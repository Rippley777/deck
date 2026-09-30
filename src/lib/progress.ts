import type { Task } from '../types';
import { isoDate, today } from './dates';

export interface ProgressItem {
  id: string;
  completed: boolean;
  deferred?: boolean;
  blocked?: boolean;
  overdue?: boolean;
}
export interface ProgressCounts {
  total: number;
  completed: number;
  deferred?: number;
  blocked?: number;
  overdue?: number;
}
export interface ProgressSummary {
  total: number;
  completed: number;
  remaining: number;
  deferred: number;
  blocked: number;
  overdue: number;
  percentage: number;
  cleared: boolean;
}
export interface ProgressSegment {
  key: string;
  start: number;
  end: number;
  weight: number;
  completed: number;
  deferred: number;
  blocked: boolean;
  overdue: boolean;
}
export type ProgressMode = 'individual' | 'grouped' | 'percentage';
const count = (n: number | undefined) => (Number.isFinite(n) ? Math.max(0, Math.floor(n!)) : 0);

/** Remaining includes deferred work. Blocked and overdue are overlapping subsets,
 * not extra tasks; completed and deferred tasks never contribute to either. */
export function progressSummary(source: ProgressCounts | readonly ProgressItem[]): ProgressSummary {
  let values: ProgressCounts;
  if (Array.isArray(source)) {
    values = { total: source.length, completed: 0, deferred: 0, blocked: 0, overdue: 0 };
    for (const item of source as readonly ProgressItem[]) {
      if (item.completed) values.completed++;
      else if (item.deferred) values.deferred!++;
      else {
        if (item.blocked) values.blocked!++;
        if (item.overdue) values.overdue!++;
      }
    }
  } else values = source as ProgressCounts;
  const total = count(values.total);
  const completed = Math.min(total, count(values.completed));
  const remaining = total - completed;
  const deferred = Math.min(remaining, count(values.deferred));
  const blocked = Math.min(remaining - deferred, count(values.blocked));
  const overdue = Math.min(remaining - deferred, count(values.overdue));
  return {
    total,
    completed,
    remaining,
    deferred,
    blocked,
    overdue,
    percentage:
      total === 0
        ? 0
        : completed === total
          ? 100
          : Math.min(99, Math.round((completed / total) * 100)),
    cleared: total > 0 && completed === total,
  };
}

export function progressText(summary: ProgressSummary): string {
  if (!summary.total) return 'No tasks yet';
  return (
    `${summary.completed} of ${summary.total} tasks complete. ${summary.remaining} remaining.` +
    (summary.deferred ? ` ${summary.deferred} deferred.` : '') +
    (summary.blocked ? ` ${summary.blocked} blocked.` : '') +
    (summary.overdue ? ` ${summary.overdue} overdue.` : '')
  );
}

export function isInTodayDeck(task: Task, date = today()): boolean {
  return (
    !!task.scheduled &&
    task.scheduled <= date &&
    task.destination !== 'someday' &&
    (!task.completedAt || isoDate(new Date(task.completedAt)) === date)
  );
}

/** Stable task identity keeps an individual arc in place on completion or list filtering. */
export function taskProgress(
  tasks: readonly Task[],
  allTasks: readonly Task[],
  date = today(),
): ProgressItem[] {
  const incomplete = new Set(allTasks.filter((t) => !t.completedAt).map((t) => t.id));
  return [...tasks]
    .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
    .map((task) => ({
      id: task.id,
      completed: !!task.completedAt,
      deferred: !task.completedAt && task.destination === 'someday',
      blocked:
        !task.completedAt &&
        task.destination !== 'someday' &&
        task.blockedBy.some((id) => incomplete.has(id)),
      overdue:
        !task.completedAt &&
        task.destination !== 'someday' &&
        !!task.deadline &&
        task.deadline < date,
    }));
}

