import { describe, expect, it } from 'vitest';
import Papa from 'papaparse';
import { seedData, makeTask } from '../src/lib/seed';
import { importData, serializeExport } from '../src/lib/transfer';
import type { DeckData } from '../src/types';

function emptyWorkspace(): DeckData {
  return { ...seedData(), tasks: [], stacks: [], goals: [], headings: [] };
}

function workspace(): DeckData {
  const data = seedData();
  data.stacks[0] = {
    ...data.stacks[0],
    notes: 'Plan, build, ship.\nKeep the "details" — café.',
    deadline: '2026-12-31',
    headings: ['Development', 'Launch, then "learn"'],
  };
  data.stacks.push({
    id: 'empty-stack',
    name: 'Empty, "future" stack 🧭',
    icon: 'lucide:Archive',
    color: '#abcdef',
    notes: 'No cards yet.\nStill worth keeping.',
    deadline: null,
    headings: ['First steps'],
    links: ['oddware'],
  });
  data.tasks.push(
    makeTask('A "milestone", ready to ship 🧭', {
      id: 'milestone',
      kind: 'milestone',
      stackId: 'oddware',
      heading: 'Launch, then "learn"',
      notes: 'First line\nSecond line, with "quotes".',
      tags: ['work;design', 'café, notes'],
      scheduled: '2026-10-04',
      deadline: '2026-12-31',
      time: '15:30',
      priority: 3,
      completedAt: '2026-10-03T12:00:00.000Z',
      checklist: [{ id: 'check', title: 'Check, "twice"', done: true }],
      links: ['empty-stack', 'deploy'],
      blockedBy: ['config'],
      parentId: 'deploy',
      effort: 90,
      order: 0,
    }),
    makeTask('Unstacked card', { id: 'unstacked', kind: 'task', destination: 'inbox' }),
  );
  return data;
}

describe('workspace export', () => {
  it('exports the complete JSON workspace, including empty stacks and completed cards', () => {
    const data = workspace();
    expect(JSON.parse(serializeExport(data, 'json'))).toEqual(data);
    const imported = importData(serializeExport(data, 'json'), 'json', emptyWorkspace());
    expect(imported.stacks).toEqual(data.stacks);
    expect(imported.tasks).toEqual(data.tasks);
  });

  it('exports all stacks and cards to CSV with their details and relationships intact', () => {
    const data = workspace();
    const content = serializeExport(data, 'csv');
    const parsed = Papa.parse<Record<string, string>>(content, { header: true });
    expect(parsed.errors).toEqual([]);
    expect(parsed.data.filter((row) => row.recordType === 'stack')).toHaveLength(
      data.stacks.length,
    );
    expect(parsed.data.filter((row) => row.recordType === 'card')).toHaveLength(data.tasks.length);
    const imported = importData(content, 'csv', emptyWorkspace());
    expect(imported.stacks).toEqual(data.stacks);
    expect(imported.tasks).toEqual(data.tasks);
  });

  it.each(['empty', 'stacks only', 'cards only'] as const)(
    'exports a valid CSV for a workspace with %s',
    (scope) => {
      const data = emptyWorkspace();
      if (scope === 'stacks only') data.stacks = workspace().stacks;
      if (scope === 'cards only') data.tasks = [makeTask('Only card')];
      const content = serializeExport(data, 'csv');
      expect(content).toContain('recordType,id,title');
      const imported = importData(content, 'csv', emptyWorkspace());
      expect(imported.stacks).toEqual(data.stacks);
      expect(imported.tasks).toEqual(data.tasks);
    },
  );

  it('updates matching CSV IDs without duplication and keeps unrelated data', () => {
    const data = workspace();
    const current = workspace();
    current.stacks[0].name = 'An older name';
    current.tasks[0].notes = 'An older note';
    current.tasks.push(makeTask('Keep me', { id: 'keep' }));
    const imported = importData(serializeExport(data, 'csv'), 'csv', current);
    expect(imported.stacks).toEqual(data.stacks);
    expect(imported.tasks).toEqual([...data.tasks, current.tasks.at(-1)]);
    expect(current.stacks[0].name).toBe('An older name');
    expect(current.tasks[0].notes).toBe('An older note');
  });

  it('keeps distinct stacks with the same name and resolves cards by ID', () => {
    const data = workspace();
    data.stacks.at(-1)!.name = data.stacks[0].name;
    data.tasks.at(-1)!.stackId = data.stacks.at(-1)!.id;
    const imported = importData(serializeExport(data, 'csv'), 'csv', emptyWorkspace());
    expect(imported.stacks).toEqual(data.stacks);
    expect(imported.tasks).toEqual(data.tasks);
  });

  it('accepts existing card-only CSV exports with semicolon tags and JSON checklists', () => {
    const card = makeTask('Legacy, "card"', { id: 'legacy', stackId: 'legacy-stack' });
    const content = Papa.unparse([
      {
        ...card,
        stack: 'Legacy stack',
        tags: 'work;design',
        checklist: JSON.stringify([{ id: 'check', title: 'Existing checklist', done: false }]),
        links: '[]',
        blockedBy: '[]',
      },
    ]);
    const imported = importData(content, 'csv', emptyWorkspace());
    expect(imported.stacks[0]).toMatchObject({ id: 'legacy-stack', name: 'Legacy stack' });
    expect(imported.tasks[0]).toMatchObject({
      title: card.title,
      stackId: 'legacy-stack',
      parentId: null,
      tags: ['work', 'design'],
      checklist: [{ id: 'check', title: 'Existing checklist', done: false }],
    });
  });

  it.each([
    ['recordType,id,title\nother,wrong,Card', 'recordType'],
    ['recordType,id,name\nstack,missing-name,', 'name'],
    ['recordType,id,title\ncard,no-title,', 'title'],
    ['recordType,id,title,tags\ncard,bad-tags,Card,not-json', 'tags'],
    ['recordType,id,title,links\ncard,bad-links,Card,{}', 'links'],
  ])('rejects malformed CSV records: %s', (content, field) => {
    const current = workspace();
    const before = structuredClone(current);
    expect(() => importData(content, 'csv', current)).toThrow(field);
    expect(current).toEqual(before);
  });
});
