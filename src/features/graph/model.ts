import type { ElementDefinition } from 'cytoscape';
import type { DeckData, Task } from '../../types';
import { today } from '../../lib/dates';
export interface GraphFilters {
  stack: string;
  tag: string;
  status: string;
  priority: boolean;
  orphans: boolean;
  completed: boolean;
  from: string;
  to: string;
}
export const initialFilters: GraphFilters = {
  stack: '',
  tag: '',
  status: '',
  priority: false,
  orphans: false,
  completed: false,
  from: '',
  to: '',
};
export function noteLinks(notes: string, data: DeckData): string[] {
  return [...notes.matchAll(/\[\[([^\]]+)\]\]/g)]
    .map(
      ([, name]) =>
        data.tasks.find((t) => t.title.toLowerCase() === name.toLowerCase())?.id ||
        data.stacks.find((s) => s.name.toLowerCase() === name.toLowerCase())?.id ||
        data.goals.find((g) => g.title.toLowerCase() === name.toLowerCase())?.id,
    )
    .filter((id): id is string => !!id);
}
export const taskLinks = (task: Task, data: DeckData) => [
  ...new Set([...task.links, ...noteLinks(task.notes, data)]),
];
export function projectGraph(data: DeckData, filters: GraphFilters): ElementDefinition[] {
  const tasks = data.tasks.filter((t) => {
    if (!filters.completed && t.completedAt) return false;
    if (filters.stack && t.stackId !== filters.stack) return false;
    if (filters.tag && !t.tags.includes(filters.tag)) return false;
    if (filters.priority && !t.priority) return false;
    const date = t.scheduled || t.deadline;
    if (filters.from && (!date || date < filters.from)) return false;
    if (filters.to && (!date || date > filters.to)) return false;
    switch (filters.status) {
      case 'today':
        if (!t.scheduled || t.scheduled > today() || t.destination === 'someday') return false;
        break;
      case 'upcoming':
        if (!t.scheduled || t.scheduled <= today()) return false;
        break;
      case 'anytime':
        if (t.scheduled || t.destination !== 'anytime') return false;
        break;
      case 'someday':
        if (t.destination !== 'someday') return false;
        break;
      case 'overdue':
        if (!t.deadline || t.deadline >= today() || t.completedAt) return false;
        break;
      case 'blocked':
        if (
          !t.blockedBy.some((id) =>
            data.tasks.some((other) => other.id === id && !other.completedAt),
          )
        )
          return false;
        break;
      case 'unstacked':
        if (t.stackId) return false;
        break;
      case 'stale':
        if (Date.now() - new Date(t.updatedAt).getTime() < 30 * 86400000) return false;
        break;
    }
    if (
      filters.orphans &&
      (t.stackId ||
        t.tags.length ||
        taskLinks(t, data).length ||
        t.blockedBy.length ||
        t.parentId ||
        data.tasks.some((o) => taskLinks(o, data).includes(t.id) || o.blockedBy.includes(t.id)))
    )
      return false;
    return true;
  });
  const elements: ElementDefinition[] = [];
  const ids = new Set<string>();
  function node(
    id: string,
    label: string,
    kind: string,
    color: string,
    size: number,
    extra: Record<string, unknown> = {},
  ) {
    if (ids.has(id)) return;
    ids.add(id);
    elements.push({ data: { id, label, kind, color, size, ...extra }, classes: kind });
  }
  function edge(source: string, target: string, relation: string) {
    elements.push({
      data: { id: `${source}:${relation}:${target}`, source, target, relation },
      classes: relation === 'blocked by' ? 'dependency' : '',
    });
  }
  const stackIds = new Set(tasks.map((t) => t.stackId).filter(Boolean));
  if (!filters.stack && !filters.tag && !filters.orphans && !filters.status)
    data.stacks.forEach((s) => stackIds.add(s.id));
  data.stacks
    .filter((s) => stackIds.has(s.id))
    .forEach((s) =>
      node(
        s.id,
        s.name,
        'stack',
        s.color,
        29 + Math.min(12, tasks.filter((t) => t.stackId === s.id).length),
        { count: tasks.filter((t) => t.stackId === s.id).length },
      ),
    );
  for (const task of tasks) {
    const stack = data.stacks.find((s) => s.id === task.stackId);
    node(
      task.id,
      task.title,
      'task',
      stack?.color || '#aaa4b1',
      task.priority ? 12 + task.priority : 10,
      {
        completed: !!task.completedAt,
        inactive: task.destination === 'someday',
        scheduled: task.scheduled || task.deadline || '9999',
        priority: task.priority,
        milestone: task.kind === 'milestone',
        overdue: !!task.deadline && task.deadline < today() && !task.completedAt,
      },
    );
    if (task.stackId) edge(task.id, task.stackId, 'belongs to');
    for (const tag of task.tags) {
      node(`tag:${tag}`, `#${tag}`, 'tag', '#899b99', 13);
      edge(task.id, `tag:${tag}`, 'tagged');
    }
    if (task.heading && stack?.headings.includes(task.heading)) {
      const id = `heading:${stack.id}:${task.heading}`;
      node(id, task.heading, 'heading', stack.color, 16);
      edge(task.id, id, 'under');
      edge(id, stack.id, 'section of');
    }
  }
  for (const task of tasks) {
    for (const target of taskLinks(task, data))
      if (ids.has(target)) edge(task.id, target, 'related to');
    for (const target of task.blockedBy) if (ids.has(target)) edge(task.id, target, 'blocked by');
    if (task.parentId && ids.has(task.parentId)) edge(task.id, task.parentId, 'subtask of');
  }
  for (const stack of data.stacks)
    if (ids.has(stack.id))
      for (const target of stack.links) if (ids.has(target)) edge(stack.id, target, 'related to');
  for (const goal of data.goals) {
    const targets = goal.stackIds.filter((id) => ids.has(id));
    if (targets.length) {
      node(goal.id, goal.title, 'goal', '#ceb684', 22);
      targets.forEach((id) => edge(goal.id, id, 'supports'));
    }
  }
  return elements.filter((el, i, array) =>
    el.data.source
      ? ids.has(String(el.data.source)) &&
        ids.has(String(el.data.target)) &&
        array.findIndex((e) => e.data.id === el.data.id) === i
      : true,
  );
}
export function wouldCycle(tasks: Task[], taskId: string, dependencyId: string) {
  const visited = new Set<string>();
  const walk = (id: string): boolean => {
    if (id === taskId) return true;
    if (visited.has(id)) return false;
    visited.add(id);
    return tasks.find((t) => t.id === id)?.blockedBy.some(walk) || false;
  };
  return walk(dependencyId);
}
export function localElements(elements: ElementDefinition[], root: string, depth: number) {
  const ids = new Set([root]);
  for (let hop = 0; hop < depth; hop++) {
    const next = new Set(ids);
    for (const e of elements) {
      if (e.data.source && (ids.has(String(e.data.source)) || ids.has(String(e.data.target)))) {
        next.add(String(e.data.source));
        next.add(String(e.data.target));
      }
    }
    if (next.size === ids.size) break;
    next.forEach((id) => ids.add(id));
  }
  return elements.filter((e) =>
    e.data.source
      ? ids.has(String(e.data.source)) && ids.has(String(e.data.target))
      : ids.has(String(e.data.id)),
  );
}
