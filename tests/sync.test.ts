import { describe, expect, it } from 'vitest';
import { mergeDeck, emptyDeck } from '../shared/sync';
import { deckSchema } from '../shared/validation';
import { defaultSettings } from '../src/types';
import { makeTask } from '../src/lib/seed';
const base = () => ({
  ...emptyDeck(defaultSettings),
  tasks: [makeTask('Original', { id: 'a', notes: 'Original notes' })],
});
describe('three-way Deck synchronization', () => {
  it('combines independent fields and independently created cards', () => {
    const b = base(),
      l = structuredClone(b),
      r = structuredClone(b);
    l.tasks[0].title = 'New title';
    r.tasks[0].notes = 'Remote notes';
    l.tasks.push(makeTask('Phone', { id: 'phone' }));
    r.tasks.push(makeTask('Desktop', { id: 'desktop' }));
    const result = mergeDeck(b, l, r);
    expect(result.data.tasks).toHaveLength(3);
    expect(result.data.tasks.find((t) => t.id === 'a')).toMatchObject({
      title: 'New title',
      notes: 'Remote notes',
    });
    expect(result.conflicts).toEqual([]);
  });
  it('preserves both notes on an overlapping conflict', () => {
    const b = base(),
      l = structuredClone(b),
      r = structuredClone(b);
    l.tasks[0].notes = 'Phone notes';
    r.tasks[0].notes = 'Desktop notes';
    const result = mergeDeck(b, l, r);
    expect(result.data.tasks[0].notes).toBe('Phone notes');
    expect(result.conflicts).toContainEqual({
      path: 'tasks.a.notes',
      local: 'Phone notes',
      remote: 'Desktop notes',
    });
  });
  it('propagates deletions and preserves an edit to a concurrently deleted card', () => {
    const b = base(),
      l = structuredClone(b),
      r = structuredClone(b);
    l.tasks = [];
    r.tasks[0].notes = 'Unsaved thought';
    const result = mergeDeck(b, l, r);
    expect(result.data.tasks).toEqual([]);
    expect(result.conflicts[0].remote).toMatchObject({ notes: 'Unsaved thought' });
  });
  it('does not reinsert a card from an unchanged stale client', () => {
    const b = base(),
      remote = { ...b, tasks: [] };
    expect(mergeDeck(b, b, remote).data.tasks).toEqual([]);
  });
  it('merges settings, templates, links, and checklist edits', () => {
    const b = base(),
      l = structuredClone(b),
      r = structuredClone(b);
    l.settings.theme = 'light';
    r.settings.clock24 = true;
    l.tasks[0].links = ['b'];
    r.tasks[0].checklist = [{ id: 'c', title: 'Item', done: true }];
    const merged = mergeDeck(b, l, r).data;
    expect(merged.settings).toMatchObject({ theme: 'light', clock24: true });
    expect(merged.tasks[0]).toMatchObject({
      links: ['b'],
      checklist: [{ id: 'c', title: 'Item', done: true }],
    });
  });
  it('ignores PostgreSQL JSONB object key ordering when comparing checklists', () => {
    const b = base();
    b.tasks[0].checklist = [{ id: 'c', title: 'Item', done: false }];
    const l = structuredClone(b),
      r = structuredClone(b);
    l.tasks[0].title = 'Changed';
    r.tasks[0].checklist = [{ done: false, title: 'Item', id: 'c' }];
    expect(mergeDeck(b, l, r).conflicts).toEqual([]);
    expect(mergeDeck(b, l, r).data.tasks[0].title).toBe('Changed');
  });
  it('merges independent checklist item edits by stable ID', () => {
    const b = base();
    b.tasks[0].checklist = [
      { id: 'first', title: 'First', done: false },
      { id: 'second', title: 'Second', done: false },
    ];
    const l = structuredClone(b),
      r = structuredClone(b);
    l.tasks[0].checklist[0].done = true;
    r.tasks[0].checklist[1].done = true;
    expect(mergeDeck(b, l, r).data.tasks[0].checklist.every((item) => item.done)).toBe(true);
    expect(mergeDeck(b, l, r).conflicts).toEqual([]);
  });
  it('preserves concurrent tag and graph link additions without resurrecting removed references', () => {
    const b = base();
    b.tasks[0].tags = ['removed', 'kept'];
    const l = structuredClone(b),
      r = structuredClone(b);
    l.tasks[0].tags = ['kept', 'local'];
    r.tasks[0].tags = ['removed', 'kept', 'remote'];
    l.tasks[0].links = ['local-link'];
    r.tasks[0].links = ['remote-link'];
    const result = mergeDeck(b, l, r).data.tasks[0];
    expect(result.tags).toEqual(['kept', 'remote', 'local']);
    expect(result.links).toEqual(['remote-link', 'local-link']);
  });
  it('rejects malformed and duplicate entities at the API boundary', () => {
    const b = base();
    expect(deckSchema.safeParse(b).success).toBe(true);
    expect(deckSchema.safeParse({ ...b, tasks: [{ id: 'bad' }] }).success).toBe(false);
    expect(deckSchema.safeParse({ ...b, tasks: [b.tasks[0], b.tasks[0]] }).success).toBe(false);
  });
});
