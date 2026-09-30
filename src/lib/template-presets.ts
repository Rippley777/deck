import type { DeckTemplate, TemplateItem, TemplateScope, TemplateVariable } from '../types';
export const projectVariable: TemplateVariable = {
  key: 'project_name',
  label: 'Project name',
  required: true,
  type: 'text',
  options: [],
  defaultValue: '',
};
export function emptyTemplate(): DeckTemplate {
  return {
    id: crypto.randomUUID(),
    name: '',
    description: '',
    icon: '▱',
    category: 'Custom',
    scope: 'stack',
    title: '{{project_name}}',
    notes: '',
    tags: [],
    effort: 25,
    priority: 0,
    defaultStackId: null,
    headings: [],
    variables: [{ ...projectVariable }],
    items: [],
    favorite: false,
    lastUsedAt: null,
  };
}
export function emptyTemplateItem(title = ''): TemplateItem {
  return {
    id: crypto.randomUUID(),
    title,
    kind: 'task',
    heading: '',
    notes: '',
    tags: [],
    effort: 25,
    priority: 0,
    selected: true,
    parentId: null,
    blockedBy: [],
  };
}
function preset(
  id: string,
  name: string,
  description: string,
  scope: TemplateScope,
  titles: string[],
  headings: string[],
  icon = '▱',
): DeckTemplate {
  return {
    ...emptyTemplate(),
    id: `builtin-${id}`,
    name,
    description,
    category: 'Software',
    scope,
    icon,
    title: scope === 'stack' ? '{{project_name}}' : `${name}: {{project_name}}`,
    tags: ['software'],
    headings,
    items: titles.map((title, i) => ({
      ...emptyTemplateItem(title),
      id: `${id}-${i}`,
      heading: headings[Math.min(Math.floor(i / 3), headings.length - 1)] || '',
      kind: scope === 'task' ? 'subtask' : scope === 'checklist' ? 'checklist' : 'task',
      blockedBy: scope !== 'checklist' && i > 0 ? [`${id}-${i - 1}`] : [],
    })),
  };
}
export function builtinTemplates(): DeckTemplate[] {
  const software = preset(
    'software',
    'Software Project',
    'From an empty repository to a project ready to ship.',
    'stack',
    [
      'Create repository for {{project_name}}',
      'Initialize project',
      'Create README',
      'Add license',
      'Configure linting',
      'Configure formatting',
      'Configure CI/CD',
      'Configure environment variables',
      'Configure deployment',
      'Add monitoring',
      'Add error tracking',
    ],
    ['Setup', 'Code quality', 'Infrastructure', 'Launch'],
    '◈',
  );
  software.favorite = true;
  software.items.forEach((item, i) => {
    item.selected = i < 9;
  });
  const feature = preset(
    'feature',
    'New Feature',
    'A clear path from requirements to verified production.',
    'task',
    [
      'Define requirements',
      'Create branch',
      'Implement feature',
      'Add tests',
      'Update documentation',
      'Create pull request',
      'Review',
      'Deploy',
      'Verify production',
    ],
    [],
    '✳',
  );
  const bug = preset(
    'bug',
    'Bug Fix',
    'Reproduce, understand, fix, and verify.',
    'task',
    [
      'Reproduce issue',
      'Identify root cause',
      'Write failing test',
      'Implement fix',
      'Run regression tests',
      'Create pull request',
      'Deploy',
      'Verify fix',
    ],
    [],
    '⌕',
  );
  const launch = preset(
    'launch',
    'App Launch',
    'The last checks between your app and the world.',
    'task',
    [
      'Production build',
      'Environment variables',
      'Database migration',
      'Deploy backend',
      'Deploy frontend',
      'Configure domain',
      'Verify SSL',
      'Test authentication',
      'Smoke test',
      'Add monitoring',
      'Update documentation',
      'Update portfolio',
    ],
    [],
    '↗',
  );
  launch.items.at(-1)!.kind = 'milestone';
  const deploy = preset(
    'deployment',
    'App Deployment',
    'A short deployment plan tailored to your provider.',
    'stack',
    [
      'Create Azure resource',
      'Configure Azure deployment credentials',
      'Configure App Service for {{project_name}}',
      'Add Azure environment variables',
      'Create Cloudflare project',
      'Configure Cloudflare DNS',
      'Configure Worker/Pages deployment',
      'Create AWS deployment environment',
      'Configure AWS deployment credentials',
      'Provision self-hosted server',
      'Configure reverse proxy',
      'Deploy {{project_name}}',
      'Verify production',
    ],
    ['Infrastructure', 'Deployment'],
    '☁',
  );
  deploy.variables.push({
    key: 'provider',
    label: 'Deployment provider',
    required: true,
    type: 'select',
    options: ['Azure', 'AWS', 'Cloudflare', 'Self-hosted'],
    defaultValue: 'Azure',
  });
  deploy.items.forEach((item, i) => {
    item.heading = i < 11 ? 'Infrastructure' : 'Deployment';
    item.blockedBy = i === 12 ? ['deployment-11'] : [];
    if (i < 11)
      item.condition = {
        variable: 'provider',
        equals: i < 4 ? 'Azure' : i < 7 ? 'Cloudflare' : i < 9 ? 'AWS' : 'Self-hosted',
      };
  });
  deploy.items[11].blockedBy = ['deployment-3', 'deployment-6', 'deployment-8', 'deployment-10'];
  const website = preset(
    'website',
    'Website Launch',
    'Content, hosting, and the finishing touches.',
    'stack',
    [
      'Define audience and pages',
      'Write content',
      'Build {{project_name}}',
      'Review accessibility',
      'Check mobile layouts',
      'Set up hosting',
      'Point {{domain}} to production',
      'Verify SSL',
      'Launch website',
      'Add analytics',
    ],
    ['Plan', 'Build', 'Launch'],
    '◉',
  );
  website.variables.push({
    key: 'domain',
    label: 'Domain',
    required: false,
    type: 'text',
    options: [],
    defaultValue: '',
  });
  website.items[6].selected = false;
  website.items[9].selected = false;
  website.items[8].kind = 'milestone';
  const release = preset(
    'release',
    'Open Source Release',
    'Prepare a release that others can use and contribute to.',
    'stack',
    [
      'Review open issues',
      'Run tests',
      'Update changelog',
      'Update documentation',
      'Check license',
      'Tag release',
      'Publish {{project_name}}',
      'Announce release',
    ],
    ['Prepare', 'Package', 'Publish'],
    '◇',
  );
  release.items[6].kind = 'milestone';
  const home = preset(
    'home',
    'Home Project',
    'Make room for a small improvement at home.',
    'stack',
    [
      'Define the outcome',
      'Measure and plan',
      'Set a budget',
      'Gather supplies',
      'Do the work',
      'Clean up and enjoy',
    ],
    ['Plan', 'Make it happen'],
    '⌂',
  );
  home.category = 'Life';
  home.tags = ['home'];
  const trip = preset(
    'trip',
    'Trip Planning',
    'A little planning for a better time away.',
    'stack',
    [
      'Choose dates and destination',
      'Set a budget',
      'Book transportation',
      'Book accommodation',
      'Plan a few activities',
      'Check travel documents',
      'Pack essentials',
      'Save offline maps',
    ],
    ['Plan', 'Prepare', 'Before you go'],
    '☀',
  );
  trip.category = 'Life';
  trip.tags = ['travel'];
  const checklist = preset(
    'checklist',
    'Deploy Checklist',
    'A reusable final pass before and after every deploy.',
    'checklist',
    [
      'Run tests',
      'Build production',
      'Verify environment variables',
      'Deploy',
      'Check logs',
      'Smoke test',
      'Verify analytics',
    ],
    [],
    '☑',
  );
  checklist.variables = [];
  checklist.title = 'Deploy checklist';
  checklist.items.at(-1)!.selected = false;
  return [software, feature, bug, launch, deploy, website, release, home, trip, checklist];
}
