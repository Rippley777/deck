import type { Task, Stack } from '../types';
import { parseDate, today } from './dates';
export function searchTasks(tasks: Task[], stacks: Stack[], query: string) {
  const filters = [
    ...query.matchAll(/(project|stack|tag|before|completed|overdue):("[^"]+"|\S+)/g),
  ];
  const text = query
    .replace(/(project|stack|tag|before|completed|overdue):("[^"]+"|\S+)/g, '')
    .trim()
    .toLowerCase();
  return tasks.filter((t) => {
    const stack = stacks.find((s) => s.id === t.stackId);
    if (
      text &&
      !`${t.title} ${t.notes} ${stack?.name || ''} ${t.tags.join(' ')}`.toLowerCase().includes(text)
    )
      return false;
    return filters.every(([, key, raw]) => {
      const v = raw.replaceAll('"', '').toLowerCase();
      switch (key) {
        case 'project':
        case 'stack':
          return stack?.name.toLowerCase() === v;
        case 'tag':
          return t.tags.some((tag) => tag.toLowerCase() === v);
        case 'before': {
          const date = parseDate(v);
          return !!date && !!(t.deadline || t.scheduled) && (t.deadline || t.scheduled)! < date;
        }
        case 'completed':
          return Boolean(t.completedAt) === (v === 'true');
        case 'overdue':
          return Boolean(!t.completedAt && t.deadline && t.deadline < today()) === (v === 'true');
        default:
          return true;
      }
    });
  });
}
export function shuffleRank(task: Task, stackId?: string | null) {
  return (
    task.priority * 20 +
    (task.deadline && task.deadline < today() ? 100 : task.deadline === today() ? 60 : 0) +
    Math.min(20, (Date.now() - new Date(task.createdAt).getTime()) / 86400000) +
    (task.stackId === stackId ? 15 : 0) +
    (task.effort <= 15 ? 10 : 0)
  );
}
