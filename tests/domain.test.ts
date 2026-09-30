import { describe, it, expect, vi, afterEach } from 'vitest';
import { parseQuickAdd, nextOccurrence, parseDate, addDays } from '../src/lib/dates';
import { seedData, makeTask } from '../src/lib/seed';
import { searchTasks, shuffleRank } from '../src/lib/search';
import { importData } from '../src/lib/transfer';
import { projectGraph, initialFilters, noteLinks, wouldCycle } from '../src/features/graph/model';
afterEach(() => vi.useRealTimers());
describe('natural language capture and recurrence', () => {
  it('extracts project, tag, scheduled date and time', () => {
    const parsed = parseQuickAdd(
      'Ship the update tomorrow at 3pm #Oddware @work',
      seedData().stacks,
    );
    expect(parsed.title).toBe('Ship the update');
    expect(parsed.stackId).toBe('oddware');
    expect(parsed.tags).toEqual(['work']);
    expect(parsed.scheduled).toBe(addDays(1));
    expect(parsed.time).toBe('15:00');
  });
  it('captures a recurring weekday without leaving schedule words in the title', () => {
    const p = parseQuickAdd('Water plants every Sunday', []);
    expect(p.title).toBe('Water plants');
    expect(p.recurrence).toBe('every Sunday');
    expect(new Date(p.scheduled + 'T12:00:00').getDay()).toBe(0);
  });
  it('separates recurrence from a start date', () => {
    const p = parseQuickAdd('Stretch tomorrow every day', []);
    expect(p.scheduled).toBe(addDays(1));
    expect(p.recurrence).toBe('every day');
  });
  it('skips weekends', () =>
    expect(nextOccurrence('every weekday', '2026-10-02')).toBe('2026-10-05'));
  it('clamps month-end to the next valid date', () =>
    expect(nextOccurrence('monthly', '2026-01-31')).toBe('2026-02-28'));
  it('respects intervals', () =>
    expect(nextOccurrence('every 2 weeks', '2026-09-29')).toBe('2026-10-13'));
  it('advances a weekly rule when completed on that weekday', () =>
    expect(nextOccurrence('every Tuesday', '2026-09-29')).toBe('2026-10-06'));
  it('rejects unrecognized dates', () => expect(parseDate('potatoes')).toBeNull());
});
describe('global search', () => {
  it('searches project and tag with a title query', () => {
    const d = seedData();
    expect(
      searchTasks(d.tasks, d.stacks, 'project:Oddware tag:development authentication').map(
        (t) => t.id,
      ),
    ).toEqual(['auth']);
  });
  it('finds completed cards', () => {
    const d = seedData();
    expect(searchTasks(d.tasks, d.stacks, 'completed:true').every((t) => t.completedAt)).toBe(true);
  });
  it('searches notes', () => {
    const d = seedData();
    expect(searchTasks(d.tasks, d.stacks, 'original destination').map((t) => t.id)).toEqual([
      'auth',
    ]);
  });
  it('combines deadline filters', () => {
    const d = seedData();
    d.tasks = [
      makeTask('Overdue', { deadline: addDays(-1) }),
      makeTask('Future', { deadline: addDays(3) }),
    ];
    expect(
      searchTasks(d.tasks, d.stacks, 'overdue:true before:tomorrow').map((t) => t.title),
    ).toEqual(['Overdue']);
  });
  it('ranks overdue work above a fresh low-priority card', () =>
    expect(shuffleRank(makeTask('Overdue', { deadline: addDays(-1) }))).toBeGreaterThan(
      shuffleRank(makeTask('New')),
    ));
});
describe('graph projection', () => {
  it('only includes edges with real visible endpoints', () => {
    const d = seedData();
    for (const filters of [
      initialFilters,
      { ...initialFilters, stack: 'deck' },
      { ...initialFilters, orphans: true },
      { ...initialFilters, completed: true },
    ]) {
      const graph = projectGraph(d, filters);
      const ids = new Set(graph.filter((e) => !e.data.source).map((e) => e.data.id));
      expect(
        graph
          .filter((e) => e.data.source)
          .every((e) => ids.has(String(e.data.source)) && ids.has(String(e.data.target))),
      ).toBe(true);
    }
  });
  it('derives links from notes', () => {
    const d = seedData();
    expect(noteLinks('Work with [[Deploy Repo Reaper]] in [[Oddware]].', d)).toEqual([
      'deploy',
      'oddware',
    ]);
  });
  it('encodes dependency direction and excludes completed by default', () => {
    const graph = projectGraph(seedData(), initialFilters);
    expect(graph.find((e) => e.data.id === 'graph-task:blocked by:deck-design')?.data.target).toBe(
      'deck-design',
    );
    expect(graph.find((e) => e.data.id === 'readme')).toBeUndefined();
  });
  it('detects indirect cycles', () => {
    const tasks = [
      makeTask('a', { id: 'a', blockedBy: ['b'] }),
      makeTask('b', { id: 'b', blockedBy: ['c'] }),
      makeTask('c', { id: 'c' }),
    ];
    expect(wouldCycle(tasks, 'c', 'a')).toBe(true);
    expect(wouldCycle(tasks, 'a', 'c')).toBe(false);
  });
  it('does not consider tags or incoming links orphaned', () => {
    const d = seedData();
    const graph = projectGraph(d, { ...initialFilters, orphans: true });
    expect(graph.filter((e) => e.data.kind === 'task').map((e) => e.data.id)).toEqual([
      'bookstore',
    ]);
  });
  it('projects more than 1000 cards without duplicating edges', () => {
    const d = seedData();
    d.tasks = Array.from({ length: 1200 }, (_, i) =>
      makeTask(`Card ${i}`, {
        id: `test-${i}`,
        stackId: d.stacks[i % 5].id,
        tags: ['work'],
        links: i ? [`test-${i - 1}`] : [],
      }),
    );
    const start = performance.now();
    const graph = projectGraph(d, initialFilters);
    expect(graph.filter((e) => e.data.kind === 'task')).toHaveLength(1200);
    expect(new Set(graph.map((e) => e.data.id)).size).toBe(graph.length);
    expect(performance.now() - start).toBeLessThan(1000);
  });
});
describe('safe import', () => {
  it('round-trips complete workspace data without duplicating cards', () => {
    const d = seedData();
    const imported = importData(JSON.stringify(d), 'json', d);
    expect(imported.tasks).toEqual(d.tasks);
    expect(imported.stacks).toEqual(d.stacks);
  });
  it('handles quoted CSV titles and preserves existing cards', () => {
    const d = seedData();
    const imported = importData(
      'title,notes,stack,tags\n"Plan, build, ship","A note","New stack","work;design"',
      'csv',
      d,
    );
    expect(imported.tasks).toHaveLength(d.tasks.length + 1);
    const t = imported.tasks.at(-1)!;
    expect(t.title).toBe('Plan, build, ship');
    expect(t.tags).toEqual(['work', 'design']);
    expect(imported.stacks.find((s) => s.id === t.stackId)?.name).toBe('New stack');
  });
  it('rejects malformed imports before mutating anything', () => {
    const d = seedData();
    expect(() => importData('{"tasks":[{"notes":"no title"}]}', 'json', d)).toThrow('title');
    expect(() => importData('name\ninvalid', 'csv', d)).toThrow('title');
    expect(d.tasks).toHaveLength(22);
  });
  it('repairs stale references', () => {
    const d = seedData();
    const imported = importData(
      JSON.stringify([{ title: 'Imported', stackId: 'missing', links: ['missing'] }]),
      'json',
      d,
    );
    expect(imported.tasks.at(-1)?.stackId).toBeNull();
    expect(imported.tasks.at(-1)?.links).toEqual([]);
  });
});
