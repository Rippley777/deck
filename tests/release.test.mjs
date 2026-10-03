import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  archivePrevious,
  collectTarget,
  copyVerified,
  exists,
  inventory,
  localDate,
  previousArtifacts,
} from '../scripts/release-artifacts.mjs';
import { releaseTargets, selectTargets } from '../scripts/release.mjs';

const arm = 'aarch64-apple-darwin';
const intel = 'x86_64-apple-darwin';

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'deck-release-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return {
    root,
    version: '0.1.0',
    targetDirectory: path.join(root, 'target'),
    hostTarget: arm,
    git: { gitCommit: null, gitBranch: null, gitDirty: null },
  };
}

async function put(file, content = 'installer bytes') {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, content);
  return file;
}

async function macBundles(ctx, triple = arm, dmg = true) {
  const bundle = path.join(ctx.targetDirectory, triple, 'release', 'bundle');
  await put(
    path.join(bundle, 'macos', 'Deck.app', 'Contents', 'MacOS', 'deck'),
    'native executable',
  );
  if (dmg) await put(path.join(bundle, 'dmg', 'Deck_0.1.0.dmg'));
  return bundle;
}

test('no previous artifacts creates no empty history; timestamp uses local offset', async (t) => {
  const ctx = await fixture(t);
  assert.equal(await archivePrevious(ctx), null);
  assert.equal(await exists(path.join(ctx.root, 'build-history')), false);
  const date = new Date(2026, 9, 2, 19, 5, 32);
  assert.equal(localDate(date).timestamp, '2026-10-02_19-05-32');
  assert.match(localDate(date).iso, /^2026-10-02T19:05:32[+-]\d{2}:\d{2}$/);
});

test('archives normalized and legacy bundles, manifests, checksums, but no caches or temporary DMGs', async (t) => {
  const ctx = await fixture(t);
  const current = path.join(ctx.root, 'releases', 'current');
  await put(path.join(current, 'windows', 'x64', 'Deck-old.msi'));
  await put(
    path.join(current, 'build-info.json'),
    JSON.stringify({ version: '0.0.9', gitCommit: 'old-sha', gitDirty: false }),
  );
  await put(path.join(current, 'SHA256SUMS.txt'), 'original checksum');
  await put(path.join(current, 'windows', 'x64', 'Deck-old.msi.sha256'), 'installer checksum');
  await macBundles(ctx);
  await put(
    path.join(
      ctx.targetDirectory,
      'release',
      'bundle',
      'macos',
      'Deck.app',
      'Contents',
      'MacOS',
      'deck',
    ),
  );
  await put(path.join(ctx.targetDirectory, arm, 'release', 'bundle', 'macos', 'rw.123.Deck.dmg'));
  await put(path.join(ctx.targetDirectory, 'debug', 'do-not-copy.exe'));
  await put(path.join(ctx.targetDirectory, arm, 'release', 'incremental', 'cache'));
  const date = new Date(2026, 9, 2, 19, 5, 32);
  const directory = await archivePrevious(ctx, { date });
  const manifest = JSON.parse(await fs.readFile(path.join(directory, 'build-info.json'), 'utf8'));
  assert.equal(manifest.version, '0.0.9');
  assert.equal(manifest.gitCommit, 'old-sha');
  assert.equal(manifest.gitDirty, false);
  assert.ok(manifest.platformArtifacts.includes('windows/x64/Deck-old.msi'));
  assert.ok(manifest.platformArtifacts.includes('macos/arm64/tauri/dmg/Deck_0.1.0.dmg'));
  assert.equal(
    manifest.artifacts.some((item) => /cache|rw\.|debug/.test(item.path)),
    false,
  );
  assert.equal(
    await fs.readFile(path.join(directory, 'previous-SHA256SUMS.txt'), 'utf8'),
    'original checksum',
  );
  assert.equal(
    await fs.readFile(path.join(directory, 'windows', 'x64', 'Deck-old.msi.sha256'), 'utf8'),
    'installer checksum',
  );
  assert.equal(
    await fs.readFile(path.join(current, 'windows', 'x64', 'Deck-old.msi'), 'utf8'),
    'installer bytes',
  );
  assert.equal(await exists(path.join(directory, 'linux')), false);
  const second = await archivePrevious(ctx, { date });
  assert.notEqual(second, directory);
  assert.equal(second, `${directory}_1`);
  assert.equal(await exists(path.join(directory, 'build-info.json')), true);
});

