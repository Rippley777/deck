import { describe, expect, it } from 'vitest';
import { seedData } from '../src/lib/seed';
import { builtinTemplates, emptyTemplateItem } from '../src/lib/template-presets';
import {
  generateFromTemplate,
  parseTemplateImport,
  serializeTemplates,
  templateFromSource,
  templateMatches,
  validateTemplate,
  withTemplates,
} from '../src/lib/templates';
import { initialFilters, projectGraph } from '../src/features/graph/model';
import { importData } from '../src/lib/transfer';
const workspace = () => withTemplates(seedData());
const preset = (name: string) => builtinTemplates().find((t) => t.name === name)!;
const options = (template: ReturnType<typeof preset>) => ({
  selectedIds: template.items.filter((i) => i.selected).map((i) => i.id),
  values: { project_name: 'Repo Reaper' },
});
describe('template generation', () => {
  it('migrates old workspaces once and keeps an intentionally empty library', () => {
    expect(workspace().templates).toHaveLength(10);
    expect(withTemplates({ ...seedData(), templates: [] }).templates).toEqual([]);
    builtinTemplates().forEach(validateTemplate);
  });
  it('adds colors to saved templates without replacing the library or its customizations', () => {
    const legacy = JSON.parse(JSON.stringify(workspace()));
    delete legacy.templates[0].color;
    legacy.templates[0].icon = '🛠';
    legacy.templates[0].favorite = true;
    legacy.templates[1].color = '#123abc';
    const migrated = withTemplates(legacy);
    expect(migrated.templates).toHaveLength(legacy.templates.length);
    expect(migrated.templates![0]).toEqual({ ...legacy.templates[0], color: '#b5a0d5' });
    expect(migrated.templates![1].color).toBe('#123abc');
    expect(legacy.templates[0].color).toBeUndefined();
    expect(withTemplates(migrated)).toBe(migrated);
    const generated = generateFromTemplate(
      migrated,
      migrated.templates![0],
      options(migrated.templates![0]),
    );
    expect(generated.data.stacks.at(-1)).toMatchObject({ icon: '🛠', color: '#b5a0d5' });
  });
  it('creates only reviewed cards and remaps dependencies into the generated stack and graph', () => {
    const data = workspace(),
      template = preset('Software Project');
    const selection = template.items.slice(0, 3).map((i) => i.id);
    const result = generateFromTemplate(data, template, {
      ...options(template),
      selectedIds: selection,
    });
    const cards = result.data.tasks.filter((t) => t.stackId === result.stackId);
    expect(cards.map((t) => t.title)).toEqual([
      'Create repository for Repo Reaper',
      'Initialize project',
      'Create README',
    ]);
    expect(cards[1].blockedBy).toEqual([cards[0].id]);
    expect(result.data.stacks.at(-1)?.headings).toContain('Infrastructure');
    expect(
      projectGraph(result.data, initialFilters).some(
        (e) =>
          e.data.source === cards[1].id &&
          e.data.target === cards[0].id &&
          e.data.relation === 'blocked by',
      ),
    ).toBe(true);
    expect(data.tasks).toHaveLength(22);
    const again = generateFromTemplate(result.data, template, {
      ...options(template),
      selectedIds: selection,
    });
    expect(new Set(again.data.tasks.map((t) => t.id)).size).toBe(again.data.tasks.length);
  });
  it('drops deselected prerequisites and excludes provider branches even if checked', () => {
    const template = preset('App Deployment');
    const result = generateFromTemplate(workspace(), template, {
      ...options(template),
      values: { project_name: 'Repo Reaper', provider: 'Cloudflare' },
    });
    const cards = result.data.tasks.filter((t) => t.stackId === result.stackId);
    expect(cards).toHaveLength(5);
    expect(cards.some((t) => /Azure|AWS|self-hosted/i.test(t.title))).toBe(false);
    expect(cards.find((t) => t.title === 'Deploy Repo Reaper')!.blockedBy).toEqual([
      cards.find((t) => t.title === 'Configure Worker/Pages deployment')!.id,
    ]);
    const software = preset('Software Project');
    const only = generateFromTemplate(workspace(), software, {
      ...options(software),
      selectedIds: [software.items[2].id],
    });
    expect(only.data.tasks.at(-1)!.blockedBy).toEqual([]);
  });
  it('requires selected variable values, accepts omitted optional items, and substitutes literally', () => {
    const template = preset('Website Launch');
    expect(() => generateFromTemplate(workspace(), template, options(template))).not.toThrow();
    expect(() =>
      generateFromTemplate(workspace(), template, {
        ...options(template),
        selectedIds: template.items.map((i) => i.id),
      }),
    ).toThrow('domain');
    expect(() =>
      generateFromTemplate(workspace(), template, { ...options(template), values: {} }),
    ).toThrow('project name');
    expect(() =>
      generateFromTemplate(workspace(), template, { ...options(template), selectedIds: [] }),
    ).toThrow('Select');
    const result = generateFromTemplate(workspace(), template, {
      ...options(template),
      values: { project_name: '$& hello' },
    });
    expect(result.data.stacks.at(-1)!.name).toBe('$& hello');
  });
  it('creates parent tasks with child cards, nested checklists, and milestones', () => {
    const template = preset('New Feature');
    template.items = template.items.slice(0, 2);
    template.items[1].kind = 'milestone';
    template.items.push({
      ...emptyTemplateItem('Nested check'),
      kind: 'checklist',
      parentId: template.items[0].id,
    });
    const result = generateFromTemplate(workspace(), template, options(template));
    const children = result.data.tasks.filter((t) => t.parentId === result.taskId);
    expect(children).toHaveLength(2);
    expect(children[0].checklist[0].title).toBe('Nested check');
    expect(children[1].kind).toBe('milestone');
    expect(result.data.tasks.find((t) => t.id === result.taskId)?.title).toBe(
      'New Feature: Repo Reaper',
    );
    expect(() =>
      generateFromTemplate(workspace(), template, {
        ...options(template),
        selectedIds: [template.items[2].id],
      }),
    ).toThrow('parent task');
  });
  it('allows a saved single-card template with no starter items', () => {
    const data = workspace();
    const template = templateFromSource(data, { sourceTaskId: 'auth' });
    const result = generateFromTemplate(data, template, { values: {}, selectedIds: [] });
    const task = result.data.tasks.find((t) => t.id === result.taskId)!;
    expect(task.title).toBe(data.tasks.find((t) => t.id === 'auth')!.title);
    expect(task.notes).toBe(data.tasks.find((t) => t.id === 'auth')!.notes);
    expect(result.data.tasks.length).toBe(data.tasks.length + 1);
  });
  it('inserts into an existing checklist without replacing it or making extra cards', () => {
    const data = workspace(),
      template = preset('Deploy Checklist');
    const original = data.tasks.find((t) => t.id === 'deploy')!;
    const result = generateFromTemplate(data, template, {
      ...options(template),
      taskId: original.id,
    });
    const updated = result.data.tasks.find((t) => t.id === original.id)!;
    expect(result.data.tasks).toHaveLength(data.tasks.length);
    expect(updated.checklist).toHaveLength(original.checklist.length + 6);
    expect(updated.checklist.slice(0, original.checklist.length)).toEqual(original.checklist);
    expect(original.checklist).toHaveLength(3);
  });
});
describe('template library safety', () => {
  it('rejects cycles, missing variables, invalid references, and malformed imports', () => {
    const template = preset('Software Project');
    template.items[0].blockedBy = [template.items[1].id];
    expect(() => validateTemplate(template)).toThrow('loop');
    template.items[0].blockedBy = ['missing'];
    expect(() => parseTemplateImport(serializeTemplates([template]))).toThrow('dependencies');
    template.items[0].blockedBy = [];
    template.variables = [];
    expect(() => validateTemplate(template)).toThrow('project_name');
    expect(() => parseTemplateImport('{"templates":[]}')).toThrow('export');
  });
  it('round trips standalone and workspace exports with dependencies and milestones', () => {
    const data = workspace();
    data.templates![0].lastUsedAt = new Date().toISOString();
    expect(parseTemplateImport(serializeTemplates(data.templates!))).toEqual(data.templates);
    const imported = importData(JSON.stringify(data), 'json', data);
    expect(imported.templates).toEqual(data.templates);
  });
  it('preserves stack appearance through templates, export, import, and generation', () => {
    const data = workspace();
    const stack = data.stacks.find((entry) => entry.id === 'oddware')!;
    stack.icon = 'lucide:flower';
    stack.color = '#123abc';
    const template = templateFromSource(data, { sourceStackId: stack.id });
    const [imported] = parseTemplateImport(serializeTemplates([template]));
    const result = generateFromTemplate(data, imported, {
      values: {},
      selectedIds: imported.items.map((item) => item.id),
    });
    expect(result.data.stacks.at(-1)).toMatchObject({ icon: stack.icon, color: stack.color });
    const overridden = generateFromTemplate(data, imported, {
      values: {},
      selectedIds: imported.items.map((item) => item.id),
      icon: 'lucide:bike',
      color: '#91b49a',
    });
    expect(overridden.data.stacks.at(-1)).toMatchObject({ icon: 'lucide:bike', color: '#91b49a' });
  });
  it('captures existing stack cards and checklists without preserving completion state', () => {
    const data = workspace();
    const template = templateFromSource(data, { sourceStackId: 'oddware' });
    validateTemplate(template);
    const result = generateFromTemplate(data, template, {
      values: {},
      selectedIds: template.items.map((i) => i.id),
    });
    const cards = result.data.tasks.filter((t) => t.stackId === result.stackId);
    expect(cards).toHaveLength(data.tasks.filter((t) => t.stackId === 'oddware').length);
    expect(cards.every((t) => !t.completedAt && t.checklist.every((c) => !c.done))).toBe(true);
    expect(cards.find((t) => t.title === 'Deploy Repo Reaper')?.checklist).toHaveLength(3);
  });
  it('supports abbreviated and category-based searches', () => {
    expect(templateMatches(preset('Software Project'), 'sftwr prj')).toBe(true);
    expect(templateMatches(preset('Bug Fix'), 'software')).toBe(true);
    expect(templateMatches(preset('Trip Planning'), 'software')).toBe(false);
  });
});
