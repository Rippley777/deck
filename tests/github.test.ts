import { describe, expect, it, vi } from 'vitest';
import { GitHub, GitHubError, synchronizeRepository } from '../server/command-center/github';
import { seal, unseal, IntegrationStore } from '../server/command-center/routes';
import type { RepositorySnapshot } from '../shared/command-center';
const date = '2026-10-08T12:00:00Z';
const rawRepo = {
  id: 42,
  owner: { login: 'org' },
  name: 'renamed',
  html_url: 'https://github.com/org/renamed',
  default_branch: 'main',
  description: null,
  language: null,
  topics: [],
  private: true,
  archived: false,
  pushed_at: date,
};
const initial: RepositorySnapshot = {
  repository: {
    id: '42',
    owner: 'old',
    name: 'old',
    url: 'https://github.com/old/old',
    defaultBranch: 'main',
    description: '',
    language: null,
    topics: [],
    visibility: 'private',
    archived: false,
    pushedAt: date,
  },
  work: [],
  activity: [],
  lastSuccess: null,
  lastAttempt: null,
  status: 'pending',
};
function fixture() {
  let closed = false;
  const fetcher = vi.fn(async (input: string | URL | Request) => {
    const url = new URL(String(input)),
      path = url.pathname;
    const raw = {
      id: 1,
      number: 1,
      title: 'Fix deployment',
      html_url: rawRepo.html_url + '/issues/1',
      state: closed ? 'closed' : 'open',
      labels: [{ name: 'priority: high' }],
      assignees: [{ login: 'user' }],
      created_at: date,
      updated_at: date,
    };
    let body: unknown = [];
    if (path === '/repositories/42') body = rawRepo;
    else if (path.endsWith('/issues'))
      body = closed && url.searchParams.get('state') === 'open' ? [] : [raw];
    else if (path.endsWith('/pulls'))
      body =
        url.searchParams.get('state') === 'closed'
          ? [{ ...raw, id: 2, merged_at: date }]
          : closed
            ? []
            : [{ ...raw, id: 2 }];
    else if (path.endsWith('/pulls/1'))
      body = {
        ...raw,
        id: 2,
        draft: false,
        mergeable_state: 'blocked',
        requested_reviewers: [{ login: 'user' }],
      };
    else if (path.endsWith('/actions/workflows')) body = { workflows: [] };
    else if (path.endsWith('/actions/runs'))
      body = {
        workflow_runs: [
          {
            ...raw,
            id: 10,
            workflow_id: 1,
            name: 'CI',
            head_branch: 'main',
            conclusion: closed ? 'success' : 'failure',
            status: 'completed',
            run_attempt: 1,
          },
          {
            ...raw,
            id: 9,
            workflow_id: 1,
            name: 'CI',
            head_branch: 'main',
            conclusion: 'failure',
            status: 'completed',
            run_attempt: 1,
          },
        ],
      };
    else if (path.endsWith('/commits'))
      body = [
        {
          sha: 'abc',
          html_url: rawRepo.html_url + '/commit/abc',
          commit: { message: 'Progress\nLong body omitted', committer: { date } },
        },
      ];
    else if (path.endsWith('/releases'))
      body = [
        { id: 1, name: 'v1', html_url: rawRepo.html_url + '/releases/tag/v1', published_at: date },
      ];
    return new Response(JSON.stringify(body), { status: 200 });
  });
  return {
    fetcher,
    close: () => {
      closed = true;
    },
  };
}
describe('GitHub synchronization', () => {
  it('initial and incremental sync preserve IDs, rename metadata, assigned issues and deduplicated events', async () => {
    const f = fixture(),
      client = new GitHub('fake-token', f.fetcher);
    const first = await synchronizeRepository(client, initial, 'user', new Date(date));
    expect(first.repository.owner).toBe('org');
    expect(first.repository.visibility).toBe('private');
    expect(first.work.map((w) => w.type)).toEqual(['issue', 'pull', 'workflow']);
    expect(first.work[0].assignees).toEqual(['user']);
    expect(first.work[1].reviewRequested).toBe(true);
    expect(first.work[1].blocked).toBe(true);
    expect(first.work[2].id).toBe('42:workflow:10');
    const again = await synchronizeRepository(client, first, 'user', new Date(date));
    expect(again.activity).toEqual(first.activity);
    expect(f.fetcher.mock.calls.some(([url]) => String(url).includes('since=2026-10-08T11'))).toBe(
      true,
    );
    f.close();
    const final = await synchronizeRepository(client, again, 'user', new Date(date));
    expect(final.work).toEqual([]);
    expect(final.activity.some((e) => e.title.endsWith('— merged'))).toBe(true);
    expect(final.activity.some((e) => e.title.endsWith('— closed'))).toBe(true);
  });
  it('discovers permitted installations with pagination, no account hardcoding and immutable deduplication', async () => {
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      const u = new URL(String(input));
      return new Response(
        JSON.stringify(
          u.pathname === '/user/installations'
            ? { installations: [{ id: 1 }, { id: 2 }] }
            : { repositories: [rawRepo] },
        ),
      );
    });
    const repos = await new GitHub('private', fetcher).discover();
    expect(repos).toHaveLength(1);
    expect(repos[0].id).toBe('42');
    expect(fetcher).toHaveBeenCalledTimes(3);
    const pages = vi.fn(
      async (input: string | URL | Request) =>
        new Response(
          JSON.stringify(
            new URL(String(input)).searchParams.get('page') === '1'
              ? Array.from({ length: 100 }, (_, i) => i)
              : [100],
          ),
        ),
    );
    expect(await new GitHub('t', pages).pages('/items')).toHaveLength(101);
    await expect(new GitHub('t', pages).pages('/items', undefined, 1)).rejects.toThrow(
      'page limit',
    );
  });
  it('handles rate limits without retry storms, revoked access and retriable server failures', async () => {
    const limited = new GitHub(
      't',
      vi.fn(async () => new Response('{}', { status: 429, headers: { 'retry-after': '120' } })),
    );
    try {
      await limited.get('/user');
      throw new Error('expected failure');
    } catch (e) {
      expect(e).toBeInstanceOf(GitHubError);
      expect((e as GitHubError).retryAt).toBeGreaterThan(Date.now() + 100000);
    }
    await expect(
      new GitHub(
        't',
        vi.fn(async () => new Response('{}', { status: 401 })),
      ).get('/user'),
    ).rejects.toThrow('revoked');
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(new Response('{}', { status: 503 }))
      .mockResolvedValueOnce(new Response('{}', { status: 500 }))
      .mockResolvedValue(new Response('{"id":1}'));
    const sleep = vi.fn(async () => {});
    expect(await new GitHub('t', fetcher, sleep).get('/user')).toEqual({ id: 1 });
    expect(sleep.mock.calls).toEqual([[500], [1000]]);
  });
  it('fails atomically on partial metadata rather than reporting fabricated zero counts', async () => {
    const fetcher = vi.fn(
      async (input: string | URL | Request) =>
        new Response(JSON.stringify(String(input).endsWith('/repositories/42') ? rawRepo : {})),
    );
    await expect(
      synchronizeRepository(new GitHub('t', fetcher), initial, 'u', new Date(date)),
    ).rejects.toThrow('incomplete');
    expect(initial.work).toEqual([]);
    expect(initial.lastSuccess).toBeNull();
  });
});
describe('credential and persistence boundaries', () => {
  it('authenticates encrypted credentials to their account and rejects tampering', () => {
    const key = Buffer.alloc(32, 7),
      token = { accessToken: 'not-a-real-token' };
    const value = seal(token, key, 'alice');
    expect(value).not.toContain(token.accessToken);
    expect(unseal(value, key, 'alice')).toEqual(token);
    expect(() => unseal(value, key, 'bob')).toThrow();
    const damaged = Buffer.from(value, 'base64');
    damaged[30] ^= 1;
    expect(() => unseal(damaged.toString('base64'), key, 'alice')).toThrow();
  });
  it('uses account scoping and optimistic revisions, refusing stale writes', async () => {
    const rows = new Map<string, { data: string; version: number }>();
    const query = vi.fn(async (sql: string, values: unknown[] = []) => {
      const uid = String(values[0]),
        old = rows.get(uid);
      if (sql.startsWith('SELECT')) return { rows: old ? [old] : [] };
      if (sql.startsWith('INSERT')) {
        if (old) throw new Error('duplicate');
        rows.set(uid, { data: String(values[1]), version: 1 });
        return { rows: [] };
      }
      if (old && old.version === values[2]) {
        rows.set(uid, { data: String(values[1]), version: old.version + 1 });
        return { rows: [{ version: old.version + 1 }] };
      }
      return { rows: [] };
    });
    const store = new IntegrationStore(query, false);
    await store.change('alice', (s) => {
      s.login = 'alice';
    });
    const first = await store.read('alice');
    await store.change('alice', (s) => {
      s.login = 'new';
    });
    expect(await store.write('alice', first.state, first.version)).toBe(false);
    expect((await store.read('bob')).state).toEqual({ repositories: [] });
    expect((await store.read('alice')).state.login).toBe('new');
  });
});

