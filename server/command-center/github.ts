import {
  repositorySchema,
  type Repository,
  type RepositorySnapshot,
  type ExternalWork,
  type Activity,
} from '../../shared/command-center';

export class GitHubError extends Error {
  constructor(
    message: string,
    readonly status = 502,
    readonly retryAt?: number,
  ) {
    super(message);
  }
}
export type Fetcher = typeof fetch;
export class GitHub {
  constructor(
    private token: string,
    private fetcher: Fetcher = fetch,
    private sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms)),
  ) {}
  async get(path: string): Promise<any> {
    if (!path.startsWith('/') || path.startsWith('//')) throw new Error('Invalid GitHub path');
    for (let attempt = 0; attempt < 3; attempt++) {
      let res: Response;
      try {
        res = await this.fetcher(`https://api.github.com${path}`, {
          headers: {
            Authorization: `Bearer ${this.token}`,
            Accept: 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28',
          },
          signal: AbortSignal.timeout(20000),
          redirect: 'error',
        });
      } catch {
        if (attempt < 2) {
          await this.sleep(500 * 2 ** attempt);
          continue;
        }
        throw new GitHubError('GitHub is unreachable. Cached data is retained.');
      }
      if (res.status === 401)
        throw new GitHubError(
          'GitHub authorization expired or was revoked. Reconnect GitHub.',
          401,
        );
      if (
        res.status === 429 ||
        (res.status === 403 &&
          (res.headers.get('x-ratelimit-remaining') === '0' || res.headers.has('retry-after')))
      ) {
        const retryAt = Math.max(
          Date.now() + 60000,
          Number(res.headers.get('x-ratelimit-reset')) * 1000 || 0,
          Date.now() + (Number(res.headers.get('retry-after')) || 60) * 1000,
        );
        throw new GitHubError(
          'GitHub rate limit reached. Refresh will resume after the reset.',
          429,
          retryAt,
        );
      }
      if (res.status >= 500 && attempt < 2) {
        await this.sleep(500 * 2 ** attempt);
        continue;
      }
      if (!res.ok)
        throw new GitHubError(
          res.status === 404 || res.status === 403
            ? 'Repository unavailable. Check GitHub App installation and read permissions.'
            : 'GitHub could not complete synchronization.',
          res.status,
        );
      return res.json();
    }
    throw new GitHubError('GitHub unavailable');
  }
  async pages(path: string, key?: string, maxPages = 20): Promise<any[]> {
    const items: any[] = [];
    for (let page = 1; page <= maxPages; page++) {
      const result = await this.get(
        `${path}${path.includes('?') ? '&' : '?'}per_page=100&page=${page}`,
      );
      const rows = key ? result[key] : result;
      if (!Array.isArray(rows)) throw new GitHubError('GitHub returned incomplete data.');
      items.push(...rows);
      if (rows.length < 100) return items;
    }
    // Never label an incomplete count as a successful snapshot.
    throw new GitHubError(
      'Repository exceeds the synchronization page limit. Cached data is retained.',
    );
  }
  async discover(): Promise<Repository[]> {
    const installs = await this.pages('/user/installations', 'installations');
    const result = new Map<string, Repository>();
    for (const install of installs) {
      if (!Number.isSafeInteger(install.id)) throw new GitHubError('Invalid installation ID');
      for (const repo of await this.pages(
        `/user/installations/${install.id}/repositories`,
        'repositories',
      )) {
        const normalized = repository(repo);
        result.set(normalized.id, normalized);
      }
    }
    return [...result.values()];
  }
}
export function repository(raw: any): Repository {
  return repositorySchema.parse({
    id: String(raw.id),
    owner: raw.owner?.login,
    name: raw.name,
    url: raw.html_url,
    defaultBranch: raw.default_branch,
    description: raw.description || '',
    language: raw.language || null,
    topics: raw.topics || [],
    visibility: raw.visibility || (raw.private ? 'private' : 'public'),
    archived: raw.archived,
    pushedAt: raw.pushed_at,
  });
}
const stamp = (v: unknown) =>
  typeof v === 'string' && Number.isFinite(Date.parse(v)) ? v : new Date(0).toISOString();
