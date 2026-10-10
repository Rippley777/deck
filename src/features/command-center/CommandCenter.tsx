import { useEffect, useState } from 'react';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { ArrowUpRight, Github, RefreshCw, Plus, Network, SlidersHorizontal } from 'lucide-react';
import { useDeck } from '../../stores/deck';
import { api, openAccount, useCloud } from '../../lib/cloud';
import { deckOwner } from '../../lib/sync-policy';
import {
  importRepositories,
  projectHealth,
  repositoryMatches,
  sortProjects,
  type ProjectHealth,
  type WorkItem,
} from '../../lib/command-center';
import {
  commandSnapshotSchema,
  repositorySchema,
  defaultWeights,
  githubUrl,
  type CommandSnapshot,
  type Repository,
  type Weights,
} from '../../../shared/command-center';
import type { Stack } from '../../types';
import { Modal } from '../../components/ui';
import './command-center.css';

const groupLabels: Record<keyof ProjectHealth['groups'], string> = {
  tasks: 'Deck tasks',
  overdue: 'Overdue tasks',
  issues: 'GitHub issues',
  reviews: 'PRs awaiting review',
  workflows: 'Failed workflows',
  blocked: 'Blocked work',
  deadlines: 'Upcoming deadlines',
  deployments: 'Deployment failures',
  milestones: 'Milestones',
  risks: 'Flagged risks',
};
const when = (date: string | null) =>
  date
    ? new Date(date).toLocaleString([], {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      })
    : 'No recorded activity';
