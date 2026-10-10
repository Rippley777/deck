import type { DeckData, Stack } from '../types';
import {
  defaultWeights,
  type Repository,
  type RepositorySnapshot,
  type ExternalWork,
  type Weights,
} from '../../shared/command-center';
export type Health = 'Critical' | 'Needs Attention' | 'On Track' | 'Idle' | 'Unknown';
export interface Evidence {
  id: string;
  title: string;
  reason: string;
  points: number;
  action: string;
  taskId?: string;
  url?: string;
}
export interface WorkItem {
  id: string;
  title: string;
  taskId?: string;
  external?: ExternalWork;
  deadline?: string;
}
export interface ProjectHealth {
  stack: Stack;
  state: Health;
  score: number;
  reasons: Evidence[];
  lastActivity: string | null;
  stale: boolean;
  groups: Record<
    | 'tasks'
    | 'overdue'
    | 'issues'
    | 'reviews'
    | 'workflows'
    | 'blocked'
    | 'deadlines'
    | 'deployments'
    | 'milestones'
    | 'risks',
    WorkItem[]
  >;
}
export function projectHealth(
  data: DeckData,
  stack: Stack,
  snapshot?: RepositorySnapshot,
  now = new Date(),
  weights: Weights = data.settings.command?.weights || defaultWeights,
): ProjectHealth {
  const groups: ProjectHealth['groups'] = {
    tasks: [],
    overdue: [],
    issues: [],
    reviews: [],
    workflows: [],
    blocked: [],
    deadlines: [],
    deployments: [],
    milestones: [],
    risks: [],
  };
  const evidence = new Map<string, Evidence>();
  const add = (reason: Evidence) => {
    if (!evidence.has(reason.id) || evidence.get(reason.id)!.points < reason.points)
      evidence.set(reason.id, reason);
  };
  const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const deadlineMs = (d: string) => new Date(d.length === 10 ? `${d}T23:59:59` : d).getTime();
  const soon = (d: string) =>
    deadlineMs(d) >= now.getTime() && deadlineMs(d) - now.getTime() <= 48 * 3600000;
  const tasks = data.tasks.filter((t) => t.stackId === stack.id);
  const active = tasks.filter((t) => !t.completedAt);
  for (const task of active) {
    const item = {
      id: task.id,
      title: task.title,
      taskId: task.id,
      deadline: task.deadline || undefined,
    };
    groups.tasks.push(item);
    const base = { id: task.id, title: task.title, taskId: task.id };
    if (task.kind === 'milestone') groups.milestones.push(item);
    if (task.deadline && task.deadline < date) {
      groups.overdue.push(item);
      add({
        ...base,
        reason: `${task.priority === 3 ? 'High-priority t' : 'T'}ask overdue`,
        points: task.priority === 3 ? weights.overdue : Math.round(weights.overdue / 2),
        action: 'Review overdue task',
      });
    }
    if (task.deadline && soon(task.deadline)) {
      groups.deadlines.push(item);
      add({
        ...base,
        reason: 'Deadline within 48 hours',
        points: weights.deadline,
        action: 'Review approaching deadline',
      });
    }
    if (task.blockedBy.some((id) => data.tasks.some((t) => t.id === id && !t.completedAt))) {
      groups.blocked.push(item);
      add({
        ...base,
        reason: 'Task has an unresolved dependency',
        points: task.priority === 3 ? weights.blocker : Math.round(weights.blocker / 3),
        action: 'Review blocking dependency',
      });
    }
  }
  if (stack.deadline) {
    const item = {
      id: `project:${stack.id}`,
      title: `${stack.name} project deadline`,
      deadline: stack.deadline,
    };
    if (soon(stack.deadline) || stack.deadline < date) {
      groups.deadlines.push(item);
      add({
        ...item,
        reason:
          stack.deadline < date ? 'Project deadline overdue' : 'Project deadline within 48 hours',
        points: weights.deadline,
        action: 'Review project deadline',
      });
    }
  }
  for (const risk of stack.command?.risks || []) {
    groups.risks.push({ id: risk.id, title: risk.title });
    add({
      id: risk.id,
      title: risk.title,
      reason: risk.critical ? 'Explicit critical blocker' : 'Flagged project risk',
      points: risk.critical ? weights.blocker : Math.round(weights.blocker / 3),
      action: 'Review project risk',
    });
  }
  const stale =
    !!stack.command?.repository &&
    (!snapshot?.lastSuccess ||
      snapshot.status !== 'ready' ||
      now.getTime() - Date.parse(snapshot.lastSuccess) > 2 * 3600000);
  for (const work of snapshot?.work || []) {
    const linkedTask = stack.command?.externalTasks?.[work.id];
    const item = {
      id: work.id,
      title: work.title,
      external: work,
      deadline: work.deadline,
    };
    if (work.type === 'issue') groups.issues.push(item);
    if (work.type === 'pull' && work.reviewRequested) groups.reviews.push(item);
    if (work.blocked) groups.blocked.push(item);
    if (work.type === 'workflow') groups.workflows.push(item);
    if (work.type === 'deployment') groups.deployments.push(item);
    if (work.type === 'milestone') groups.milestones.push(item);
    if (work.deadline && soon(work.deadline)) groups.deadlines.push(item);
    if (stale) continue;
    // An explicitly linked task and external reference are one underlying work item.
    const base = {
      id: active.some((t) => t.id === linkedTask) ? linkedTask! : work.evidenceKey || work.id,
      title: work.title,
      url: work.url,
    };
    if (work.type === 'deployment')
      add({
        ...base,
        reason: work.production ? 'Failed production deployment' : 'Failed deployment',
        points: work.production ? weights.deployment : weights.ci,
        action: 'Investigate deployment failure',
      });
    if (work.type === 'workflow')
      add({
        ...base,
        reason: work.defaultBranch ? 'Failed CI on default branch' : 'Failed workflow',
        points: work.defaultBranch ? weights.ci : Math.round(weights.ci / 2),
        action: 'Investigate failing workflow',
      });
    if (work.reviewRequested)
      add({
        ...base,
        reason: 'Pull request awaits your review',
        points: weights.review,
        action: 'Review pull request',
      });
    if (work.type === 'issue' && work.priority === 'high')
      add({
        ...base,
        reason: 'Open high-priority issue',
        points: weights.issue,
        action: 'Triage high-priority issue',
      });
    if (work.blocked)
      add({
        ...base,
        reason: 'Pull request blocked',
        points: weights.review,
        action: 'Resolve pull request blocker',
      });
    if (work.deadline && (soon(work.deadline) || deadlineMs(work.deadline) < now.getTime()))
      add({
        ...base,
        reason: 'Milestone due',
        points: weights.deadline,
        action: 'Review milestone',
      });
  }
  const reasons = [...evidence.values()].sort(
    (a, b) => b.points - a.points || a.id.localeCompare(b.id),
  );
  const score = reasons.reduce((sum, r) => sum + r.points, 0);
  const lastActivity =
    [
      ...tasks.map((t) => t.updatedAt),
      ...(snapshot?.activity.map((a) => a.occurredAt) || []),
      snapshot?.repository.pushedAt || '',
    ]
      .filter(Boolean)
      .sort()
      .at(-1) || null;
  const inactive =
    stack.command?.lifecycle === 'paused' ||
    stack.command?.lifecycle === 'archived' ||
    (snapshot?.repository.archived ?? stack.command?.repository?.archived);
  const state: Health = inactive
    ? 'Idle'
    : reasons.some(
          (r) =>
            r.reason === 'Failed production deployment' || r.reason === 'Explicit critical blocker',
        ) || score >= 60
      ? 'Critical'
      : reasons.length
        ? 'Needs Attention'
        : stale
          ? 'Unknown'
          : !lastActivity || now.getTime() - Date.parse(lastActivity) > 30 * 86400000
            ? 'Idle'
            : 'On Track';
  return {
    stack,
    state,
    score: inactive ? 0 : score,
    reasons: inactive ? [] : reasons,
    groups,
    lastActivity,
    stale,
  };
}
export function sortProjects(projects: ProjectHealth[], sort = 'urgency') {
  return [...projects].sort(
    (a, b) =>
      (sort === 'name'
        ? a.stack.name.localeCompare(b.stack.name)
        : sort === 'activity'
          ? (b.lastActivity || '').localeCompare(a.lastActivity || '')
          : sort === 'importance'
            ? (b.stack.command?.importance || 0) - (a.stack.command?.importance || 0)
            : b.score - a.score) ||
      a.stack.name.localeCompare(b.stack.name) ||
      a.stack.id.localeCompare(b.stack.id),
  );
}
const normalize = (v: string) =>
  v
    .toLowerCase()
    .replace(/\.git\/?$/, '')
    .replace(/\/$/, '')
    .replace(/^git@github.com:/, 'https://github.com/');