const title = (v: unknown) => String(v || '').slice(0, 1000);
const resourceUrl = (v: unknown) => {
  const parsed = repositorySchema.shape.url.safeParse(v);
  if (!parsed.success) throw new GitHubError('GitHub returned an invalid resource URL.');
  return parsed.data;
};
export async function synchronizeRepository(
  client: GitHub,
  previous: RepositorySnapshot,
  login: string,
  now = new Date(),
): Promise<RepositorySnapshot> {
  // Immutable lookup follows repository renames and transfers without trusting stale names.
  const repo = repository(await client.get(`/repositories/${previous.repository.id}`));
  const base = `/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}`;
  const syncedAt = now.toISOString();
  const work: ExternalWork[] = [],
    events: Activity[] = [];
  const since = new Date(
    Math.max(now.getTime() - 30 * 86400000, Date.parse(previous.lastSuccess || '') - 60000 || 0),
  ).toISOString();
  const addEvent = (type: Activity['type'], id: string, text: string, url: string, at: string) => {
    events.push({
      id: `${repo.id}:${type}:${id}`,
      repositoryId: repo.id,
      type,
      title: title(text),
      url: resourceUrl(url),
      occurredAt: stamp(at),
    });
  };
  const item = (raw: any, type: ExternalWork['type']): ExternalWork => ({
    id: `${repo.id}:${type}:${raw.id}`,
    provider: 'github',
    repositoryId: repo.id,
    type,
    title: title(raw.title || raw.name || type),
    url: resourceUrl(raw.html_url),
    state: raw.state || raw.conclusion || raw.status,
    assignees: (raw.assignees || []).map((a: any) => title(a.login)),
    createdAt: stamp(raw.created_at),
    updatedAt: stamp(raw.updated_at),
    syncedAt,
  });
  const issues = await client.pages(`${base}/issues?state=open`);
  for (const raw of issues.filter((i) => !i.pull_request)) {
    work.push({
      ...item(raw, 'issue'),
      priority: (raw.labels || []).some((l: any) =>
        /^(priority: high|priority: critical|p0|p1|critical|high priority)$/i.test(l.name),
      )
        ? 'high'
        : undefined,
    });
  }
  const pulls = await client.pages(`${base}/pulls?state=open`);
  if (pulls.length > 200)
    throw new GitHubError('More than 200 open pull requests; synchronization is incomplete.');
  for (const raw of pulls) {
    const detail = await client.get(`${base}/pulls/${raw.number}`);
    work.push({
      ...item(detail, 'pull'),
      reviewRequested:
        !detail.draft && (detail.requested_reviewers || []).some((r: any) => r.login === login),
      blocked: ['blocked', 'dirty'].includes(detail.mergeable_state),
    });
  }
  for (const raw of await client.pages(`${base}/milestones?state=open`))
    work.push({ ...item(raw, 'milestone'), deadline: raw.due_on || undefined });
  // Full recent run window, newest run per workflow and branch. Old failures cannot outlive a succeeding run.
  const runs = await client.pages(
    `${base}/actions/runs?created=${encodeURIComponent('>=' + new Date(now.getTime() - 30 * 86400000).toISOString())}`,
    'workflow_runs',
  );
  // Always inspect the latest default-branch result, including quiet repositories
  // whose last run is outside the recent activity window.
  for (const workflow of await client.pages(`${base}/actions/workflows`, 'workflows')) {
    const latest = await client.get(
      `${base}/actions/workflows/${workflow.id}/runs?branch=${encodeURIComponent(repo.defaultBranch)}&per_page=1`,
    );
    if (!Array.isArray(latest.workflow_runs))
      throw new GitHubError('GitHub returned incomplete workflow data.');
    for (const run of latest.workflow_runs) if (!runs.some((r) => r.id === run.id)) runs.push(run);
  }
  const seen = new Set<string>();
  for (const raw of runs.sort(
    (a, b) => Date.parse(b.created_at) - Date.parse(a.created_at) || b.id - a.id,
  )) {
    const key = `${raw.workflow_id}:${raw.head_branch}`;
    if (!seen.has(key)) {
      seen.add(key);
      if (['failure', 'timed_out', 'action_required', 'startup_failure'].includes(raw.conclusion))
        work.push({
          ...item(raw, 'workflow'),
          defaultBranch: raw.head_branch === repo.defaultBranch,
          workflowId: String(raw.workflow_id),
          evidenceKey: `run:${repo.id}:${raw.id}`,
        });
    }
    addEvent(
      'workflow',
      `${raw.id}:${raw.run_attempt}:${raw.status}:${raw.conclusion}`,
      `${raw.name}: ${raw.conclusion || raw.status}`,
      raw.html_url,
      raw.updated_at,
    );
  }
  // Production is GitHub's explicit production_environment flag; never guessed from a workflow name.
  const deployments = await client.pages(`${base}/deployments`, undefined, 10);
  const environments = new Set<string>();
  for (const raw of deployments) {
    if (environments.has(raw.environment)) continue;
    environments.add(raw.environment);
    const statuses = await client.get(`${base}/deployments/${raw.id}/statuses?per_page=1`);
    const status = statuses[0];
    if (!status) continue;
    const url = `${repo.url}/deployments`;
    if (['failure', 'error'].includes(status.state))
      work.push({
        ...item(
          {
            ...raw,
            html_url: url,
            title: `${raw.environment} deployment failed`,
            state: status.state,
            updated_at: status.updated_at,
          },
          'deployment',
        ),
        production: raw.production_environment === true,
        evidenceKey:
          typeof status.log_url === 'string' &&
          status.log_url.startsWith(`${repo.url}/actions/runs/`)
            ? `run:${repo.id}:${status.log_url.split('/actions/runs/')[1].split('/')[0]}`
            : undefined,
      });
    addEvent(
      'deployment',
      `${raw.id}:${status.id}`,
      `${raw.environment}: ${status.state}`,
      url,
      status.updated_at,
    );
  }
  if (repo.pushedAt) {
    for (const raw of await client.pages(`${base}/commits?since=${encodeURIComponent(since)}`))
      addEvent(
        'commit',
        raw.sha,
        raw.commit.message.split('\n')[0],
        raw.html_url,
        raw.commit.committer?.date,
      );
  }
  for (const raw of await client.pages(
    `${base}/issues?state=all&since=${encodeURIComponent(since)}`,
  ))
    addEvent(
      raw.pull_request ? 'pull' : 'issue',
      `${raw.id}:${raw.state}:${raw.updated_at}`,
      `${raw.title} — ${raw.state}`,
      raw.html_url,
      raw.updated_at,
    );
  const closed = await client.pages(
    `${base}/pulls?state=closed&sort=updated&direction=desc`,
    undefined,
    20,
  );
  for (const raw of closed.filter((p) => p.merged_at && p.merged_at >= since))
    addEvent('pull', `${raw.id}:merged`, `${raw.title} — merged`, raw.html_url, raw.merged_at);
  for (const raw of await client.pages(`${base}/releases`))
    if (!raw.draft && raw.published_at)
      addEvent(
        'release',
        String(raw.id),
        `Release ${raw.name || raw.tag_name}`,
        raw.html_url,
        raw.published_at,
      );
  const merged = new Map(previous.activity.map((e) => [e.id, e]));
  for (const event of events) merged.set(event.id, event);
  return {
    repository: repo,
    work,
    activity: [...merged.values()]
      .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))
      .slice(0, 500),
    lastSuccess: syncedAt,
    lastAttempt: syncedAt,
    status: 'ready',
    failures: 0,
  };
}
