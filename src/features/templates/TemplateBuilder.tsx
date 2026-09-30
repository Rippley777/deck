import { useState } from 'react';
import { ArrowDown, ArrowUp, ChevronDown, GripVertical, Plus, Trash2 } from 'lucide-react';
import { IconButton } from '../../components/ui';
import { useDeck } from '../../stores/deck';
import { emptyTemplateItem } from '../../lib/template-presets';
import type { DeckTemplate, TemplateItem, TemplateScope, TemplateVariable } from '../../types';
const tags = (value: string) =>
  value
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean);
export function TemplateBuilder({
  template,
  onChange,
  onSave,
  onCancel,
}: {
  template: DeckTemplate;
  onChange: (template: DeckTemplate) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  const stacks = useDeck((s) => s.data.stacks);
  const [heading, setHeading] = useState('');
  const patch = (value: Partial<DeckTemplate>) => onChange({ ...template, ...value });
  const patchItem = (id: string, value: Partial<TemplateItem>) =>
    patch({ items: template.items.map((item) => (item.id === id ? { ...item, ...value } : item)) });
  const patchVariable = (index: number, value: Partial<TemplateVariable>) =>
    patch({ variables: template.variables.map((v, i) => (i === index ? { ...v, ...value } : v)) });
  const move = (id: string, targetId: string) => {
    if (id === targetId) return;
    const item = template.items.find((i) => i.id === id);
    if (!item) return;
    const items = template.items.filter((i) => i.id !== id);
    items.splice(
      items.findIndex((i) => i.id === targetId),
      0,
      item,
    );
    patch({ items });
  };
  return (
    <form
      className="template-builder"
      onSubmit={(e) => {
        e.preventDefault();
        onSave();
      }}
    >
      <div className="template-builder-grid">
        <label>
          Name
          <input
            className="field"
            value={template.name}
            required
            onChange={(e) => patch({ name: e.target.value })}
          />
        </label>
        <label>
          Template type
          <select
            className="field"
            value={template.scope}
            onChange={(e) => {
              const scope = e.target.value as TemplateScope;
              patch({
                scope,
                items: template.items.map((item) =>
                  scope === 'checklist'
                    ? { ...item, kind: 'checklist', parentId: null, blockedBy: [] }
                    : item,
                ),
              });
            }}
          >
            <option value="stack">Stack</option>
            <option value="task">Parent task</option>
            <option value="checklist">Checklist</option>
          </select>
        </label>
        <label className="template-wide">
          Description
          <input
            className="field"
            value={template.description}
            onChange={(e) => patch({ description: e.target.value })}
            placeholder="What does this help you get started?"
          />
        </label>
        <label>
          Icon
          <input
            className="field"
            maxLength={8}
            value={template.icon}
            onChange={(e) => patch({ icon: e.target.value })}
          />
        </label>
        <label>
          Category
          <input
            className="field"
            value={template.category}
            onChange={(e) => patch({ category: e.target.value })}
            list="template-categories"
          />
          <datalist id="template-categories">
            <option>Software</option>
            <option>Life</option>
            <option>Work</option>
            <option>Custom</option>
          </datalist>
        </label>
        <label className="template-wide">
          Generated title
          <input
            className="field"
            value={template.title}
            required
            onChange={(e) => patch({ title: e.target.value })}
            placeholder="Launch {{project_name}}"
          />
        </label>
        <label>
          Default tags
          <input
            className="field"
            value={template.tags.join(', ')}
            onChange={(e) => patch({ tags: e.target.value.split(',') })}
            onBlur={() => patch({ tags: tags(template.tags.join(',')) })}
            placeholder="software, launch"
          />
        </label>
        <label>
          Default stack
          <select
            className="field"
            value={template.defaultStackId || ''}
            onChange={(e) => patch({ defaultStackId: e.target.value || null })}
          >
            <option value="">No default stack</option>
            {stacks.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <small>Used when creating a task or checklist.</small>
        </label>
        <label>
          Parent task effort (minutes)
          <input
            className="field"
            type="number"
            min="0"
            max="100000"
            value={template.effort}
            onChange={(e) => patch({ effort: Number(e.target.value) })}
          />
        </label>
        <label>
          Parent task priority
          <select
            className="field"
            value={template.priority}
            onChange={(e) =>
              patch({ priority: Number(e.target.value) as DeckTemplate['priority'] })
            }
          >
            <option value="0">None</option>
            <option value="1">Low</option>
            <option value="2">Medium</option>
            <option value="3">High</option>
          </select>
        </label>
        <label className="template-wide">
          Notes
          <textarea
            className="field"
            rows={3}
            value={template.notes}
            onChange={(e) => patch({ notes: e.target.value })}
            placeholder="Useful context for the new stack or parent task…"
          />
        </label>
      </div>
      <section className="template-builder-section">
        <div className="template-section-title">
          <h3>Variables</h3>
          <button
            type="button"
            className="secondary-button"
            onClick={() =>
              patch({
                variables: [
                  ...template.variables,
                  {
                    key: `variable_${template.variables.length + 1}`,
                    label: 'New variable',
                    required: false,
                    type: 'text',
                    options: [],
                    defaultValue: '',
                  },
                ],
              })
            }
          >
            <Plus size={13} />
            Add variable
          </button>
        </div>
        <p className="small-muted">
          Use {'{{project_name}}'} in titles, notes, headings, or tags. Conditions compare one
          variable to one value.
        </p>
        {template.variables.map((variable, index) => (
          <div className="template-variable-row" key={index}>
            <label>
              Key
              <input
                className="field"
                value={variable.key}
                onChange={(e) => patchVariable(index, { key: e.target.value })}
              />
            </label>
            <label>
              Label
              <input
                className="field"
                value={variable.label}
                onChange={(e) => patchVariable(index, { label: e.target.value })}
              />
            </label>
            <label>
              Input
              <select
                className="field"
                value={variable.type}
                onChange={(e) =>
                  patchVariable(index, { type: e.target.value as TemplateVariable['type'] })
                }
              >
                <option value="text">Text</option>
                <option value="select">Choice</option>
              </select>
            </label>
            <label>
              Default
              <input
                className="field"
                value={variable.defaultValue}
                onChange={(e) => patchVariable(index, { defaultValue: e.target.value })}
              />
            </label>
            {variable.type === 'select' && (
              <label className="template-wide">
                Options (one per line)
                <textarea
                  className="field"
                  value={variable.options.join('\n')}
                  onChange={(e) => patchVariable(index, { options: e.target.value.split('\n') })}
                  onBlur={() =>
                    patchVariable(index, {
                      options: [...new Set(variable.options.map((s) => s.trim()).filter(Boolean))],
                    })
                  }
                />
              </label>
            )}
            <label className="template-inline-check">
              <input
                type="checkbox"
                checked={variable.required}
                onChange={(e) => patchVariable(index, { required: e.target.checked })}
              />
              Required
            </label>
            <IconButton
              icon={Trash2}
              label={`Remove variable ${variable.label}`}
              onClick={() => patch({ variables: template.variables.filter((_, i) => i !== index) })}
            />
          </div>
        ))}
      </section>
      <section className="template-builder-section">
        <div className="template-section-title">
          <h3>Headings</h3>
        </div>
        <div className="template-headings">
          {template.headings.map((name, index) => (
            <span key={index}>
              {name}
              <button
                type="button"
                aria-label={`Remove heading ${name}`}
                onClick={() =>
                  patch({
                    headings: template.headings.filter((h) => h !== name),
                    items: template.items.map((i) =>
                      i.heading === name ? { ...i, heading: '' } : i,
                    ),
                  })
                }
              >
                ×
              </button>
            </span>
          ))}
        </div>
        <div className="template-heading-add">
          <input
            className="field"
            aria-label="New template heading"
            placeholder="Setup, Infrastructure, Launch…"
            value={heading}
            onChange={(e) => setHeading(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                if (heading.trim() && !template.headings.includes(heading.trim()))
                  patch({ headings: [...template.headings, heading.trim()] });
                setHeading('');
              }
            }}
          />
          <button
            type="button"
            className="secondary-button"
            disabled={!heading.trim()}
            onClick={() => {
              if (!template.headings.includes(heading.trim()))
                patch({ headings: [...template.headings, heading.trim()] });
              setHeading('');
            }}
          >
            Add heading
          </button>
        </div>
      </section>
      <section className="template-builder-section">
        <div className="template-section-title">
          <h3>
            Starter items <span>{template.items.length}</span>
          </h3>
          <button
            type="button"
            className="secondary-button"
            onClick={() =>
              patch({
                items: [
                  ...template.items,
                  {
                    ...emptyTemplateItem(),
                    kind:
                      template.scope === 'checklist'
                        ? 'checklist'
                        : template.scope === 'task'
                          ? 'subtask'
                          : 'task',
                    heading: template.headings[0] || '',
                  },
                ],
              })
            }
          >
            <Plus size={13} />
            Add item
          </button>
        </div>
        <p className="small-muted">
          Checked items are selected by default. Drag the handle or use the arrows to reorder.
        </p>
        {template.items.map((item, index) => (
          <div
            className="template-builder-item"
            key={item.id}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              move(e.dataTransfer.getData('template-item'), item.id);
            }}
          >
            <div className="template-item-line">
              <span
                draggable
                onDragStart={(e) => e.dataTransfer.setData('template-item', item.id)}
                className="template-item-handle"
                title="Drag to reorder"
              >
                <GripVertical size={16} />
              </span>
              <input
                type="checkbox"
                aria-label={`Include item ${index + 1} by default`}
                checked={item.selected}
                onChange={(e) => patchItem(item.id, { selected: e.target.checked })}
              />
              <input
                className="field"
                aria-label={`Item ${index + 1} title`}
                value={item.title}
                placeholder="What’s the next step?"
                required
                onChange={(e) => patchItem(item.id, { title: e.target.value })}
              />
              <IconButton
                icon={ArrowUp}
                label={`Move item ${index + 1} up`}
                disabled={index === 0}
                onClick={() => move(item.id, template.items[index - 1].id)}
              />
              <IconButton
                icon={ArrowDown}
                label={`Move item ${index + 1} down`}
                disabled={index === template.items.length - 1}
                onClick={() => move(template.items[index + 1].id, item.id)}
              />
              <IconButton
                icon={Trash2}
                label={`Remove item ${index + 1}`}
                onClick={() =>
                  patch({
                    items: template.items
                      .filter((i) => i.id !== item.id)
                      .map((i) => ({
                        ...i,
                        parentId: i.parentId === item.id ? null : i.parentId,
                        blockedBy: i.blockedBy.filter((id) => id !== item.id),
                      })),
                  })
                }
              />
            </div>
            <details>
              <summary>
                <ChevronDown size={12} />
                {item.kind} · {item.heading || 'No heading'}
                {item.blockedBy.length ? ` · ${item.blockedBy.length} dependencies` : ''}
                {item.condition
                  ? ` · If ${item.condition.variable} = ${item.condition.equals}`
                  : ''}
              </summary>
              <div className="template-builder-grid">
                <label>
                  Item type
                  <select
                    className="field"
                    value={item.kind}
                    onChange={(e) =>
                      patchItem(item.id, {
                        kind: e.target.value as TemplateItem['kind'],
                        ...(e.target.value === 'checklist' ? { blockedBy: [] } : {}),
                      })
                    }
                  >
                    {(template.scope === 'checklist'
                      ? ['checklist']
                      : ['task', 'subtask', 'checklist', 'milestone']
                    ).map((kind) => (
                      <option key={kind}>{kind}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Heading
                  <select
                    className="field"
                    value={item.heading}
                    onChange={(e) => patchItem(item.id, { heading: e.target.value })}
                  >
                    <option value="">No heading</option>
                    {template.headings.map((h) => (
                      <option key={h}>{h}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Parent
                  <select
                    className="field"
                    value={item.parentId || ''}
                    onChange={(e) => patchItem(item.id, { parentId: e.target.value || null })}
                  >
                    <option value="">
                      {template.scope === 'stack' ? 'No parent' : 'Generated parent task'}
                    </option>
                    {template.items
                      .filter((i) => i.id !== item.id && i.kind !== 'checklist')
                      .map((i) => (
                        <option key={i.id} value={i.id}>
                          {i.title || 'Untitled item'}
                        </option>
                      ))}
                  </select>
                </label>
                <label>
                  Priority
                  <select
                    className="field"
                    value={item.priority}
                    onChange={(e) =>
                      patchItem(item.id, {
                        priority: Number(e.target.value) as TemplateItem['priority'],
                      })
                    }
                  >
                    <option value="0">None</option>
                    <option value="1">Low</option>
                    <option value="2">Medium</option>
                    <option value="3">High</option>
                  </select>
                </label>
                <label>
                  Effort (minutes)
                  <input
                    className="field"
                    type="number"
                    min="0"
                    max="100000"
                    value={item.effort}
                    onChange={(e) => patchItem(item.id, { effort: Number(e.target.value) })}
                  />
                </label>
                <label>
                  Tags
                  <input
                    className="field"
                    value={item.tags.join(',')}
                    onChange={(e) => patchItem(item.id, { tags: e.target.value.split(',') })}
                    onBlur={() => patchItem(item.id, { tags: tags(item.tags.join(',')) })}
                  />
                </label>
                <label className="template-wide">
                  Notes
                  <textarea
                    className="field"
                    value={item.notes}
                    onChange={(e) => patchItem(item.id, { notes: e.target.value })}
                  />
                </label>
                {item.kind !== 'checklist' && (
                  <fieldset className="template-dependencies template-wide">
                    <legend>Depends on</legend>
                    {template.items
                      .filter((i) => i.id !== item.id && i.kind !== 'checklist')
                      .map((i) => (
                        <label className="template-inline-check" key={i.id}>
                          <input
                            type="checkbox"
                            checked={item.blockedBy.includes(i.id)}
                            onChange={(e) =>
                              patchItem(item.id, {
                                blockedBy: e.target.checked
                                  ? [...item.blockedBy, i.id]
                                  : item.blockedBy.filter((id) => id !== i.id),
                              })
                            }
                          />
                          {i.title || 'Untitled item'}
                        </label>
                      ))}
                    {template.items.filter((i) => i.id !== item.id && i.kind !== 'checklist')
                      .length === 0 && <small>Add another task to define a dependency.</small>}
                  </fieldset>
                )}
                <label>
                  Include only when
                  <select
                    className="field"
                    value={item.condition?.variable || ''}
                    onChange={(e) =>
                      patchItem(item.id, {
                        condition: e.target.value
                          ? { variable: e.target.value, equals: '' }
                          : undefined,
                      })
                    }
                  >
                    <option value="">Always available</option>
                    {template.variables.map((v) => (
                      <option key={v.key} value={v.key}>
                        {v.label}
                      </option>
                    ))}
                  </select>
                </label>
                {item.condition && (
                  <label>
                    Equals
                    {template.variables.find((v) => v.key === item.condition!.variable)?.type ===
                    'select' ? (
                      <select
                        className="field"
                        value={item.condition.equals}
                        onChange={(e) =>
                          patchItem(item.id, {
                            condition: { ...item.condition!, equals: e.target.value },
                          })
                        }
                      >
                        <option value="">Choose a value…</option>
                        {template.variables
                          .find((v) => v.key === item.condition!.variable)!
                          .options.map((value) => (
                            <option key={value}>{value}</option>
                          ))}
                      </select>
                    ) : (
                      <input
                        className="field"
                        value={item.condition.equals}
                        onChange={(e) =>
                          patchItem(item.id, {
                            condition: { ...item.condition!, equals: e.target.value },
                          })
                        }
                      />
                    )}
                  </label>
                )}
              </div>
            </details>
          </div>
        ))}
      </section>
      <div className="modal-footer">
        <button className="secondary-button" type="button" onClick={onCancel}>
          Cancel
        </button>
        <button className="primary-button" type="submit">
          Save template
        </button>
      </div>
    </form>
  );
}
