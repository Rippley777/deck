import { useEffect, useMemo, useRef, useState } from 'react';
import cytoscape, { type Core, type StylesheetJson } from 'cytoscape';
import {
  ArrowRight,
  ChevronDown,
  Focus,
  Info,
  Maximize,
  Minus,
  Network,
  Plus,
  RotateCcw,
  Search,
  SlidersHorizontal,
  X,
} from 'lucide-react';
import { useDeck } from '../../stores/deck';
import { DeckProgress } from '../../components/progress/DeckProgress';
import { taskProgress, progressSummary } from '../../lib/progress';
import { IconButton } from '../../components/ui';
import { initialFilters, localElements, projectGraph, type GraphFilters } from './model';
let savedViewport: { zoom: number; pan: { x: number; y: number } } | null = null;
const savedPositions = new Map<string, { x: number; y: number }>();
export function GraphView() {
  const { data, graphFocus, select, setView, commit } = useDeck();
  const [systemLight, setSystemLight] = useState(
    () => matchMedia('(prefers-color-scheme: light)').matches,
  );
  const isLight =
    data.settings.theme === 'light' || (data.settings.theme === 'system' && systemLight);
  useEffect(() => {
    const media = matchMedia('(prefers-color-scheme: light)');
    const update = () => setSystemLight(media.matches);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  const workspaceProgress = useMemo(() => taskProgress(data.tasks, data.tasks), [data.tasks]);
  const workspaceSummary = progressSummary(workspaceProgress);
  const container = useRef<HTMLDivElement>(null);
  const cyRef = useRef<Core | null>(null);
  const stabilized = useRef(false);
  const worker = useRef<Worker | null>(null);
  const [layingOut, setLayingOut] = useState(false);
  const [filters, setFilters] = useState<GraphFilters>({
    ...initialFilters,
    completed: !!data.tasks.find((t) => t.id === graphFocus)?.completedAt,
  });
  const [filterOpen, setFilterOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [focus, setFocus] = useState<string | null>(graphFocus);
  const [depth, setDepth] = useState('1');
  const [insights, setInsights] = useState(true);
  const [hover, setHover] = useState('');
  const [context, setContext] = useState<{ x: number; y: number; id: string; kind: string } | null>(
    null,
  );
  const [stats, setStats] = useState({ nodes: 0, edges: 0 });
  const [zoom, setZoom] = useState(100);
  const layout = data.settings.layout;
  const elements = useMemo(() => {
    const all = projectGraph(data, filters);
    return graphFocus
      ? localElements(all, graphFocus, depth === 'all' ? all.length : Number(depth))
      : all;
  }, [data, filters, graphFocus, depth]);
  const filter = (patch: Partial<GraphFilters>) => setFilters((f) => ({ ...f, ...patch }));
  const blocked = data.tasks.filter(
    (t) =>
      !t.completedAt &&
      t.blockedBy.some((id) => data.tasks.some((o) => o.id === id && !o.completedAt)),
  );
  const unstacked = data.tasks.filter((t) => !t.stackId && !t.completedAt);
  const busiestStack = data.stacks
    .map((stack) => ({
      ...stack,
      active: data.tasks.filter((task) => task.stackId === stack.id && !task.completedAt).length,
    }))
    .sort((a, b) => b.active - a.active)[0];
  useEffect(() => {
    setFocus(graphFocus);
  }, [graphFocus]);
  useEffect(() => {
    if (!container.current) return;
    const cy = cytoscape({
      container: container.current,
      elements: [],
      layout: { name: 'preset', fit: false },
      minZoom: 0.18,
      maxZoom: 3,
      wheelSensitivity: 0.2,
      pixelRatio: 'auto',
      hideEdgesOnViewport: false,
      textureOnViewport: true,
      style: [
        {
          selector: 'node',
          style: {
            'background-color': 'data(color)',
            width: 'data(size)',
            height: 'data(size)',
            label: 'data(label)',
            'font-family': 'Inter, sans-serif',
            'font-size': 12,
            color: isLight ? '#585362' : '#96929e',
            'text-valign': 'bottom',
            'text-margin-y': 9,
            'text-max-width': '160px',
            'text-wrap': 'ellipsis',
            'text-background-color': isLight ? '#f7f6f3' : '#19191c',
            'text-background-opacity': 0.8,
            'text-background-padding': '3px',
            'border-width': 2,
            'border-color': 'data(color)',
            'border-opacity': 0.18,
            'overlay-opacity': 0,
          },
        },
        {
          selector: '.stack',
          style: {
            'font-size': 15,
            'font-weight': 600,
            color: isLight ? '#29242d' : '#ded9e4',
            'border-width': 10,
            'border-opacity': 0.09,
            'text-margin-y': 15,
          },
        },
        {
          selector: '.tag',
          style: {
            'background-opacity': 0,
            'border-width': 1.5,
            'border-opacity': 0.7,
            'font-size': 9,
          },
        },
        { selector: '.goal', style: { shape: 'diamond', 'font-size': 11 } },
        {
          selector: 'node[?milestone]',
          style: {
            shape: 'diamond',
            'border-width': 2,
            'border-color': '#c9ae78',
            'border-opacity': 0.8,
          },
        },
        { selector: '.heading', style: { shape: 'round-rectangle', 'background-opacity': 0.4 } },
        { selector: 'node[?completed]', style: { opacity: 0.28 } },
        { selector: 'node[?inactive]', style: { opacity: 0.45 } },
        {
          selector: 'node[?overdue]',
          style: { 'border-color': '#d38a80', 'border-width': 3, 'border-opacity': 1 },
        },
        {
          selector: 'edge',
          style: {
            width: 0.8,
            'line-color': '#62576e',
            opacity: 0.5,
            'curve-style': 'bezier',
            'target-arrow-shape': 'none',
          },
        },
        {
          selector: '.dependency',
          style: {
            'target-arrow-shape': 'triangle',
            'target-arrow-color': '#b29acc',
            'line-color': '#a18bb8',
            'line-style': 'dashed',
            width: 1.2,
          },
        },
        { selector: '.dim', style: { opacity: 0.08 } },
        { selector: '.emphasis', style: { opacity: 1, 'border-width': 5, 'border-opacity': 0.35 } },
        { selector: 'edge.emphasis', style: { width: 1.5, 'line-color': '#b29aca', opacity: 0.8 } },
        { selector: '.hide-label', style: { label: '' } },
        { selector: ':selected', style: { 'border-color': '#e0c8ff', 'border-opacity': 0.8 } },
      ] as StylesheetJson,
    });
    cyRef.current = cy;
    stabilized.current = false;
    cy.on('tap', 'node', (e) => {
      const node = e.target;
      const id = node.id();
      setFocus(id);
      if (node.data('kind') === 'task') useDeck.getState().select(id);
    });
    cy.on('dbltap', 'node', (e) => {
      const n = e.target;
      if (n.data('kind') === 'stack') useDeck.getState().setView(`stack:${n.id()}`);
      else if (n.data('kind') === 'task') useDeck.getState().select(n.id());
      else if (n.data('kind') === 'tag') filter({ tag: n.data('label').slice(1) });
    });
    cy.on('tap', (e) => {
      setContext(null);
      if (e.target === cy) setFocus(null);
    });
    cy.on('mouseover', 'node', (e) => {
      const n = e.target;
      setHover(`${n.data('label')} · ${n.data('kind')}`);
      n.addClass('emphasis');
      n.connectedEdges().addClass('emphasis');
      if (container.current) container.current.style.cursor = 'pointer';
    });
    cy.on('mouseout', 'node', (e) => {
      e.target.removeClass('emphasis');
      e.target.connectedEdges().removeClass('emphasis');
      setHover('');
      if (container.current) container.current.style.cursor = 'grab';
    });
    cy.on('mouseover', 'edge', (e) => {
      const edge = e.target;
      setHover(
        `${edge.source().data('label')} → ${edge.data('relation')} → ${edge.target().data('label')}`,
      );
    });
    cy.on('mouseout', 'edge', () => setHover(''));
    cy.on('cxttap', 'node', (e) =>
      setContext({
        x: e.renderedPosition.x,
        y: e.renderedPosition.y,
        id: e.target.id(),
        kind: e.target.data('kind'),
      }),
    );
    cy.on('zoom', () => {
      setZoom(Math.round(cy.zoom() * 100));
      cy.nodes('.task').toggleClass('hide-label', cy.zoom() < 0.65);
    });
    cy.on('viewport', () => {
      if (!stabilized.current) return;
      savedViewport = { zoom: cy.zoom(), pan: cy.pan() };
    });
    cy.on('dragfree', 'node', (e) => savedPositions.set(e.target.id(), e.target.position()));
    return () => {
      worker.current?.terminate();
      if (stabilized.current)
        cy.nodes().forEach((n) => {
          savedPositions.set(n.id(), n.position());
        });
      cy.destroy();
      cyRef.current = null;
    };
  }, [isLight]);
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    const oldPositions = new Map(cy.nodes().map((n) => [n.id(), n.position()] as const));
    cy.elements().remove();
    cy.add(elements);
    setStats({ nodes: cy.nodes().length, edges: cy.edges().length });
    cy.nodes().forEach((n) => {
      const pos = oldPositions.get(n.id()) || savedPositions.get(n.id());
      if (pos) n.position(pos);
    });
    const reuse = elements
      .filter((e) => !e.data.source)
      .every((e) => oldPositions.has(e.data.id!) || savedPositions.has(e.data.id!));
    if (reuse && layout === 'force') {
      stabilized.current = true;
      if (savedViewport) {
        const viewport = { zoom: savedViewport.zoom, pan: { ...savedViewport.pan } };
        cy.viewport(viewport);
      }
    } else runLayout(cy, layout, false);
    return () => {
      worker.current?.terminate();
      cy.stop();
    };
  }, [elements, layout, isLight]);
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    cy.elements().removeClass('dim emphasis');
    if (focus && cy.getElementById(focus).length) {
      let selected = cy.getElementById(focus).closedNeighborhood();
      const hops = depth === 'all' ? cy.nodes().length : Number(depth);
      for (let i = 1; i < hops; i++) {
        const next = selected.closedNeighborhood();
        if (next.length === selected.length) break;
        selected = next;
      }
      cy.elements().difference(selected).addClass('dim');
      cy.getElementById(focus).addClass('emphasis');
    }
    if (query) {
      const matching = cy
        .nodes()
        .filter((n) => String(n.data('label')).toLowerCase().includes(query.toLowerCase()));
      cy.elements().addClass('dim');
      matching.removeClass('dim').addClass('emphasis');
      matching.connectedEdges().removeClass('dim');
    }
  }, [focus, depth, query, elements]);
  function runLayout(cy: Core, name: string, animate = true) {
    worker.current?.terminate();
    cy.stop();
    cy.resize();
    if (!cy.nodes().length) return;
    const common = {
      animate: animate && data.settings.animations,
      animationDuration: 350,
      fit: true,
      padding: 75,
    };
    if (name === 'force') {
      setLayingOut(true);
      stabilized.current = false;
      const nextWorker = new Worker(new URL('./layout.worker.ts', import.meta.url), {
        type: 'module',
      });
      worker.current = nextWorker;
      nextWorker.onmessage = (
        event: MessageEvent<{ id: string; position: { x: number; y: number } }[]>,
      ) => {
        if (cy.destroyed()) return;
        const positions = new Map(event.data.map((n) => [n.id, n.position]));
        cy.nodes().positions((n) => positions.get(n.id()) || n.position());
        cy.fit(undefined, 65);
        stabilized.current = true;
        savedViewport = { zoom: cy.zoom(), pan: { ...cy.pan() } };
        cy.nodes().forEach((n) => {
          savedPositions.set(n.id(), n.position());
        });
        setZoom(Math.round(cy.zoom() * 100));
        setLayingOut(false);
        nextWorker.terminate();
      };
      nextWorker.onerror = () => {
        if (!cy.destroyed()) {
          cy.layout({ name: 'circle', fit: true, padding: 70 }).run();
          setLayingOut(false);
        }
        nextWorker.terminate();
      };
      nextWorker.postMessage({
        elements: cy.elements().map((e) => ({ data: e.data() })),
        width: Math.max(cy.width() - 180, 500),
        height: Math.max(cy.height() - 160, 350),
      });
    } else {
      setLayingOut(false);
      stabilized.current = true;
    }
    if (name === 'hierarchy')
      cy.layout({
        name: 'breadthfirst',
        ...common,
        directed: true,
        spacingFactor: 1.25,
        roots: cy.nodes('.goal, .stack').map((n) => n.id()),
      }).run();
    if (name === 'radial')
      cy.layout({
        name: 'concentric',
        ...common,
        concentric: (n) => (n.id() === focus ? 100 : n.degree()),
        levelWidth: () => 2,
        minNodeSpacing: 35,
      }).run();
    if (name === 'timeline') {
      const dates = [...new Set(cy.nodes('.task').map((n) => n.data('scheduled')))].sort();
      const counts: Record<string, number> = {};
      cy.nodes().forEach((n) => {
        const date = n.data('scheduled') || 'stack';
        const index = counts[date] || 0;
        counts[date] = index + 1;
        n.position({ x: date === 'stack' ? -200 : dates.indexOf(date) * 240, y: index * 80 });
      });
      cy.fit(undefined, 70);
    }
  }
  const tags = [...new Set(data.tasks.flatMap((t) => t.tags))];
  const currentFocus =
    data.tasks.find((t) => t.id === focus)?.title ||
    data.stacks.find((s) => s.id === focus)?.name ||
    data.goals.find((g) => g.id === focus)?.title ||
    focus;
  return (
    <div className="graph-page">
      <div className="graph-header">
        <div>
          <div className="page-eyebrow">
            <Network size={14} /> EVERYTHING IS CONNECTED
          </div>
          <h1>Your work, connected.</h1>
          <p className="page-subtitle">
            Step back. See the relationships. Find a little perspective.
          </p>
        </div>
        <button
          className={`secondary-button ${filterOpen ? 'active-filter' : ''}`}
          onClick={() => setFilterOpen(!filterOpen)}
        >
          <SlidersHorizontal size={14} /> Filters <ChevronDown size={13} />
        </button>
      </div>
      <div className="graph-toolbar">
        <div className="graph-search">
          <Search size={15} />
          <input
            placeholder="Find a node…"
            aria-label="Search graph nodes"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                const cy = cyRef.current;
                const node = cy
                  ?.nodes()
                  .filter((n) => n.data('label').toLowerCase().includes(query.toLowerCase()))
                  .first();
                if (node?.length) {
                  setFocus(node.id());
                  cy?.animate({ center: { eles: node }, zoom: 1.2 }, { duration: 250 });
                  setQuery('');
                }
              }
            }}
          />
          {query && <IconButton icon={X} label="Clear graph search" onClick={() => setQuery('')} />}
        </div>
        <div className="layout-tabs">
          {(['force', 'hierarchy', 'radial', 'timeline'] as const).map((l) => (
            <button
              key={l}
              className={layout === l ? 'selected' : ''}
              onClick={() => {
                commit({ ...data, settings: { ...data.settings, layout: l } });
              }}
            >
              {l[0].toUpperCase() + l.slice(1)}
            </button>
          ))}
        </div>
        <IconButton
          icon={Info}
          label="Toggle graph insights"
          onClick={() => setInsights(!insights)}
        />
      </div>
      {filterOpen && (
        <div className="graph-filters">
          <select
            aria-label="Filter graph by stack"
            value={filters.stack}
            onChange={(e) => filter({ stack: e.target.value })}
          >
            <option value="">All stacks</option>
            {data.stacks.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <select
            aria-label="Filter graph by tag"
            value={filters.tag}
            onChange={(e) => filter({ tag: e.target.value })}
          >
            <option value="">All tags</option>
            {tags.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
          <select
            aria-label="Filter graph by status"
            value={filters.status}
            onChange={(e) => filter({ status: e.target.value })}
          >
            <option value="">All active cards</option>
            {['today', 'upcoming', 'anytime', 'someday', 'overdue', 'blocked'].map((s) => (
              <option key={s} value={s}>
                {s === 'upcoming' ? 'On Deck' : s[0].toUpperCase() + s.slice(1)}
              </option>
            ))}
          </select>
          <label>
            <input
              type="checkbox"
              checked={filters.completed}
              onChange={(e) => filter({ completed: e.target.checked })}
            />{' '}
            Completed
          </label>
          <label>
            <input
              type="checkbox"
              checked={filters.priority}
              onChange={(e) => filter({ priority: e.target.checked })}
            />{' '}
            Priority
          </label>
          <label>
            <input
              type="checkbox"
              checked={filters.orphans}
              onChange={(e) => filter({ orphans: e.target.checked })}
            />{' '}
            Orphans
          </label>
          <input
            type="date"
            aria-label="Graph date from"
            value={filters.from}
            onChange={(e) => filter({ from: e.target.value })}
          />
          <span>to</span>
          <input
            type="date"
            aria-label="Graph date to"
            value={filters.to}
            onChange={(e) => filter({ to: e.target.value })}
          />
          <button className="subtle-link" onClick={() => setFilters(initialFilters)}>
            Reset
          </button>
        </div>
      )}
      <div className="graph-canvas-wrap">
        {layingOut && (
          <div className="layout-status">
            <span className="status-dot" /> Finding a little balance…
          </div>
        )}
        <div
          className="graph-canvas"
          ref={container}
          aria-label="Interactive graph of your tasks, stacks, tags, and goals"
        />
        {stats.nodes === 0 && (
          <div className="graph-empty">
            <Network size={40} />
            <h3>
              {data.tasks.length || data.stacks.length
                ? 'No connections in this view.'
                : 'Your work will connect here.'}
            </h3>
            <button
              className="secondary-button"
              onClick={() =>
                data.tasks.length || data.stacks.length
                  ? setFilters(initialFilters)
                  : useDeck.getState().setModal('quick')
              }
            >
              {data.tasks.length || data.stacks.length ? 'Clear filters' : 'Add Task'}
            </button>
          </div>
        )}
        {focus && (
          <div className="graph-focus-pill">
            <Focus size={14} />
            <span>{currentFocus}</span>
            <select
              aria-label="Relationship depth"
              value={depth}
              onChange={(e) => setDepth(e.target.value)}
            >
              <option value="1">1 hop</option>
              <option value="2">2 hops</option>
              <option value="3">3 hops</option>
              <option value="all">All connected</option>
            </select>
            {data.stacks.some((s) => s.id === focus) && (
              <button onClick={() => setView(`stack:${focus}`)}>
                Open stack <ArrowRight size={13} />
              </button>
            )}
            <IconButton
              icon={X}
              label="Clear graph focus"
              onClick={() => {
                setFocus(null);
                useDeck.setState({ graphFocus: null });
              }}
            />
          </div>
        )}
        {insights && elements.length > 0 && (
          <div className="graph-insights">
            <div className="insights-title">
              <span>IN THE CONNECTIONS</span>
              <IconButton icon={X} label="Hide insights" onClick={() => setInsights(false)} />
            </div>
            <h3>A little perspective.</h3>
            <div className="graph-progress-summary">
              <DeckProgress
                items={workspaceProgress}
                label="Workspace progress"
                size={36}
                variant="enhanced"
                animate={data.settings.animations}
              />
              <div>
                <strong>
                  {workspaceSummary.completed} of {workspaceSummary.total} cleared
                </strong>
                <small>Across your workspace</small>
              </div>
            </div>
            <button onClick={() => filter({ ...initialFilters, status: 'blocked' })}>
              <span className="insight-dot amber" />
              <span>
                <strong>{blocked.length} cards</strong> are waiting on something
              </span>
              <ArrowRight size={12} />
            </button>
            <button
              onClick={() => {
                filter({ ...initialFilters, status: 'unstacked' });
                setFocus(null);
              }}
            >
              <span className="insight-dot" />
              <span>
                <strong>{unstacked.length} cards</strong> have no stack
              </span>
              <ArrowRight size={12} />
            </button>
            {busiestStack && (
              <button
                onClick={() => {
                  filter({ ...initialFilters, stack: busiestStack.id });
                  setFocus(busiestStack.id);
                }}
              >
                <span className="insight-dot purple" />
                <span>
                  <strong>{busiestStack.name}</strong> has {busiestStack.active} active cards
                </span>
                <ArrowRight size={12} />
              </button>
            )}
            <p>
              Patterns in your work. Nothing more,
              <br />
              nothing less.
            </p>
          </div>
        )}
        <div className="graph-legend">
          <span>
            <i className="legend-stack" />
            Stack
          </span>
          <span>
            <i />
            Card
          </span>
          <span>
            <i className="legend-tag" />
            Tag
          </span>
          <span>
            <i className="legend-goal" />
            Goal
          </span>
          <span className="legend-dependency">⇢ Dependency</span>
        </div>
        <div className="graph-controls">
          <IconButton
            icon={Minus}
            label="Zoom out"
            onClick={() => {
              const cy = cyRef.current;
              cy?.zoom({
                level: cy.zoom() / 1.2,
                renderedPosition: { x: cy.width() / 2, y: cy.height() / 2 },
              });
            }}
          />
          <span>{zoom}%</span>
          <IconButton
            icon={Plus}
            label="Zoom in"
            onClick={() => {
              const cy = cyRef.current;
              cy?.zoom({
                level: cy.zoom() * 1.2,
                renderedPosition: { x: cy.width() / 2, y: cy.height() / 2 },
              });
            }}
          />
          <div />
          <IconButton
            icon={Maximize}
            label="Fit graph"
            onClick={() => cyRef.current?.fit(undefined, 70)}
          />
          <IconButton
            icon={RotateCcw}
            label="Reset graph layout"
            onClick={() => {
              if (cyRef.current) runLayout(cyRef.current, layout);
            }}
          />
        </div>
        {context && (
          <div
            className="context-menu"
            style={{
              left: Math.min(context.x, container.current!.clientWidth - 180),
              top: Math.min(context.y, container.current!.clientHeight - 110),
            }}
          >
            <button
              onClick={() => {
                if (context.kind === 'task') select(context.id);
                if (context.kind === 'stack') setView(`stack:${context.id}`);
                setContext(null);
              }}
            >
              Open {context.kind}
            </button>
            <button
              onClick={() => {
                setFocus(context.id);
                setContext(null);
              }}
            >
              Focus connections
            </button>
            {context.kind === 'task' && (
              <button
                onClick={() => {
                  useDeck.getState().completeTask(context.id);
                  setContext(null);
                }}
              >
                Toggle completion
              </button>
            )}
          </div>
        )}
      </div>
      <div className="graph-footer">
        <span className="status-dot" />
        <span>
          {stats.nodes} nodes <span className="dot-separator">·</span> {stats.edges} connections
        </span>
        <span>{hover || 'Drag to explore · Scroll to zoom · Select a card to open it'}</span>
      </div>
    </div>
  );
}
