export interface DiscoveredProject {
  name: string;
  path: string;
  localPath?: string;
}
/** Browser directory imports expose relative names only. No file contents are read. */
export function discoverProjectFiles(paths: string[]): DiscoveredProject[] {
  const directories = new Set<string>();
  for (const path of paths) {
    if (!/(^|\/)(package\.json|Cargo\.toml|pyproject\.toml|go\.mod|\.git\/config)$/.test(path))
      continue;
    if (
      path
        .split('/')
        .some((part) => ['node_modules', 'target', 'vendor', 'dist', '.venv'].includes(part))
    )
      continue;
    const directory = path.replace(
      /\/(package\.json|Cargo\.toml|pyproject\.toml|go\.mod|\.git\/config)$/,
      '',
    );
    if (directory) directories.add(directory);
  }
  return [...directories].sort().map((path) => ({ name: path.split('/').at(-1) || path, path }));
}
