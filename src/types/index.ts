export type Destination = 'inbox' | 'anytime' | 'someday';
export type View =
  'today' | 'inbox' | 'upcoming' | 'anytime' | 'someday' | 'logbook' | 'graph' | `stack:${string}`;
export interface ChecklistItem {
  id: string;
  title: string;
  done: boolean;
}
export interface Task {
  kind?: 'task' | 'milestone';
  id: string;
  title: string;
  notes: string;
  stackId: string | null;
  heading: string;
  tags: string[];
  scheduled: string | null;
  deadline: string | null;
  time: string | null;
  destination: Destination;
  priority: 0 | 1 | 2 | 3;
  recurrence: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
  checklist: ChecklistItem[];
  links: string[];
  blockedBy: string[];
  parentId: string | null;
  effort: number;
  order: number;
}
export interface Stack {
  id: string;
  name: string;
  icon: string;
  color: string;
  notes: string;
  deadline: string | null;
  headings: string[];
  links: string[];
}
export interface Goal {
  id: string;
  title: string;
  stackIds: string[];
}
export interface Settings {
  theme: 'dark' | 'light' | 'system';
  startOfWeek: 0 | 1;
  defaultDestination: Destination;
  dateFormat: 'friendly' | 'iso';
  clock24: boolean;
  sound: boolean;
  animations: boolean;
  backupFrequency: 'daily' | 'weekly';
  layout: 'force' | 'hierarchy' | 'radial' | 'timeline';
}
export interface DeckData {
  cloudPristine?: boolean;
  cloud?: {
    userId: string;
    version: number;
    base: Omit<DeckData, 'cloud'>;
    recovery?: Omit<DeckData, 'cloud'>[];
  };
  version: 1;
  tasks: Task[];
  stacks: Stack[];
  goals: Goal[];
  headings: string[];
  settings: Settings;
  templates?: DeckTemplate[];
}
export type TemplateScope = 'stack' | 'task' | 'checklist';
export interface TemplateVariable {
  key: string;
  label: string;
  required: boolean;
  type: 'text' | 'select';
  options: string[];
  defaultValue: string;
}
export interface TemplateItem {
  id: string;
  title: string;
  kind: 'task' | 'subtask' | 'checklist' | 'milestone';
  heading: string;
  notes: string;
  tags: string[];
  effort: number;
  priority: Task['priority'];
  selected: boolean;
  parentId: string | null;
  blockedBy: string[];
  condition?: { variable: string; equals: string };
}
export interface DeckTemplate {
  id: string;
  name: string;
  description: string;
  icon: string;
  color: string;
  category: string;
  scope: TemplateScope;
  title: string;
  notes: string;
  tags: string[];
  effort: number;
  priority: Task['priority'];
  defaultStackId: string | null;
  headings: string[];
  variables: TemplateVariable[];
  items: TemplateItem[];
  favorite: boolean;
  lastUsedAt: string | null;
}
export interface TemplateContext {
  scope?: TemplateScope;
  title?: string;
  stackId?: string | null;
  taskId?: string;
  scheduled?: string | null;
  heading?: string;
  tags?: string[];
  icon?: string;
  color?: string;
  library?: boolean;
  sourceTaskId?: string;
  sourceStackId?: string;
}
export const defaultSettings: Settings = {
  theme: 'dark',
  startOfWeek: 1,
  defaultDestination: 'inbox',
  dateFormat: 'friendly',
  clock24: false,
  sound: false,
  animations: true,
  backupFrequency: 'daily',
  layout: 'force',
};
