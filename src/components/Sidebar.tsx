import {
  Archive,
  CalendarDays,
  CheckCheck,
  ChevronDown,
  ChevronsLeft,
  Command,
  CopyPlus,
  Flower2,
  Inbox,
  Infinity,
  Layers3,
  Network,
  Plus,
  Search,
  Settings2,
  Sun,
  LayoutTemplate,
  type LucideIcon,
} from 'lucide-react';
import { useMemo } from 'react';
import { DeckProgress, DeckProgressTooltip } from './progress/DeckProgress';
import { taskProgress, progressSummary } from '../lib/progress';
import { useDeck } from '../stores/deck';
import { DeckMark, IconButton } from './ui';
import type { View } from '../types';
import { addDays, today } from '../lib/dates';
import { useTemplateContextMenu } from './TemplateContextMenu';
import { StackGlyph } from './StackGlyph';
const nav: { id: View; label: string; icon: LucideIcon; color: string; shortcut?: string }[] = [
  { id: 'inbox', label: 'Inbox', icon: Inbox, color: 'blue', shortcut: '1' },
  { id: 'today', label: 'Today', icon: Sun, color: 'gold', shortcut: '2' },
  { id: 'upcoming', label: 'On Deck', icon: CalendarDays, color: 'purple', shortcut: '3' },
  { id: 'anytime', label: 'Anytime', icon: Infinity, color: 'teal', shortcut: '4' },
  { id: 'someday', label: 'Someday', icon: Archive, color: 'muted', shortcut: '5' },
  { id: 'logbook', label: 'Logbook', icon: CheckCheck, color: 'muted', shortcut: '6' },
];
export function Sidebar() {
  const templateMenu = useTemplateContextMenu();
  const { data, view, setView, setModal, updateTask, commit, duplicateStack } = useDeck();
  const active = data.tasks.filter((t) => !t.completedAt);
  const stackProgress = useMemo(
    () =>
      new Map(
        data.stacks.map((stack) => [
          stack.id,
          taskProgress(
            data.tasks.filter((task) => task.stackId === stack.id),
            data.tasks,
          ),
        ]),
      ),
    [data.tasks, data.stacks],
  );
  const count = (id: View) =>
    id === 'today'
      ? active.filter((t) => t.scheduled && t.scheduled <= today() && t.destination !== 'someday')
          .length
      : id === 'inbox'
        ? active.filter((t) => t.destination === 'inbox' && !t.scheduled && !t.stackId).length
        : 0;
  function drop(e: React.DragEvent, view: View) {
    e.preventDefault();
    e.currentTarget.classList.remove('drag-over');
    const id = e.dataTransfer.getData('task');
    if (!id) return;
    if (view.startsWith('stack:'))
      updateTask(id, { stackId: view.slice(6), destination: 'anytime' });
    else if (view === 'today') updateTask(id, { scheduled: today(), destination: 'anytime' });
    else if (view === 'upcoming') updateTask(id, { scheduled: addDays(1), destination: 'anytime' });
    else if (['inbox', 'someday', 'anytime'].includes(view))
      updateTask(id, {
        destination: view as 'inbox' | 'someday' | 'anytime',
        scheduled: null,
        ...(view === 'inbox' ? { stackId: null } : {}),
      });
  }
  return (
    <aside className="sidebar">
      <div className="brand">
        <DeckMark />
        <span>deck</span>
        <span className="brand-dot" />
        <IconButton
          icon={ChevronsLeft}
          label="Hide sidebar"
          onClick={() => useDeck.setState({ sidebar: false })}
        />
      </div>
      <button className="workspace-switch" onClick={() => setModal('settings')}>
        <span className="avatar">A</span>
        <span>
          My workspace<small>A little clarity, every day.</small>
        </span>
        <ChevronDown size={14} />
      </button>
      <button className="sidebar-search" onClick={() => setModal('commands')}>
        <Search size={16} />
        <span>Find anything</span>
        <kbd>⌘ K</kbd>
      </button>
      <nav aria-label="Main navigation">
        {nav.map(({ id, label, icon: Icon, color, shortcut }) => (
          <button
            key={id}
            aria-label={label}
            aria-current={view === id ? 'page' : undefined}
            className={`nav-item ${view === id ? 'active' : ''}`}
            onClick={() => setView(id)}
            onDragOver={(e) => {
              e.preventDefault();
              e.currentTarget.classList.add('drag-over');
            }}
            onDragLeave={(e) => e.currentTarget.classList.remove('drag-over')}
            onDrop={(e) => drop(e, id)}
            title={`Go to ${label} · Alt ${shortcut}`}
          >
            <Icon size={18} className={`icon-${color}`} />
            <span>{label}</span>
            {count(id) > 0 && <span className="nav-count">{count(id)}</span>}
            {view === id && <i className="active-dot" />}
          </button>
        ))}
      </nav>
      <div className="sidebar-rule" />
      <button
        className={`nav-item graph-nav ${view === 'graph' ? 'active' : ''}`}
        aria-label="Graph"
        aria-current={view === 'graph' ? 'page' : undefined}
        onClick={() => setView('graph')}
      >
        <Network size={18} />
        <span>Graph</span>
        <span className="tiny-badge">EXPLORE</span>
      </button>
      <button
        className="nav-item templates-nav"
        aria-label="Templates"
        onClick={() => useDeck.getState().openTemplates({ library: true })}
      >
        <LayoutTemplate size={18} />
        <span>Templates</span>
      </button>
      <div className="stack-label">
        <span>YOUR STACKS</span>
        <IconButton icon={Plus} label="Create stack" onClick={() => setModal('stack')} />
      </div>
      <nav aria-label="Stacks">
        {data.stacks.map((stack) => (
          <div className="stack-nav-row" key={stack.id}>
            <DeckProgressTooltip
              label={stack.name}
              summary={progressSummary(stackProgress.get(stack.id)!)}
              hint="Open stack"
              side="right"
              className="stack-progress-tooltip"
            >
              <button
                className={`nav-item stack-nav ${view === `stack:${stack.id}` ? 'active' : ''}`}
                draggable
                onContextMenu={(e) => templateMenu.open(e, { stackId: stack.id })}
                onKeyDown={(e) => {
                  if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10'))
                    templateMenu.open(e, { stackId: stack.id });
                }}
                aria-label={`${stack.name} stack`}
                aria-current={view === `stack:${stack.id}` ? 'page' : undefined}
                onDragStart={(e) => e.dataTransfer.setData('stack', stack.id)}
                onDragOver={(e) => {
                  e.preventDefault();
                  e.currentTarget.classList.add('drag-over');
                }}
                onDragLeave={(e) => e.currentTarget.classList.remove('drag-over')}
                onDrop={(e) => {
                  drop(e, `stack:${stack.id}`);
                  const draggedId = e.dataTransfer.getData('stack');
                  if (draggedId && draggedId !== stack.id) {
                    const stacks = data.stacks.filter((s) => s.id !== draggedId);
                    stacks.splice(
                      stacks.findIndex((s) => s.id === stack.id),
                      0,
                      data.stacks.find((s) => s.id === draggedId)!,
                    );
                    commit({ ...data, stacks });
                  }
                }}
                onClick={() => setView(`stack:${stack.id}`)}
              >
                <span className="stack-glyph" style={{ color: stack.color }}>
                  <StackGlyph icon={stack.icon} color={stack.color} size={18} />
                </span>
                <span>{stack.name}</span>
                <DeckProgress
                  items={stackProgress.get(stack.id)}
                  label={`${stack.name} progress`}
                  size={16}
                  tooltip={false}
                  animate={data.settings.animations}
                />
              </button>
            </DeckProgressTooltip>
            <IconButton
              icon={CopyPlus}
              label={`Duplicate ${stack.name} stack`}
              className="stack-duplicate-action"
              onClick={() => duplicateStack(stack.id)}
            />
          </div>
        ))}
      </nav>
      <button className="new-stack" onClick={() => setModal('stack')}>
        <Plus size={15} /> New stack
      </button>
      <div className="sidebar-bottom">
        <div className="sidebar-note">
          <Flower2 size={18} />
          <span>
            One thing at a time.
            <br />
            <small>You’re doing just fine.</small>
          </span>
        </div>
        <div className="sidebar-footer">
          <button onClick={() => setModal('settings')}>
            <Settings2 size={16} /> Settings
          </button>
          <IconButton
            icon={Command}
            label="Keyboard shortcuts"
            onClick={() => setModal('shortcuts')}
          />
        </div>
      </div>
      {templateMenu.menu}
    </aside>
  );
}
export const viewName = (view: View) =>
  nav.find((n) => n.id === view)?.label || (view === 'graph' ? 'Graph' : 'Stack');
export { Layers3 };
