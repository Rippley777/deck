import { useRef, useState } from 'react';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { useDeck } from '../../stores/deck';
import { localIdentity } from '../../lib/sync-policy';
import { discoverProjectFiles, type DiscoveredProject } from '../../lib/discovery';
export function ProjectDiscovery() {
  const input = useRef<HTMLInputElement>(null);
  const [projects, setProjects] = useState<DiscoveredProject[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [scanned, setScanned] = useState(false);
  const show = (found: DiscoveredProject[]) => {
    setProjects(found);
    setSelected(found.map((p) => p.path));
    setScanned(true);
  };
  return (
    <div className="project-discovery">
      <h4>Project Discovery</h4>
      <p className="small-muted">
        Find projects in a folder, then choose which ones to turn into Stacks. Files stay on this
        device.
      </p>
      <input
        ref={(element) => {
          input.current = element;
          element?.setAttribute('webkitdirectory', '');
        }}
        type="file"
        multiple
        hidden
        onChange={(e) =>
          show(
            discoverProjectFiles(Array.from(e.target.files || []).map((f) => f.webkitRelativePath)),
          )
        }
      />
      <button
        className="secondary-button"
        disabled={busy}
        onClick={async () => {
          setError('');
          if (!isTauri()) {
            input.current?.click();
            return;
          }
          setBusy(true);
          try {
            const found = await invoke<DiscoveredProject[] | null>('discover_projects');
            if (found) show(found);
          } catch (e) {
            setError(String(e));
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? 'Looking for projects…' : 'Choose project folder'}
      </button>
      {projects.map((project) => (
        <label className="setting-row" key={project.path}>
          <span>
            {project.name}
            <small>{project.path}</small>
          </span>
          <input
            type="checkbox"
            checked={selected.includes(project.path)}
            onChange={(e) =>
              setSelected(
                e.target.checked
                  ? [...selected, project.path]
                  : selected.filter((p) => p !== project.path),
              )
            }
          />
        </label>
      ))}
      {scanned && !projects.length && (
        <p>
          No projects found. Look for folders containing package.json, Cargo.toml, pyproject.toml,
          go.mod, or a Git repository.
        </p>
      )}
      {!!selected.length && (
        <button
          className="primary-button"
          onClick={() => {
            const current = useDeck.getState().data;
            const paths = { ...current.local?.projectPaths };
            const additions = projects
              .filter((p) => selected.includes(p.path))
              .map((project) => {
                const id = crypto.randomUUID();
                if (project.localPath) paths[id] = project.localPath;
                return {
                  id,
                  name: project.name,
                  icon: 'lucide:folder',
                  color: '#b5a0d5',
                  notes: '',
                  deadline: null,
                  headings: [],
                  links: [],
                };
              });
            useDeck.getState().commit({
              ...current,
              stacks: [...current.stacks, ...additions],
              local: { ...localIdentity(current), projectPaths: paths },
            });
            setSelected([]);
            useDeck.getState().notify(`${additions.length} Stacks created.`);
          }}
        >
          Create selected Stacks
        </button>
      )}
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
