import {
  cloneElement,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactElement,
} from 'react';
import { createPortal } from 'react-dom';
import {
  progressSegments,
  progressSummary,
  progressText,
  ringArc,
  ringPoint,
  ringStroke,
  type ProgressCounts,
  type ProgressItem,
  type ProgressSummary,
} from '../../lib/progress';
import './progress.css';

interface TooltipProps {
  label: string;
  summary: ProgressSummary;
  children: ReactElement<{ 'aria-describedby'?: string }>;
  hint?: string;
  className?: string;
  side?: 'bottom' | 'right';
}

/** A portal keeps the tooltip outside scrolling sidebars. The description remains
 * available to screen readers before the visual tooltip opens. */
export function DeckProgressTooltip({
  label,
  summary,
  children,
  hint,
  className = '',
  side = 'bottom',
}: TooltipProps) {
  const id = useId();
  const anchor = useRef<HTMLSpanElement>(null);
  const tip = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ left: 0, top: 0 });
  const cancel = () => clearTimeout(timer.current);
  const show = (delay = 350) => {
    cancel();
    timer.current = setTimeout(() => setOpen(true), delay);
  };
  const hide = () => {
    cancel();
    setOpen(false);
  };
  const placeTooltip = useCallback(() => {
    if (!anchor.current || !tip.current) return;
    const rect = anchor.current.getBoundingClientRect();
    const { width, height } = tip.current.getBoundingClientRect();
    let left = side === 'right' ? rect.right + 12 : rect.left + rect.width / 2 - width / 2;
    let top = side === 'right' ? rect.top + rect.height / 2 - height / 2 : rect.bottom + 10;
    if (side === 'bottom' && top + height > window.innerHeight - 12) top = rect.top - height - 10;
    left = Math.max(12, Math.min(left, window.innerWidth - width - 12));
    top = Math.max(12, Math.min(top, window.innerHeight - height - 12));
    setPosition({ left, top });
  }, [side]);
  useEffect(() => () => clearTimeout(timer.current), []);
  useEffect(() => {
    if (!open) return;
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        setOpen(false);
      }
    };
    const close = () => {
      if (anchor.current?.contains(document.activeElement)) placeTooltip();
      else setOpen(false);
    };
    document.addEventListener('keydown', escape, true);
    window.addEventListener('resize', close);
    window.addEventListener('scroll', close, true);
    return () => {
      document.removeEventListener('keydown', escape, true);
      window.removeEventListener('resize', close);
      window.removeEventListener('scroll', close, true);
    };
  }, [open, placeTooltip]);
  useLayoutEffect(() => {
    if (open) placeTooltip();
  }, [open, placeTooltip, summary, label]);
  const plural = summary.total === 1 ? 'task' : 'tasks';
  return (
    <span
      ref={anchor}
      className={`deck-progress-anchor ${className}`}
      onPointerEnter={(e) => {
        if (e.pointerType !== 'touch') show();
      }}
      onPointerLeave={() => {
        cancel();
        if (anchor.current?.contains(document.activeElement)) return;
        timer.current = setTimeout(() => setOpen(false), 120);
      }}
      onFocus={() => show(0)}
      onBlur={hide}
      onClick={hide}
    >
      {cloneElement(children, {
        'aria-describedby': [children.props['aria-describedby'], id].filter(Boolean).join(' '),
      })}
      <span className="progress-sr-only" id={id}>
        {progressText(summary)}
      </span>
      {open &&
        createPortal(
          <div
            ref={tip}
            role="tooltip"
            className="deck-progress-tooltip"
            style={position}
            onPointerEnter={cancel}
            onPointerLeave={() => {
              if (!anchor.current?.contains(document.activeElement)) hide();
            }}
          >
            <div className="progress-tooltip-heading">
              <strong>{label}</strong>
              <span>
                {summary.total} {plural}
              </span>
            </div>
            {!summary.total ? (
              <p className="progress-tooltip-empty">A little room for what’s next.</p>
            ) : (
              <>
                <div className="progress-tooltip-row">
                  <i className="progress-key completed" />
                  <span>Completed</span>
                  <b>{summary.completed}</b>
                </div>
                <div className="progress-tooltip-row">
                  <i className="progress-key remaining" />
                  <span>Remaining</span>
                  <b>{summary.remaining}</b>
                </div>
                {(summary.deferred > 0 || summary.blocked > 0 || summary.overdue > 0) && (
                  <div className="progress-tooltip-statuses">
                    <p>Of the remaining cards</p>
                    {summary.deferred > 0 && (
                      <div className="progress-tooltip-row">
                        <i className="progress-key deferred" />
                        <span>Deferred / Someday</span>
                        <b>{summary.deferred}</b>
                      </div>
                    )}
                    {summary.blocked > 0 && (
                      <div className="progress-tooltip-row">
                        <i className="progress-key blocked" />
                        <span>Blocked</span>
                        <b>{summary.blocked}</b>
                      </div>
                    )}
                    {summary.overdue > 0 && (
                      <div className="progress-tooltip-row">
                        <i className="progress-key overdue" />
                        <span>Overdue</span>
                        <b>{summary.overdue}</b>
                      </div>
                    )}
                  </div>
                )}
                {summary.cleared && <p className="progress-tooltip-cleared">Deck cleared.</p>}
              </>
            )}
            {hint && <div className="progress-tooltip-hint">{hint}</div>}
          </div>,
          document.body,
        )}
    </span>
  );
}