function GitHubLink({ url, children }: { url: string; children: React.ReactNode }) {
  return githubUrl.safeParse(url).success ? (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      onClick={(e) => {
        if (isTauri()) {
          e.preventDefault();
          void invoke('open_github_resource', { url }).catch((error) =>
            useDeck.getState().notify(String(error)),
          );
        }
      }}
    >
      {children}
      <ArrowUpRight size={12} aria-hidden="true" />
    </a>
  ) : (
    <span>{children}</span>
  );
}
export function CommandCenter() {
  const { data, commit, setView, setModal, select, localGraph, search } = useDeck();
  const user = useCloud((s) => s.user);
  const accountId = user?.id;
  const owner = deckOwner(data);
  const allowed = !!accountId && (!owner || owner === accountId);
  const [loaded, setLoaded] = useState<{ account: string; snapshot: CommandSnapshot } | null>(null);
  const snapshot = allowed && loaded?.account === accountId ? loaded.snapshot : null;
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(false);
  const [importOpen, setImportOpen] = useState(false),
    [settingsOpen, setSettingsOpen] = useState(false);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [drill, setDrill] = useState<{
    project: string;
    group: keyof ProjectHealth['groups'];
  } | null>(null);
  const [eventProject, setEventProject] = useState('all'),
    [eventType, setEventType] = useState('all'),
    [days, setDays] = useState('7');
  const [now, setNow] = useState(() => new Date());
  const accept = (result: CommandSnapshot, id = accountId) => {
    if (id && useCloud.getState().user?.id === id)
      setLoaded({ account: id, snapshot: commandSnapshotSchema.parse(result) });
  };
  useEffect(() => {
    if (!allowed || !accountId) {
      setLoaded(null);
      return;
    }
    let stopped = false,
      pending = false;
    const load = async () => {
      if (pending || document.hidden) return;
      pending = true;
      try {
        const result = await api<CommandSnapshot>('command-center');
        if (!stopped) {
          accept(result, accountId);
          setError('');
        }
      } catch (e) {
        if (!stopped) setError(String(e));
      } finally {
        pending = false;
        if (!stopped) setLoading(false);
      }
    };
    setLoading(true);
    void load();
    const timer = setInterval(() => {
      setNow(new Date());
      void load();
    }, 30000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [accountId, allowed]);
  async function action(fn: () => Promise<void>) {
    setBusy(true);
    setError('');
    try {
      await fn();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  const projects = data.stacks.map((s) =>
    projectHealth(
      data,
      s,
      snapshot?.repositories.find((r) => r.repository.id === s.command?.repository?.id),
      now,
    ),
  );
  const active = projects.filter(
    (p) =>
      !['paused', 'archived'].includes(p.stack.command?.lifecycle || '') &&
      !p.stack.command?.repository?.archived,
  );
  const focus = sortProjects(active)
    .filter((p) => p.reasons.length)
    .slice(0, 5);
  const sort = data.settings.command?.sort || 'urgency';
  const portfolio = sortProjects(
    projects.filter((p) => !search || p.stack.name.toLowerCase().includes(search.toLowerCase())),
    sort,
  );
  const events = (snapshot?.repositories || [])
    .flatMap((r) => r.activity)
    .filter(
      (e) =>
        (eventProject === 'all' || e.repositoryId === eventProject) &&
        (eventType === 'all' || e.type === eventType) &&
        Date.parse(e.occurredAt) >= now.getTime() - Number(days) * 86400000,
    )
    .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))
    .slice(0, 100);
  const review = [
    ...(!allowed
      ? [
          owner && owner !== accountId
            ? 'Switch to this Deck’s account to load repository data.'
            : 'Connect an account to add GitHub. Local tasks are available now.',
        ]
      : []),
    ...(snapshot && !snapshot.configured
      ? ['GitHub App is not configured on this server. See docs/command-center.md.']
      : []),
    ...(snapshot?.error ? [snapshot.error] : []),
    ...(new URLSearchParams(location.search).get('github') === 'failed'
      ? ['GitHub authorization did not complete. Reconnect and try again.']
      : []),
  ];
  const setCommand = (stack: Stack, command: Stack['command']) => {
    const current = useDeck.getState().data;
    commit({
      ...current,
      stacks: current.stacks.map((s) => (s.id === stack.id ? { ...s, command } : s)),
    });
  };
  const selectedProject = projects.find((p) => p.stack.id === projectId);
  const drillProject = projects.find((p) => p.stack.id === drill?.project);
  const unknownTotals = active.some(
    (p) =>
      p.stack.command?.repository &&
      !snapshot?.repositories.find((r) => r.repository.id === p.stack.command?.repository?.id)
        ?.lastSuccess,
  );
  const total = (key: keyof ProjectHealth['groups']) =>
    active.reduce((sum, p) => sum + p.groups[key].length, 0);
  const openEvidence = (p: ProjectHealth) => {
    const first = p.reasons[0];
    return first?.url ? (
      <GitHubLink url={first.url}>{first.action}</GitHubLink>
    ) : (
      <button
        className="cc-next"
        onClick={() => (first?.taskId ? select(first.taskId) : setView(`stack:${p.stack.id}`))}
      >
        {first?.action || 'Open project'} <ArrowUpRight size={13} />
      </button>
    );
  };
  return (
    <main className="command-center">
      <header className="cc-header">
        <div>
          <span className="cc-eyebrow">YOUR WORK, IN PERSPECTIVE</span>
          <h1>Command Center</h1>
          <p>Everything you’re building. Everything that needs attention.</p>
        </div>
        <button
          aria-label="Command Center preferences"
          className="secondary-button"
          onClick={() => setSettingsOpen(true)}
        >
          <SlidersHorizontal size={16} />
        </button>
      </header>
      <div className="cc-quick" aria-label="Quick actions">
        <button className="primary-button" onClick={() => setModal('quick')}>
          <Plus size={14} />
          Create task
        </button>
        <button className="secondary-button" onClick={() => setImportOpen(true)}>
          <Github size={14} />
          Import repositories
        </button>
        <button
          className="secondary-button"
          disabled={busy || !snapshot?.connected}
          onClick={() =>
            void action(async () =>
              accept(await api<CommandSnapshot>('command-center/github/refresh', {})),
            )
          }
        >
          <RefreshCw size={14} />
          Refresh status
        </button>
        <button className="secondary-button" onClick={() => setView('graph')}>
          <Network size={14} />
          Project graph
        </button>
      </div>
      {error && (
        <div className="cc-notice" role="alert">
          {error} <button onClick={() => setImportOpen(true)}>Review connection</button>
        </div>
      )}
      {loading && (
        <div className="cc-skeleton" role="status">
          Loading GitHub status… Your local work is ready.
        </div>
      )}
      <section className="cc-focus" aria-labelledby="focus-title">
        <div className="cc-section-title">
          <h2 id="focus-title">Today’s Focus</h2>
          <span>{focus.length ? 'Highest urgency first' : 'Room to move forward'}</span>
        </div>
        {!focus.length ? (
          <div className="cc-empty">
            <strong>
              {projects.length
                ? 'No urgent work detected in available data.'
                : 'Give your next project a place on deck.'}
            </strong>
            <p>
              {projects.some((p) => p.stale)
                ? 'Some repository data needs a refresh before health can be assessed.'
                : 'Create a Stack or import repositories. Deadlines, blockers and failures will surface here.'}
            </p>
            <button onClick={() => setModal('stack')}>Create a project →</button>
          </div>
        ) : (
          <ol className="cc-focus-list">
            {focus.map((p, i) => (
              <li key={p.stack.id}>
                <span className="cc-rank">{String(i + 1).padStart(2, '0')}</span>
                <div className="cc-focus-content">
                  <div className="cc-project-line">
                    <button onClick={() => setView(`stack:${p.stack.id}`)}>
                      <strong>{p.stack.name}</strong>
                    </button>
                    <span className={`cc-health ${p.state === 'Critical' ? 'critical' : ''}`}>
                      {p.state}
                    </span>
                    <button
                      className="cc-score"
                      onClick={() => setProjectId(p.stack.id)}
                      aria-label={`${p.stack.name} score ${p.score}, show reasons`}
                    >
                      {p.score} points
                    </button>
                  </div>
                  <p>
                    {p.reasons[0].reason} · {p.reasons[0].title}
                  </p>
                  {p.stale && (
                    <small>GitHub data needs a refresh; score uses current Deck evidence.</small>
                  )}
                </div>
                <div className="cc-focus-action">
                  {openEvidence(p)}
                  {p.stack.command?.pitBoss && (
                    <button onClick={() => setProjectId(p.stack.id)}>Pit Boss link</button>
                  )}
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>
      <section aria-labelledby="portfolio-title">
        <div className="cc-section-title">
          <h2 id="portfolio-title">Project Portfolio</h2>
          <label>
            Sort{' '}
            <select
              aria-label="Sort projects"
              value={sort}
              onChange={(e) =>
                commit({
                  ...data,
                  settings: {
                    ...data.settings,
                    command: { ...data.settings.command, sort: e.target.value as typeof sort },
                  },
                })
              }
            >
              <option value="urgency">Urgency</option>
              <option value="activity">Last activity</option>
              <option value="name">Name</option>
              <option value="importance">My priority</option>
            </select>
          </label>
        </div>
        <div className="cc-metrics">
          {[
            [active.length, 'Active projects'],
            [active.filter((p) => p.reasons.length).length, 'Need attention'],
            [active.filter((p) => p.state === 'Critical').length, 'Critical'],
            [total('tasks'), 'Open Deck tasks'],
            [unknownTotals ? '—' : total('workflows'), 'Failed workflows'],
            [unknownTotals ? '—' : total('reviews'), 'Awaiting review'],
          ].map(([count, label]) => (
            <div key={label}>
              <strong>{count}</strong>
              <span>{label}</span>
            </div>
          ))}
        </div>
        <div className="cc-grid">
          {portfolio.map((p) => {
            const sync = snapshot?.repositories.find(
              (r) => r.repository.id === p.stack.command?.repository?.id,
            );
            return (
              <article className="cc-card" key={p.stack.id}>
                <div className="cc-project-line">
                  <button
                    className="cc-project-name"
                    onClick={() => setView(`stack:${p.stack.id}`)}
                  >
                    {p.stack.name}
                  </button>
                  <span className="cc-health">{p.state}</span>
                </div>
                <p>
                  {p.stack.command?.lifecycle === 'paused'
                    ? 'Paused · excluded from focus'
                    : p.stack.command?.lifecycle === 'archived' ||
                        p.stack.command?.repository?.archived
                      ? 'Archived · excluded from focus'
                      : p.reasons[0]?.reason ||
                        (p.stale
                          ? 'Refresh needed to assess GitHub health'
                          : 'No urgent signals detected')}
                </p>
                <div className="cc-counts">
                  {(Object.keys(groupLabels) as (keyof typeof groupLabels)[])
                    .filter(
                      (key) =>
                        p.groups[key].length ||
                        ['tasks', 'issues', 'reviews', 'workflows'].includes(key),
                    )
                    .map((key) => (
                      <button
                        key={key}
                        onClick={() => setDrill({ project: p.stack.id, group: key })}
                      >
                        <strong>
                          {!sync?.lastSuccess &&
                          p.stack.command?.repository &&
                          ['issues', 'reviews', 'workflows', 'deployments'].includes(key)
                            ? '—'
                            : p.groups[key].length}
                        </strong>
                        {groupLabels[key]}
                      </button>
                    ))}
                </div>
                <small>Last activity: {when(p.lastActivity)}</small>
                {p.stack.command?.repository && (
                  <small className={p.stale ? 'cc-stale' : ''}>
                    GitHub: {sync?.status || 'not synchronized'} · Last success:{' '}
                    {when(sync?.lastSuccess || null)}
                  </small>
                )}
                <div className="cc-card-actions">
                  <button onClick={() => setProjectId(p.stack.id)}>Health & settings</button>
                  {p.stack.command?.repository && (
                    <GitHubLink url={sync?.repository.url || p.stack.command.repository.url}>
                      Repository
                    </GitHubLink>
                  )}
                  <button onClick={() => localGraph(p.stack.id)}>Graph</button>
                </div>
              </article>
            );
          })}
        </div>
      </section>
      <div className="cc-bottom">
        <section aria-labelledby="activity-title">
          <div className="cc-section-title">
            <h2 id="activity-title">Recent Activity</h2>
            <span>GitHub</span>
          </div>
          <div className="cc-filters">
            <select
              aria-label="Activity project"
              value={eventProject}
              onChange={(e) => setEventProject(e.target.value)}
            >
              <option value="all">All repositories</option>
              {snapshot?.repositories.map((r) => (
                <option key={r.repository.id} value={r.repository.id}>
                  {r.repository.name}
                </option>
              ))}
            </select>
            <select
              aria-label="Activity type"
              value={eventType}
              onChange={(e) => setEventType(e.target.value)}
            >
              <option value="all">All activity</option>
              {['commit', 'issue', 'pull', 'workflow', 'release', 'deployment'].map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
            <select
              aria-label="Activity time range"
              value={days}
              onChange={(e) => setDays(e.target.value)}
            >
              <option value="1">24 hours</option>
              <option value="7">7 days</option>
              <option value="30">30 days</option>
            </select>
          </div>
          {!events.length && (
            <p className="cc-empty">
              No activity in this range. Connect GitHub and synchronize repositories to see
              progress.
            </p>
          )}
          <ul className="cc-timeline">
            {events.map((event) => (
              <li key={event.id}>
                <span className="cc-event-type">{event.type}</span>
                <div>
                  <GitHubLink url={event.url}>{event.title}</GitHubLink>
                  <small>
                    {
                      snapshot?.repositories.find((r) => r.repository.id === event.repositoryId)
                        ?.repository.name
                    }{' '}
                    · {when(event.occurredAt)}
                  </small>
                </div>
              </li>
            ))}
          </ul>
        </section>
        <section className="cc-review" aria-labelledby="review-title">
          <h2 id="review-title">Needs Review</h2>
          {review.map((message) => (
            <p key={message}>{message}</p>
          ))}
          {!allowed && <button onClick={openAccount}>Account settings →</button>}
          {snapshot?.repositories.map((r) => {
            const p = projects.find((p) => p.stack.command?.repository?.id === r.repository.id);
            return (
              <div key={r.repository.id}>
                {!p && (
                  <p>
                    {r.repository.name}: imported repository has no project in this Deck.{' '}
                    <button onClick={() => setImportOpen(true)}>Link project</button>
                  </p>
                )}
                {r.error && (
                  <p role="alert">
                    {r.repository.name}: {r.error}
                    {r.nextAttempt && <small>Next attempt: {when(r.nextAttempt)}</small>}
                  </p>
                )}
              </div>
            );
          })}
          {projects
            .filter((p) => !p.stack.command?.repository)
            .map((p) => (
              <p key={p.stack.id}>
                {p.stack.name}: no repository linked.{' '}
                <button onClick={() => setImportOpen(true)}>Review</button>
              </p>
            ))}
          {projects.map((p) => {
            const unlinked = p.groups.issues
              .concat(p.groups.reviews)
              .filter(
                (w) => !data.tasks.some((t) => t.id === p.stack.command?.externalTasks?.[w.id]),
              );
            return unlinked.length ? (
              <p key={p.stack.id}>
                {p.stack.name}: {unlinked.length} external items have no Deck task link. Linking is
                optional.{' '}
                <button onClick={() => setDrill({ project: p.stack.id, group: 'issues' })}>
                  Review work
                </button>
              </p>
            ) : null;
          })}
          {!review.length && !projects.length && <p>Create or import a project to get started.</p>}
        </section>
      </div>
      <Modal
        open={!!drillProject && !!drill}
        onClose={() => setDrill(null)}
        title={`${drillProject?.stack.name || ''} — ${drill ? groupLabels[drill.group] : ''}`}
        className="cc-modal"
      >
        <p className="small-muted">
          Counts show the items below. GitHub work stays external; task links are optional. A dash
          means GitHub has not synchronized; stale counts show the last successful snapshot.
        </p>
        {drillProject && drill && (
          <WorkList
            items={drillProject.groups[drill.group]}
            stack={drillProject.stack}
            onLink={(key, id) =>
              setCommand(drillProject.stack, {
                ...drillProject.stack.command,
                externalTasks: { ...drillProject.stack.command?.externalTasks, [key]: id },
              })
            }
          />
        )}
      </Modal>
      <Modal
        open={!!selectedProject}
        onClose={() => setProjectId(null)}
        title={`${selectedProject?.stack.name || ''} — health & settings`}
        className="cc-modal"
      >
        {selectedProject && (
          <ProjectSettings
            key={selectedProject.stack.id}
            project={selectedProject}
            save={(command) => setCommand(selectedProject.stack, command)}
          />
        )}
      </Modal>
      <Modal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        title="Import GitHub repositories"
        className="cc-modal"
      >
        <p>
          Connect a read-only GitHub App installation. Select repositories individually and choose a
          project for each.
        </p>
        {!allowed ? (
          <button className="primary-button" onClick={openAccount}>
            Open account settings
          </button>
        ) : (
          <>
            <p>
              {snapshot?.connected ? `Connected as ${snapshot.login}` : 'GitHub is not connected.'}
            </p>
            {isTauri() ? (
              <p>
                Connect or reconnect GitHub in your signed-in Deck web portal, then refresh here.
                Credentials stay on the server.
              </p>
            ) : (
              <button
                disabled={busy || !snapshot?.configured}
                className="secondary-button"
                onClick={() =>
                  void action(async () => {
                    const result = await api<{ url: string }>('command-center/github/connect', {});
                    const url = new URL(result.url);
                    if (
                      url.origin !== 'https://github.com' ||
                      url.pathname !== '/login/oauth/authorize'
                    )
                      throw new Error('Invalid authorization URL');
                    location.assign(url.href);
                  })
                }
              >
                {snapshot?.connected ? 'Reconnect GitHub' : 'Connect GitHub'}
              </button>
            )}
            {snapshot?.connected && (
              <>
                <button
                  disabled={busy}
                  className="secondary-button"
                  onClick={() =>
                    void action(async () => {
                      await api('command-center/github/disconnect', {});
                      accept({
                        configured: snapshot.configured,
                        connected: false,
                        repositories: [],
                      });
                    })
                  }
                >
                  Disconnect GitHub
                </button>
                <RepositoryImport onImported={accept} />
              </>
            )}
            {!snapshot?.configured && (
              <p>
                Server setup required: GitHub App client ID, client secret and encryption key. See
                docs/command-center.md.
              </p>
            )}
          </>
        )}
        {error && <p role="alert">{error}</p>}
      </Modal>
      <Modal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        title="Priority scoring"
        className="cc-modal"
      >
        <p>
          Deterministic points per evidence item. Linked work and multiple signals for one task use
          only the highest weight. Paused and archived projects stay outside Today’s Focus.
        </p>
        {(Object.keys(defaultWeights) as (keyof Weights)[]).map((key) => (
          <label className="setting-row" key={key}>
            <span>{key}</span>
            <input
              type="number"
              min={0}
              max={100}
              aria-label={`${key} weight`}
              value={(data.settings.command?.weights || defaultWeights)[key]}
              onChange={(e) => {
                const value = Number(e.target.value);
                if (value >= 0 && value <= 100)
                  commit({
                    ...data,
                    settings: {
                      ...data.settings,
                      command: {
                        ...data.settings.command,
                        weights: {
                          ...(data.settings.command?.weights || defaultWeights),
                          [key]: value,
                        },
                      },
                    },
                  });
              }}
            />
          </label>
        ))}
        <button
          onClick={() =>
            commit({
              ...data,
              settings: {
                ...data.settings,
                command: { ...data.settings.command, weights: defaultWeights },
              },
            })
          }
        >
          Restore default weights
        </button>
      </Modal>
    </main>
  );
}
function WorkList({
  items,
  stack,
  onLink,
}: {
  items: WorkItem[];
  stack: Stack;
  onLink: (key: string, id: string) => void;
}) {
  const { data, select } = useDeck();
  return !items.length ? (
    <p className="cc-empty">No items in this category.</p>
  ) : (
    <ul className="cc-work-list">
      {items.map((item) => (
        <li key={item.id}>
          {item.external ? (
            <GitHubLink url={item.external.url}>{item.title}</GitHubLink>
          ) : (
            <button
              onClick={() =>
                item.taskId ? select(item.taskId) : useDeck.getState().setView(`stack:${stack.id}`)
              }
            >
              {item.title}
            </button>
          )}
          <small>
            {item.external
              ? `GitHub · ${item.external.state}${item.external.assignees.length ? ` · Assigned: ${item.external.assignees.join(', ')}` : ''}`
              : 'Deck'}
            {item.deadline ? ` · Due ${item.deadline.slice(0, 10)}` : ''}
          </small>
          {item.external && (
            <label>
              Linked Deck task{' '}
              <select
                aria-label={`Link ${item.title}`}
                value={stack.command?.externalTasks?.[item.id] || ''}
                onChange={(e) => onLink(item.id, e.target.value)}
              >
                <option value="">No task link</option>
                {data.tasks
                  .filter((t) => t.stackId === stack.id)
                  .map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.title}
                    </option>
                  ))}
              </select>
            </label>
          )}
        </li>
      ))}
    </ul>
  );
}
function RepositoryImport({ onImported }: { onImported: (snapshot: CommandSnapshot) => void }) {
  const { data } = useDeck();
  const [repos, setRepos] = useState<Repository[] | null>(null),
    [choices, setChoices] = useState<Record<string, string>>({});
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  async function discover() {
    setBusy(true);
    setError('');
    const uid = useCloud.getState().user?.id;
    try {
      const found = repositorySchema
        .array()
        .parse(await api<Repository[]>('command-center/github/repositories'));
      if (uid !== useCloud.getState().user?.id) return;
      setRepos(found);
      setChoices({});
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="cc-import">
      <button className="primary-button" disabled={busy} onClick={() => void discover()}>
        {busy ? 'Working…' : 'Discover accessible repositories'}
      </button>
      {repos && (
        <>
          <p>
            Only repositories granted to the App and accessible to your GitHub user appear here.
            Install the App on additional organizations to include them.
          </p>
          <div className="cc-card-actions">
            <button
              disabled={busy}
              onClick={() =>
                setChoices(
                  Object.fromEntries(
                    repos.map((r) => [r.id, repositoryMatches(data, r).length ? 'skip' : 'new']),
                  ),
                )
              }
            >
              Select all unmatched
            </button>
            <button disabled={busy} onClick={() => setChoices({})}>
              Skip all
            </button>
          </div>
          {!repos.length && (
            <p>No repositories found. Check the App installation’s repository selection.</p>
          )}
          {repos.map((repo) => {
            const matches = repositoryMatches(data, repo);
            const linked = matches.find((m) => m.signals.includes('Saved repository ID'));
            return (
              <div className="cc-import-row" key={repo.id}>
                <strong>
                  {repo.owner}/{repo.name}
                </strong>
                <small>
                  {repo.visibility} · {repo.language || 'No primary language'}
                  {repo.archived ? ' · Archived' : ''}
                </small>
                {matches.length > 0 && (
                  <small>
                    Suggested:{' '}
                    {matches.map((m) => `${m.stack.name} (${m.signals.join(', ')})`).join('; ')}.
                    Choose explicitly below.
                  </small>
                )}
                <select
                  disabled={busy}
                  aria-label={`Import ${repo.name}`}
                  value={choices[repo.id] || 'skip'}
                  onChange={(e) => setChoices({ ...choices, [repo.id]: e.target.value })}
                >
                  <option value="skip">Skip repository</option>
                  {!linked && <option value="new">Create new Deck project</option>}
                  {data.stacks
                    .filter(
                      (s) =>
                        (!s.command?.repository || s.command.repository.id === repo.id) &&
                        (!linked || s.id === linked.stack.id),
                    )
                    .map((s) => (
                      <option key={s.id} value={s.id}>
                        Link to {s.name}
                      </option>
                    ))}
                </select>
              </div>
            );
          })}
          <button
            className="primary-button"
            disabled={busy || !Object.values(choices).some((v) => v !== 'skip')}
            onClick={async () => {
              setBusy(true);
              setError('');
              const uid = useCloud.getState().user?.id;
              const selected = repos
                .filter((r) => choices[r.id] && choices[r.id] !== 'skip')
                .map((repository) => ({ repository, target: choices[repository.id] }));
              try {
                importRepositories(useDeck.getState().data, selected); // Validate whole selection before any remote mutation.
                const result = await api<CommandSnapshot>('command-center/github/import', {
                  repositoryIds: selected.map((s) => s.repository.id),
                });
                if (uid !== useCloud.getState().user?.id) return;
                useDeck.getState().commit(importRepositories(useDeck.getState().data, selected));
                onImported(result);
                setChoices({});
                useDeck
                  .getState()
                  .notify('Repositories linked. Initial synchronization is queued.');
              } catch (e) {
                setError(String(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            Import selected repositories
          </button>
        </>
      )}
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
function ProjectSettings({
  project,
  save,
}: {
  project: ProjectHealth;
  save: (command: Stack['command']) => void;
}) {
  const c = project.stack.command || {};
  const [pitId, setPitId] = useState(c.pitBoss?.projectId || ''),
    [actions, setActions] = useState(
      c.pitBoss?.actions.map((a) => `${a.id}: ${a.name}`).join('\n') || '',
    );
  const [risk, setRisk] = useState(''),
    [critical, setCritical] = useState(false);
  return (
    <>
      <p>
        <strong>
          {project.state} · {project.score} points
        </strong>
        {project.stale && ' · GitHub data is stale or incomplete'}
      </p>
      <ul className="cc-work-list">
        {project.reasons.map((r) => (
          <li key={r.id}>
            <strong>
              {r.reason} (+{r.points})
            </strong>
            {r.url ? (
              <GitHubLink url={r.url}>{r.title}</GitHubLink>
            ) : (
              <button
                onClick={() =>
                  r.taskId
                    ? useDeck.getState().select(r.taskId)
                    : useDeck.getState().setView(`stack:${project.stack.id}`)
                }
              >
                {r.title}
              </button>
            )}
          </li>
        ))}
      </ul>
      <label className="setting-row">
        Project state
        <select
          value={c.lifecycle || 'active'}
          onChange={(e) =>
            save({ ...c, lifecycle: e.target.value as 'active' | 'paused' | 'archived' })
          }
        >
          <option value="active">Active</option>
          <option value="paused">Paused</option>
          <option value="archived">Archived</option>
        </select>
      </label>
      <label className="setting-row">
        My priority (importance, 0–100)
        <input
          type="number"
          min={0}
          max={100}
          value={c.importance || 0}
          onChange={(e) =>
            save({
              ...c,
              importance: Math.max(0, Math.min(100, Math.round(Number(e.target.value)))),
            })
          }
        />
      </label>
      <h3>Project risks</h3>
      {c.risks?.map((r) => (
        <p key={r.id}>
          {r.title}{' '}
          <button onClick={() => save({ ...c, risks: c.risks?.filter((x) => x.id !== r.id) })}>
            Resolve
          </button>
        </p>
      ))}
      <div className="cc-risk">
        <input
          aria-label="Risk description"
          placeholder="Describe the blocker or risk"
          maxLength={1000}
          value={risk}
          onChange={(e) => setRisk(e.target.value)}
        />
        <label>
          <input
            type="checkbox"
            checked={critical}
            onChange={(e) => setCritical(e.target.checked)}
          />{' '}
          Critical blocker
        </label>
        <button
          disabled={!risk.trim()}
          onClick={() => {
            save({
              ...c,
              risks: [
                ...(c.risks || []),
                { id: crypto.randomUUID(), title: risk.trim(), critical },
              ],
            });
            setRisk('');
          }}
        >
          Flag risk
        </button>
      </div>
      <h3>Pit Boss</h3>
      {isTauri() && (
        <button
          className="secondary-button"
          onClick={() =>
            void invoke('open_pit_boss').catch((error) => useDeck.getState().notify(String(error)))
          }
        >
          Open Pit Boss application
        </button>
      )}
      <p>
        Pit Boss owns execution. The current installation contract exposes no external action API or
        deep-link handler. These are manual references; run actions inside Pit Boss.
      </p>
      <label className="cc-field">
        Pit Boss project ID
        <input maxLength={200} value={pitId} onChange={(e) => setPitId(e.target.value)} />
      </label>
      <label className="cc-field">
        Configured action references (one “ID: name” per line)
        <textarea value={actions} onChange={(e) => setActions(e.target.value)} />
      </label>
      <div className="cc-card-actions">
        <button
          disabled={!pitId.trim()}
          onClick={() =>
            save({
              ...c,
              pitBoss: {
                projectId: pitId.trim(),
                actions: actions
                  .split('\n')
                  .filter((s) => s.includes(':'))
                  .slice(0, 100)
                  .map((s) => ({
                    id: s.slice(0, s.indexOf(':')).trim().slice(0, 200),
                    name: s
                      .slice(s.indexOf(':') + 1)
                      .trim()
                      .slice(0, 200),
                  }))
                  .filter((a) => a.id && a.name),
              },
            })
          }
        >
          Save Pit Boss link
        </button>
        {c.pitBoss && (
          <button
            onClick={() => {
              const next = { ...c };
              delete next.pitBoss;
              save(next);
              setPitId('');
              setActions('');
            }}
          >
            Unlink Pit Boss
          </button>
        )}
      </div>
      {c.pitBoss && (
        <div className="cc-notice">
          <strong>Execution unavailable</strong>
          <p>
            No authorized bridge is configured. Deck cannot verify whether Pit Boss is installed or
            running.
          </p>
          {c.pitBoss.actions.map((a) => (
            <button key={a.id} disabled title="Run this action in Pit Boss">
              {a.name}
            </button>
          ))}
        </div>
      )}
    </>
  );
}