test('copy errors and corrupted copies stop archival and preserve originals', async (t) => {
  const ctx = await fixture(t);
  const source = await put(path.join(ctx.root, 'releases', 'current', 'linux', 'x64', 'Deck.deb'));
  await assert.rejects(
    archivePrevious(ctx, {
      copy: async () => {
        throw new Error('disk full');
      },
    }),
    /Archive failed.*disk full/,
  );
  await assert.rejects(
    archivePrevious(ctx, {
      copy: async (_, destination) => {
        await fs.writeFile(destination, 'corrupt');
      },
    }),
    /Copy verification failed/,
  );
  assert.equal(await fs.readFile(source, 'utf8'), 'installer bytes');
});

test('verified app copies preserve executable modes and relative symlinks', async (t) => {
  const ctx = await fixture(t);
  await macBundles(ctx);
  const app = path.join(ctx.targetDirectory, arm, 'release', 'bundle', 'macos', 'Deck.app');
  await fs.chmod(path.join(app, 'Contents', 'MacOS', 'deck'), 0o755);
  if (process.platform !== 'win32')
    await fs.symlink('MacOS/deck', path.join(app, 'Contents', 'Current'));
  const destination = path.join(ctx.root, 'copied.app');
  await copyVerified(app, destination);
  assert.deepEqual(await inventory(app), await inventory(destination));
});

test('detects unknown legacy architecture instead of silently overwriting it', async (t) => {
  const ctx = await fixture(t);
  await put(path.join(ctx.targetDirectory, 'unknown-target', 'release', 'bundle', 'Deck.deb'));
  await assert.rejects(previousArtifacts(ctx), /Cannot identify architecture/);
});

test('native OS rules, missing Rust targets, and universal Mac prerequisites are explicit', () => {
  assert.deepEqual(selectTargets('darwin', arm, [arm, intel]).selected, [arm, intel]);
  assert.match(
    selectTargets('darwin', arm, [arm]).skipped.join('\n'),
    /x86_64-apple-darwin: Rust target unavailable/,
  );
  assert.throws(() => selectTargets('darwin', arm, [arm], intel), /rustup target add/);
  assert.throws(
    () => selectTargets('darwin', arm, [arm], 'universal-apple-darwin'),
    /rustup target add/,
  );
  assert.throws(() => selectTargets('darwin', arm, [arm], 'x86_64-pc-windows-msvc'), /native OS/);
  assert.throws(
    () => selectTargets('linux', 'aarch64-unknown-linux-gnu', ['x86_64-unknown-linux-gnu']),
    /native x64/,
  );
  assert.deepEqual(
    selectTargets('win32', 'x86_64-pc-windows-msvc', ['x86_64-pc-windows-msvc']).selected,
    ['x86_64-pc-windows-msvc'],
  );
});

