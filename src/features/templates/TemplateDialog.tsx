import { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowDown,
  ArrowUp,
  Copy,
  Download,
  GripVertical,
  Pencil,
  Plus,
  Search,
  Sparkles,
  Star,
  Trash2,
  Upload,
} from 'lucide-react';
import { Modal, IconButton } from '../../components/ui';
import { useDeck } from '../../stores/deck';
import { download } from '../../lib/transfer';
import { emptyTemplate } from '../../lib/template-presets';
import {
  generateFromTemplate,
  interpolate,
  parseTemplateImport,
  serializeTemplates,
  templateFromSource,
  templateMatches,
  validateTemplate,
  visibleTemplateItems,
} from '../../lib/templates';
import type { DeckTemplate, TemplateScope } from '../../types';
import { TemplateBuilder } from './TemplateBuilder';
import './templates.css';

export function TemplateDialog() {
  const { data, templateContext: context, setModal, commit, notify, setView, select } = useDeck();
  const templates = data.templates || [];
  const fromSource = !!(context.sourceTaskId || context.sourceStackId);
  const [stage, setStage] = useState<'browse' | 'preview' | 'edit'>(fromSource ? 'edit' : 'browse');
  const [draft, setDraft] = useState<DeckTemplate>(() =>
    fromSource ? templateFromSource(data, context) : emptyTemplate(),
  );
  const [chosen, setChosen] = useState<DeckTemplate | null>(null);
  const [query, setQuery] = useState('');
  const [scope, setScope] = useState<TemplateScope | ''>(context.scope || '');
  const [values, setValues] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<string[]>([]);
  const [title, setTitle] = useState(context.title || '');
  const [stackId, setStackId] = useState(context.stackId || '');
  const [error, setError] = useState('');
  const file = useRef<HTMLInputElement>(null);
  useEffect(() => {
    document.querySelector('.templates-modal')?.scrollTo({ top: 0 });
  }, [stage]);
  const close = () => {
    setModal(null);
    if (context.taskId || context.sourceTaskId) select(context.taskId || context.sourceTaskId!);
  };
  function preview(template: DeckTemplate) {
    setChosen(template);
    setSelected(template.items.filter((item) => item.selected).map((item) => item.id));
    setValues(
      Object.fromEntries(
        template.variables.map((v) => [
          v.key,
          v.key === 'project_name' && context.title ? context.title : v.defaultValue,
        ]),
      ),
    );
    setStackId(
      context.stackId ??
        (data.stacks.some((s) => s.id === template.defaultStackId) ? template.defaultStackId! : ''),
    );
    setTitle(context.title || '');
    setError('');
    setStage('preview');
  }
  function save(template: DeckTemplate) {
    try {
      validateTemplate(template);
      commit({
        ...data,
        templates: templates.some((t) => t.id === template.id)
          ? templates.map((t) => (t.id === template.id ? template : t))
          : [...templates, template],
      });
      notify('Template saved. Ready for next time.');
      setStage('browse');
      setError('');
    } catch (e) {
      setError((e as Error).message);
    }
  }
  function reorder(id: string, beforeId: string) {
    if (id === beforeId) return;
    const item = templates.find((t) => t.id === id);
    if (!item) return;
    const next = templates.filter((t) => t.id !== id);
    next.splice(
      next.findIndex((t) => t.id === beforeId),
      0,
      item,
    );
    commit({ ...data, templates: next });
  }
  async function importFile(file: File) {
    try {
      if (file.size > 5_000_000) throw new Error('Choose a template file smaller than 5 MB.');
      const imported = parseTemplateImport(await file.text()).map((t) => ({
        ...t,
        id: crypto.randomUUID(),
        lastUsedAt: null,
      }));
      const current = useDeck.getState().data;
      commit({ ...current, templates: [...(current.templates || []), ...imported] });
      notify(`${imported.length} ${imported.length === 1 ? 'template' : 'templates'} imported.`);
      setError('');
    } catch (e) {
      setError((e as Error).message);
    }
  }
  const visible = templates.filter(
    (t) =>
      (!scope || t.scope === scope || (scope === 'task' && t.scope === 'checklist')) &&
      templateMatches(t, query),
  );
  if (!context.library)
    visible.sort(
      (a, b) =>
        (b.lastUsedAt || '').localeCompare(a.lastUsedAt || '') ||
        Number(b.favorite) - Number(a.favorite),
    );
  const items = chosen ? visibleTemplateItems(chosen, values) : [];
  const selectedItems = items.filter((item) => selected.includes(item.id));
  const sections = [
    ...new Set([...(chosen?.headings || []), ...items.map((i) => i.heading)]),
  ].filter((heading) => items.some((item) => item.heading === heading));
  const creatingChecklist = !!context.taskId;
  const exportTemplate = async (template: DeckTemplate) => {
    try {
      await download(
        `deck-template-${template.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase() || 'custom'}.json`,
        serializeTemplates([template]),
        'application/json',
      );
    } catch (e) {
      setError(`Could not export: ${(e as Error).message}`);
    }
  };
  return (
    <Modal
      open
      onClose={close}
      title={
        stage === 'edit'
          ? 'Make it repeatable.'
          : stage === 'preview'
            ? 'Make this one yours.'
            : context.library
              ? 'Your templates.'
              : 'New from template'
      }
      description={
        stage === 'edit'
          ? 'Build a starting point you can use again.'
          : stage === 'preview'
            ? 'Choose what you need. Leave the rest for another time.'
            : 'You’ve done this before. Keep the setup.'
      }
      className="templates-modal"
    >
      {error && (
        <p className="template-error" role="alert">
          {error}
        </p>
      )}
      {stage === 'edit' ? (
        <TemplateBuilder
          template={draft}
          onChange={setDraft}
          onSave={() => save(draft)}
          onCancel={() => {
            setStage('browse');
            setError('');
          }}
        />
      ) : stage === 'preview' && chosen ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            try {
              const current = useDeck.getState().data;
              const result = generateFromTemplate(current, chosen, {
                ...context,
                title,
                stackId: stackId || null,
                values,
                selectedIds: selected,
              });
              commit(result.data);
              setModal(null);
              sessionStorage.removeItem('deck-add-heading');
              if (chosen.scope === 'stack') setView(`stack:${result.stackId}`);
              else if (result.taskId) {
                if (result.stackId) setView(`stack:${result.stackId}`);
                select(result.taskId);
              }
              notify(
                creatingChecklist
                  ? `${result.count} checklist items added.`
                  : `${chosen.name} is ready. Make it your own.`,
              );
            } catch (e) {
              setError((e as Error).message);
            }
          }}
        >
          <button
            type="button"
            className="template-back"
            onClick={() => {
              setStage('browse');
              setError('');
            }}
          >
            <ArrowLeft size={14} /> All templates
          </button>
          <div className="template-preview-title">
            <span>{chosen.icon}</span>
            <div>
              <h3>{chosen.name}</h3>
              <p>{chosen.description}</p>
            </div>
            <small>{chosen.scope}</small>
          </div>
          <div className="template-preview-grid">
            <div className="template-setup">
              {!creatingChecklist && (
                <label>
                  {chosen.scope === 'stack' ? 'Stack name' : 'Task title'}
                  <input
                    className="field"
                    aria-label={
                      chosen.scope === 'stack' ? 'Template stack name' : 'Template task title'
                    }
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder={interpolate(chosen.title, values)}
                  />
                  <small>Leave blank to use the template title.</small>
                </label>
              )}
              {chosen.scope !== 'stack' && !creatingChecklist && (
                <label>
                  Stack
                  <select
                    className="field"
                    value={stackId}
                    onChange={(e) => setStackId(e.target.value)}
                  >
                    <option value="">No stack</option>
                    {data.stacks.map((stack) => (
                      <option key={stack.id} value={stack.id}>
                        {stack.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {chosen.variables.map((variable) => (
                <label key={variable.key}>
                  {variable.label}
                  {variable.required && <span className="template-required"> *</span>}
                  {variable.type === 'select' ? (
                    <select
                      className="field"
                      value={values[variable.key] || ''}
                      required={variable.required}
                      onChange={(e) => setValues({ ...values, [variable.key]: e.target.value })}
                    >
                      <option value="">Choose…</option>
                      {variable.options.map((option) => (
                        <option key={option}>{option}</option>
                      ))}
                    </select>
                  ) : (
                    <input
                      className="field"
                      value={values[variable.key] || ''}
                      required={variable.required}
                      onChange={(e) => setValues({ ...values, [variable.key]: e.target.value })}
                    />
                  )}
                </label>
              ))}
              {chosen.tags.length > 0 && (
                <div className="template-tags">
                  {chosen.tags.map((tag) => (
                    <span key={tag}>#{interpolate(tag, values)}</span>
                  ))}
                </div>
              )}
              <p className="template-explainer">
                {creatingChecklist
                  ? 'Checked items will be added to your existing checklist.'
                  : chosen.scope === 'stack'
                    ? 'Your cards will keep these headings. Everything stays editable.'
                    : 'Tasks become child cards. Checklist items stay inside their parent card.'}
              </p>
            </div>
            <div className="template-item-preview">
              <div className="template-selection-bar">
                <strong>
                  {selectedItems.length} of {items.length} selected
                </strong>
                <button
                  type="button"
                  onClick={() =>
                    setSelected([...new Set([...selected, ...items.map((item) => item.id)])])
                  }
                >
                  Select All
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setSelected(selected.filter((id) => !items.some((item) => item.id === id)))
                  }
                >
                  Clear All
                </button>
              </div>
              {sections.map((section) => (
                <section key={section}>
                  <h4>{interpolate(section, values) || 'Your cards'}</h4>
                  {items
                    .filter((item) => item.heading === section)
                    .map((item) => (
                      <label
                        className={`template-preview-item ${selected.includes(item.id) ? 'is-checked' : ''}`}
                        key={item.id}
                      >
                        <input
                          type="checkbox"
                          checked={selected.includes(item.id)}
                          onChange={(e) =>
                            setSelected(
                              e.target.checked
                                ? [...selected, item.id]
                                : selected.filter((id) => id !== item.id),
                            )
                          }
                        />
                        <span>
                          <strong>{interpolate(item.title, values)}</strong>
                          <small>
                            {item.kind === 'milestone'
                              ? '◇ Milestone'
                              : item.kind === 'checklist'
                                ? 'Checklist item'
                                : item.kind === 'subtask'
                                  ? 'Child task'
                                  : 'Task'}
                            {item.effort > 0 && item.kind !== 'checklist'
                              ? ` · ${item.effort} min`
                              : ''}
                            {item.condition ? ` · ${item.condition.equals}` : ''}
                          </small>
                          {item.notes && <p>{interpolate(item.notes, values)}</p>}
                          {item.blockedBy.length > 0 && (
                            <small>
                              After:{' '}
                              {item.blockedBy
                                .map((id) => chosen.items.find((i) => i.id === id))
                                .filter((i) => !!i && selectedItems.includes(i))
                                .map((i) => interpolate(i!.title, values))
                                .join(', ') || 'no selected prerequisites'}
                            </small>
                          )}
                        </span>
                      </label>
                    ))}
                </section>
              ))}
              {!items.length && (
                <p className="template-explainer">
                  {chosen.scope === 'task' && !chosen.items.length
                    ? 'This template creates one card with its saved notes, tags, priority, and effort.'
                    : 'Choose your options to see the matching items.'}
                </p>
              )}
              {chosen.items.some((item) => item.blockedBy.length) && (
                <p className="template-explainer">
                  Dependencies connect selected tasks in Graph View. Skipped prerequisites are left
                  out.
                </p>
              )}
            </div>
          </div>
          <div className="modal-footer">
            <span className="small-muted">A starting point, always yours to change.</span>
            <button
              className="primary-button"
              type="submit"
              disabled={!selectedItems.length && !(chosen.scope === 'task' && !chosen.items.length)}
            >
              <Sparkles size={14} />
              {creatingChecklist
                ? 'Insert checklist'
                : chosen.scope === 'stack'
                  ? 'Create stack'
                  : 'Create task'}
            </button>
          </div>
        </form>
      ) : (
        <>
          <div className="template-toolbar">
            <div className="template-search">
              <Search size={16} />
              <input
                autoFocus
                aria-label="Search templates"
                placeholder="Search a familiar workflow…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
            {!context.scope && (
              <select
                className="field"
                aria-label="Template type"
                value={scope}
                onChange={(e) => setScope(e.target.value as TemplateScope | '')}
              >
                <option value="">All types</option>
                <option value="stack">Stacks</option>
                <option value="task">Tasks</option>
                <option value="checklist">Checklists</option>
              </select>
            )}
            <button
              className="secondary-button"
              onClick={() => {
                setDraft({ ...emptyTemplate(), scope: context.scope || 'stack' });
                setStage('edit');
                setError('');
              }}
            >
              <Plus size={14} />
              New template
            </button>
            {context.library && (
              <button className="secondary-button" onClick={() => file.current?.click()}>
                <Upload size={14} />
                Import
              </button>
            )}
            <input
              ref={file}
              type="file"
              accept=".json,application/json"
              hidden
              onChange={(e) => {
                if (e.target.files?.[0]) void importFile(e.target.files[0]);
                e.target.value = '';
              }}
            />
          </div>
          <div className="template-library">
            {visible.map((template) => (
              <article
                className="template-card"
                key={template.id}
                draggable={context.library}
                onDragStart={(e) => e.dataTransfer.setData('deck-template', template.id)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  reorder(e.dataTransfer.getData('deck-template'), template.id);
                }}
              >
                <button className="template-card-main" onClick={() => preview(template)}>
                  <span className="template-card-icon">{template.icon}</span>
                  <span>
                    <strong>{template.name}</strong>
                    <small>{template.description}</small>
                    <span className="template-card-meta">
                      {template.scope} · {template.items.length} items · {template.category}
                      {template.lastUsedAt && <em>Recently used</em>}
                    </span>
                  </span>
                </button>
                <div className="template-card-actions">
                  <IconButton
                    icon={Star}
                    label={`${template.favorite ? 'Unfavorite' : 'Favorite'} ${template.name}`}
                    className={template.favorite ? 'is-favorite' : ''}
                    onClick={() =>
                      commit({
                        ...data,
                        templates: templates.map((t) =>
                          t.id === template.id ? { ...t, favorite: !t.favorite } : t,
                        ),
                      })
                    }
                  />
                  {context.library && (
                    <>
                      <IconButton
                        icon={Pencil}
                        label={`Edit ${template.name}`}
                        onClick={() => {
                          setDraft(structuredClone(template));
                          setStage('edit');
                          setError('');
                        }}
                      />
                      <IconButton
                        icon={Copy}
                        label={`Duplicate ${template.name} template`}
                        onClick={() => {
                          setDraft({
                            ...structuredClone(template),
                            id: crypto.randomUUID(),
                            name: `${template.name} (copy)`,
                            lastUsedAt: null,
                          });
                          setStage('edit');
                          setError('');
                        }}
                      />
                      <IconButton
                        icon={Download}
                        label={`Export ${template.name}`}
                        onClick={() => void exportTemplate(template)}
                      />
                      <IconButton
                        icon={ArrowUp}
                        label={`Move ${template.name} up`}
                        disabled={templates.indexOf(template) === 0}
                        onClick={() =>
                          reorder(template.id, templates[templates.indexOf(template) - 1].id)
                        }
                      />
                      <IconButton
                        icon={ArrowDown}
                        label={`Move ${template.name} down`}
                        disabled={templates.indexOf(template) === templates.length - 1}
                        onClick={() =>
                          reorder(templates[templates.indexOf(template) + 1].id, template.id)
                        }
                      />
                      <IconButton
                        icon={Trash2}
                        label={`Delete ${template.name}`}
                        onClick={() => {
                          commit({
                            ...data,
                            templates: templates.filter((t) => t.id !== template.id),
                          });
                          notify('Template deleted', () => {
                            const current = useDeck.getState().data;
                            if (!(current.templates || []).some((t) => t.id === template.id))
                              commit({
                                ...current,
                                templates: [...(current.templates || []), template],
                              });
                          });
                        }}
                      />
                      <GripVertical size={13} className="template-drag-hint" />
                    </>
                  )}
                </div>
              </article>
            ))}
          </div>
          {!visible.length && (
            <div className="template-empty">
              <Sparkles size={24} />
              <h3>A little room for your routine.</h3>
              <p>
                {query
                  ? 'Try another search or create your own template.'
                  : 'Create a template to save the setup for next time.'}
              </p>
            </div>
          )}
          <div className="template-library-footer">
            <span>Start small. Skip freely. Make it yours.</span>
            <kbd>⌘ / Ctrl ⇧ N</kbd>
          </div>
        </>
      )}
    </Modal>
  );
}
