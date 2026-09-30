import {
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  MoveUpRight,
  Network,
  Sparkles,
} from 'lucide-react';
import { useState } from 'react';
import { useDeck } from '../stores/deck';
import { addDays, isoDate, today } from '../lib/dates';
import { IconButton } from './ui';
export function TodayAside() {
  const { data, setModal, setView } = useDeck();
  const [weekOffset, setWeekOffset] = useState(0);
  const now = new Date();
  const start = new Date();
  start.setDate(
    now.getDate() - ((now.getDay() - data.settings.startOfWeek + 7) % 7) + weekOffset * 7,
  );
  const tomorrow = data.tasks.filter((t) => !t.completedAt && t.scheduled === addDays(1));
  return (
    <aside className="today-aside">
      <div className="week-heading">
        <span>A little perspective</span>
        <div>
          <IconButton
            icon={ChevronLeft}
            label="Previous week"
            onClick={() => setWeekOffset((v) => v - 1)}
          />
          <IconButton
            icon={ChevronRight}
            label="Next week"
            onClick={() => setWeekOffset((v) => v + 1)}
          />
        </div>
      </div>
      <div className="week-strip">
        {Array.from({ length: 7 }, (_, i) => {
          const date = new Date(start);
          date.setDate(start.getDate() + i);
          const iso = isoDate(date);
          return (
            <button
              key={i}
              className={iso === today() ? 'day current' : 'day'}
              onClick={() => {
                if (iso === today()) setView('today');
                else {
                  setView('upcoming');
                  useDeck.setState({ plannedDate: iso });
                }
              }}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const id = e.dataTransfer.getData('task');
                if (id)
                  useDeck.getState().updateTask(id, { scheduled: iso, destination: 'anytime' });
              }}
              title={date.toDateString()}
            >
              <span>{date.toLocaleDateString('en-US', { weekday: 'narrow' })}</span>
              <strong>{date.getDate()}</strong>
              <i
                className={
                  data.tasks.some((t) => t.scheduled === iso && !t.completedAt) ? 'has-tasks' : ''
                }
              />
            </button>
          );
        })}
      </div>
      <div className="aside-divider" />
      <div className="breathing-art" aria-hidden="true">
        <div className="orbit orbit-one" />
        <div className="orbit orbit-two" />
        <span className="art-spark spark-one">✧</span>
        <span className="art-spark spark-two">✦</span>
        <div className="illustrated-card card-back" />
        <div className="illustrated-card card-mid" />
        <div className="illustrated-card card-front">
          <div className="card-sun">☀</div>
          <span />
          <span />
          <span />
          <i>one thing at a time.</i>
        </div>
      </div>
      <h3>
        A little less noise.
        <br />A little more focus.
      </h3>
      <p>
        You don’t have to do everything.
        <br />
        Just make room for what matters.
      </p>
      <button className="plan-button" onClick={() => setModal('planning')}>
        <Sparkles size={14} /> Deal your day <ArrowRight size={14} />
      </button>
      <div className="aside-divider" />
      <div className="tomorrow-heading">
        <span>WAITING IN THE WINGS</span>
        <span>{tomorrow.length}</span>
      </div>
      <h4>Tomorrow, gently.</h4>
      {tomorrow.slice(0, 3).map((t) => (
        <button
          className="tomorrow-task"
          key={t.id}
          onClick={() => useDeck.getState().select(t.id)}
        >
          <span className="mini-circle" />
          <span>{t.title}</span>
        </button>
      ))}
      {tomorrow.length === 0 && <p className="small-muted">A little space for what’s next.</p>}
      <button className="subtle-link" onClick={() => setView('upcoming')}>
        Look ahead <ArrowRight size={13} />
      </button>
      <button className="graph-promo" onClick={() => setView('graph')}>
        <span className="mini-network">
          <Network size={23} />
        </span>
        <span>
          See the bigger picture<small>Explore how your work connects</small>
        </span>
        <MoveUpRight size={14} />
      </button>
    </aside>
  );
}
