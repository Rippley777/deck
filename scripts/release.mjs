import { spawn, spawnSync } from 'node:child_process';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import {
  archivePrevious,
  collectTarget,
  exists,
  findArtifacts,
  localDate,
  targets,
  writeChecksums,
  writeJson,
} from './release-artifacts.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const releases = path.join(root, 'releases');
const lockFile = path.join(releases, '.release-lock.json');

function command(executable, args, cwd = root) {
  const result = spawnSync(executable, args, { cwd, encoding: 'utf8', windowsHide: true });
  if (result.error || result.status !== 0) {
    throw new Error(
      `${executable} ${args.join(' ')} failed. ${result.error?.message ?? result.stderr?.trim() ?? ''}`,
    );
  }
  return result.stdout.trim();
}

function gitMetadata() {
  try {
    return {
      gitCommit: command('git', ['rev-parse', 'HEAD']),
      gitBranch: command('git', ['branch', '--show-current']) || null,
      gitDirty: Boolean(command('git', ['status', '--porcelain'])),
    };
  } catch {
    return { gitCommit: null, gitBranch: null, gitDirty: null };
  }
}

async function context() {
  if (Number(process.versions.node.split('.')[0]) < 22)
    throw new Error('Deck releases require Node.js 22+. Switch Node versions, then run npm ci.');
  const config = JSON.parse(
    await fs.readFile(path.join(root, 'src-tauri', 'tauri.conf.json'), 'utf8'),
  );
  const pkg = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
  if (!/^\d+\.\d+\.\d+(?:-[\w.-]+)?(?:\+[\w.-]+)?$/.test(config.version))
    throw new Error('Expected a filesystem-safe application version in tauri.conf.json.');
  const metadata = JSON.parse(
    command(
      'cargo',
      ['metadata', '--no-deps', '--format-version', '1'],
      path.join(root, 'src-tauri'),
    ),
  );
  const crate = metadata.packages.find((item) => item.name === 'deck');
  if (pkg.version !== config.version || crate?.version !== config.version)
    throw new Error('Version mismatch: package.json, Cargo.toml and tauri.conf.json must agree.');
  const hostTarget = command('rustc', ['-vV']).match(/^host: (.+)$/m)?.[1];
  if (!hostTarget) throw new Error('Could not determine the Rust host target.');
  return {
    root,
    version: config.version,
    targetDirectory: metadata.target_directory,
    hostTarget,
    git: gitMetadata(),
  };
}

function parseArgs(args) {
  if (args.length === 1 && ['--before-build', '--archive-only', '--help'].includes(args[0]))
    return { mode: args[0] };
  if (!args.length) return { mode: 'release' };
  if (args.length === 2 && args[0] === '--target' && targets[args[1]])
    return { mode: 'release', target: args[1] };
  throw new Error(
    'Usage: npm run release [-- --target <Rust target>] (see npm run release -- --help)',
  );
}

async function acquireLock() {
  await fs.mkdir(releases, { recursive: true });
  const token = randomUUID();
  let handle;
  try {
    handle = await fs.open(lockFile, 'wx');
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    throw new Error(
      `Another release is running, or an interrupted release left ${lockFile}. Check that no Deck build is running before manually removing this lock.`,
    );
  }
  try {
    await handle.writeFile(JSON.stringify({ pid: process.pid, token, archived: false }));
  } catch (error) {
    await fs.rm(lockFile, { force: true });
    throw error;
  } finally {
    await handle.close();
  }
  return token;
}

async function parentAlreadyArchived() {
  if (!process.env.DECK_RELEASE_TOKEN) return false;
  const lock = JSON.parse(await fs.readFile(lockFile, 'utf8'));
  if (lock.token !== process.env.DECK_RELEASE_TOKEN || !lock.archived)
    throw new Error('Invalid release archive guard.');
  process.kill(lock.pid, 0); // The orchestrator must still be alive.
  return true;
}

export function selectTargets(platform, host, installed, requested) {
  const nativePlatform = { darwin: 'macos', win32: 'windows', linux: 'linux' }[platform];
  if (!nativePlatform) throw new Error(`Unsupported release host: ${platform}`);
  const desired = requested
    ? [requested]
    : nativePlatform === 'macos'
      ? [host, host === 'aarch64-apple-darwin' ? 'x86_64-apple-darwin' : 'aarch64-apple-darwin']
      : [nativePlatform === 'windows' ? 'x86_64-pc-windows-msvc' : 'x86_64-unknown-linux-gnu'];
  const selected = [];
  const skipped = [];
  for (const triple of desired) {
    const target = targets[triple];
    if (!target || target.platform !== nativePlatform)
      throw new Error(
        `Build ${triple} on its native OS; use the desktop-release GitHub Actions matrix.`,
      );
    if (nativePlatform !== 'macos' && host !== triple)
      throw new Error(`A native x64 ${nativePlatform} toolchain is required for ${triple}.`);
    const required =
      triple === 'universal-apple-darwin'
        ? ['aarch64-apple-darwin', 'x86_64-apple-darwin']
        : [triple];
    const missing = required.filter((item) => !installed.includes(item));
    if (missing.length) {
      const reason = `${triple}: Rust target unavailable; run rustup target add ${missing.join(' ')}`;
      if (requested || triple === host) throw new Error(reason);
      skipped.push(reason);
    } else selected.push(triple);
  }
  for (const other of ['macos', 'windows', 'linux'].filter((item) => item !== nativePlatform))
    skipped.push(`${other}: requires a native ${other} runner`);
  return { selected, skipped };
}

