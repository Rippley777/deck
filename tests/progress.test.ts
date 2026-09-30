import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { makeTask } from '../src/lib/seed';
import { DeckProgress } from '../src/components/progress/DeckProgress';
import {
  isInTodayDeck,
  progressSegments,
  progressSummary,
  progressText,
  ringArc,
  taskProgress,
  type ProgressItem,
} from '../src/lib/progress';

const fixture = (total: number, completed: number): ProgressItem[] =>
  Array.from({ length: total }, (_, i) => ({ id: `card-${i}`, completed: i < completed }));

describe('honest progress accounting', () => {
  it('keeps overlapping statuses as subsets, with deferred and completed work excluded', () => {
    const tasks = [
      makeTask('Done', { id: 'done', completedAt: '2026-09-29T12:00:00Z', deadline: '2026-09-01' }),
      makeTask('Prerequisite', { id: 'pre' }),
      makeTask('Blocked and overdue', { id: 'both', blockedBy: ['pre'], deadline: '2026-09-28' }),
      makeTask('Someday', { destination: 'someday', deadline: '2026-09-01', blockedBy: ['pre'] }),
      makeTask('Unblocked', { blockedBy: ['done', 'deleted'] }),
    ];
    const result = progressSummary(taskProgress(tasks, tasks, '2026-09-29'));
    expect(result).toMatchObject({
      total: 5,
      completed: 1,
      remaining: 4,
      deferred: 1,
      blocked: 1,
      overdue: 1,
    });
    expect(result.completed + result.remaining).toBe(result.total);
    expect(progressText(result)).toContain('1 of 5 tasks complete');
  });
  it('normalizes impossible counts and handles empty decks without reporting completion', () => {
    expect(progressSummary({ total: 0, completed: 8 })).toMatchObject({
      total: 0,
      completed: 0,
      percentage: 0,
      cleared: false,
    });
    expect(progressSummary({ total: 8, completed: 99 })).toMatchObject({
      total: 8,
      completed: 8,
      cleared: true,
    });
    expect(
      progressSummary({ total: 8.9, completed: -2, blocked: 99, overdue: Infinity, deferred: 2 }),
    ).toMatchObject({ total: 8, completed: 0, blocked: 6, overdue: 0, deferred: 2 });
    expect(progressSummary({ total: NaN, completed: Infinity })).toMatchObject({
      total: 0,
      completed: 0,
    });
  });
  it('never rounds unfinished work up to 100%', () =>
    expect(progressSummary({ total: 1000, completed: 999 }).percentage).toBe(99));
  it('recognizes work-date carryover, local completion dates, and future recurrence', () => {
    expect(isInTodayDeck(makeTask('Carried over', { scheduled: '2026-09-28' }), '2026-09-29')).toBe(
      true,
    );
    expect(
      isInTodayDeck(
        makeTask('Deferred', { scheduled: '2026-09-29', destination: 'someday' }),
        '2026-09-29',
      ),
    ).toBe(false);
    expect(
      isInTodayDeck(makeTask('Next occurrence', { scheduled: '2026-09-30' }), '2026-09-29'),
    ).toBe(false);
    expect(
      isInTodayDeck(
        makeTask('Yesterday', {
          scheduled: '2026-09-28',
          completedAt: new Date(2026, 8, 28, 12).toISOString(),
        }),
        '2026-09-29',
      ),
    ).toBe(false);
    expect(
      isInTodayDeck(
        makeTask('Today', {
          scheduled: '2026-09-28',
          completedAt: new Date(2026, 8, 29, 23).toISOString(),
        }),
        '2026-09-29',
      ),
    ).toBe(true);
  });
});

describe('adaptive arc geometry', () => {
  it.each([1, 8, 12])('assigns exactly one stable segment to each of %i cards', (total) => {
    const before = fixture(total, 0),
      after = before.map((item, i) => ({ ...item, completed: i === total - 1 }));
    const a = progressSegments(before),
      b = progressSegments(after);
    expect(a.mode).toBe('individual');
    expect(a.segments).toHaveLength(total);
    expect(a.segments.map((s) => s.key)).toEqual(b.segments.map((s) => s.key));
    expect(b.segments.filter((s) => s.completed === 1).map((s) => s.key)).toEqual([
      `card-${total - 1}`,
    ]);
  });
  it.each([13, 25, 40])(
    'groups %i cards proportionally without rounding away completions',
    (total) => {
      const { mode, segments } = progressSegments(fixture(total, 7));
      expect(mode).toBe('grouped');
      expect(segments).toHaveLength(12);
      expect(segments.reduce((n, s) => n + s.weight, 0)).toBe(total);
      expect(segments.reduce((n, s) => n + s.completed * s.weight, 0)).toBeCloseTo(7, 10);
      expect(segments.every((s) => s.start < s.end && s.start >= 0 && s.end <= 360)).toBe(true);
    },
  );
  it.each([41, 1000, 1000000])(
    'bounds SVG complexity for %i cards and preserves precise percentage',
    (total) => {
      const { mode, segments } = progressSegments({ total, completed: 17, deferred: 4 }, 48);
      expect(mode).toBe('percentage');
      expect(segments).toHaveLength(24);
      expect(segments.reduce((n, s) => n + s.completed * s.weight, 0)).toBeCloseTo(17, 7);
      expect(segments.reduce((n, s) => n + s.deferred * s.weight, 0)).toBeCloseTo(4, 7);
      expect(progressSegments({ total, completed: 17 }, 16).segments).toHaveLength(12);
    },
  );
  it('keeps gaps and an open center for a single-card deck', () => {
    const segment = progressSegments({ total: 1, completed: 0 }).segments[0];
    expect(segment.end - segment.start).toBeLessThan(360);
    expect(ringArc(segment.start, segment.end)).toContain('A 33 33');
    expect(ringArc(segment.start, segment.end)).not.toContain('NaN');
  });
});

describe('the reusable SVG primitive', () => {
  it('exposes numeric progress and non-color status descriptions', () => {
    const html = renderToStaticMarkup(
      createElement(DeckProgress, {
        total: 12,
        completed: 7,
        blocked: 1,
        overdue: 1,
        deferred: 2,
        label: 'Oddware',
        tooltip: false,
        variant: 'enhanced',
      }),
    );
    expect(html).toContain('role="progressbar"');
    expect(html).toContain('aria-valuenow="7"');
    expect(html).toContain('aria-valuemax="12"');
    expect(html).toContain(
      '7 of 12 tasks complete. 5 remaining. 2 deferred. 1 blocked. 1 overdue.',
    );
    expect(html).toContain('class="deck-progress-blocked"');
    expect(html).toContain('class="deck-progress-overdue"');
    expect(html).toContain('class="deck-progress-deferred"');
  });
  it('omits center text at tiny sizes even when requested', () => {
    const tiny = renderToStaticMarkup(
      createElement(DeckProgress, {
        total: 8,
        completed: 3,
        size: 16,
        showLabel: true,
        tooltip: false,
      }),
    );
    const header = renderToStaticMarkup(
      createElement(DeckProgress, {
        total: 8,
        completed: 3,
        size: 48,
        showLabel: 'percentage',
        tooltip: false,
      }),
    );
    expect(tiny).not.toContain('<text');
    expect(header).toContain('38%');
  });
  it('renders an empty state rather than a spinner or a completed ring', () => {
    const html = renderToStaticMarkup(
      createElement(DeckProgress, { total: 0, completed: 0, tooltip: false }),
    );
    expect(html).toContain('No tasks yet');
    expect(html).toContain('deck-progress-empty');
    expect(html).toContain('data-cleared="false"');
  });
});
