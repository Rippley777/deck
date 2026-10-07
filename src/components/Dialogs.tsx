import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import {
  ArrowRight,
  CalendarDays,
  Check,
  CheckCheck,
  Command,
  CornerDownLeft,
  Inbox,
  Layers3,
  Moon,
  Network,
  Plus,
  Search,
  Settings2,
  Shuffle,
  Sparkles,
  Sun,
} from 'lucide-react';
import { useDeck } from '../stores/deck';
import { Modal } from './ui';
const StackIconPicker = lazy(() =>
  import('./StackIconPicker').then((m) => ({ default: m.StackIconPicker })),
);
import { addDays, dateLabel, parseQuickAdd, today } from '../lib/dates';
import { searchTasks, shuffleRank } from '../lib/search';
export function Dialogs() {
  const {
    data,
    modal,
    setModal,
    view,
    plannedDate,
    addTask,
    addStack,
    setView,
    commit,
    select,
    selected,
    updateTask,
    completeTask,
    notify,
  } = useDeck();
  const [text, setText] = useState('');
  const [commandIndex, setCommandIndex] = useState(0);
  const [stackName, setStackName] = useState('');
  const [stackIcon, setStackIcon] = useState('lucide:layers-3');
  const [stackColor, setStackColor] = useState('#b5a0d5');
  const [shuffleIndex, setShuffleIndex] = useState(0);
  const parsed = useMemo(() => parseQuickAdd(text, data.stacks), [text, data.stacks]);
  useEffect(() => {
    setText('');
    setCommandIndex(0);
    setShuffleIndex(0);
  }, [modal]);
  const close = () => setModal(null);
  const commands = [
    {
      label: 'New from template',
      icon: Sparkles,
      key: '⇧ ⌘ N',
      action: () => useDeck.getState().openTemplates(),
    },
    {
      label: 'Manage templates',
      icon: Layers3,
      key: '',
      action: () => useDeck.getState().openTemplates({ library: true }),
    },
    { label: 'Add a card', icon: Plus, key: 'N', action: () => setModal('quick') },
    ...data.stacks.map((s) => ({
      label: `Open ${s.name}`,
      icon: Layers3,
      key: '',
      action: () => {
        setView(`stack:${s.id}`);
        close();
      },
    })),
    {
      label: 'Go to Today',
      icon: Sun,
      key: '⌥ 2',
      action: () => {
        setView('today');
        close();
      },
    },
    {
      label: 'Go to Inbox',
      icon: Inbox,
      key: '⌥ 1',
      action: () => {
        setView('inbox');
        close();
      },
    },
    {
      label: 'Explore your Graph',
      icon: Network,
      key: '⌥ 7',
      action: () => {
        setView('graph');
        close();
      },
    },
    {
      label: 'Go to On Deck',
      icon: CalendarDays,
      key: '⌥ 3',
      action: () => {
        setView('upcoming');
        close();
      },
    },
    { label: 'Create a stack', icon: Layers3, key: '', action: () => setModal('stack') },
    { label: 'Deal your day', icon: Sparkles, key: '', action: () => setModal('planning') },
    {
      label: 'Open Logbook',
      icon: CheckCheck,
      key: '⌥ 6',
      action: () => {
        setView('logbook');
        close();
      },
    },
    {
      label: 'Toggle sidebar',
      icon: Layers3,
      key: '',
      action: () => {
        useDeck.setState({ sidebar: !useDeck.getState().sidebar });
        close();
      },
    },
    {
      label: 'Toggle theme',
      icon: Moon,
      key: '',
      action: () => {
        commit({
          ...data,
          settings: { ...data.settings, theme: data.settings.theme === 'dark' ? 'light' : 'dark' },
        });
        close();
      },
    },
    { label: 'Settings', icon: Settings2, key: '⌘ ,', action: () => setModal('settings') },
    ...(selected
      ? [
          {
            label: 'Complete selected card',
            icon: Check,
            key: '⌘ ↵',
            action: () => {
              completeTask(selected);
              close();
            },
          },
          {
            label: 'Schedule selected card for today',
            icon: CalendarDays,
            key: '',
            action: () => {
              updateTask(selected, { scheduled: today() });
              close();
            },
          },
          {
            label: 'Move selected card to Inbox',
            icon: Inbox,
            key: '',
            action: () => {
              updateTask(selected, { stackId: null, scheduled: null, destination: 'inbox' });
              close();
            },
          },
        ]
      : []),
  ];
  const filteredCommands = commands.filter((c) =>
    c.label.toLowerCase().includes(text.toLowerCase()),
  );
  const results = text.trim() ? searchTasks(data.tasks, data.stacks, text).slice(0, 12) : [];
  const actions = [
    ...filteredCommands.map((c) => c.action),
    ...results.map((t) => () => {
      select(t.id);
      close();
    }),
  ];
  const planningTasks = data.tasks
    .filter(
      (t) =>
        !t.completedAt && t.destination !== 'someday' && (!t.scheduled || t.scheduled > today()),
    )
    .sort((a, b) => b.priority - a.priority);
  const shuffled = data.tasks
    .filter(
      (t) =>
        !t.completedAt &&
        t.destination !== 'someday' &&
        !t.blockedBy.some((id) => data.tasks.some((o) => o.id === id && !o.completedAt)),
    )
    .sort(
      (a, b) =>
        shuffleRank(b, view.startsWith('stack:') ? view.slice(6) : null) -
        shuffleRank(a, view.startsWith('stack:') ? view.slice(6) : null),
    );
  const suggestion = shuffled[shuffleIndex % Math.max(1, shuffled.length)];
  function createCard() {
    if (!parsed.title.trim()) return;
    const section = sessionStorage.getItem('deck-add-heading');
    const destination =
      parsed.stackId || view.startsWith('stack:')
        ? 'anytime'
        : view === 'someday'
          ? 'someday'
          : view === 'inbox'
            ? 'inbox'
            : data.settings.defaultDestination;
    addTask(parsed.title, {
      ...parsed,
      destination,
      stackId: parsed.stackId || (view.startsWith('stack:') ? view.slice(6) : null),
      scheduled:
        parsed.scheduled ||
        (view === 'today'
          ? today()
          : view === 'upcoming'
            ? section && /^\d{4}-/.test(section)
              ? section
              : plannedDate || addDays(1)
            : null),
      heading: section && !/^\d{4}-/.test(section) ? section : data.headings[0] || '',
    });
    sessionStorage.removeItem('deck-add-heading');
    close();
  }
  return (
    <>
      <Modal
        open={modal === 'quick'}
        onClose={close}
        title="A little more headspace."
        description="Get it out of your head. Give it a place to land."
        className="quick-modal"
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            createCard();
          }}
        >
          <div className="quick-input-wrap">
            <span className="task-check" />
            <input
              autoFocus
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="What’s on your mind?"
              aria-label="New task"
            />
          </div>
          <div className="parsed-metadata">
            {parsed.scheduled && (
              <span>
                <CalendarDays size={13} />
                {dateLabel(parsed.scheduled)}
                {parsed.time && ` · ${parsed.time}`}
              </span>
            )}
            {parsed.stackId && (
              <span>
                <Layers3 size={13} />
                {data.stacks.find((s) => s.id === parsed.stackId)?.name}
              </span>
            )}
            {parsed.tags.map((t) => (
              <span key={t}>#{t}</span>
            ))}
            {parsed.recurrence && <span>↻ {parsed.recurrence}</span>}
            {!parsed.scheduled &&
              !parsed.stackId &&
              parsed.tags.length === 0 &&
              !parsed.recurrence && <small>Try “Finish the README tomorrow @writing”</small>}
          </div>
          <button
            type="button"
            className="template-entry"
            onClick={() =>
              useDeck.getState().openTemplates({
                scope: 'task',
                title: parsed.title,
                stackId: parsed.stackId || (view.startsWith('stack:') ? view.slice(6) : undefined),
                scheduled: parsed.scheduled || (view === 'today' ? today() : null),
                tags: parsed.tags,
                heading: sessionStorage.getItem('deck-add-heading') || undefined,
              })
            }
          >
            <Sparkles size={15} /> Start from template <span>A familiar setup, ready to go.</span>
          </button>
          <div className="quick-footer">
            <span>
              <Command size={12} /> Your thoughts, one card at a time.
            </span>
            <button className="primary-button" disabled={!parsed.title.trim()} type="submit">
              Add card <CornerDownLeft size={13} />
            </button>
          </div>
        </form>
      </Modal>
      <Modal
        open={modal === 'commands'}
        onClose={close}
        title="Find your way"
        className="command-modal"
      >
        <div className="command-search">
          <Search size={19} />
          <input
            autoFocus
            placeholder="Search cards or type a command…"
            value={text}
            aria-label="Search tasks and commands"
            onChange={(e) => {
              setText(e.target.value);
              setCommandIndex(0);
            }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setCommandIndex((i) => (i + 1) % Math.max(actions.length, 1));
              }
              if (e.key === 'ArrowUp') {
                e.preventDefault();
                setCommandIndex((i) => (i - 1 + actions.length) % Math.max(actions.length, 1));
              }
              if (e.key === 'Enter') {
                e.preventDefault();
                actions[commandIndex]?.();
              }
            }}
          />
          <kbd>esc</kbd>
        </div>
        <div className="command-results">
          {filteredCommands.length > 0 && (
            <div className="command-section-label">YOUR SHORTCUTS</div>
          )}
          {filteredCommands.map((c, i) => (
            <button
              key={c.label}
              className={commandIndex === i ? 'highlighted' : ''}
              onClick={c.action}
              onMouseEnter={() => setCommandIndex(i)}
            >
              <c.icon size={16} />
              <span>{c.label}</span>
              <kbd>{c.key}</kbd>
            </button>
          ))}
          {results.length > 0 && (
            <div className="command-section-label">CARDS · {results.length} RESULTS</div>
          )}
          {results.map((t, i) => (
            <button
              key={t.id}
              className={commandIndex === i + filteredCommands.length ? 'highlighted' : ''}
              onClick={() => {
                select(t.id);
                close();
              }}
              onMouseEnter={() => setCommandIndex(i + filteredCommands.length)}
            >
              {t.completedAt ? <CheckCheck size={16} /> : <span className="mini-circle" />}
              <span>
                {t.title}
                <small>
                  {data.stacks.find((s) => s.id === t.stackId)?.name || 'No stack'}
                  {t.completedAt ? ' · Completed' : ''}
                </small>
              </span>
              <ArrowRight size={13} />
            </button>
          ))}
          {actions.length === 0 && (
            <div className="command-empty">No matching cards. Try a different thought.</div>
          )}
        </div>
        <div className="command-footer">
          <span>
            ↑ ↓ navigate <span>↵ open</span>
          </span>
          <small>Try tag:design or completed:true</small>
        </div>
      </Modal>
      <Modal
        open={modal === 'stack'}
        onClose={close}
        title="Make room for something."
        description="A stack brings related cards together."
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (stackName.trim()) {
              addStack({
                name: stackName.trim(),
                icon: stackIcon,
                color: stackColor,
                notes: '',
                deadline: null,
                headings: [],
                links: [],
              });
              setStackName('');
            }
          }}
        >
          <label className="form-label">
            Stack name
            <input
              className="field large-input"
              autoFocus
              value={stackName}
              onChange={(e) => setStackName(e.target.value)}
              placeholder="A project, a place, a part of life…"
            />
          </label>
          <label className="form-label">Make it yours</label>
          <button
            type="button"
            className="template-entry"
            onClick={() =>
              useDeck.getState().openTemplates({
                scope: 'stack',
                title: stackName,
                icon: stackIcon,
                color: stackColor,
              })
            }
          >
            <Sparkles size={15} /> Start from template <span>Choose your starter cards.</span>
          </button>
          <Suspense fallback={<div className="stack-icon-loading">Loading icons…</div>}>
            <StackIconPicker
              icon={stackIcon}
              color={stackColor}
              onIconChange={setStackIcon}
              onColorChange={setStackColor}
            />
          </Suspense>
          <div className="modal-footer">
            <button className="primary-button" type="submit" disabled={!stackName.trim()}>
              Create stack <Plus size={14} />
            </button>
          </div>
        </form>
      </Modal>
      <Modal
        open={modal === 'planning'}
        onClose={close}
        title="Deal your day."
        description="Choose what deserves your attention. Leave a little breathing room."
        className="planning-modal"
      >
        <div className="planning-summary">
          <Sun size={20} />
          <span>
            <strong>
              {data.tasks.filter((t) => t.scheduled === today() && !t.completedAt).length} cards
            </strong>{' '}
            on today’s deck<small>You can always make room for more. Or less.</small>
          </span>
          <button
            className="secondary-button"
            onClick={() => {
              setView('today');
              close();
            }}
          >
            Back to Today <ArrowRight size={13} />
          </button>
        </div>
        <div className="planning-list">
          {planningTasks.map((t) => (
            <div className="planning-item" key={t.id}>
              <div>
                <span>{t.title}</span>
                <small>
                  {data.stacks.find((s) => s.id === t.stackId)?.name || 'Inbox'} ·{' '}
                  {t.scheduled ? dateLabel(t.scheduled) : 'Anytime'}
                  {t.priority > 0 ? ' · Priority' : ''}
                </small>
              </div>
              <button
                className="secondary-button"
                onClick={() => {
                  updateTask(t.id, { scheduled: today(), destination: 'anytime' });
                  notify('Added to today’s deck');
                }}
              >
                <Plus size={12} /> Add to Deck
              </button>
            </div>
          ))}
          {planningTasks.length === 0 && (
            <div className="empty-state">
              <CheckCheck size={30} />
              <h3>Everything has its place.</h3>
              <p>Your day is ready when you are.</p>
            </div>
          )}
        </div>
        <div className="modal-footer">
          <span className="small-muted">A good day doesn’t have to be a full day.</span>
          <button className="primary-button" onClick={close}>
            That feels right <Check size={14} />
          </button>
        </div>
      </Modal>
      <Modal
        open={modal === 'shuffle'}
        onClose={close}
        title="A small nudge forward."
        description="Sometimes all you need is a place to start."
        className="shuffle-modal"
      >
        <div className="shuffle-symbol">
          <Shuffle size={26} />
        </div>
        {suggestion ? (
          <>
            <div className="page-eyebrow">HOW ABOUT THIS?</div>
            <h2>{suggestion.title}</h2>
            <div className="shuffle-meta">
              <span>{data.stacks.find((s) => s.id === suggestion.stackId)?.name || 'Inbox'}</span>
              <span>About {suggestion.effort} minutes</span>
              {suggestion.priority > 0 && <span>Priority</span>}
            </div>
            <p>Chosen from your priorities, deadlines, and available next steps.</p>
            <button
              className="primary-button shuffle-start"
              onClick={() => {
                updateTask(suggestion.id, { scheduled: today(), destination: 'anytime' });
                select(suggestion.id);
                close();
              }}
            >
              Let’s do this <ArrowRight size={15} />
            </button>
            <div className="shuffle-options">
              <button onClick={() => setShuffleIndex((i) => i + 1)}>
                <Shuffle size={13} /> Another one
              </button>
              <button
                onClick={() => {
                  updateTask(suggestion.id, { scheduled: addDays(1) });
                  setShuffleIndex((i) => i + 1);
                  notify('A little space. Moved to tomorrow.');
                }}
              >
                Move to later
              </button>
            </div>
          </>
        ) : (
          <div className="empty-state">
            <h2>You’ve earned a little pause.</h2>
            <p>No actionable cards right now.</p>
          </div>
        )}
      </Modal>
      <Modal
        open={modal === 'shortcuts'}
        onClose={close}
        title="Less clicking. More clarity."
        description="A few shortcuts to make Deck feel like second nature."
      >
        <div className="shortcut-list">
          {[
            ['Quick add a card', '⌘ / Ctrl N · N'],
            ['Find anything & commands', '⌘ / Ctrl K · /'],
            ['Complete open card', '⌘ / Ctrl Enter'],
            ['Go to Inbox / Today / On Deck', 'Alt 1 / 2 / 3'],
            ['Go to Anytime / Someday / Logbook', 'Alt 4 / 5 / 6'],
            ['Explore Graph', 'Alt 7'],
            ['Move between cards', '↑ / ↓'],
            ['Open focused card', 'Enter'],
            ['Complete focused card', 'Space'],
            ['Select multiple cards', 'Shift / ⌘ click'],
            ['Schedule open card for today', 'T'],
            ['Move open card to a stack', 'M'],
            ['Settings', '⌘ / Ctrl ,'],
            ['New from template', '⌘ / Ctrl ⇧ N'],
            ['Keyboard shortcuts', '?'],
            ['Close a panel', 'Esc'],
          ].map(([label, key]) => (
            <div key={label}>
              <span>{label}</span>
              <kbd>{key}</kbd>
            </div>
          ))}
        </div>
      </Modal>
    </>
  );
}