test('collection normalizes installers and rejects zero-byte outputs without replacing current', async (t) => {
  const ctx = await fixture(t);
  await macBundles(ctx);
  const old = await put(
    path.join(ctx.root, 'releases', 'current', 'macos', 'arm64', 'previous.dmg'),
  );
  const archive = await archivePrevious(ctx);
  const result = await collectTarget(ctx, arm);
  assert.equal(result.missing.length, 0);
  assert.ok(result.artifacts.some((file) => file.endsWith('Deck-0.1.0-macos-arm64.dmg')));
  assert.equal(await exists(old), false);
  assert.equal(await exists(path.join(archive, 'macos', 'arm64', 'previous.dmg')), true);
  assert.match(
    await fs.readFile(
      path.join(ctx.root, 'releases', 'current', 'macos', 'arm64', 'SHA256SUMS.txt'),
      'utf8',
    ),
    /[0-9a-f]{64}  Deck-0.1.0-macos-arm64.dmg/,
  );
  await put(path.join(ctx.targetDirectory, arm, 'release', 'bundle', 'dmg', 'Deck_0.1.0.dmg'), '');
  await assert.rejects(collectTarget(ctx, arm), /Empty artifact/);
  assert.equal(
    await fs.readFile(
      path.join(ctx.root, 'releases', 'current', 'macos', 'arm64', 'Deck-0.1.0-macos-arm64.dmg'),
      'utf8',
    ),
    'installer bytes',
  );
});

test('a failed target preserves successful and partial targets; stale installers never count', async (t) => {
  const ctx = await fixture(t);
  await macBundles(ctx, intel);
  const archive = await archivePrevious(ctx);
  let count = 0;
  const results = await releaseTargets(ctx, [arm, intel], async (triple) => {
    count++;
    await macBundles(ctx, triple, triple === arm);
    return { ok: triple === arm, reason: 'DMG packaging failed' };
  });
  assert.equal(count, 2);
  assert.equal(results[0].status, 'complete');
  assert.equal(results[1].status, 'failed');
  assert.equal(results[1].error, 'DMG packaging failed');
  assert.ok(results[1].artifacts.some((file) => file.endsWith('Deck.app')));
  assert.equal(
    await exists(
      path.join(ctx.root, 'releases', 'current', 'macos', 'x64', 'Deck-0.1.0-macos-x64.dmg'),
    ),
    false,
  );
  assert.equal(
    await exists(path.join(archive, 'macos', 'x64', 'tauri', 'dmg', 'Deck_0.1.0.dmg')),
    true,
  );
});

test('successful Tauri exit without all installers still reports failure', async (t) => {
  const ctx = await fixture(t);
  const results = await releaseTargets(ctx, [arm], async () => {
    await macBundles(ctx, arm, false);
    return { ok: true };
  });
  assert.equal(results[0].status, 'failed');
  assert.match(results[0].error, /Missing expected artifacts: .dmg/);
});

test('Windows and Linux collect their actual formats with clear architecture names', async (t) => {
  const ctx = await fixture(t);
  for (const [triple, files, folder] of [
    ['x86_64-pc-windows-msvc', ['Deck_0.1.0_x64-setup.exe', 'Deck_0.1.0_x64.msi'], 'windows/x64'],
    [
      'x86_64-unknown-linux-gnu',
      ['Deck_0.1.0.AppImage', 'Deck_0.1.0.deb', 'Deck_0.1.0.rpm'],
      'linux/x64',
    ],
  ]) {
    for (const name of files)
      await put(path.join(ctx.targetDirectory, triple, 'release', 'bundle', name));
    const result = await collectTarget(ctx, triple);
    assert.equal(result.missing.length, 0);
    assert.ok(result.artifacts.every((file) => file.includes(path.join(...folder.split('/')))));
  }
});