export interface DeckProgressProps extends Partial<ProgressCounts> {
  /** Task identities enable exact segment updates for small decks. Overrides counts. */
  items?: readonly ProgressItem[];
  label?: string;
  size?: number;
  variant?: 'default' | 'enhanced';
  showLabel?: boolean | 'fraction' | 'percentage';
  interactive?: boolean;
  onClick?: () => void;
  actionLabel?: string;
  pressed?: boolean;
  tooltip?: boolean;
  animate?: boolean;
  className?: string;
}

export function DeckProgress({
  items,
  total = 0,
  completed = 0,
  deferred = 0,
  blocked = 0,
  overdue = 0,
  label = 'Deck progress',
  size = 48,
  variant = 'default',
  showLabel = false,
  interactive = false,
  onClick,
  actionLabel = 'Show incomplete cards',
  pressed,
  tooltip = true,
  animate = true,
  className = '',
}: DeckProgressProps) {
  const dimension = Math.max(14, Number.isFinite(size) ? size : 48);
  const canInteract = interactive && !!onClick;
  const source = items ?? { total, completed, deferred, blocked, overdue };
  const { summary, segments, mode } = progressSegments(source, dimension);
  const previous = useRef(summary);
  const [resolving, setResolving] = useState(false);
  useEffect(() => {
    const before = previous.current;
    previous.current = summary;
    setResolving(false);
    if (
      !animate ||
      matchMedia('(prefers-reduced-motion: reduce)').matches ||
      !summary.cleared ||
      before.total !== summary.total ||
      before.completed >= summary.completed
    )
      return;
    setResolving(true);
    const timeout = setTimeout(() => setResolving(false), 420);
    return () => clearTimeout(timeout);
  }, [summary.total, summary.completed, summary.cleared, animate]);
  const tiny = dimension < 24;
  const inner = tiny ? 31 : 33;
  const text =
    showLabel === 'percentage' ? `${summary.percentage}%` : `${summary.completed}/${summary.total}`;
  const style = { '--deck-ring-size': `${dimension}px` } as CSSProperties;
  const visualization = (
    <span
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={summary.total || 1}
      aria-valuenow={summary.completed}
      aria-valuetext={progressText(summary)}
      className={`deck-progress ${className}`}
      style={style}
      data-mode={mode}
      data-total={summary.total}
      data-completed={summary.completed}
      data-cleared={summary.cleared}
      data-resolving={resolving}
      data-animate={animate}
      tabIndex={!canInteract && tooltip ? 0 : undefined}
    >
      <svg
        width={dimension}
        height={dimension}
        viewBox="0 0 100 100"
        fill="none"
        aria-hidden="true"
        focusable="false"
      >
        {summary.total === 0 && <circle className="deck-progress-empty" cx="50" cy="50" r="38" />}
        <g className="deck-progress-segments">
          {segments.map((segment) => {
            const span = segment.end - segment.start;
            const activeEnd = segment.end - span * segment.deferred;
            const fillEnd = segment.start + span * segment.completed;
            const midpoint = (Math.max(fillEnd, segment.start) + activeEnd) / 2;
            const notchStart = ringPoint(44.5, midpoint),
              notchEnd = ringPoint(37, midpoint);
            const marker = ringPoint(47.5, midpoint);
            return (
              <g
                key={segment.key}
                data-segment={segment.key}
                data-weight={segment.weight}
                data-fill={segment.completed}
                data-deferred={segment.deferred === 1}
              >
                <path
                  className="deck-progress-track"
                  d={ringArc(segment.start, segment.end, 43, inner)}
                />
                {mode === 'individual' ? (
                  <path
                    className="deck-progress-fill"
                    d={ringArc(segment.start, segment.end, 43, inner)}
                    style={{
                      fillOpacity: segment.completed > 0 ? 1 : 0,
                      strokeOpacity: segment.completed > 0 ? 1 : 0,
                    }}
                  />
                ) : (
                  <path
                    className="deck-progress-aggregate-fill"
                    d={ringStroke(segment.start, segment.end, (43 + inner) / 2)}
                    pathLength={1}
                    strokeWidth={43 - inner}
                    style={{ strokeDasharray: `${segment.completed} 1` }}
                  />
                )}
                {segment.deferred > 0 && (
                  <path
                    className="deck-progress-deferred"
                    d={ringArc(activeEnd, segment.end, 43, inner)}
                  />
                )}
                {variant === 'enhanced' && segment.blocked && (
                  <line
                    className="deck-progress-blocked"
                    x1={notchStart[0]}
                    y1={notchStart[1]}
                    x2={notchEnd[0]}
                    y2={notchEnd[1]}
                  />
                )}
                {variant === 'enhanced' && segment.overdue && (
                  <circle
                    className="deck-progress-overdue"
                    cx={marker[0]}
                    cy={marker[1]}
                    r={tiny ? 3.3 : 2}
                  />
                )}
              </g>
            );
          })}
        </g>
        <circle
          className="deck-progress-resolve"
          cx="50"
          cy="50"
          r={(43 + inner) / 2}
          strokeWidth={43 - inner}
        />
        {showLabel && dimension >= 36 && (
          <text
            className="deck-progress-center"
            x="50"
            y="51"
            textAnchor="middle"
            dominantBaseline="middle"
          >
            {summary.total ? text : '—'}
          </text>
        )}
      </svg>
    </span>
  );
  const content =
    interactive && onClick ? (
      <button
        type="button"
        className="deck-progress-button"
        onClick={onClick}
        aria-label={`${actionLabel} in ${label}`}
        aria-pressed={pressed}
      >
        {visualization}
      </button>
    ) : (
      visualization
    );
  return tooltip ? (
    <DeckProgressTooltip
      label={label}
      summary={summary}
      hint={interactive && onClick ? actionLabel : undefined}
    >
      {content}
    </DeckProgressTooltip>
  ) : (
    content
  );
}

export { progressSummary };
