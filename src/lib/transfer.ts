import Papa from 'papaparse';
import { invoke, isTauri } from '@tauri-apps/api/core';
import type { DeckData, Task, Stack, Goal } from '../types';
import { makeTask } from './seed';
import { today, validRecurrence } from './dates';
import { parseTemplateImport } from './templates';
import type { DeckTemplate } from '../types';
export async function download(name: string, content: string, type = 'text/plain') {
  if (isTauri()) return invoke<boolean>('save_export', { name, contents: content });
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return true;
}
export function exportData(data: DeckData, format: 'json' | 'csv' | 'md') {
  let content = '';
  if (format === 'json') content = JSON.stringify(data, null, 2);
  if (format === 'csv')
    content = Papa.unparse(
      data.tasks.map((t) => ({
        ...t,
        stack: data.stacks.find((s) => s.id === t.stackId)?.name || '',
        tags: t.tags.join(';'),
        checklist: JSON.stringify(t.checklist),
        links: JSON.stringify(t.links),
        blockedBy: JSON.stringify(t.blockedBy),
      })),
    );
  if (format === 'md')
    content =
      `# Deck\n\nExported ${today()}\n\n` +
      [
        ...data.stacks.map((s) => ({ id: s.id, name: s.name })),
        { id: null, name: 'Inbox & unstacked' },
      ]
        .map(
          (s) =>
            `## ${s.name}\n\n` +
            data.tasks
              .filter((t) => t.stackId === s.id)
              .map(
                (t) =>
                  `- [${t.completedAt ? 'x' : ' '}] ${t.title}${t.scheduled ? ` · ${t.scheduled}` : ''}${t.deadline ? ` · Due ${t.deadline}` : ''}${t.tags.length ? ` ${t.tags.map((tag) => '#' + tag).join(' ')}` : ''}\n${
                    t.notes
                      ? `\n${t.notes
                          .split('\n')
                          .map((l) => '  ' + l)
                          .join('\n')}\n`
                      : ''
                  }${t.checklist.map((c) => `  - [${c.done ? 'x' : ' '}] ${c.title}`).join('\n')}`,
              )
              .join('\n'),
        )
        .join('\n\n');
  return download(
    `deck-${today()}.${format}`,
    content,
    format === 'json' ? 'application/json' : format === 'csv' ? 'text/csv' : 'text/markdown',
  );
}
const strings = (v: unknown) =>
  Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string') : [];
