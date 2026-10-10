import { CommandCenter } from './features/command-center/CommandCenter';
import { portalEnabled, useCloud } from './lib/cloud';
import { CalendarDays, Inbox, Layers3, Sun } from 'lucide-react';
import { trackView } from './lib/analytics';
import { lazy, Suspense, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  ArrowUpRight,
  Check,
  ChevronRight,
  CloudOff,
  PanelLeft,
  Plus,
  Search,
  X,
} from 'lucide-react';
import { useDeck } from './stores/deck';
import { Sidebar, viewName } from './components/Sidebar';
import { IconButton, DeckMark } from './components/ui';
import { TaskView } from './features/tasks/TaskView';
const GraphView = lazy(() =>
  import('./features/graph/GraphView').then((m) => ({ default: m.GraphView })),
);
const TaskDetail = lazy(() =>
  import('./features/tasks/TaskDetail').then((m) => ({ default: m.TaskDetail })),
);
import { Dialogs } from './components/Dialogs';
import { Settings } from './features/settings/Settings';
const TemplateDialog = lazy(() =>
  import('./features/templates/TemplateDialog').then((m) => ({ default: m.TemplateDialog })),
);
import { today } from './lib/dates';
import type { View } from './types';
export default function App() {
  const cloudUser = useCloud((s) => s.user);
  const cloudStatus = useCloud((s) => s.status);
  const [mobileMenu, setMobileMenu] = useState(false);
  const {
    data,
    ready,
    error,
    initialize,
    view,
    sidebar,
    modal,
    setModal,
    selected,
    select,
    setView,
    search,
    saving,
    toast,
  } = useDeck();
  useEffect(() => {
    trackView(view);
  }, [view]);
  useEffect(() => setMobileMenu(false), [view]);
  const [searchOpen, setSearchOpen] = useState(false);
  useEffect(() => {
    void initialize();
  }, [initialize]);
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      document.documentElement.dataset.theme =
        data.settings.theme === 'system' ? (media.matches ? 'dark' : 'light') : data.settings.theme;
      document.documentElement.dataset.animations = String(data.settings.animations);
    };
    apply();
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [data.settings.theme, data.settings.animations]);
  useEffect(() => {
    const handle = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      const editing = el.matches('input,textarea,select,[contenteditable="true"]');
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setModal(modal === 'commands' ? null : 'commands');
        return;
      }
      if (mod && e.key.toLowerCase() === 'n') {
        e.preventDefault();
        if (e.shiftKey) useDeck.getState().openTemplates();
        else setModal('quick');
        return;
      }
      if (mod && e.key === ',') {
        e.preventDefault();
        setModal('settings');
        return;
      }
      if (mod && e.key === 'Enter' && selected) {
        e.preventDefault();
        useDeck.getState().completeTask(selected);
        return;
      }
      if (e.altKey && /^[1-7]$/.test(e.key)) {
        e.preventDefault();
        setView(
          (['inbox', 'today', 'upcoming', 'anytime', 'someday', 'logbook', 'graph'] as View[])[
            Number(e.key) - 1
          ],
        );
        return;
      }
      if (editing) return;
      if (e.key === 'Escape') {
        select(null);
        setModal(null);
        useDeck.setState({ selection: [] });
        return;
      }
      if (modal) return;
      if (e.key.toLowerCase() === 'n') setModal('quick');
      if (e.key === '/') {
        e.preventDefault();
        setModal('commands');
      }
      if (e.key === '?') setModal('shortcuts');
      if (selected && e.key.toLowerCase() === 't')
        useDeck.getState().updateTask(selected, { scheduled: today(), destination: 'anytime' });
      if (selected && e.key.toLowerCase() === 'm') {
        document.querySelector<HTMLSelectElement>('.detail-field select')?.focus();
      }
      if (['ArrowDown', 'ArrowUp'].includes(e.key) && !selected) {
        const rows = Array.from(document.querySelectorAll<HTMLElement>('.task-row'));
        if (rows.length) {
          e.preventDefault();
          const index = rows.indexOf(document.activeElement as HTMLElement);
          rows[(index + (e.key === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length].focus();
        }
      }
    };
    window.addEventListener('keydown', handle);
    return () => window.removeEventListener('keydown', handle);
  }, [modal, selected, setModal, setView, select]);
  if (!ready)
    return (
      <div className="loading-screen">
        <DeckMark size={50} />
        <h1>A little clarity is on its way.</h1>
        <span>Opening your deck…</span>
      </div>
    );
  if (error && !data.tasks.length)
    return (
      <div className="loading-screen">
        <DeckMark size={50} />
        <h1>Let’s get your deck open.</h1>
        <p role="alert">{error}</p>
        <button className="primary-button" onClick={() => location.reload()}>
          Try again
        </button>
      </div>
    );
  const stack = view.startsWith('stack:') ? data.stacks.find((s) => s.id === view.slice(6)) : null;
  return (
    <div
      onClick={(e) => {
        if (mobileMenu && (e.target as HTMLElement).closest('.sidebar button'))
          setMobileMenu(false);
      }}
      className={`app-shell ${!sidebar ? 'sidebar-hidden' : ''} ${mobileMenu ? 'mobile-menu-open' : ''}`}
    >
      {(sidebar || mobileMenu) && <Sidebar />}
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumbs">
            {!sidebar && (
              <IconButton
                icon={PanelLeft}
                label="Show sidebar"
                onClick={() => useDeck.setState({ sidebar: true })}
              />
            )}
            <span>My workspace</span>
            <ChevronRight size={12} />
            <span>{stack?.name || viewName(view)}</span>
          </div>
          <div className="topbar-actions">
            <span className="local-label">
              <span className={`status-dot ${error ? 'status-error' : ''}`} />
              {error
                ? 'Save needs attention'
                : saving
                  ? 'Saving…'
                  : portalEnabled || cloudUser
                    ? cloudStatus
                    : 'All changes saved'}
            </span>
            <span className="topbar-divider" />
            <IconButton
              icon={Search}
              label="Search this view"
              onClick={() => {
                if (view === 'graph') setModal('commands');
                else setSearchOpen(!searchOpen);
              }}
            />
            <button className="primary-button add-card-button" onClick={() => setModal('quick')}>
              <Plus size={14} /> Add card <kbd>⌘ N</kbd>
            </button>
          </div>
        </header>
        {error && (
          <div className="error-banner" role="alert">
            {error}
            <button onClick={() => setModal('settings')}>
              Export a copy <ArrowUpRight size={12} />
            </button>
          </div>
        )}
        {searchOpen && view !== 'graph' && (
          <div className="inline-search">
            <Search size={16} />
            <input
              autoFocus
              aria-label="Filter current view"
              placeholder="Search this view · Try tag:design, overdue:true, or before:Friday"
              value={search}
              onChange={(e) => useDeck.setState({ search: e.target.value })}
            />
            <IconButton
              icon={X}
              label="Close view search"
              onClick={() => {
                setSearchOpen(false);
                useDeck.setState({ search: '' });
              }}
            />
          </div>
        )}
        {view === 'command' ? (
          <CommandCenter />
        ) : view === 'graph' ? (
          <Suspense
            fallback={
              <div className="graph-loading">
                <NetworkPlaceholder />
              </div>
            }
          >
            <GraphView />
          </Suspense>
        ) : (
          <TaskView key={view} />
        )}
        <footer className="app-footer">
          <span>
            <CloudOff size={12} /> A quiet corner of your digital life.
          </span>
          <div>
            <span className="local-only">Local-first. Always yours.</span>
            <button onClick={() => setModal('shortcuts')}>
              <kbd>?</kbd> Keyboard shortcuts
            </button>
          </div>
        </footer>
      </div>
      {selected && (
        <Suspense fallback={null}>
          <TaskDetail />
        </Suspense>
      )}
      <nav className="mobile-nav" aria-label="Main navigation">
        <button className={view === 'today' ? 'active' : ''} onClick={() => setView('today')}>
          <Sun size={19} />
          Today
        </button>
        <button className={view === 'inbox' ? 'active' : ''} onClick={() => setView('inbox')}>
          <Inbox size={19} />
          Inbox
        </button>
        <button className={view === 'upcoming' ? 'active' : ''} onClick={() => setView('upcoming')}>
          <CalendarDays size={19} />
          On Deck
        </button>
        <button
          className="mobile-add"
          aria-label="Quick add card"
          onClick={() => setModal('quick')}
        >
          <Plus size={23} />
        </button>
        <button aria-expanded={mobileMenu} onClick={() => setMobileMenu(!mobileMenu)}>
          <Layers3 size={19} />
          Stacks
        </button>
        <button onClick={() => setModal('commands')}>
          <Search size={19} />
          Search
        </button>
      </nav>
      <Dialogs />
      <Settings />
      {modal === 'templates' && (
        <Suspense fallback={null}>
          <TemplateDialog />
        </Suspense>
      )}
      {createPortal(
        <div aria-live="polite" aria-atomic="true">
          {toast && (
            <div className="toast" role="status" aria-live="polite" aria-atomic="true">
              <span className="toast-check">
                <Check size={14} />
              </span>
              <span>{toast.message}</span>
              {toast.undo && (
                <button
                  onClick={() => {
                    toast.undo?.();
                    useDeck.setState({ toast: null });
                  }}
                >
                  Undo
                </button>
              )}
              <IconButton
                icon={X}
                label="Dismiss notification"
                onClick={() => useDeck.setState({ toast: null })}
              />
            </div>
          )}
        </div>,
        document.body,
      )}
    </div>
  );
}

function NetworkPlaceholder() {
  return (
    <>
      <DeckMark size={35} />
      <span>Connecting the dots…</span>
    </>
  );
}
