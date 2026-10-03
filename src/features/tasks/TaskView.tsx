import { lazy, Suspense, useMemo, useState } from 'react';
import {
  Archive,
  ArrowDownWideNarrow,
  Check,
  CheckCheck,
  CopyPlus,
  LayoutTemplate,
  ChevronDown,
  ChevronRight,
  Inbox,
  Layers3,
  MoreHorizontal,
  Network,
  Plus,
  Search,
  Shuffle,
  SlidersHorizontal,
  Sun,
  X,
} from 'lucide-react';
import { useDeck } from '../../stores/deck';
import { dateLabel, isoDate, today } from '../../lib/dates';
import { searchTasks } from '../../lib/search';
import { TaskRow } from './TaskRow';
import { TodayAside } from '../../components/TodayAside';
import { IconButton, Modal } from '../../components/ui';
import { DeckProgress, DeckProgressTooltip } from '../../components/progress/DeckProgress';
import { isInTodayDeck, taskProgress, progressSummary } from '../../lib/progress';
import type { Task } from '../../types';
import { StackGlyph } from '../../components/StackGlyph';
import { useTemplateContextMenu } from '../../components/TemplateContextMenu';
const StackIconPicker = lazy(() =>
  import('../../components/StackIconPicker').then((m) => ({ default: m.StackIconPicker })),
);
const descriptions: Record<string, string> = {
  inbox: 'A home for everything on your mind. Sort it out when you’re ready.',
  upcoming: 'A little look ahead. Your next steps, at your own pace.',
  anytime: 'Ready when you are. Good things to come back to.',
  someday: 'Keep the possibility. Let go of the pressure.',
  logbook: 'Small steps, meaningful progress. Look at how far you’ve come.',
};
const titles: Record<string, string> = {
  today: 'Today’s Deck',
  inbox: 'Inbox',
  upcoming: 'On Deck',
  anytime: 'Anytime',
  someday: 'Someday',
  logbook: 'Logbook',
};
export function TaskView() {
  const headingMenu = useTemplateContextMenu();
  const {
    data,
    view,
    search,
    plannedDate,
    setModal,
    selection,
    bulk,
    deleteTasks,
    commit,
    updateTask,
    localGraph,
    duplicateStack,
  } = useDeck();
  const [collapsed, setCollapsed] = useState<string[]>([]);
  const [showCompleted, setShowCompleted] = useState(true);
  const [priorityOnly, setPriorityOnly] = useState(false);
  const [sort, setSort] = useState('manual');
  const [headingModal, setHeadingModal] = useState(false);
  const [heading, setHeading] = useState('');
  const [stackEdit, setStackEdit] = useState(false);
  const stack = view.startsWith('stack:') ? data.stacks.find((s) => s.id === view.slice(6)) : null;
  const scopeTasks = useMemo(
    () =>
      data.tasks.filter((t) => {
        if (view === 'today') return isInTodayDeck(t);
        if (view === 'inbox')
          return t.destination === 'inbox' && !t.stackId && !t.scheduled && !t.completedAt;
        if (view === 'upcoming')
          return (
            (plannedDate ? t.scheduled === plannedDate : !!t.scheduled && t.scheduled > today()) &&
            !t.completedAt
          );
        if (view === 'anytime')
          return !t.scheduled && t.destination === 'anytime' && !t.completedAt;
        if (view === 'someday') return t.destination === 'someday' && !t.completedAt;
        if (view === 'logbook') return !!t.completedAt;
        return t.stackId === stack?.id;
      }),
    [data.tasks, view, plannedDate, stack],
  );
  const scopeProgress = useMemo(
    () => taskProgress(scopeTasks, data.tasks),
    [scopeTasks, data.tasks],
  );
  const scopeSummary = progressSummary(scopeProgress);
  const tasks = useMemo(() => {
    let items = [...scopeTasks];
    if (search) items = searchTasks(items, data.stacks, search);
    if (priorityOnly) items = items.filter((t) => t.priority > 0);
    if (!showCompleted && view !== 'logbook') items = items.filter((t) => !t.completedAt);
    return items.sort((a, b) =>
      sort === 'priority'
        ? b.priority - a.priority
        : sort === 'title'
          ? a.title.localeCompare(b.title)
          : a.order - b.order,
    );
  }, [scopeTasks, data.stacks, view, search, priorityOnly, showCompleted, sort]);
  const groups = useMemo(() => {
    const result: Record<string, Task[]> = {};
    if (view === 'upcoming' && plannedDate) result[plannedDate] = [];
    if (view === 'today') data.headings.forEach((h) => (result[h] = []));
    if (stack) {
      result['Cards'] = [];
      stack.headings.forEach((h) => (result[h] = []));
    }
    for (const t of tasks) {
      const group =
        view === 'today'
          ? t.heading || data.headings[0]
          : view === 'upcoming'
            ? t.scheduled!
            : view === 'logbook'
              ? isoDate(new Date(t.completedAt!))
              : stack
                ? stack.headings.includes(t.heading)
                  ? t.heading
                  : 'Cards'
                : 'Your cards';
      (result[group] ||= []).push(t);
    }
    return Object.entries(result).sort(([a], [b]) =>
      view === 'upcoming' ? a.localeCompare(b) : view === 'logbook' ? b.localeCompare(a) : 0,
    );
  }, [tasks, data.headings, view, stack, plannedDate]);
  const sectionForTask = (task: Task) =>
    view === 'today'
      ? task.heading || data.headings[0]
      : view === 'upcoming'
        ? task.scheduled!
        : view === 'logbook'
          ? isoDate(new Date(task.completedAt!))
          : stack
            ? stack.headings.includes(task.heading)
              ? task.heading
              : 'Cards'
            : 'Your cards';
  const sectionItems = (name: string) => {
    const ids = new Set(
      scopeTasks.filter((task) => sectionForTask(task) === name).map((task) => task.id),
    );
    return scopeProgress.filter((item) => ids.has(item.id));
  };
  function addInSection(section: string) {
    useDeck.setState({ modal: 'quick' });
    sessionStorage.setItem('deck-add-heading', section);
  }
  return (
    <>
      {headingMenu.menu}
      <div className="workspace-scroll">
        <div className={`page-wrap ${view === 'today' ? 'today-page' : ''}`}>
          <main className="task-main">
            <div className="page-eyebrow">
              {view === 'today' ? (
                <>
                  <Sun size={14} /> A FRESH START
                </>
              ) : stack ? (
                <>
                  <StackGlyph icon={stack.icon} color={stack.color} size={14} /> YOUR STACK
                </>
              ) : (
                <>
                  <span className="eyebrow-dot" /> YOUR WORKSPACE
                </>
              )}
              <span>
                {data.settings.dateFormat === 'iso'
                  ? today()
                  : new Date().toLocaleDateString('en-US', {
                      weekday: 'long',
                      month: 'long',
                      day: 'numeric',
                    })}
              </span>
            </div>
            <div className="page-title-row">
              <h1>
                {stack?.name ||
                  (view === 'upcoming' && plannedDate ? dateLabel(plannedDate) : titles[view])}
              </h1>
              <div className="page-actions">
                {view === 'today' ? (
                  <button
                    className="secondary-button shuffle-button"
                    onClick={() => setModal('shuffle')}
                  >
                    <Shuffle size={14} /> Shuffle
                  </button>
                ) : stack ? (
                  <>
                    <IconButton
                      icon={LayoutTemplate}
                      label="Save stack as template"
                      onClick={() =>
                        useDeck.getState().openTemplates({ library: true, sourceStackId: stack.id })
                      }
                    />
                    <IconButton
                      icon={CopyPlus}
                      label={`Duplicate ${stack.name} stack`}
                      onClick={() => duplicateStack(stack.id)}
                    />
                    <IconButton
                      icon={Network}
                      label="Open local graph"
                      onClick={() => localGraph(stack.id)}
                    />
                    <IconButton
                      icon={MoreHorizontal}
                      label="Edit stack"
                      onClick={() => setStackEdit(true)}
                    />
                  </>
                ) : (
                  <IconButton icon={Plus} label="Add task" onClick={() => setModal('quick')} />
                )}
              </div>
            </div>
            <p className="page-subtitle">
              {view === 'today'
                ? 'A little intention goes a long way. Let’s make today a good one.'
                : stack
                  ? stack.notes
                  : descriptions[view]}
            </p>
            {stack?.deadline && (
              <span className="due-badge">Deadline · {dateLabel(stack.deadline)}</span>
            )}
            {(view === 'today' || stack) && (
              <div className="daily-progress deck-progress-summary">
                <DeckProgress
                  items={scopeProgress}
                  label={stack?.name || 'Today’s Deck'}
                  size={48}
                  showLabel="percentage"
                  variant="enhanced"
                  interactive
                  onClick={() => setShowCompleted(!showCompleted)}
                  pressed={!showCompleted}
                  actionLabel={showCompleted ? 'Show incomplete cards' : 'Show all cards'}
                  animate={data.settings.animations}
                />
                <div className="progress-summary-copy">
                  <span>
                    <strong>{scopeSummary.completed}</strong> of {scopeSummary.total}{' '}
                    {stack ? 'cards complete' : 'cards cleared'}
                  </span>
                  <small>
                    {!scopeSummary.total
                      ? 'A little room for what’s next.'
                      : scopeSummary.cleared
                        ? 'Deck cleared.'
                        : scopeSummary.deferred
                          ? `${scopeSummary.deferred} saved for someday`
                          : 'One card at a time.'}
                  </small>
                </div>
                {scopeSummary.overdue > 0 && (
                  <span className="progress-overdue-note">
                    <i />
                    {scopeSummary.overdue} overdue
                  </span>
                )}
                <span className="progress-note">
                  {scopeSummary.cleared ? 'A little room to breathe.' : 'Slow and steady.'}
                </span>
              </div>
            )}
            <div className="task-toolbar">
              <div className="view-label">
                <Layers3 size={14} />
                <span>{view === 'logbook' ? 'Completed cards' : 'Your cards'}</span>
                <span className="count-pill">
                  {tasks.filter((t) => view === 'logbook' || !t.completedAt).length}
                </span>
              </div>
              <div className="task-toolbar-right">
                <button
                  className={priorityOnly ? 'filter active-filter' : 'filter'}
                  onClick={() => setPriorityOnly(!priorityOnly)}
                  title="Show priority cards"
                >
                  <SlidersHorizontal size={13} /> Filter
                </button>
                <select
                  aria-label="Sort tasks"
                  value={sort}
                  onChange={(e) => setSort(e.target.value)}
                >
                  <option value="manual">Manual order</option>
                  <option value="priority">Priority</option>
                  <option value="title">Title A–Z</option>
                </select>
                <ArrowDownWideNarrow size={13} />
              </div>
            </div>
            {selection.length > 0 && (
              <div className="bulk-toolbar">
                <span>{selection.length} selected</span>
                <button onClick={() => bulk({ scheduled: today(), destination: 'anytime' })}>
                  Today
                </button>
                <input
                  type="date"
                  aria-label="Schedule selected cards"
                  onChange={(e) => {
                    if (e.target.value) bulk({ scheduled: e.target.value, destination: 'anytime' });
                  }}
                />
                <select
                  aria-label="Move selected cards to stack"
                  defaultValue=""
                  onChange={(e) => bulk({ stackId: e.target.value || null })}
                >
                  <option value="" disabled>
                    Move to stack…
                  </option>
                  {data.stacks.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
                <button onClick={() => bulk({ completedAt: new Date().toISOString() })}>
                  <Check size={14} /> Complete
                </button>
                <button
                  className="bulk-delete-action"
                  aria-label={`Delete ${selection.length} selected ${selection.length === 1 ? 'card' : 'cards'}`}
                  onClick={() => deleteTasks(selection)}
                >
                  <X size={14} /> Delete
                </button>
                <IconButton
                  icon={X}
                  label="Clear selection"
                  onClick={() => useDeck.setState({ selection: [] })}
                />
              </div>
            )}
            {view === 'today' && scopeSummary.cleared && (
              <div className="cleared-note">
                <CheckCheck size={26} />
                <h3>Deck cleared.</h3>
                <p>Nothing else needs your attention today.</p>
              </div>
            )}
            {groups.map(([name, group], index) => (
              <section
                className="task-section"
                key={name}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  const id = e.dataTransfer.getData('task');
                  if (id)
                    updateTask(
                      id,
                      view === 'upcoming'
                        ? { scheduled: name, destination: 'anytime' }
                        : {
                            heading: name,
                            ...(view === 'today'
                              ? { scheduled: today(), destination: 'anytime' as const }
                              : {}),
                            ...(stack ? { stackId: stack.id } : {}),
                          },
                    );
                }}
              >
                <div className="section-heading">
                  <DeckProgressTooltip
                    label={view === 'upcoming' || view === 'logbook' ? dateLabel(name) : name}
                    summary={progressSummary(sectionItems(name))}
                    hint={collapsed.includes(name) ? 'Expand section' : 'Collapse section'}
                    className="section-progress-tooltip"
                  >
                    <button
                      aria-expanded={!collapsed.includes(name)}
                      onContextMenu={(e) => {
                        if (stack?.headings.includes(name))
                          headingMenu.open(e, { stackId: stack.id, heading: name });
                      }}
                      onKeyDown={(e) => {
                        if (
                          stack?.headings.includes(name) &&
                          (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10'))
                        )
                          headingMenu.open(e, { stackId: stack.id, heading: name });
                      }}
                      onClick={() =>
                        setCollapsed(
                          collapsed.includes(name)
                            ? collapsed.filter((h) => h !== name)
                            : [...collapsed, name],
                        )
                      }
                    >
                      {collapsed.includes(name) ? (
                        <ChevronRight size={13} />
                      ) : (
                        <ChevronDown size={13} />
                      )}
                      <span className={`section-marker marker-${index % 3}`}>
                        {view === 'today' ? (index === 0 ? '◈' : index === 1 ? '○' : '☾') : null}
                      </span>
                      <h2>{view === 'upcoming' || view === 'logbook' ? dateLabel(name) : name}</h2>
                      <DeckProgress
                        items={sectionItems(name)}
                        label={`${name} progress`}
                        size={16}
                        tooltip={false}
                        animate={data.settings.animations}
                      />
                      <span className="section-count">
                        {group.filter((t) => !t.completedAt || view === 'logbook').length}
                      </span>
                    </button>
                  </DeckProgressTooltip>
                  {view !== 'logbook' && (
                    <IconButton
                      icon={Plus}
                      label={`Add task to ${name}`}
                      onClick={() => addInSection(name)}
                    />
                  )}
                </div>
                {!collapsed.includes(name) && (
                  <div className="section-content">
                    {group.map((task) => (
                      <TaskRow key={task.id} task={task} showStack={!stack} />
                    ))}
                    {group.length === 0 && (
                      <button className="empty-section" onClick={() => addInSection(name)}>
                        <Plus size={13} /> A little space for something that matters
                      </button>
                    )}
                  </div>
                )}
              </section>
            ))}
            {tasks.length === 0 && groups.length === 0 && (
              <div className="empty-state">
                {search ? (
                  <Search size={35} />
                ) : view === 'inbox' ? (
                  <Inbox size={35} />
                ) : (
                  <Archive size={35} />
                )}
                <h2>
                  {search
                    ? 'Nothing here just yet.'
                    : view === 'inbox'
                      ? 'A little more headspace.'
                      : 'Room for what’s next.'}
                </h2>
                <p>
                  {search
                    ? 'Try another search or clear your filters.'
                    : 'Capture a thought and give it a place to land.'}
                </p>
                <button className="primary-button" onClick={() => setModal('quick')}>
                  <Plus size={14} /> Add a card
                </button>
              </div>
            )}
            {view !== 'logbook' && (
              <div className="list-bottom">
                <button className="add-task-inline" onClick={() => setModal('quick')}>
                  <Plus size={15} /> Add a card <kbd>N</kbd>
                </button>
                {(view === 'today' || stack) && (
                  <button className="add-heading" onClick={() => setHeadingModal(true)}>
                    Add heading
                  </button>
                )}
              </div>
            )}
            <div className="task-list-footer">
              <span>
                {view === 'today' ? (
                  <>
                    <span className="little-sun">✳</span> Your pace. Your priorities. Your day.
                  </>
                ) : (
                  `${tasks.length} cards · Saved on this device`
                )}
              </span>
              {view !== 'logbook' && (
                <button onClick={() => setShowCompleted(!showCompleted)}>
                  {showCompleted ? 'Hide' : 'Show'} completed
                </button>
              )}
            </div>
          </main>
          {view === 'today' && <TodayAside />}
        </div>
      </div>
      <Modal
        open={headingModal}
        onClose={() => setHeadingModal(false)}
        title="A little structure"
        description="Give this part of your day a name."
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!heading.trim()) return;
            const name = heading.trim();
            commit({
              ...data,
              ...(stack
                ? {
                    stacks: data.stacks.map((s) =>
                      s.id === stack.id
                        ? { ...s, headings: [...new Set([...s.headings, name])] }
                        : s,
                    ),
                  }
                : { headings: [...new Set([...data.headings, name])] }),
            });
            setHeading('');
            setHeadingModal(false);
          }}
        >
          <input
            autoFocus
            className="field large-input"
            placeholder="Deep work, errands, this evening…"
            value={heading}
            onChange={(e) => setHeading(e.target.value)}
          />
          <div className="modal-footer">
            <button className="primary-button" type="submit">
              Add heading
            </button>
          </div>
        </form>
      </Modal>
      {stack && (
        <Modal open={stackEdit} onClose={() => setStackEdit(false)} title="Edit stack">
          <Suspense fallback={<div className="stack-icon-loading">Loading icons…</div>}>
            <StackIconPicker
              icon={stack.icon}
              color={stack.color}
              onIconChange={(icon) =>
                commit({
                  ...data,
                  stacks: data.stacks.map((s) => (s.id === stack.id ? { ...s, icon } : s)),
                })
              }
              onColorChange={(color) =>
                commit({
                  ...data,
                  stacks: data.stacks.map((s) => (s.id === stack.id ? { ...s, color } : s)),
                })
              }
            />
          </Suspense>
          <div className="form-grid">
            <label>
              Name
              <input
                className="field"
                value={stack.name}
                onChange={(e) =>
                  commit({
                    ...data,
                    stacks: data.stacks.map((s) =>
                      s.id === stack.id ? { ...s, name: e.target.value } : s,
                    ),
                  })
                }
              />
            </label>
            <label>
              Notes
              <textarea
                className="field"
                value={stack.notes}
                onChange={(e) =>
                  commit({
                    ...data,
                    stacks: data.stacks.map((s) =>
                      s.id === stack.id ? { ...s, notes: e.target.value } : s,
                    ),
                  })
                }
              />
            </label>
            <label>
              Deadline
              <input
                type="date"
                className="field"
                value={stack.deadline || ''}
                onChange={(e) =>
                  commit({
                    ...data,
                    stacks: data.stacks.map((s) =>
                      s.id === stack.id ? { ...s, deadline: e.target.value || null } : s,
                    ),
                  })
                }
              />
            </label>
            <label>
              Related stacks
              <select
                className="field"
                multiple
                value={stack.links}
                onChange={(e) =>
                  commit({
                    ...data,
                    stacks: data.stacks.map((s) =>
                      s.id === stack.id
                        ? { ...s, links: Array.from(e.target.selectedOptions, (o) => o.value) }
                        : s,
                    ),
                  })
                }
              >
                {data.stacks
                  .filter((s) => s.id !== stack.id)
                  .map((s) => (
                    <option value={s.id} key={s.id}>
                      {s.name}
                    </option>
                  ))}
              </select>
            </label>
          </div>
          <div className="modal-footer">
            <button
              className="danger-button"
              onClick={() => {
                useDeck.getState().deleteStack(stack.id);
                setStackEdit(false);
              }}
            >
              Delete stack & keep cards
            </button>
            <button className="primary-button" onClick={() => setStackEdit(false)}>
              Done
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