async function validateEnvironment(ctx, requested) {
  const cli = path.join(root, 'node_modules', '@tauri-apps', 'cli', 'tauri.js');
  if (!(await exists(cli))) throw new Error('Tauri CLI is missing. Run npm ci first.');
  const installed = command('rustup', ['target', 'list', '--installed']).split(/\s+/);
  const selection = selectTargets(process.platform, ctx.hostTarget, installed, requested);
  if (process.platform === 'darwin') {
    command('xcrun', ['--find', 'clang']);
    command('xcrun', ['--show-sdk-path']);
  } else if (process.platform === 'linux') {
    command('pkg-config', ['--exists', 'webkit2gtk-4.1', 'gtk+-3.0', 'dbus-1']);
    command('patchelf', ['--version']);
  }
  return { cli, ...selection };
}

function build(cli, triple, token) {
  const args = [
    cli,
    'build',
    '--target',
    triple,
    '--bundles',
    targets[triple].bundles.join(','),
    '--',
    '--locked',
  ];
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, {
      cwd: root,
      stdio: 'inherit',
      env: {
        ...process.env,
        DECK_RELEASE_TOKEN: token,
        ...(process.platform === 'darwin' ? { LC_ALL: 'C', LANG: 'C', LC_CTYPE: 'C' } : {}),
        // Desktop builds must include the local workspace, even in a portal shell.
        VITE_DECK_PORTAL: 'false',
      },
    });
    child.once('error', (error) => resolve({ ok: false, reason: error.message }));
    child.once('exit', (code, signal) =>
      resolve({ ok: code === 0, reason: `Tauri exited with ${signal ?? code}` }),
    );
  });
}

export async function releaseTargets(ctx, selected, runBuild, onResult = async () => {}) {
  const results = [];
  for (const triple of selected) {
    console.log(`\nBuilding ${triple}…`);
    try {
      // Remove only this target's old bundles after the caller verified the archive.
      // This prevents stale installers from passing verification after a failed build.
      await fs.rm(path.join(ctx.targetDirectory, triple, 'release', 'bundle'), {
        recursive: true,
        force: true,
      });
      const built = await runBuild(triple);
      const collected = await collectTarget(ctx, triple, { requireAll: built.ok });
      const ok = built.ok && !collected.missing.length;
      results.push({
        target: triple,
        status: ok ? 'complete' : 'failed',
        artifacts: collected.artifacts.map((file) =>
          path.relative(ctx.root, file).split(path.sep).join('/'),
        ),
        ...(!ok
          ? {
              error: built.ok
                ? `Missing expected artifacts: ${collected.missing.join(', ')}`
                : built.reason,
            }
          : {}),
      });
    } catch (error) {
      results.push({ target: triple, status: 'failed', error: error.message, artifacts: [] });
    }
    await onResult(results);
  }
  return results;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.mode === '--help') {
    console.log(
      `npm run release                          Build for this OS (both installed Mac architectures)\nnpm run release -- --target <target>       Build one target on its native OS\nnpm run release:archive                   Archive only; never delete history\nTargets: ${Object.keys(targets).join(', ')}\nOutput: releases/current/<platform>/<architecture>/\nHistory: build-history/v<version>_YYYY-MM-DD_HH-mm-ss/`,
    );
    return;
  }
  if (options.mode === '--before-build' && (await parentAlreadyArchived())) return;
  const ctx = await context();
  const environment =
    options.mode === 'release' ? await validateEnvironment(ctx, options.target) : null;
  const token = await acquireLock();
  try {
    const archive = await archivePrevious(ctx);
    console.log(
      archive
        ? `Previous builds archived and verified: ${path.relative(root, archive)}`
        : 'No previous distributable artifacts to archive.',
    );
    if (!environment) return;
    await writeJson(lockFile, { pid: process.pid, token, archived: true });
    const current = path.join(releases, 'current');
    const updateManifest = async (results) => {
      if (!(await exists(current))) return;
      const artifacts = (await findArtifacts(current, false)).map((file) =>
        path.relative(current, file).split(path.sep).join('/'),
      );
      await writeJson(path.join(current, 'build-info.json'), {
        app: 'Deck',
        version: ctx.version,
        builtAt: localDate().iso,
        ...ctx.git,
        status:
          results.length === environment.selected.length &&
          results.every((item) => item.status === 'complete')
            ? 'complete'
            : 'partial',
        archive: archive ? path.relative(root, archive).split(path.sep).join('/') : null,
        platformArtifacts: artifacts,
        targets: results,
        skipped: environment.skipped,
        note: 'Other target directories are preserved from prior runs; use their build-info.json for version and provenance.',
      });
      await writeChecksums(current);
    };
    const results = await releaseTargets(
      ctx,
      environment.selected,
      (triple) => build(environment.cli, triple, token),
      updateManifest,
    );
    const failed = results.some((item) => item.status !== 'complete');
    console.log(
      `\nDeck Release ${failed ? 'Failed' : 'Complete'}\nVersion: ${ctx.version}\nCommit: ${ctx.git.gitCommit ?? 'unavailable'}\nArchive: ${archive ? path.relative(root, archive) : 'none (first build)'}`,
    );
    for (const result of results) {
      console.log(
        `\n${result.target}: ${result.status}${result.error ? ` — ${result.error}` : ''}`,
      );
      for (const artifact of result.artifacts) console.log(`  ${artifact}`);
    }
    for (const skipped of environment.skipped) console.log(`Skipped — ${skipped}`);
    if (failed) process.exitCode = 1;
  } finally {
    await fs.rm(lockFile, { force: true });
  }
}

if (process.argv[1] && (await fs.realpath(process.argv[1])) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`Deck release stopped: ${error.message}`);
    process.exitCode = 1;
  });
}
