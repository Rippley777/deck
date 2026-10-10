import { describe, expect, it } from 'vitest';
import { emptyDeck } from '../shared/sync';
import { defaultSettings, type Stack } from '../src/types';
import { makeTask } from '../src/lib/seed';
import {
  importRepositories,
  projectHealth,
  repositoryMatches,
  sortProjects,
} from '../src/lib/command-center';
import {
  defaultWeights,
  type Repository,
  type RepositorySnapshot,
  type ExternalWork,
} from '../shared/command-center';
import { deckSchema } from '../shared/validation';
const now = new Date('2026-10-08T12:00:00');
const repo: Repository = {
  id: '42',
  owner: 'user',
  name: 'Deck',
  url: 'https://github.com/user/deck',
  defaultBranch: 'main',
  description: 'Project',
  language: 'TypeScript',
  topics: ['tasks'],
  visibility: 'private',
  archived: false,
  pushedAt: now.toISOString(),
};
const stack: Stack = {
  id: 'project',
  name: 'Deck',
  icon: 'folder',
  color: '#ccc',
  notes: '',
  deadline: null,
  headings: [],
  links: [],
  command: { repository: repo },
};
const data = () => ({ ...emptyDeck(defaultSettings), stacks: [structuredClone(stack)] });
const work = (type: ExternalWork['type'], patch: Partial<ExternalWork> = {}): ExternalWork => ({
  id: `42:${type}:1`,
  provider: 'github',
  repositoryId: '42',
  type,
  title: `Test ${type}`,
  url: 'https://github.com/user/deck/issues/1',
  state: 'open',
  assignees: [],
  createdAt: now.toISOString(),
  updatedAt: now.toISOString(),
  syncedAt: now.toISOString(),
  ...patch,
});
const snapshot = (items: ExternalWork[] = []): RepositorySnapshot => ({
  repository: repo,
  work: items,
  activity: [],
  lastSuccess: now.toISOString(),
  lastAttempt: now.toISOString(),
  status: 'ready',
});
describe('import', () => {
  it('imports single and multiple repositories, then reimports renamed/transferred IDs without duplicates', () => {
    const initial = emptyDeck(defaultSettings);
    const one = importRepositories(initial, [{ repository: repo, target: 'new' }]);
    expect(one.stacks).toHaveLength(1);
    const many = importRepositories(one, [
      { repository: { ...repo, id: '43' }, target: 'new' },
      { repository: { ...repo, id: '44' }, target: 'new' },
    ]);
    const again = importRepositories(many, [
      {
        repository: { ...repo, name: 'New', owner: 'org', url: 'https://github.com/org/New' },
        target: 'new',
      },
    ]);
    expect(again.stacks).toHaveLength(3);
    expect(again.stacks[0].command?.repository?.owner).toBe('org');
    expect(again.stacks[0].command?.repository?.visibility).toBe('private');
    expect(again.tasks).toHaveLength(0);
  });
  it('suggests ambiguous name/path/URL matches without merging; explicit linking preserves tasks', () => {
    const existing = data();
    existing.stacks[0].command = undefined;
    existing.stacks[0].links = [repo.url + '.git'];
    const matches = repositoryMatches(existing, repo);
    expect(matches[0].signals).toContain('Repository URL');
    expect(matches[0].signals).toContain('Similar name');
    const linked = importRepositories(existing, [{ repository: repo, target: 'project' }]);
    expect(linked.stacks).toHaveLength(1);
    expect(importRepositories(linked, [{ repository: repo, target: 'skip' }])).toEqual(linked);
    expect(() =>
      importRepositories(linked, [{ repository: { ...repo, id: '9' }, target: 'project' }]),
    ).toThrow('another repository');
    expect(() =>
      importRepositories(linked, [{ repository: { ...repo, id: '9' }, target: 'missing' }]),
    ).toThrow('no longer exists');
  });
  it('persists optional metadata and rejects unsafe URLs without exposing local paths to sync', () => {
    const d = data();
    d.stacks[0].command!.pitBoss = { projectId: 'pit-1', actions: [{ id: 'test', name: 'Test' }] };
    expect(deckSchema.parse(d).stacks[0].command).toEqual(d.stacks[0].command);
    d.stacks[0].command!.repository!.url = 'javascript:alert(1)';
    expect(deckSchema.safeParse(d).success).toBe(false);
  });
});
describe('health', () => {
  it('ranks failed default-branch CI with traceable evidence and no invented tasks', () => {
    const d = data();
    const p = projectHealth(d, stack, snapshot([work('workflow', { defaultBranch: true })]), now);
    expect(p.score).toBe(25);
    expect(p.state).toBe('Needs Attention');
    expect(p.reasons[0].url).toMatch(/^https:/);
    expect(p.groups.tasks).toHaveLength(0);
    const healthy = projectHealth(d, { ...stack, id: 'healthy' }, snapshot(), now);
    expect(healthy.state).toBe('On Track');
    expect(sortProjects([healthy, p])[0]).toBe(p);
  });
  it('aggregates overdue, milestones, deadlines and blockers with per-task deduplication', () => {
    const d = data();
    d.tasks = [
      makeTask('Overdue', {
        id: 'task',
        stackId: stack.id,
        deadline: '2026-10-07',
        priority: 3,
        blockedBy: ['blocker'],
      }),
      makeTask('Blocker', { id: 'blocker', stackId: stack.id }),
      makeTask('Ship', { stackId: stack.id, kind: 'milestone', deadline: '2026-10-09' }),
    ];
    const p = projectHealth(d, stack, snapshot(), now);
    expect(p.groups.overdue).toHaveLength(1);
    expect(p.groups.milestones).toHaveLength(1);
    expect(p.groups.blocked).toHaveLength(1);
    expect(p.reasons.filter((r) => r.id === 'task')).toHaveLength(1);
    expect(p.score).toBe(50);
  });
  it('does not penalize inactivity on paused or archived projects', () => {
    const d = data();
    d.tasks = [makeTask('Past', { stackId: stack.id, deadline: '2000-01-01', priority: 3 })];
    for (const lifecycle of ['paused', 'archived'] as const) {
      const result = projectHealth(
        d,
        { ...stack, command: { repository: repo, lifecycle } },
        snapshot([work('workflow', { defaultBranch: true })]),
        now,
      );
      expect(result.state).toBe('Idle');
      expect(result.score).toBe(0);
      expect(result.reasons).toEqual([]);
    }
  });
  it('marks stale data unknown and never recommends stale failures', () => {
    const old = {
      ...snapshot([work('workflow', { defaultBranch: true })]),
      lastSuccess: '2020-01-01',
    };
    const p = projectHealth(data(), stack, old, now);
    expect(p.state).toBe('Unknown');
    expect(p.score).toBe(0);
    expect(p.groups.workflows).toHaveLength(1);
    expect(projectHealth(data(), stack, undefined, now).state).toBe('Unknown');
  });
  it('links external work without duplicate tasks or double counting urgency', () => {
    const d = data();
    d.tasks = [
      makeTask('Issue task', {
        id: 'task',
        stackId: stack.id,
        priority: 3,
        deadline: '2000-01-01',
      }),
    ];
    d.stacks[0].command!.externalTasks = { '42:issue:1': 'task' };
    const p = projectHealth(d, d.stacks[0], snapshot([work('issue', { priority: 'high' })]), now);
    expect(p.groups.issues).toHaveLength(1);
    expect(p.groups.tasks).toHaveLength(1);
    expect(p.score).toBe(20);
    expect(p.reasons).toHaveLength(1);
  });
  it('supports weights, explicit critical risks and importance independently', () => {
    const s = {
      ...stack,
      command: {
        ...stack.command,
        risks: [{ id: 'risk', title: 'Production blocked', critical: true }],
      },
    };
    const p = projectHealth(data(), s, snapshot(), now, { ...defaultWeights, blocker: 5 });
    expect(p.state).toBe('Critical');
    expect(p.score).toBe(5);
    expect(p.reasons[0].title).toBe('Production blocked');
  });
});

it('counts a deployment and CI signal for the same GitHub run only once', () => {
  const p = projectHealth(
    data(),
    stack,
    snapshot([
      work('workflow', { defaultBranch: true, evidenceKey: 'run:42:99' }),
      work('deployment', { production: true, evidenceKey: 'run:42:99' }),
    ]),
    now,
  );
  expect(p.score).toBe(40);
  expect(p.reasons).toHaveLength(1);
  expect(p.state).toBe('Critical');
});
