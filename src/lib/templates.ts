import type { DeckData, DeckTemplate, TemplateContext, Task } from '../types';
import { makeTask } from './seed';
import { builtinTemplates, emptyTemplate, emptyTemplateItem } from './template-presets';

export function withTemplates(data: DeckData): DeckData {
  if (!data.templates) return { ...data, templates: builtinTemplates() };
  if (data.templates.every((template) => /^#[\da-f]{6}$/i.test(template.color))) return data;
  return {
    ...data,
    templates: data.templates.map((template) =>
      /^#[\da-f]{6}$/i.test(template.color) ? template : { ...template, color: '#b5a0d5' },
    ),
  };
}
export const interpolate = (text: string, values: Record<string, string>) =>
  text.replace(
    /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g,
    (match, key: string) => values[key]?.trim() || match,
  );
export const visibleTemplateItems = (template: DeckTemplate, values: Record<string, string>) =>
  template.items.filter(
    (item) => !item.condition || values[item.condition.variable] === item.condition.equals,
  );
export function templateMatches(template: DeckTemplate, query: string) {
  const text =
    `${template.name} ${template.category} ${template.description} ${template.tags.join(' ')}`.toLowerCase();
  return query
    .toLowerCase()
    .trim()
    .split(/\s+/)
    .every((word) => {
      let at = 0;
      for (const char of text) if (char === word[at]) at++;
      return at === word.length;
    });
}
export function validateTemplate(template: DeckTemplate) {
  if (!template.name.trim()) throw new Error('Give this template a name.');
  if (!template.title.trim()) throw new Error('Add a title for the generated stack or task.');
  if (!template.items.length && template.scope !== 'task')
    throw new Error('Add at least one item.');
  const ids = new Set(template.items.map((item) => item.id));
  if (ids.size !== template.items.length) throw new Error('Template item IDs must be unique.');
  const variables = new Set(template.variables.map((variable) => variable.key));
  if (variables.size !== template.variables.length)
    throw new Error('Variable keys must be unique.');
  for (const variable of template.variables) {
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(variable.key) || !variable.label.trim())
      throw new Error('Give every variable a label and a key such as project_name.');
    if (
      variable.type === 'select' &&
      (!variable.options.length ||
        (variable.defaultValue && !variable.options.includes(variable.defaultValue)))
    )
      throw new Error(`Check the options and default for ${variable.label}.`);
  }
  const strings = [template.title, template.notes, ...template.tags, ...template.headings];
  for (const item of template.items) {
    if (!item.title.trim()) throw new Error('Give every item a title.');
    strings.push(item.title, item.notes, item.heading, ...item.tags);
    if (template.scope === 'checklist' && item.kind !== 'checklist')
      throw new Error('Checklist templates can only contain checklist items.');
    if (item.kind === 'checklist' && item.blockedBy.length)
      throw new Error('Use a task or milestone for dependencies.');
    if (template.scope === 'stack' && item.kind === 'checklist' && !item.parentId)
      throw new Error(`Choose a parent task for “${item.title}”.`);
    for (const ref of [...item.blockedBy, ...(item.parentId ? [item.parentId] : [])]) {
      const target = template.items.find((other) => other.id === ref);
      if (!target || target.id === item.id || target.kind === 'checklist')
        throw new Error(`Check the parent and dependencies of “${item.title}”.`);
    }
    if (item.condition) {
      const variable = template.variables.find((v) => v.key === item.condition!.variable);
      if (
        !variable ||
        !item.condition.equals ||
        (variable.type === 'select' && !variable.options.includes(item.condition.equals))
      )
        throw new Error(`Check the condition on “${item.title}”.`);
    }
  }
  for (const text of strings)
    for (const match of text.matchAll(/\{\{\s*([^{}]+?)\s*\}\}/g)) {
      if (!variables.has(match[1]))
        throw new Error(`Define the variable “${match[1]}” before saving.`);
    }
  for (const relation of ['blockedBy', 'parentId'] as const) {
    const visiting = new Set<string>(),
      visited = new Set<string>();
    const visit = (id: string) => {
      if (visiting.has(id))
        throw new Error(
          `The ${relation === 'blockedBy' ? 'dependencies' : 'parent tasks'} contain a loop.`,
        );
      if (visited.has(id)) return;
      visiting.add(id);
      const item = template.items.find((entry) => entry.id === id)!;
      const refs = relation === 'blockedBy' ? item.blockedBy : item.parentId ? [item.parentId] : [];
      refs.forEach(visit);
      visiting.delete(id);
      visited.add(id);
    };
    template.items.forEach((item) => visit(item.id));
  }
}
export interface ApplyTemplateOptions extends TemplateContext {
  selectedIds: string[];
  values: Record<string, string>;
}
export function generateFromTemplate(
  data: DeckData,
  template: DeckTemplate,
  options: ApplyTemplateOptions,
) {
  validateTemplate(template);
  const values = Object.fromEntries(
    template.variables.map((v) => [v.key, options.values[v.key] ?? v.defaultValue]),
  );
  const items = visibleTemplateItems(template, values).filter((item) =>
    options.selectedIds.includes(item.id),
  );
  if (!items.length && !(template.scope === 'task' && !template.items.length))
    throw new Error('Select at least one item to create.');
  const replace = (text: string) => interpolate(text, values);
  const title = options.title?.trim() || replace(template.title);
  const used = [
    title,
    template.notes,
    ...template.tags,
    ...template.headings,
    ...items.flatMap((item) => [item.title, item.notes, item.heading, ...item.tags]),
  ].join('\n');
  for (const variable of template.variables) {
    if (
      (variable.required ||
        used.includes(`{{${variable.key}}}`) ||
        new RegExp(`\\{\\{\\s*${variable.key}\\s*\\}\\}`).test(used)) &&
      !values[variable.key]?.trim()
    )
      throw new Error(`Enter ${variable.label.toLowerCase()}.`);
    if (
      values[variable.key] &&
      variable.type === 'select' &&
      !variable.options.includes(values[variable.key])
    )
      throw new Error(`Choose a valid ${variable.label.toLowerCase()}.`);
  }
  // Any value used by a selected item must be resolved, even for optional variables.
  if (/\{\{[^{}]+\}\}/.test(replace(used)))
    throw new Error('Fill in the variables used by your selected items.');
  const existing = options.taskId
    ? data.tasks.find((task) => task.id === options.taskId)
    : undefined;
  if (options.taskId && (!existing || template.scope !== 'checklist'))
    throw new Error('The destination card is no longer available.');
  const requestedStack = options.stackId !== undefined ? options.stackId : template.defaultStackId;
  let stackId =
    existing?.stackId ??
    (data.stacks.some((stack) => stack.id === requestedStack) ? requestedStack : null);
  const stacks = [...data.stacks];
  const destinationStack =
    !existing && stackId ? data.stacks.find((stack) => stack.id === stackId) : undefined;
  const addToStack =
    destinationStack && (template.scope !== 'stack' || options.stackId !== undefined);
  let templateHeading: string | undefined;
  if (addToStack) {
    const headings = new Set(['Cards', ...destinationStack.headings]);
    templateHeading = title;
    for (let suffix = 2; headings.has(templateHeading); suffix++)
      templateHeading = `${title} (${suffix})`;
    stacks[stacks.indexOf(destinationStack)] = {
      ...destinationStack,
      headings: [...destinationStack.headings, templateHeading],
    };
  } else if (template.scope === 'stack') {
    stackId = crypto.randomUUID();
    stacks.push({
      id: stackId,
      name: title,
      icon: options.icon || template.icon,
      color: options.color || template.color,
      notes: replace(template.notes),
      deadline: null,
      headings: [
        ...new Set(
          [...template.headings, ...items.map((item) => item.heading)].filter(Boolean).map(replace),
        ),
      ],
      links: [],
    });
  }
  const root =
    template.scope !== 'stack' && !existing
      ? makeTask(title, {
          stackId,
          destination: stackId ? 'anytime' : data.settings.defaultDestination,
          notes: replace(template.notes),
          tags: [...new Set([...template.tags.map(replace), ...(options.tags || [])])],
          priority: template.priority,
          effort: template.effort,
          scheduled: options.scheduled ?? null,
          heading: templateHeading || options.heading || '',
        })
      : undefined;
  const taskIds = new Map(
    items.filter((item) => item.kind !== 'checklist').map((item) => [item.id, crypto.randomUUID()]),
  );
  const baseOrder = Date.now();
  const generated: Task[] = items
    .filter((item) => item.kind !== 'checklist')
    .map((item, index) =>
      makeTask(replace(item.title), {
        id: taskIds.get(item.id)!,
        stackId,
        kind: item.kind === 'milestone' ? 'milestone' : 'task',
        heading: templateHeading || replace(item.heading) || options.heading || '',
        notes: replace(item.notes),
        tags: [
          ...new Set([
            ...template.tags.map(replace),
            ...item.tags.map(replace),
            ...(options.tags || []),
          ]),
        ],
        effort: item.effort,
        priority: item.priority,
        parentId: (item.parentId ? taskIds.get(item.parentId) : null) || root?.id || null,
        blockedBy: item.blockedBy.flatMap((id) => (taskIds.has(id) ? [taskIds.get(id)!] : [])),
        order: baseOrder + index,
        scheduled: options.scheduled ?? null,
        destination: stackId ? 'anytime' : data.settings.defaultDestination,
      }),
    );
  if (root) generated.unshift(root);
  const updatedExisting = existing
    ? { ...existing, checklist: [...existing.checklist], updatedAt: new Date().toISOString() }
    : undefined;
  for (const item of items.filter((item) => item.kind === 'checklist')) {
    const parent = item.parentId
      ? generated.find((task) => task.id === taskIds.get(item.parentId!))
      : root || updatedExisting;
    if (!parent) throw new Error(`Select the parent task to include “${replace(item.title)}”.`);
    parent.checklist.push({ id: crypto.randomUUID(), title: replace(item.title), done: false });
  }
  return {
    data: {
      ...data,
      stacks,
      tasks: [
        ...data.tasks.map((task) => (task.id === updatedExisting?.id ? updatedExisting : task)),
        ...generated,
      ],
      templates: (data.templates || []).map((entry) =>
        entry.id === template.id ? { ...entry, lastUsedAt: new Date().toISOString() } : entry,
      ),
    } as DeckData,
    stackId,
    taskId: root?.id || existing?.id,
    count: items.length,
  };
}

/** Import only known fields, then validate references before touching the workspace. */
export function parseTemplateImport(content: string): DeckTemplate[] {
  const parsed = JSON.parse(content);
  if (parsed.version !== 1 || parsed.kind !== 'deck-templates' || !Array.isArray(parsed.templates))
    throw new Error('Choose a Deck template export (version 1).');
  if (!parsed.templates.length || parsed.templates.length > 200)
    throw new Error('Import between 1 and 200 templates at a time.');
  const string = (v: unknown) => (typeof v === 'string' ? v : '');
  const strings = (v: unknown) =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  const priority = (v: unknown) =>
    ([0, 1, 2, 3].includes(Number(v)) ? Number(v) : 0) as Task['priority'];
  const effort = (v: unknown) =>
    Number.isFinite(Number(v)) && Number(v) >= 0 ? Math.min(Number(v), 100000) : 25;
  return parsed.templates.map((raw: Record<string, unknown>) => {
    if (
      !raw ||
      !['stack', 'task', 'checklist'].includes(string(raw.scope)) ||
      !Array.isArray(raw.items) ||
      raw.items.length > 500 ||
      !Array.isArray(raw.variables)
    )
      throw new Error('Invalid template structure.');
    const template: DeckTemplate = {
      ...emptyTemplate(),
      id: string(raw.id) || crypto.randomUUID(),
      name: string(raw.name),
      description: string(raw.description),
      icon: string(raw.icon) || '▱',
      color: /^#[\da-f]{6}$/i.test(string(raw.color)) ? string(raw.color) : '#b5a0d5',
      category: string(raw.category) || 'Custom',
      scope: raw.scope as DeckTemplate['scope'],
      title: string(raw.title),
      notes: string(raw.notes),
      tags: strings(raw.tags),
      headings: strings(raw.headings),
      defaultStackId: string(raw.defaultStackId) || null,
      priority: priority(raw.priority),
      effort: effort(raw.effort),
      favorite: raw.favorite === true,
      lastUsedAt:
        typeof raw.lastUsedAt === 'string' && Number.isFinite(Date.parse(raw.lastUsedAt))
          ? raw.lastUsedAt
          : null,
      variables: raw.variables.map((v) => {
        if (!v || typeof v !== 'object') throw new Error('Invalid variable.');
        return {
          key: string(v.key),
          label: string(v.label),
          required: v.required === true,
          type: v.type === 'select' ? 'select' : 'text',
          options: strings(v.options),
          defaultValue: string(v.defaultValue),
        };
      }),
      items: raw.items.map((item) => {
        if (
          !item ||
          typeof item !== 'object' ||
          !['task', 'subtask', 'checklist', 'milestone'].includes(item.kind)
        )
          throw new Error('Invalid template item.');
        return {
          id: string(item.id) || crypto.randomUUID(),
          title: string(item.title),
          kind: item.kind,
          heading: string(item.heading),
          notes: string(item.notes),
          tags: strings(item.tags),
          effort: effort(item.effort),
          priority: priority(item.priority),
          selected: item.selected !== false,
          parentId: string(item.parentId) || null,
          blockedBy: strings(item.blockedBy),
          ...(item.condition
            ? {
                condition: {
                  variable: string(item.condition.variable),
                  equals: string(item.condition.equals),
                },
              }
            : {}),
        };
      }),
    };
    validateTemplate(template);
    return template;
  });
}
export const serializeTemplates = (templates: DeckTemplate[]) =>
  JSON.stringify({ kind: 'deck-templates', version: 1, templates }, null, 2);
export function templateFromSource(data: DeckData, context: TemplateContext): DeckTemplate {
  const stack = data.stacks.find((s) => s.id === context.sourceStackId);
  const root = data.tasks.find((task) => task.id === context.sourceTaskId);
  const template = emptyTemplate();
  if (!stack && !root) return template;
  template.name = stack?.name || root!.title;
  template.title = template.name;
  template.variables = [];
  template.notes = stack?.notes || root?.notes || '';
  template.scope = stack ? 'stack' : 'task';
  template.icon = stack?.icon || '▱';
  template.color = stack?.color || '#b5a0d5';
  template.headings = [...(stack?.headings || [])];
  template.tags = [...(root?.tags || [])];
  template.effort = root?.effort ?? 25;
  template.priority = root?.priority ?? 0;
  template.defaultStackId = root?.stackId || null;
  const included = new Set<string>();
  if (root) included.add(root.id);
  for (let changed = true; changed;) {
    changed = false;
    for (const task of data.tasks)
      if (
        !included.has(task.id) &&
        (stack ? task.stackId === stack.id : !!task.parentId && included.has(task.parentId))
      ) {
        included.add(task.id);
        changed = true;
      }
  }
  const tasks = data.tasks
    .filter((task) => included.has(task.id) && task.id !== root?.id)
    .sort((a, b) => a.order - b.order);
  const ids = new Set(tasks.map((task) => task.id));
  template.items = tasks.flatMap((task) => [
    {
      ...emptyTemplateItem(task.title),
      id: task.id,
      kind:
        task.kind === 'milestone'
          ? ('milestone' as const)
          : task.parentId
            ? ('subtask' as const)
            : ('task' as const),
      notes: task.notes,
      tags: [...task.tags],
      effort: task.effort,
      priority: task.priority,
      heading: task.heading,
      parentId: ids.has(task.parentId || '') ? task.parentId : null,
      blockedBy: task.blockedBy.filter((id) => ids.has(id)),
    },
    ...task.checklist.map((item) => ({
      ...emptyTemplateItem(item.title),
      kind: 'checklist' as const,
      parentId: task.id,
    })),
  ]);
  if (root)
    template.items.push(
      ...root.checklist.map((item) => ({
        ...emptyTemplateItem(item.title),
        kind: 'checklist' as const,
      })),
    );
  return template;
}
