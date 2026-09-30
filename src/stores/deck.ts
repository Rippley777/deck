import { create } from 'zustand';
import type { DeckData, Task, Stack, View, TemplateContext } from '../types';
import { withTemplates } from '../lib/templates';
import { defaultSettings } from '../types';
import { seedData, makeTask } from '../lib/seed';
import { repository } from '../lib/repository';
import { nextOccurrence, today } from '../lib/dates';
type Modal =
  | 'quick'
  | 'commands'
  | 'planning'
  | 'shuffle'
  | 'stack'
  | 'settings'
  | 'shortcuts'
  | 'templates'
  | null;
interface Store {
  data: DeckData;
  ready: boolean;
  error: string | null;
  saving: boolean;
  view: View;
  selected: string | null;
  selection: string[];
  modal: Modal;
  sidebar: boolean;
  search: string;
  toast: { message: string; undo?: () => void } | null;
  graphFocus: string | null;
  plannedDate: string | null;
  templateContext: TemplateContext;
  openTemplates: (context?: TemplateContext) => void;
  initialize: () => Promise<void>;
  commit: (data: DeckData) => void;
  updateTask: (id: string, patch: Partial<Task>) => void;
  addTask: (title: string, patch?: Partial<Task>) => string;
  completeTask: (id: string) => void;
  deleteTask: (id: string) => void;
  duplicateTask: (id: string) => void;
  addStack: (stack: Omit<Stack, 'id'>) => void;
  duplicateStack: (id: string) => void;
  setView: (view: View) => void;
  setModal: (modal: Modal) => void;
  select: (id: string | null) => void;
  notify: (message: string, undo?: () => void) => void;
  bulk: (patch: Partial<Task>) => void;
  localGraph: (id: string) => void;
}
let queue = Promise.resolve();
export async function flushPersistence() {
  await queue;
}
let pendingSaves = 0;
let toastTimer: ReturnType<typeof setTimeout>;
let initializing: Promise<void> | null = null;
export const useDeck = create<Store>((set, get) => ({
  data: { version: 1, tasks: [], stacks: [], goals: [], headings: [], settings: defaultSettings },
  ready: false,
  error: null,
  saving: false,
  view: 'today',
  selected: null,
  selection: [],
  modal: null,
  sidebar: true,
  search: '',
  toast: null,
  graphFocus: null,
  plannedDate: null,
  templateContext: {},
  openTemplates: (context = {}) =>
    set({ templateContext: context, modal: 'templates', selected: null }),
  initialize: () => {
    if (initializing) return initializing;
    initializing = (async () => {
      try {
        const saved = await repository.load();
        const data = withTemplates(saved || seedData());
        if (data !== saved) await repository.save(data);
        set({ data, ready: true });
      } catch (e) {
        set({ error: `Could not open your local database: ${String(e)}`, ready: true });
      }
    })();
    return initializing;
  },
  commit: (data) => {
    data = withTemplates(data);
    set({ data, saving: true });
    pendingSaves++;
    queue = queue
      .then(() => repository.save(data))
      .then(() => {
        pendingSaves--;
        set({ saving: pendingSaves > 0, error: null });
      })
      .catch((e) => {
        pendingSaves--;
        set({
          error: `Your latest changes could not be saved: ${String(e)}`,
          saving: pendingSaves > 0,
        });
        get().notify('Save failed. Export your data from Settings to keep a copy.');
      });
  },
  updateTask: (id, patch) => {
    const data = get().data;
    get().commit({
      ...data,
      tasks: data.tasks.map((t) =>
        t.id === id ? { ...t, ...patch, updatedAt: new Date().toISOString() } : t,
      ),
    });
  },
  addTask: (title, patch = {}) => {
    const data = get().data;
    const task = makeTask(title, { destination: data.settings.defaultDestination, ...patch });
    get().commit({ ...data, tasks: [...data.tasks, task] });
    get().notify('Card added. A little more headspace.');
    return task.id;
  },
  completeTask: (id) => {
    const data = get().data;
    const task = data.tasks.find((t) => t.id === id);
    if (!task) return;
    const completing = !task.completedAt;
    const next =
      completing && task.recurrence
        ? makeTask(task.title, {
            ...task,
            id: crypto.randomUUID(),
            completedAt: null,
            scheduled: nextOccurrence(
              task.recurrence,
              task.scheduled && task.scheduled > today() ? task.scheduled : today(),
            ),
            checklist: task.checklist.map((c) => ({ ...c, done: false })),
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          })
        : null;
    get().commit({
      ...data,
      tasks: [
        ...data.tasks.map((t) =>
          t.id === id
            ? {
                ...t,
                completedAt: completing ? new Date().toISOString() : null,
                updatedAt: new Date().toISOString(),
              }
            : t,
        ),
        ...(next ? [next] : []),
      ],
    });
    if (completing && data.settings.sound) {
      try {
        const context = new AudioContext();
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        oscillator.connect(gain);
        gain.connect(context.destination);
        oscillator.frequency.value = 660;
        gain.gain.setValueAtTime(0.05, context.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.15);
        oscillator.start();
        oscillator.stop(context.currentTime + 0.15);
        oscillator.onended = () => {
          void context.close();
        };
      } catch {
        /* audio is optional */
      }
    }
    get().notify(completing ? 'One less thing on your mind.' : 'Card reopened', () => {
      const current = get().data;
      get().commit({
        ...current,
        tasks: current.tasks
          .filter((t) => t.id !== next?.id)
          .map((t) => (t.id === id ? { ...t, completedAt: task.completedAt } : t)),
      });
    });
  },
  deleteTask: (id) => {
    const data = get().data;
    const task = data.tasks.find((t) => t.id === id);
    get().commit({
      ...data,
      tasks: data.tasks
        .filter((t) => t.id !== id)
        .map((t) => ({
          ...t,
          links: t.links.filter((l) => l !== id),
          blockedBy: t.blockedBy.filter((l) => l !== id),
          parentId: t.parentId === id ? null : t.parentId,
        })),
    });
    set({ selected: null, selection: [] });
    get().notify('Card deleted', () => {
      if (task) {
        const current = get().data;
        get().commit({
          ...current,
          tasks: [
            ...current.tasks.map((t) => {
              const old = data.tasks.find((o) => o.id === t.id);
              return {
                ...t,
                links: [...new Set([...t.links, ...(old?.links.includes(id) ? [id] : [])])],
                blockedBy: [
                  ...new Set([...t.blockedBy, ...(old?.blockedBy.includes(id) ? [id] : [])]),
                ],
                parentId: old?.parentId === id ? id : t.parentId,
              };
            }),
            task,
          ],
        });
      }
    });
  },
  duplicateTask: (id) => {
    const task = get().data.tasks.find((t) => t.id === id);
    if (task)
      get().addTask(task.title + ' (copy)', {
        ...task,
        id: crypto.randomUUID(),
        completedAt: null,
        createdAt: new Date().toISOString(),
      });
  },
  addStack: (stack) => {
    const data = get().data;
    const id = crypto.randomUUID();
    get().commit({ ...data, stacks: [...data.stacks, { ...stack, id }] });
    get().setView(`stack:${id}`);
    get().setModal(null);
  },
  duplicateStack: (sourceId) => {
    const data = get().data;
    const source = data.stacks.find((stack) => stack.id === sourceId);
    if (!source) return;

    const id = crypto.randomUUID();
    const baseName = `${source.name} (copy)`;
    const names = new Set(data.stacks.map((stack) => stack.name));
    let name = baseName;
    for (let suffix = 2; names.has(name); suffix++) name = `${source.name} (copy ${suffix})`;

    const sourceTasks = data.tasks.filter((task) => task.stackId === sourceId);
    const taskIds = new Map(sourceTasks.map((task) => [task.id, crypto.randomUUID()]));
    const now = new Date().toISOString();
    const tasks = sourceTasks.map((task) => ({
      ...task,
      id: taskIds.get(task.id)!,
      stackId: id,
      createdAt: now,
      updatedAt: now,
      checklist: task.checklist.map((item) => ({ ...item, id: crypto.randomUUID() })),
      links: task.links.map((link) => taskIds.get(link) ?? link),
      blockedBy: task.blockedBy.map((blocker) => taskIds.get(blocker) ?? blocker),
      parentId: task.parentId ? (taskIds.get(task.parentId) ?? task.parentId) : null,
    }));
    const stack: Stack = {
      ...source,
      id,
      name,
      headings: [...source.headings],
      links: source.links.map((link) => (link === sourceId ? id : link)),
    };
    get().commit({
      ...data,
      stacks: [...data.stacks, stack],
      tasks: [...data.tasks, ...tasks],
      goals: data.goals.map((goal) =>
        goal.stackIds.includes(sourceId) ? { ...goal, stackIds: [...goal.stackIds, id] } : goal,
      ),
    });
    get().setView(`stack:${id}`);
    get().notify(
      `“${name}” duplicated with ${tasks.length} ${tasks.length === 1 ? 'card' : 'cards'}.`,
    );
  },
  setView: (view) =>
    set({ view, search: '', selection: [], selected: null, graphFocus: null, plannedDate: null }),
  setModal: (modal) => set({ modal }),
  select: (selected) => set({ selected }),
  notify: (message, undo) => {
    clearTimeout(toastTimer);
    set({ toast: { message, undo } });
    toastTimer = setTimeout(() => set({ toast: null }), 5500);
  },
  bulk: (patch) => {
    const { data, selection } = get();
    if (patch.completedAt) {
      selection.forEach((id) => {
        if (!get().data.tasks.find((t) => t.id === id)?.completedAt) get().completeTask(id);
      });
      set({ selection: [] });
      return;
    }
    get().commit({
      ...data,
      tasks: data.tasks.map((t) =>
        selection.includes(t.id) ? { ...t, ...patch, updatedAt: new Date().toISOString() } : t,
      ),
    });
    get().notify(`${selection.length} cards updated`);
    set({ selection: [] });
  },
  localGraph: (id) => set({ view: 'graph', graphFocus: id, selected: null, search: '' }),
}));