import { createHmac } from 'node:crypto';
import { verifySignature } from '../server/command-center/webhook';
it('validates webhook signatures over exact raw bytes and rejects malformed signatures', () => {
  const bytes = Buffer.from('{"repository":{"id":42}}');
  const signature = 'sha256=' + createHmac('sha256', 'fixture-secret').update(bytes).digest('hex');
  expect(verifySignature(bytes, signature, 'fixture-secret')).toBe(true);
  expect(verifySignature(Buffer.from('{}'), signature, 'fixture-secret')).toBe(false);
  expect(verifySignature(bytes, 'sha256=abc', 'fixture-secret')).toBe(false);
});

it('keeps an unresolved default-branch failure outside the recent activity window', async () => {
  const f = fixture();
  const remote = async (input: string | URL | Request) => {
    const path = new URL(String(input)).pathname;
    if (path.endsWith('/actions/workflows'))
      return new Response(JSON.stringify({ workflows: [{ id: 55 }] }));
    if (path.endsWith('/actions/workflows/55/runs'))
      return new Response(
        JSON.stringify({
          workflow_runs: [
            {
              id: 999,
              workflow_id: 55,
              name: 'Quiet CI',
              head_branch: 'main',
              conclusion: 'failure',
              status: 'completed',
              html_url: rawRepo.html_url + '/actions/runs/999',
              created_at: '2026-01-01T00:00:00Z',
              updated_at: '2026-01-01T00:00:00Z',
              run_attempt: 1,
            },
          ],
        }),
      );
    return f.fetcher(input);
  };
  const result = await synchronizeRepository(
    new GitHub('fixture-token', remote),
    initial,
    'user',
    new Date(date),
  );
  expect(result.work.find((w) => w.id === '42:workflow:999')?.defaultBranch).toBe(true);
});
