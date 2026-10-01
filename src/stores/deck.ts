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
  deleteTasks: (ids: string[]) => void;
  duplicateTask: (id: string) => void;
  addStack: (stack: Omit<Stack, 'id'>) => void;
  deleteStack: (id: string) => void;
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
        const data = withTemplates(saved || (import.meta.env.VITE_DECK_PORTAL === 'true' ? { cloudPristine: true, version: 1 as const, tasks: [], stacks: [], goals: [], headings: [], settings: defaultSettings } : seedData()));
        if (data !== saved) await repository.save(data);
        set({ data, ready: true });
      } catch (e) {
        set({ error: `Could not open your local database: ${String(e)}`, ready: true });
      }
    })();
    return initializing;
  },
  commit: (data) => {
    data = withTemplates(data.cloudPristine ? { ...data, cloudPristine: false } : data);
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
  deleteTask: (id) => get().deleteTasks([id]),
  deleteTasks: (ids) => {
    const data = get().data;
    const deletedIds = new Set(ids);
    const deletedTasks = data.tasks.filter((task) => deletedIds.has(task.id));
    if (!deletedTasks.length) return;
    get().commit({
      ...data,
      tasks: data.tasks
        .filter((task) => !deletedIds.has(task.id))
        .map((t) => ({
          ...t,
          links: t.links.filter((id) => !deletedIds.has(id)),
          blockedBy: t.blockedBy.filter((id) => !deletedIds.has(id)),
          parentId: t.parentId && deletedIds.has(t.parentId) ? null : t.parentId,
        })),
    });
    set((state) => ({
      selected: state.selected && deletedIds.has(state.selected) ? null : state.selected,
      selection: state.selection.filter((id) => !deletedIds.has(id)),
    }));
    const label =
      deletedTasks.length === 1 ? 'Card deleted' : `${deletedTasks.length} cards deleted`;
    get().notify(label, () => {
      const current = get().data;
      const present = new Set(current.tasks.map((task) => task.id));
      get().commit({
        ...current,
        tasks: [
          ...current.tasks.map((task) => {
            const old = data.tasks.find((entry) => entry.id === task.id);
            if (!old) return task;
            return {
              ...task,
              links: [...new Set([...task.links, ...old.links.filter((id) => deletedIds.has(id))])],
              blockedBy: [
                ...new Set([
                  ...task.blockedBy,
                  ...old.blockedBy.filter((id) => deletedIds.has(id)),
                ]),
              ],
              parentId: old.parentId && deletedIds.has(old.parentId) ? old.parentId : task.parentId,
            };
          }),
          ...deletedTasks.filter((task) => !present.has(task.id)),
        ],
      });
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
  deleteStack: (id) => {
    const data = get().data;
    const stack = data.stacks.find((entry) => entry.id === id);
    if (!stack) return;
    const stackIndex = data.stacks.indexOf(stack);
    const cardIds = new Set(
      data.tasks.filter((task) => task.stackId === id).map((task) => task.id),
    );
    get().commit({
      ...data,
      stacks: data.stacks
        .filter((entry) => entry.id !== id)
        .map((entry) => ({ ...entry, links: entry.links.filter((link) => link !== id) })),
      tasks: data.tasks.map((task) =>
        task.stackId === id ? { ...task, stackId: null, destination: 'inbox' } : task,
      ),
      goals: data.goals.map((goal) => ({
        ...goal,
        stackIds: goal.stackIds.filter((stackId) => stackId !== id),
      })),
    });
    if (get().view === `stack:${id}`) get().setView('inbox');
    get().notify(`“${stack.name}” deleted. Cards moved to Inbox.`, () => {
      const current = get().data;
      const stacks = [...current.stacks];
      if (!stacks.some((entry) => entry.id === id))
        stacks.splice(Math.min(stackIndex, stacks.length), 0, stack);
      get().commit({
        ...current,
        stacks: stacks.map((entry) => {
          const old = data.stacks.find((previous) => previous.id === entry.id);
          return old
            ? {
                ...entry,
                links: [...new Set([...entry.links, ...old.links.filter((link) => link === id)])],
              }
            : entry;
        }),
        tasks: current.tasks.map((task) =>
          cardIds.has(task.id) && task.stackId === null ? { ...task, stackId: id } : task,
        ),
        goals: current.goals.map((goal) => {
          const old = data.goals.find((previous) => previous.id === goal.id);
          return old?.stackIds.includes(id) && !goal.stackIds.includes(id)
            ? { ...goal, stackIds: [...goal.stackIds, id] }
            : goal;
        }),
      });
    });
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
