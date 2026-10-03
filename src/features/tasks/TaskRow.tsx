import { Check, Flag, GripVertical, Link2, ListTodo, MessageSquare, Repeat2 } from 'lucide-react';
import type { Task } from '../../types';
import { useDeck } from '../../stores/deck';
import { dateLabel, today } from '../../lib/dates';
import { useTemplateContextMenu } from '../../components/TemplateContextMenu';
import { StackGlyph } from '../../components/StackGlyph';
export function TaskRow({ task, showStack = true }: { task: Task; showStack?: boolean }) {
  const templateMenu = useTemplateContextMenu();
  const { data, completeTask, select, selection, updateTask } = useDeck();
  const stack = data.stacks.find((s) => s.id === task.stackId);
  const checked = selection.includes(task.id);
  const toggleSelection = () =>
    useDeck.setState((state) => ({
      selection: state.selection.includes(task.id)
        ? state.selection.filter((id) => id !== task.id)
        : [...state.selection, task.id],
    }));
  return (
    <div
      className={`task-row ${task.completedAt ? 'is-complete' : ''} ${checked ? 'is-selected' : ''}`}
      role="button"
      tabIndex={0}
      aria-label={`Open ${task.title}`}
      draggable
      onContextMenu={(e) => templateMenu.open(e, { taskId: task.id })}
      onDragStart={(e) => {
        e.dataTransfer.setData('task', task.id);
        e.dataTransfer.effectAllowed = 'move';
      }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        e.stopPropagation();
        const id = e.dataTransfer.getData('task');
        if (id && id !== task.id)
          updateTask(id, {
            heading: task.heading,
            order: task.order - 0.5,
            stackId: task.stackId,
            scheduled: task.scheduled,
          });
      }}
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey) {
          toggleSelection();
        } else select(task.id);
      }}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
          templateMenu.open(e, { taskId: task.id });
          return;
        }
        if (e.key === 'Enter') {
          e.preventDefault();
          select(task.id);
        }
        if (e.key === ' ') {
          e.preventDefault();
          completeTask(task.id);
        }
      }}
    >
      <GripVertical className="task-grip" size={13} />
      {templateMenu.menu}
      <button
        className={`task-check priority-${task.priority}`}
        aria-label={`${task.completedAt ? 'Reopen' : 'Complete'} ${task.title}`}
        onClick={(e) => {
          e.stopPropagation();
          completeTask(task.id);
        }}
      >
        {task.completedAt && <Check size={12} strokeWidth={2.5} />}
      </button>
      <div className="task-title">
        <span>{task.title}</span>
        <div className="task-indicators">
          {task.recurrence && <Repeat2 size={12} />} {task.notes && <MessageSquare size={12} />}{' '}
          {task.checklist.length > 0 && (
            <span>
              <ListTodo size={12} />
              {task.checklist.filter((c) => c.done).length}/{task.checklist.length}
            </span>
          )}{' '}
          {task.links.length > 0 && <Link2 size={12} />}
        </div>
      </div>
      <div className="task-meta">
        {task.kind === 'milestone' && (
          <span className="template-milestone">
            <Flag size={11} /> Milestone
          </span>
        )}
        {task.time && (
          <span className="time-badge">
            {data.settings.clock24
              ? task.time
              : new Date(`2000-01-01T${task.time}`).toLocaleTimeString('en-US', {
                  hour: 'numeric',
                  minute: '2-digit',
                })}
          </span>
        )}
        {task.deadline && !task.completedAt && (
          <span className={`due-badge ${task.deadline < today() ? 'overdue' : ''}`}>
            <Flag size={11} />
            {data.settings.dateFormat === 'iso' ? task.deadline : dateLabel(task.deadline, true)}
          </span>
        )}
        {showStack && stack && (
          <span className="task-stack" style={{ color: stack.color }}>
            <StackGlyph icon={stack.icon} color={stack.color} size={13} />
            {stack.name}
          </span>
        )}
      </div>
      <input
        type="checkbox"
        className="task-select"
        aria-label={`Select ${task.title}`}
        title="Select card for bulk actions"
        checked={checked}
        onClick={(e) => e.stopPropagation()}
        onChange={toggleSelection}
      />
    </div>
  );
}
