import { useEffect, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import {
  ArrowUpRight,
  Check,
  CheckCheck,
  Copy,
  Flag,
  Link2,
  ListTodo,
  Network,
  Plus,
  Repeat2,
  Trash2,
  LayoutTemplate,
  Sparkles,
  X,
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useDeck } from '../../stores/deck';
import { IconButton } from '../../components/ui';
import { dateLabel, isoDate, parseDate, validRecurrence } from '../../lib/dates';
import { taskLinks, wouldCycle } from '../graph/model';
function DateField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string | null;
  onChange: (s: string | null) => void;
}) {
  const [draft, setDraft] = useState(value || '');
  const [invalid, setInvalid] = useState(false);
  useEffect(() => setDraft(value || ''), [value]);
  return (
    <label className="detail-field">
      <span>{label}</span>
      <div className="date-entry">
        <input
          aria-label={label}
          value={draft}
          placeholder="Choose a date…"
          onChange={(e) => {
            setDraft(e.target.value);
            setInvalid(false);
          }}
          onBlur={() => {
            const parsed = parseDate(draft);
            if (!draft.trim() || parsed) {
              onChange(parsed);
              setDraft(parsed || '');
            } else setInvalid(true);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur();
          }}
        />
        <input
          className="native-date"
          type="date"
          aria-label={`${label} calendar`}
          value={value || ''}
          onChange={(e) => {
            onChange(e.target.value || null);
            setDraft(e.target.value);
            setInvalid(false);
          }}
        />
      </div>
      {invalid && <small className="error-text">Try “tomorrow”, “Friday”, or YYYY-MM-DD.</small>}
    </label>
  );
}
export function TaskDetail() {
  const {
    data,
    selected,
    select,
    updateTask,
    completeTask,
    deleteTask,
    duplicateTask,
    localGraph,
    notify,
  } = useDeck();
  const task = data.tasks.find((t) => t.id === selected);
  const [preview, setPreview] = useState(false);
  const [checklist, setChecklist] = useState('');
  const [linkMode, setLinkMode] = useState<'related' | 'blocked' | null>(null);
  const [linkQuery, setLinkQuery] = useState('');
  const [wiki, setWiki] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  useEffect(() => {
    setPreview(false);
    setWiki(false);
    setLinkMode(null);
    setDeleteConfirm(false);
  }, [selected]);
  if (!task) return null;
  const stack = data.stacks.find((s) => s.id === task.stackId);
  const references = [
    ...data.tasks
      .filter((t) => t.id !== task.id)
      .map((t) => ({ id: t.id, title: t.title, kind: 'Card' })),
    ...data.stacks.map((s) => ({ id: s.id, title: s.name, kind: 'Stack' })),
    ...data.goals.map((g) => ({ id: g.id, title: g.title, kind: 'Goal' })),
  ];
  const resolve = (id: string) => references.find((r) => r.id === id);
  const backlinks = data.tasks.filter(
    (t) => t.id !== task.id && taskLinks(t, data).includes(task.id),
  );
  const allLinks = taskLinks(task, data);
  const blockers = task.blockedBy
    .map((id) => data.tasks.find((t) => t.id === id))
    .filter((t) => !!t);
  const blocks = data.tasks.filter((t) => t.blockedBy.includes(task.id));
  function addLink(id: string) {
    if (!task) return;
    if (linkMode === 'blocked') {
      if (wouldCycle(data.tasks, task.id, id)) {
        notify('That dependency would create a loop.');
        return;
      }
      updateTask(task.id, { blockedBy: [...new Set([...task.blockedBy, id])] });
    } else updateTask(task.id, { links: [...new Set([...task.links, id])] });
    setLinkMode(null);
    setLinkQuery('');
  }
  return (
    <Dialog.Root open onOpenChange={(open) => !open && select(null)}>
      <Dialog.Portal>
        <Dialog.Overlay className="detail-overlay" />
        <Dialog.Content className="detail-panel" aria-describedby={undefined}>
          <div className="detail-top">
            <span>
              CARD DETAILS <span className="dot-separator">/</span> {stack?.name || 'Inbox'}
            </span>
            <div>
              <IconButton
                icon={Network}
                label="Open local graph"
                onClick={() => localGraph(task.id)}
              />
              <IconButton
                icon={Copy}
                label="Duplicate card"
                onClick={() => duplicateTask(task.id)}
              />
              <IconButton
                icon={LayoutTemplate}
                label="Insert checklist from template"
                onClick={() =>
                  useDeck.getState().openTemplates({ scope: 'checklist', taskId: task.id })
                }
              />
              <Dialog.Close asChild>
                <IconButton icon={X} label="Close task details" />
              </Dialog.Close>
            </div>
          </div>
          <div className="detail-scroll">
            <div className="detail-title-row">
              <button
                className={`task-check ${task.completedAt ? 'checked' : ''}`}
                aria-label={task.completedAt ? 'Reopen card' : 'Complete card'}
                onClick={() => completeTask(task.id)}
              >
                {task.completedAt && <Check size={13} />}
              </button>
              <Dialog.Title asChild>
                <textarea
                  className={`detail-title ${task.completedAt ? 'struck' : ''}`}
                  aria-label="Task title"
                  value={task.title}
                  onChange={(e) => updateTask(task.id, { title: e.target.value })}
                  onBlur={() => {
                    if (!task.title.trim()) updateTask(task.id, { title: 'Untitled card' });
                  }}
                  rows={2}
                />
              </Dialog.Title>
            </div>
            {task.completedAt && (
              <div className="completed-label">
                <CheckCheck size={14} /> Cleared {dateLabel(isoDate(new Date(task.completedAt)))}
              </div>
            )}
            <div className="notes-label">
              <span>NOTES</span>
              <button onClick={() => setPreview(!preview)}>{preview ? 'Edit' : 'Preview'}</button>
            </div>
            {preview ? (
              <div className="markdown-preview">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {task.notes.replace(/\[\[([^\]]+)\]\]/g, '**$1**') ||
                    '*A little room for the details.*'}
                </ReactMarkdown>
              </div>
            ) : (
              <textarea
                className="notes-editor"
                aria-label="Task notes"
                placeholder="A little room for the details…\nMarkdown works here. Type [[ to link a card."
                value={task.notes}
                onChange={(e) => {
                  updateTask(task.id, { notes: e.target.value });
                  setWiki(/\[\[[^\]]*$/.test(e.target.value));
                }}
              />
            )}
            {wiki && (
              <div className="link-picker wiki-picker">
                <span>LINK TO A CARD, STACK, OR GOAL</span>
                {references
                  .filter((r) =>
                    r.title.toLowerCase().includes(task.notes.split('[[').pop()!.toLowerCase()),
                  )
                  .slice(0, 7)
                  .map((r) => (
                    <button
                      key={r.id}
                      onClick={() => {
                        updateTask(task.id, {
                          notes: task.notes.replace(/\[\[[^\]]*$/, `[[${r.title}]] `),
                        });
                        setWiki(false);
                      }}
                    >
                      <Link2 size={13} />
                      {r.title}
                      <small>{r.kind}</small>
                    </button>
                  ))}
                <button onClick={() => setWiki(false)}>Dismiss</button>
              </div>
            )}
            <div className="detail-checklist">
              <div className="detail-section-title">
                <ListTodo size={14} />
                <span>Checklist</span>
                <small>
                  {task.checklist.filter((c) => c.done).length}/{task.checklist.length}
                </small>
              </div>
              {task.checklist.map((item) => (
                <div className="checklist-row" key={item.id}>
                  <button
                    className={`task-check ${item.done ? 'checked' : ''}`}
                    aria-label={`Toggle ${item.title}`}
                    onClick={() =>
                      updateTask(task.id, {
                        checklist: task.checklist.map((c) =>
                          c.id === item.id ? { ...c, done: !c.done } : c,
                        ),
                      })
                    }
                  >
                    {item.done && <Check size={11} />}
                  </button>
                  <input
                    aria-label="Checklist item"
                    className={item.done ? 'struck' : ''}
                    value={item.title}
                    onChange={(e) =>
                      updateTask(task.id, {
                        checklist: task.checklist.map((c) =>
                          c.id === item.id ? { ...c, title: e.target.value } : c,
                        ),
                      })
                    }
                  />
                  <IconButton
                    icon={X}
                    label={`Remove ${item.title}`}
                    onClick={() =>
                      updateTask(task.id, {
                        checklist: task.checklist.filter((c) => c.id !== item.id),
                      })
                    }
                  />
                </div>
              ))}
              <form
                className="checklist-add"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (checklist.trim()) {
                    updateTask(task.id, {
                      checklist: [
                        ...task.checklist,
                        { id: crypto.randomUUID(), title: checklist.trim(), done: false },
                      ],
                    });
                    setChecklist('');
                  }
                }}
              >
                <Plus size={13} />
                <input
                  placeholder="Add a step…"
                  aria-label="Add checklist item"
                  value={checklist}
                  onChange={(e) => setChecklist(e.target.value)}
                />
                {checklist && <button type="submit">Add</button>}
              </form>
            </div>
            <div className="detail-properties">
              {data.tasks.some((child) => child.parentId === task.id) && (
                <div className="detail-child-cards">
                  <div className="detail-section-title">
                    <ListTodo size={14} />
                    <span>Child cards</span>
                  </div>
                  {data.tasks
                    .filter((child) => child.parentId === task.id)
                    .sort((a, b) => a.order - b.order)
                    .map((child) => (
                      <div className="checklist-row" key={child.id}>
                        <button
                          className={`task-check ${child.completedAt ? 'checked' : ''}`}
                          aria-label={`${child.completedAt ? 'Reopen' : 'Complete'} child ${child.title}`}
                          onClick={() => completeTask(child.id)}
                        >
                          {child.completedAt && <Check size={11} />}
                        </button>
                        <button
                          className={child.completedAt ? 'struck' : ''}
                          onClick={() => select(child.id)}
                        >
                          {child.title}
                        </button>
                      </div>
                    ))}
                </div>
              )}
              <button
                className="template-entry"
                onClick={() =>
                  useDeck.getState().openTemplates({ library: true, sourceTaskId: task.id })
                }
              >
                <Sparkles size={14} /> Save card as template
              </button>
              <DateField
                label="Work on"
                value={task.scheduled}
                onChange={(scheduled) => updateTask(task.id, { scheduled })}
              />
              <DateField
                label="Deadline"
                value={task.deadline}
                onChange={(deadline) => updateTask(task.id, { deadline })}
              />
              <label className="detail-field">
                <span>At a time</span>
                <input
                  type="time"
                  value={task.time || ''}
                  onChange={(e) => updateTask(task.id, { time: e.target.value || null })}
                />
              </label>
              <label className="detail-field">
                <span>Stack</span>
                <select
                  value={task.stackId || ''}
                  onChange={(e) =>
                    updateTask(task.id, {
                      stackId: e.target.value || null,
                      destination: e.target.value ? 'anytime' : 'inbox',
                    })
                  }
                >
                  <option value="">No stack</option>
                  {data.stacks.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.icon.startsWith('lucide:') ? s.name : `${s.icon} ${s.name}`}
                    </option>
                  ))}
                </select>
              </label>
              <label className="detail-field">
                <span>Section</span>
                <select
                  value={task.heading}
                  onChange={(e) => updateTask(task.id, { heading: e.target.value })}
                >
                  {[...new Set([task.heading, ...data.headings, ...(stack?.headings || [])])].map(
                    (h) => (
                      <option key={h}>{h}</option>
                    ),
                  )}
                </select>
              </label>
              <label className="detail-field">
                <span>Keep in</span>
                <select
                  value={task.destination}
                  onChange={(e) =>
                    updateTask(task.id, {
                      destination: e.target.value as typeof task.destination,
                      ...(e.target.value === 'someday' ? { scheduled: null } : {}),
                    })
                  }
                >
                  <option value="inbox">Inbox</option>
                  <option value="anytime">Anytime</option>
                  <option value="someday">Someday</option>
                </select>
              </label>
              <label className="detail-field">
                <span>
                  <Flag size={12} /> Priority
                </span>
                <select
                  value={task.priority}
                  onChange={(e) =>
                    updateTask(task.id, { priority: Number(e.target.value) as 0 | 1 | 2 | 3 })
                  }
                >
                  <option value="0">None</option>
                  <option value="1">Low</option>
                  <option value="2">Medium</option>
                  <option value="3">High</option>
                </select>
              </label>
              <label className="detail-field">
                <span>
                  <Repeat2 size={12} /> Repeat
                </span>
                <input
                  aria-label="Recurring schedule"
                  list="recurrences"
                  key={task.id}
                  defaultValue={task.recurrence || ''}
                  placeholder="Does not repeat"
                  onBlur={(e) => {
                    const rule = e.target.value.trim();
                    if (!rule || validRecurrence(rule))
                      updateTask(task.id, { recurrence: rule || null });
                    else {
                      e.target.value = task.recurrence || '';
                      notify('Try “every weekday”, “every 2 weeks”, or “monthly”.');
                    }
                  }}
                />
                <datalist id="recurrences">
                  {[
                    'every day',
                    'every weekday',
                    'every Monday',
                    'every Tuesday',
                    'every Wednesday',
                    'every Thursday',
                    'every Friday',
                    'every Saturday',
                    'every Sunday',
                    'every 2 weeks',
                    'monthly',
                  ].map((r) => (
                    <option value={r} key={r} />
                  ))}
                </datalist>
              </label>
              <label className="detail-field">
                <span>Time needed</span>
                <select
                  value={task.effort}
                  onChange={(e) => updateTask(task.id, { effort: Number(e.target.value) })}
                >
                  {[5, 10, 15, 25, 30, 45, 60, 90, 120].map((n) => (
                    <option key={n} value={n}>
                      {n} minutes
                    </option>
                  ))}
                </select>
              </label>
              <label className="detail-field">
                <span>Tags</span>
                <input
                  aria-label="Task tags"
                  key={task.id}
                  defaultValue={task.tags.join(', ')}
                  placeholder="design, work…"
                  onBlur={(e) =>
                    updateTask(task.id, {
                      tags: [
                        ...new Set(
                          e.target.value
                            .split(',')
                            .map((s) => s.trim().replace(/^#/, ''))
                            .filter(Boolean),
                        ),
                      ],
                    })
                  }
                />
              </label>
              <label className="detail-field">
                <span>Parent card</span>
                <select
                  value={task.parentId || ''}
                  onChange={(e) => {
                    const id = e.target.value;
                    let parent = data.tasks.find((t) => t.id === id);
                    const visited = new Set<string>();
                    while (parent) {
                      if (parent.id === task.id || visited.has(parent.id)) {
                        notify('That parent would create a loop.');
                        return;
                      }
                      visited.add(parent.id);
                      parent = data.tasks.find((t) => t.id === parent?.parentId);
                    }
                    updateTask(task.id, { parentId: id || null });
                  }}
                >
                  <option value="">None</option>
                  {data.tasks
                    .filter((t) => t.id !== task.id)
                    .map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.title}
                      </option>
                    ))}
                </select>
              </label>
            </div>
            <div className="detail-relations">
              <div className="detail-section-title">
                <Link2 size={14} />
                <span>Connections</span>
                <button onClick={() => setLinkMode(linkMode === 'related' ? null : 'related')}>
                  <Plus size={13} /> Link to…
                </button>
              </div>
              {allLinks.length > 0 && (
                <div className="relation-group">
                  <h4>Links to</h4>
                  {allLinks.map((id) => {
                    const ref = resolve(id);
                    if (!ref) return null;
                    return (
                      <div className="relation-row" key={id}>
                        <button onClick={() => (ref.kind === 'Card' ? select(id) : localGraph(id))}>
                          <Link2 size={13} />
                          {ref.title}
                          <ArrowUpRight size={12} />
                        </button>
                        {task.links.includes(id) && (
                          <IconButton
                            icon={X}
                            label="Remove link"
                            onClick={() =>
                              updateTask(task.id, { links: task.links.filter((l) => l !== id) })
                            }
                          />
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
              {backlinks.length > 0 && (
                <div className="relation-group">
                  <h4>Linked from</h4>
                  {backlinks.map((t) => (
                    <button className="relation-link" key={t.id} onClick={() => select(t.id)}>
                      <Link2 size={13} />
                      {t.title}
                      <ArrowUpRight size={12} />
                    </button>
                  ))}
                </div>
              )}
              <div className="relation-group">
                <h4>
                  Blocked by{' '}
                  <button onClick={() => setLinkMode(linkMode === 'blocked' ? null : 'blocked')}>
                    <Plus size={12} /> Add dependency
                  </button>
                </h4>
                {blockers.map((t) => (
                  <div className="relation-row" key={t.id}>
                    <button onClick={() => select(t.id)}>
                      {t.completedAt ? <Check size={12} /> : <span className="insight-dot amber" />}
                      {t.title}
                    </button>
                    <IconButton
                      icon={X}
                      label="Remove dependency"
                      onClick={() =>
                        updateTask(task.id, {
                          blockedBy: task.blockedBy.filter((id) => id !== t.id),
                        })
                      }
                    />
                  </div>
                ))}
              </div>
              {blocks.length > 0 && (
                <div className="relation-group">
                  <h4>Blocks</h4>
                  {blocks.map((t) => (
                    <button className="relation-link" key={t.id} onClick={() => select(t.id)}>
                      <ArrowUpRight size={12} />
                      {t.title}
                    </button>
                  ))}
                </div>
              )}
              {linkMode && (
                <div className="link-picker">
                  <input
                    autoFocus
                    className="field"
                    placeholder={
                      linkMode === 'blocked' ? 'Find a prerequisite…' : 'Find something to connect…'
                    }
                    value={linkQuery}
                    onChange={(e) => setLinkQuery(e.target.value)}
                  />
                  {references
                    .filter(
                      (r) =>
                        (linkMode !== 'blocked' || r.kind === 'Card') &&
                        r.title.toLowerCase().includes(linkQuery.toLowerCase()),
                    )
                    .slice(0, 8)
                    .map((r) => (
                      <button key={r.id} onClick={() => addLink(r.id)}>
                        <Link2 size={13} />
                        {r.title}
                        <small>{r.kind}</small>
                      </button>
                    ))}
                </div>
              )}
              {allLinks.length === 0 &&
                blockers.length === 0 &&
                backlinks.length === 0 &&
                !linkMode && (
                  <p className="small-muted">
                    Good work rarely happens in isolation.
                    <br />
                    Connect this card to the bigger picture.
                  </p>
                )}
              <button className="local-graph-button" onClick={() => localGraph(task.id)}>
                <Network size={14} /> Open local graph <ArrowUpRight size={13} />
              </button>
            </div>
          </div>
          <div className="detail-footer">
            <span>Saved on this device</span>
            {deleteConfirm ? (
              <>
                <button className="danger-button" onClick={() => deleteTask(task.id)}>
                  Delete card
                </button>
                <button onClick={() => setDeleteConfirm(false)}>Cancel</button>
              </>
            ) : (
              <IconButton
                icon={Trash2}
                label="Delete card"
                onClick={() => setDeleteConfirm(true)}
              />
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