test(
  'real CLI archives before building, rejects concurrent runs, and never builds after archive failure',
  { skip: process.platform === 'win32' },
  async (t) => {
    const ctx = await fixture(t);
    const scriptSource = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../scripts');
    await fs.cp(scriptSource, path.join(ctx.root, 'scripts'), { recursive: true });
    await put(
      path.join(ctx.root, 'package.json'),
      JSON.stringify({ type: 'module', version: ctx.version }),
    );
    await put(
      path.join(ctx.root, 'src-tauri', 'tauri.conf.json'),
      JSON.stringify({ version: ctx.version }),
    );
    const triple = process.platform === 'darwin' ? arm : 'x86_64-unknown-linux-gnu';
    const fakeBin = path.join(ctx.root, 'bin');
    for (const [name, output] of Object.entries({
      cargo: JSON.stringify({
        packages: [{ name: 'deck', version: ctx.version }],
        target_directory: ctx.targetDirectory,
      }),
      rustc: `host: ${triple}`,
      rustup: triple,
      xcrun: '/fake/sdk',
      'pkg-config': '',
      patchelf: '0.18',
    })) {
      const file = await put(
        path.join(fakeBin, name),
        `#!${process.execPath}\nconsole.log(${JSON.stringify(output)});\n`,
      );
      await fs.chmod(file, 0o755);
    }
    await put(
      path.join(ctx.root, 'node_modules', '@tauri-apps', 'cli', 'tauri.js'),
      `
      import fs from 'node:fs';
      import path from 'node:path';
      import { spawnSync } from 'node:child_process';
      const hook = spawnSync(process.execPath, ['scripts/release.mjs', '--before-build'], { encoding: 'utf8' });
      if (hook.status !== 0) throw new Error(hook.stderr);
      const root = process.cwd();
      const archives = fs.readdirSync(path.join(root, 'build-history'));
      if (!archives.some(name => fs.existsSync(path.join(root, 'build-history', name, 'build-info.json')))) throw new Error('Build began without verified archive');
      fs.writeFileSync('.build-started', 'yes');
      const bundle = path.join(root, 'target', ${JSON.stringify(triple)}, 'release', 'bundle');
      const files = ${JSON.stringify(process.platform === 'darwin' ? ['macos/Deck.app/Contents/MacOS/deck', 'dmg/Deck.dmg'] : ['Deck.AppImage', 'Deck.deb', 'Deck.rpm'])};
      for (const name of files) {
        const file = path.join(bundle, name);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, 'new release bytes');
      }
    `,
    );
    const old = await put(path.join(ctx.root, 'releases', 'current', 'linux', 'x64', 'old.deb'));
    const run = (...args) =>
      spawnSync(process.execPath, [path.join(ctx.root, 'scripts', 'release.mjs'), ...args], {
        encoding: 'utf8',
        timeout: 30_000,
        env: {
          ...process.env,
          DECK_RELEASE_TOKEN: '',
          PATH: `${fakeBin}${path.delimiter}${process.env.PATH}`,
        },
      });
    const success = run('--target', triple);
    assert.equal(success.status, 0, success.stderr);
    assert.match(success.stdout, /Deck Release Complete/);
    assert.equal(await exists(path.join(ctx.root, '.build-started')), true);
    const history = path.join(ctx.root, 'build-history');
    const archives = await fs.readdir(history);
    assert.equal(archives.length, 1, 'the hook must not archive twice in the same run');
    assert.equal(await exists(path.join(history, archives[0], 'linux', 'x64', 'old.deb')), true);
    await fs.rm(path.join(ctx.root, '.build-started'));
    const lock = path.join(ctx.root, 'releases', '.release-lock.json');
    await put(lock, '{}');
    const concurrent = run('--target', triple);
    assert.equal(concurrent.status, 1);
    assert.match(concurrent.stderr, /Another release is running/);
    await fs.rm(lock);
    const keepHistory = path.join(ctx.root, 'original-history');
    await fs.rename(history, keepHistory);
    await put(history, 'blocked archive destination');
    const blocked = run('--target', triple);
    assert.equal(blocked.status, 1);
    assert.match(blocked.stderr, /Deck release stopped/);
    assert.equal(await exists(path.join(ctx.root, '.build-started')), false);
    assert.equal(await exists(lock), false);
    // The existing target's bundle and current output survive the rejected archive.
    assert.equal(
      (await fs.readdir(path.join(ctx.targetDirectory, triple, 'release', 'bundle'))).length > 0,
      true,
    );
    if (process.platform === 'darwin')
      assert.equal(await fs.readFile(old, 'utf8'), 'installer bytes');
    const rawHook = run('--before-build');
    assert.equal(rawHook.status, 1, 'raw Tauri hook also rejects an archive failure');
  },
);