/** Counts-only consumers get stable ordinal slots, without allocating per task for large totals. */
function itemAt(index: number, summary: ProgressSummary): ProgressItem {
  const { total, completed, deferred, blocked, overdue } = summary;
  return {
    id: `slot-${index}`,
    completed: index < completed,
    deferred: index >= total - deferred,
    blocked: index >= completed && index < completed + blocked,
    overdue: index >= completed && index < completed + overdue,
  };
}

export function progressSegments(
  source: ProgressCounts | readonly ProgressItem[],
  size = 48,
): {
  mode: ProgressMode;
  summary: ProgressSummary;
  segments: ProgressSegment[];
} {
  const summary = progressSummary(source);
  const { total, completed, deferred, blocked, overdue } = summary;
  const mode: ProgressMode = total <= 12 ? 'individual' : total <= 40 ? 'grouped' : 'percentage';
  if (!total) return { mode, summary, segments: [] };
  const items = Array.isArray(source) ? (source as readonly ProgressItem[]) : null;
  const segmentCount =
    mode === 'individual' ? total : mode === 'grouped' ? 12 : size < 24 ? 12 : 24;
  const step = 360 / segmentCount;
  // Fixed physical gaps remain visible even in a 16px sidebar glyph.
  const gap = Math.min(step * 0.24, size < 24 ? 8 : size < 40 ? 5 : 3.5);
  const segments: ProgressSegment[] = [];
  const overlap = (a: number, b: number, start: number, end: number) =>
    Math.max(0, Math.min(b, end) - Math.max(a, start));
  for (let i = 0; i < segmentCount; i++) {
    if (mode === 'percentage') {
      const a = i / segmentCount,
        b = (i + 1) / segmentCount;
      const c = completed / total,
        d = (total - deferred) / total;
      segments.push({
        key: `percentage-${i}`,
        start: i * step + gap / 2,
        end: (i + 1) * step - gap / 2,
        weight: total / segmentCount,
        completed: overlap(a, b, 0, c) * segmentCount,
        deferred: overlap(a, b, d, 1) * segmentCount,
        blocked: overlap(a, b, c, (completed + blocked) / total) > 0,
        overdue: overlap(a, b, c, (completed + overdue) / total) > 0,
      });
    } else {
      const first = Math.floor((i * total) / segmentCount),
        last = Math.floor(((i + 1) * total) / segmentCount);
      const group = Array.from(
        { length: last - first },
        (_, j) => items?.[first + j] ?? itemAt(first + j, summary),
      );
      const groupSummary = progressSummary(group);
      segments.push({
        key: mode === 'individual' ? group[0].id : `group-${i}`,
        start: (first / total) * 360 + gap / 2,
        end: (last / total) * 360 - gap / 2,
        weight: group.length,
        completed: groupSummary.completed / group.length,
        deferred: groupSummary.deferred / group.length,
        blocked: groupSummary.blocked > 0,
        overdue: groupSummary.overdue > 0,
      });
    }
  }
  return { mode, summary, segments };
}

export function ringPoint(radius: number, degrees: number): [number, number] {
  const radians = ((degrees - 90) * Math.PI) / 180;
  return [50 + radius * Math.cos(radians), 50 + radius * Math.sin(radians)];
}

export function ringStroke(start: number, end: number, radius: number): string {
  const a = ringPoint(radius, start),
    b = ringPoint(radius, end);
  return `M ${a.join(' ')} A ${radius} ${radius} 0 ${end - start > 180 ? 1 : 0} 1 ${b.join(' ')}`;
}

/** A hollow annular card, never a wedge into the center. */
export function ringArc(start: number, end: number, outer = 43, inner = 33): string {
  if (end <= start) return '';
  const a = ringPoint(outer, start),
    b = ringPoint(outer, end);
  const c = ringPoint(inner, end),
    d = ringPoint(inner, start);
  const large = end - start > 180 ? 1 : 0;
  return `M ${a.join(' ')} A ${outer} ${outer} 0 ${large} 1 ${b.join(' ')} L ${c.join(' ')} A ${inner} ${inner} 0 ${large} 0 ${d.join(' ')} Z`;
}