export function repositoryMatches(data: DeckData, repo: Repository) {
  return data.stacks
    .map((stack) => ({
      stack,
      signals: [
        ...(stack.command?.repository?.id === repo.id ? ['Saved repository ID'] : []),
        ...(stack.links.some((url) => normalize(url) === normalize(repo.url)) ||
        normalize(stack.command?.repository?.url || '') === normalize(repo.url)
          ? ['Repository URL']
          : []),
        ...(normalize(data.local?.projectPaths?.[stack.id]?.split('/').at(-1) || '') ===
        normalize(repo.name)
          ? ['Local folder name']
          : []),
        ...(stack.notes.includes(repo.url) ? ['Project metadata'] : []),
        ...(stack.name.toLowerCase().replace(/\W/g, '') ===
        repo.name.toLowerCase().replace(/\W/g, '')
          ? ['Similar name']
          : []),
      ],
    }))
    .filter((m) => m.signals.length);
}
export function importRepositories(
  data: DeckData,
  choices: { repository: Repository; target: 'new' | 'skip' | string }[],
): DeckData {
  const stacks = data.stacks.map((s) => ({ ...s }));
  for (const { repository, target } of choices) {
    if (target === 'skip') continue;
    const existing = stacks.find((s) => s.command?.repository?.id === repository.id);
    const stack = existing || (target !== 'new' ? stacks.find((s) => s.id === target) : undefined);
    if (!stack && target !== 'new')
      throw new Error('Selected project no longer exists. Review the import.');
    if (stack?.command?.repository && stack.command.repository.id !== repository.id)
      throw new Error('This project already has another repository. Choose a different project.');
    if (stack) {
      stack.command = { ...stack.command, repository };
    } else {
      if (stacks.some((s) => s.id === `github:${repository.id}`))
        throw new Error(
          'Repository project ID conflicts with an existing project. Link explicitly.',
        );
      stacks.push({
        id: `github:${repository.id}`,
        name: repository.name,
        icon: 'lucide:folder-git-2',
        color: '#b9a3d7',
        notes: repository.description,
        deadline: null,
        headings: [],
        links: [],
        command: { repository },
      });
    }
  }
  return { ...data, stacks };
}
