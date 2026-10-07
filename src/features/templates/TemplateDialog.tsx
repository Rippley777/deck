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
import { emptyTemplate, builtinTemplates } from '../../lib/template-presets';
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
import { StackGlyph } from '../../components/StackGlyph';
import './templates.css';

export function TemplateDialog() {
  const { data, templateContext: context, setModal, commit, notify, setView, select } = useDeck();
  const templates = data.templates || [];
  const fromSource = !!(context.sourceTaskId || context.sourceStackId);
  const [stage, setStage] = useState<'browse' | 'preview' | 'edit'>(fromSource ? 'edit' : 'browse');
  const [editReturn, setEditReturn] = useState<'browse' | 'preview'>('browse');
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
  const [appearance, setAppearance] = useState<{ icon?: string; color?: string }>({});
  const [error, setError] = useState('');
  const editingTemplate = templates.find((template) => template.id === draft.id);
  const file = useRef<HTMLInputElement>(null);
  useEffect(() => {
    document.querySelector('.templates-modal')?.scrollTo({ top: 0 });
  }, [stage]);
  const close = () => {
    setModal(null);
    if (context.taskId || context.sourceTaskId) select(context.taskId || context.sourceTaskId!);
  };
  function preview(
    template: DeckTemplate,
    overrides = { icon: context.icon, color: context.color },
  ) {
    setAppearance(overrides);
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
  function edit(template: DeckTemplate, copy = false) {
    setDraft({
      ...structuredClone(template),
      ...(copy
        ? { id: crypto.randomUUID(), name: `${template.name} (copy)`, lastUsedAt: null }
        : {}),
    });
    setEditReturn(stage === 'preview' ? 'preview' : 'browse');
    setStage('edit');
    setError('');
  }
  function save(template: DeckTemplate, copy = false) {
    try {
      validateTemplate(template);
      const saved = copy
        ? {
            ...template,
            id: crypto.randomUUID(),
            name:
              template.name.trim() === editingTemplate?.name.trim()
                ? `${template.name.trim()} (copy)`
                : template.name.trim(),
            lastUsedAt: null,
          }
        : template;
      const current = useDeck.getState().data;
      const library = current.templates || [];
      commit({
        ...current,
        templates: library.some((t) => t.id === saved.id)
          ? library.map((t) => (t.id === saved.id ? saved : t))
          : [...library, saved],
      });
      notify(copy ? 'Template copy saved.' : 'Template saved. Ready for next time.');
      const previous = editReturn === 'preview' ? chosen : editingTemplate;
      const overrides = editReturn === 'preview' ? appearance : context;
      const nextAppearance = {
        icon: saved.icon !== previous?.icon ? saved.icon : overrides.icon,
        color: saved.color !== previous?.color ? saved.color : overrides.color,
      };
      if (editReturn === 'preview' && chosen && (!context.taskId || saved.scope === 'checklist')) {
        setSelected(
          saved.items
            .filter((item) => {
              const previous = chosen.items.find((entry) => entry.id === item.id);
              return !previous || previous.selected !== item.selected
                ? item.selected
                : selected.includes(item.id);
            })
            .map((item) => item.id),
        );
        setValues(
          Object.fromEntries(
            saved.variables.map((variable) => {
              const previous = chosen.variables.find((entry) => entry.key === variable.key);
              const value = values[variable.key];
              return [
                variable.key,
                value !== undefined &&
                value !== previous?.defaultValue &&
                (variable.type !== 'select' || variable.options.includes(value))
                  ? value
                  : variable.defaultValue,
              ];
            }),
          ),
        );
        const previousStack = data.stacks.some((stack) => stack.id === chosen.defaultStackId)
          ? chosen.defaultStackId!
          : '';
        if (context.stackId === undefined && stackId === previousStack)
          setStackId(
            data.stacks.some((stack) => stack.id === saved.defaultStackId)
              ? saved.defaultStackId!
              : '',
          );
        setAppearance(nextAppearance);
        setChosen(saved);
        setStage('preview');
      } else if (!context.library && (!context.taskId || saved.scope === 'checklist')) {
        preview(saved, nextAppearance);
      } else {
        setStage('browse');
        setQuery('');
        if (!context.scope) setScope('');
      }
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
          ? editingTemplate
            ? 'Customize template'
            : 'Create a template'
          : stage === 'preview'
            ? 'Make this one yours.'
            : context.library
              ? 'Your templates.'
              : 'New from template'
      }
      description={
        stage === 'edit'
          ? editingTemplate
            ? 'Update the setup for next time, or save your changes as a separate template.'
            : 'Build a starting point you can use again.'
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
          onSaveCopy={editingTemplate ? () => save(draft, true) : undefined}
          saveLabel={editingTemplate ? 'Save changes' : 'Save template'}
          onCancel={() => {
            setStage(editReturn);
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
                ...appearance,
                title,
                stackId: stackId || null,
                values,
                selectedIds: selected,
              });
              commit(result.data);
              setModal(null);
              sessionStorage.removeItem('deck-add-heading');
              if (result.stackId) setView(`stack:${result.stackId}`);
              if (result.taskId) select(result.taskId);
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
          <div className="template-preview-toolbar">
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
            <button type="button" className="secondary-button" onClick={() => edit(chosen)}>
              <Pencil size={14} /> Customize template
            </button>
          </div>
          <div className="template-preview-title">
            <StackGlyph
              icon={chosen.scope === 'stack' ? appearance.icon || chosen.icon : chosen.icon}
              color={chosen.scope === 'stack' ? appearance.color || chosen.color : chosen.color}
              size={27}
            />
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
                  {stackId
                    ? 'Heading title'
                    : chosen.scope === 'stack'
                      ? 'Stack name'
                      : 'Task title'}
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
              {!creatingChecklist && (
                <label>
                  Stack
                  <select
                    className="field"
                    aria-label="Template destination stack"
                    value={stackId}
                    onChange={(e) => setStackId(e.target.value)}
                  >
                    <option value="">{chosen.scope === 'stack' ? 'New stack' : 'No stack'}</option>
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
                    ? stackId
                      ? 'Your cards will go under a new heading in this stack.'
                      : 'Your cards will keep these headings. Everything stays editable.'
                    : stackId
                      ? 'Your cards will go under a new heading in this stack. Checklist items stay inside their parent card.'
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
                : stackId
                  ? 'Add to stack'
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
                setEditReturn('browse');
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
                  <span className="template-card-icon">
                    <StackGlyph icon={template.icon} color={template.color} size={21} />
                  </span>
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
                  <button
                    type="button"
                    className="template-customize"
                    aria-label={`Customize ${template.name}`}
                    onClick={() => edit(template)}
                  >
                    <Pencil size={13} /> Customize
                  </button>
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
                        icon={Copy}
                        label={`Duplicate ${template.name} template`}
                        onClick={() => edit(template, true)}
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
              <h3>{query ? 'No matching templates.' : 'No templates yet.'}</h3>
              <p>
                {query
                  ? 'Try another search or create your own template.'
                  : 'Create a template to save the setup for next time.'}
              </p>
              {!templates.length && !query && (
                <button
                  className="secondary-button"
                  onClick={() =>
                    commit({ ...useDeck.getState().data, templates: builtinTemplates() })
                  }
                >
                  Add starter templates
                </button>
              )}
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