function normalizeTask(raw: unknown): Task {
  if (!raw || typeof raw !== 'object') throw new Error('Each card must be an object.');
  const r = raw as Record<string, unknown>;
  if (typeof r.title !== 'string' || !r.title.trim()) throw new Error('Every card needs a title.');
  const date = (v: unknown) =>
    typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(new Date(v).getTime())
      ? v
      : null;
  return makeTask(r.title, {
    ...(r.kind === 'milestone' ? { kind: 'milestone' } : {}),
    id: typeof r.id === 'string' ? r.id : crypto.randomUUID(),
    notes: typeof r.notes === 'string' ? r.notes : '',
    stackId: typeof r.stackId === 'string' && r.stackId ? r.stackId : null,
    heading: typeof r.heading === 'string' ? r.heading : 'Focus today',
    tags: strings(r.tags),
    scheduled: date(r.scheduled),
    deadline: date(r.deadline),
    time: typeof r.time === 'string' && /^\d{2}:\d{2}$/.test(r.time) ? r.time : null,
    destination: ['inbox', 'anytime', 'someday'].includes(String(r.destination))
      ? (r.destination as Task['destination'])
      : 'inbox',
    priority: ([0, 1, 2, 3].includes(Number(r.priority))
      ? Number(r.priority)
      : 0) as Task['priority'],
    recurrence:
      typeof r.recurrence === 'string' && validRecurrence(r.recurrence) ? r.recurrence : null,
    completedAt:
      typeof r.completedAt === 'string' && !Number.isNaN(Date.parse(r.completedAt))
        ? r.completedAt
        : null,
    createdAt:
      typeof r.createdAt === 'string' && !Number.isNaN(Date.parse(r.createdAt))
        ? r.createdAt
        : new Date().toISOString(),
    updatedAt:
      typeof r.updatedAt === 'string' && !Number.isNaN(Date.parse(r.updatedAt))
        ? r.updatedAt
        : new Date().toISOString(),
    checklist: Array.isArray(r.checklist)
      ? r.checklist
          .filter((c) => typeof c?.title === 'string')
          .map((c) => ({
            id: typeof c.id === 'string' ? c.id : crypto.randomUUID(),
            title: c.title,
            done: !!c.done,
          }))
      : [],
    links: strings(r.links),
    blockedBy: strings(r.blockedBy),
    parentId: typeof r.parentId === 'string' ? r.parentId : null,
    effort: Number(r.effort) > 0 ? Number(r.effort) : 25,
    order: Number.isFinite(Number(r.order)) ? Number(r.order) : Date.now(),
  });
}
export function importData(content: string, format: 'json' | 'csv', current: DeckData): DeckData {
  let tasks: Task[] = [];
  let stacks: Stack[] = [];
  let goals: Goal[] = [];
  let headings: string[] = [];
  let templates: DeckTemplate[] = [];
  if (format === 'json') {
    const parsed = JSON.parse(content);
    const records = Array.isArray(parsed) ? parsed : parsed.tasks;
    if (!Array.isArray(records)) throw new Error('Expected a Deck export or an array of cards.');
    if (parsed.version && parsed.version !== 1) throw new Error('This export uses a newer format.');
    tasks = records.map(normalizeTask);
    if (Array.isArray(parsed.stacks))
      stacks = parsed.stacks.map((s: Record<string, unknown>) => {
        if (typeof s.id !== 'string' || typeof s.name !== 'string')
          throw new Error('Invalid stack in import.');
        return {
          id: s.id,
          name: s.name,
          icon: typeof s.icon === 'string' ? s.icon : '◈',
          color:
            typeof s.color === 'string' && /^#[\da-f]{6}$/i.test(s.color) ? s.color : '#b5a0d5',
          notes: typeof s.notes === 'string' ? s.notes : '',
          deadline: typeof s.deadline === 'string' ? s.deadline : null,
          headings: strings(s.headings),
          links: strings(s.links),
        };
      });
    if (Array.isArray(parsed.goals))
      goals = parsed.goals
        .filter((g: Goal) => typeof g.id === 'string' && typeof g.title === 'string')
        .map((g: Goal) => ({ ...g, stackIds: strings(g.stackIds) }));
    headings = strings(parsed.headings);
    if (Array.isArray(parsed.templates) && parsed.templates.length)
      templates = parseTemplateImport(
        JSON.stringify({ kind: 'deck-templates', version: 1, templates: parsed.templates }),
      );
  } else {
    const parsed = Papa.parse<Record<string, string>>(content, {
      header: true,
      skipEmptyLines: true,
    });
    if (!parsed.meta.fields?.includes('title')) throw new Error('CSV needs a “title” column.');
    const errors = parsed.errors.filter((e) => e.code !== 'UndetectableDelimiter');
    if (errors.length) throw new Error(errors[0].message);
    tasks = parsed.data.map((row) => {
      let stackId = row.stackId || null;
      if (row.stack && !current.stacks.some((s) => s.id === stackId)) {
        const existing = [...current.stacks, ...stacks].find((s) => s.name === row.stack);
        if (existing) stackId = existing.id;
        else {
          stackId = stackId || crypto.randomUUID();
          stacks.push({
            id: stackId,
            name: row.stack,
            icon: '◈',
            color: '#b5a0d5',
            notes: '',
            deadline: null,
            headings: [],
            links: [],
          });
        }
      }
      return normalizeTask({
        ...row,
        stackId,
        tags: row.tags ? row.tags.split(';') : [],
        checklist: row.checklist ? JSON.parse(row.checklist) : [],
        links: row.links ? JSON.parse(row.links) : [],
        blockedBy: row.blockedBy ? JSON.parse(row.blockedBy) : [],
      });
    });
  }
  const merge = <T extends { id: string }>(a: T[], b: T[]) =>
    Array.from(new Map([...a, ...b].map((item) => [item.id, item])).values());
  const allStacks = merge(current.stacks, stacks);
  const allGoals = merge(current.goals, goals);
  const allTasks = merge(current.tasks, tasks);
  const ids = new Set([...allStacks, ...allGoals, ...allTasks].map((x) => x.id));
  return {
    ...current,
    tasks: allTasks.map((t) => ({
      ...t,
      stackId: allStacks.some((s) => s.id === t.stackId) ? t.stackId : null,
      links: t.links.filter((id) => ids.has(id) && id !== t.id),
      blockedBy: t.blockedBy.filter((id) => allTasks.some((o) => o.id === id) && id !== t.id),
    })),
    stacks: allStacks,
    goals: allGoals,
    headings: [...new Set([...current.headings, ...headings])],
    ...(templates.length ? { templates: merge(current.templates || [], templates) } : {}),
  };
}
