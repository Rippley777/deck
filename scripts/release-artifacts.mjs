import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import * as fs from 'node:fs/promises';
import path from 'node:path';

export const targets = {
  'aarch64-apple-darwin': { platform: 'macos', arch: 'arm64', bundles: ['app', 'dmg'] },
  'x86_64-apple-darwin': { platform: 'macos', arch: 'x64', bundles: ['app', 'dmg'] },
  'universal-apple-darwin': { platform: 'macos', arch: 'universal', bundles: ['app', 'dmg'] },
  'x86_64-pc-windows-msvc': { platform: 'windows', arch: 'x64', bundles: ['msi', 'nsis'] },
  'x86_64-unknown-linux-gnu': {
    platform: 'linux',
    arch: 'x64',
    bundles: ['appimage', 'deb', 'rpm'],
  },
};

export async function exists(file) {
  try {
    await fs.lstat(file);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

const artifactPattern =
  /\.(app|dmg|pkg|exe|msi|AppImage|deb|rpm|app\.tar\.gz|AppImage\.tar\.gz)(\.sig)?$/i;
const metadataPattern =
  /^(.*(?:checksum|manifest).*|.*SUMS.*|.*\.(?:sha256|sha512|md5)|build-info\.json|latest\.json)$/i;

// Stop at .app directories: their contents and relative symlinks form one signed bundle.
export async function findArtifacts(directory, includeMetadata = true) {
  if (!(await exists(directory))) return [];
  const result = [];
  async function visit(dir) {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (/^rw\./.test(entry.name)) continue; // Tauri's temporary, unfinalized DMG images.
      if (
        artifactPattern.test(entry.name) ||
        (includeMetadata && metadataPattern.test(entry.name))
      ) {
        if (entry.isSymbolicLink()) throw new Error(`Artifact must not be a symlink: ${file}`);
        if (entry.isFile() || (entry.isDirectory() && entry.name.endsWith('.app')))
          result.push(file);
      } else if (entry.isDirectory()) {
        await visit(file);
      }
    }
  }
  await visit(directory);
  return result.sort();
}

async function hashFile(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

// Hash every file, symlink target and mode so verification also catches incomplete .apps.
export async function inventory(file) {
  const entries = [];
  let bytes = 0;
  async function visit(current, relative) {
    const stat = await fs.lstat(current);
    const mode = stat.mode & 0o777;
    if (stat.isSymbolicLink()) {
      const link = await fs.readlink(current);
      if (path.isAbsolute(link))
        throw new Error(`Absolute bundle symlink cannot be copied safely: ${current}`);
      entries.push({ path: relative, type: 'link', link, mode });
    } else if (stat.isDirectory()) {
      entries.push({ path: relative, type: 'directory', mode });
      for (const name of (await fs.readdir(current)).sort())
        await visit(path.join(current, name), `${relative}/${name}`);
    } else if (stat.isFile()) {
      bytes += stat.size;
      entries.push({
        path: relative,
        type: 'file',
        size: stat.size,
        mode,
        sha256: await hashFile(current),
      });
    } else {
      throw new Error(`Unsupported artifact entry: ${current}`);
    }
  }
  await visit(file, '.');
  return { bytes, entries };
}

export async function copyVerified(source, destination, copy = fs.cp) {
  const before = await inventory(source);
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await copy(source, destination, {
    recursive: true,
    dereference: false,
    verbatimSymlinks: true,
    preserveTimestamps: true,
    errorOnExist: true,
    force: false,
  });
  const after = await inventory(destination);
  if (
    JSON.stringify(before) !== JSON.stringify(after) ||
    JSON.stringify(before) !== JSON.stringify(await inventory(source))
  ) {
    throw new Error(`Copy verification failed: ${source}`);
  }
  return after;
}

export function localDate(date = new Date()) {
  const pad = (value) => String(value).padStart(2, '0');
  const timestamp = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`;
  const offset = -date.getTimezoneOffset();
  const iso = `${timestamp.replace('_', 'T').replace(/T(\d\d)-(\d\d)-(\d\d)/, 'T$1:$2:$3')}${offset >= 0 ? '+' : '-'}${pad(Math.floor(Math.abs(offset) / 60))}:${pad(Math.abs(offset) % 60)}`;
  return { timestamp, iso };
}

export async function writeJson(file, data) {
  // Write then rename: a failed write cannot truncate a previous manifest.
  const temp = `${file}.tmp`;
  await fs.writeFile(temp, `${JSON.stringify(data, null, 2)}\n`);
  await fs.rename(temp, file);
}

export async function writeChecksums(directory) {
  const lines = [];
  for (const file of await findArtifacts(directory, false)) {
    const relative = path.relative(directory, file).split(path.sep).join('/');
    for (const entry of (await inventory(file)).entries) {
      if (entry.type === 'file')
        lines.push(
          `${entry.sha256}  ${entry.path === '.' ? relative : relative + entry.path.slice(1)}`,
        );
    }
  }
  await fs.writeFile(path.join(directory, 'SHA256SUMS.txt'), `${lines.join('\n')}\n`);
}

export async function previousArtifacts({ root, targetDirectory, hostTarget }) {
  const current = path.join(root, 'releases', 'current');
  const entries = (await findArtifacts(current)).map((source) => ({
    source,
    destination: path.relative(current, source),
  }));
  // Cargo metadata resolves CARGO_TARGET_DIR and .cargo/config.toml for us.
  const locations = [
    {
      directory: path.join(targetDirectory, 'release', 'bundle'),
      target: hostTarget,
      native: true,
    },
  ];
  if (await exists(targetDirectory)) {
    for (const dir of await fs.readdir(targetDirectory, { withFileTypes: true })) {
      if (dir.isDirectory() && dir.name !== 'release' && dir.name !== 'debug') {
        locations.push({
          directory: path.join(targetDirectory, dir.name, 'release', 'bundle'),
          target: dir.name,
        });
      }
    }
  }
  for (const location of locations) {
    const files = await findArtifacts(location.directory);
    if (!files.length) continue;
    const target = targets[location.target];
    if (!target)
      throw new Error(`Cannot identify architecture of existing bundles: ${location.directory}`);
    for (const source of files)
      entries.push({
        source,
        destination: path.join(
          target.platform,
          target.arch,
          location.native ? 'tauri-native' : 'tauri',
          path.relative(location.directory, source),
        ),
      });
  }
  return entries;
}

export async function archivePrevious(context, { date = new Date(), copy } = {}) {
  const entries = await previousArtifacts(context);
  if (!entries.some(({ source }) => artifactPattern.test(source))) return null;
  const { timestamp, iso } = localDate(date);
  const history = path.join(context.root, 'build-history');
  await fs.mkdir(history, { recursive: true });
  // Exclusive mkdir prevents collisions, even for two runs in the same second.
  let directory;
  for (let suffix = 0; ; suffix++) {
    directory = path.join(history, `v${context.version}_${timestamp}${suffix ? `_${suffix}` : ''}`);
    try {
      await fs.mkdir(directory);
      break;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
  }
  try {
    const artifacts = [];
    for (const entry of entries) {
      // Preserve the original release manifest separately from the archive's manifest.
      const destination = ['build-info.json', 'SHA256SUMS.txt'].includes(entry.destination)
        ? `previous-${entry.destination}`
        : entry.destination;
      const verified = await copyVerified(entry.source, path.join(directory, destination), copy);
      artifacts.push({ path: destination.split(path.sep).join('/'), bytes: verified.bytes });
    }
    let previousInfo = null;
    const oldManifest = path.join(directory, 'previous-build-info.json');
    if (await exists(oldManifest)) {
      try {
        previousInfo = JSON.parse(await fs.readFile(oldManifest, 'utf8'));
      } catch {
        /* Keep the original bytes. */
      }
    }
    await writeChecksums(directory);
    await writeJson(path.join(directory, 'build-info.json'), {
      app: 'Deck',
      version: previousInfo?.version ?? context.version,
      archivedAt: iso,
      gitCommit: previousInfo?.gitCommit ?? null,
      gitBranch: previousInfo?.gitBranch ?? null,
      gitDirty: previousInfo?.gitDirty ?? null,
      archivedBy: context.git,
      platformArtifacts: artifacts
        .filter((item) => artifactPattern.test(item.path))
        .map((item) => item.path),
      artifacts,
      legacyMetadataNote:
        'Raw Tauri bundles may predate the current version and Git checkout; their provenance is unknown.',
    });
    return directory;
  } catch (error) {
    // Keep the partial archive for diagnosis. Never touch its sources on failure.
    throw new Error(
      `Archive failed at ${directory}; existing builds were left untouched. ${error.message}`,
      { cause: error },
    );
  }
}

function normalizedName(source, context, target) {
  const name = path.basename(source);
  if (name.endsWith('.app')) return name; // Preserve the signed application's name and contents.
  const extension = name.match(
    /\.(app\.tar\.gz|AppImage\.tar\.gz|AppImage|dmg|pkg|exe|msi|deb|rpm)(\.sig)?$/i,
  );
  if (!extension) return name;
  const installer = /\.exe(\.sig)?$/i.test(name) && /setup/i.test(name) ? '-setup' : '';
  return `Deck-${context.version}-${target.platform}-${target.arch}${installer}.${extension[1]}${extension[2] ?? ''}`;
}

export async function collectTarget(context, triple, { requireAll = true } = {}) {
  const target = targets[triple];
  const bundle = path.join(context.targetDirectory, triple, 'release', 'bundle');
  const sources = await findArtifacts(bundle);
  const distributables = sources.filter(
    (file) => artifactPattern.test(file) && !file.endsWith('.sig'),
  );
  if (!distributables.length) throw new Error(`No distributable artifacts generated for ${triple}`);
  const expected =
    target.platform === 'macos'
      ? ['.app', '.dmg']
      : target.platform === 'windows'
        ? ['.msi', '.exe']
        : ['.AppImage', '.deb', '.rpm'];
  const missing = expected.filter(
    (extension) => !distributables.some((file) => file.endsWith(extension)),
  );
  const current = path.join(context.root, 'releases', 'current');
  const destination = path.join(current, target.platform, target.arch);
  const stage = path.join(context.root, 'releases', `.stage-${triple}-${process.pid}`);
  await fs.mkdir(path.dirname(stage), { recursive: true });
  await fs.mkdir(stage); // Never reuse leftovers from an interrupted run.
  try {
    const names = new Set();
    for (const source of sources) {
      const name = normalizedName(source, context, target);
      if (names.has(name)) throw new Error(`Artifact name collision: ${name}`);
      names.add(name);
      const info = await copyVerified(source, path.join(stage, name));
      if (!info.bytes) throw new Error(`Empty artifact: ${source}`);
    }
    await writeJson(path.join(stage, 'build-info.json'), {
      app: 'Deck',
      version: context.version,
      builtAt: localDate().iso,
      ...context.git,
      target: triple,
      status: requireAll && !missing.length ? 'complete' : 'partial',
      missing,
      platformArtifacts: [...names].filter((name) => artifactPattern.test(name)),
    });
    await writeChecksums(stage);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    // Caller has already verified the archive; keep old output until collection succeeds.
    const backup = `${destination}.previous-${process.pid}`;
    const hadPrevious = await exists(destination);
    if (hadPrevious) await fs.rename(destination, backup);
    try {
      await fs.rename(stage, destination);
    } catch (error) {
      if (hadPrevious) await fs.rename(backup, destination);
      throw error;
    }
    if (hadPrevious) await fs.rm(backup, { recursive: true });
    return { artifacts: [...names].map((name) => path.join(destination, name)), missing };
  } finally {
    await fs.rm(stage, { recursive: true, force: true });
  }
}
