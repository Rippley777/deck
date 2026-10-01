import { z } from 'zod';
const id = z.string().min(1).max(200);
const text = z.string().max(1000000);
const strings = z.array(z.string().max(1000)).max(10000);
const nullable = z.string().max(200).nullable();
const priority = z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]);
export const deckSchema = z
  .object({
    version: z.literal(1),
    tasks: z
      .array(
        z.object({
          id,
          kind: z.enum(['task', 'milestone']).optional(),
          title: text,
          notes: text,
          stackId: nullable,
          heading: text,
          tags: strings,
          scheduled: nullable,
          deadline: nullable,
          time: nullable,
          destination: z.enum(['inbox', 'anytime', 'someday']),
          priority,
          recurrence: nullable,
          completedAt: nullable,
          createdAt: z.string(),
          updatedAt: z.string(),
          checklist: z.array(z.object({ id, title: text, done: z.boolean() })),
          links: strings,
          blockedBy: strings,
          parentId: nullable,
          effort: z.number().finite(),
          order: z.number().finite(),
        }),
      )
      .max(50000),
    stacks: z
      .array(
        z.object({
          id,
          name: text,
          icon: text,
          color: text,
          notes: text,
          deadline: nullable,
          headings: strings,
          links: strings,
        }),
      )
      .max(10000),
    goals: z.array(z.object({ id, title: text, stackIds: strings })).max(10000),
    headings: strings,
    settings: z.object({
      theme: z.enum(['dark', 'light', 'system']),
      startOfWeek: z.union([z.literal(0), z.literal(1)]),
      defaultDestination: z.enum(['inbox', 'anytime', 'someday']),
      dateFormat: z.enum(['friendly', 'iso']),
      clock24: z.boolean(),
      sound: z.boolean(),
      animations: z.boolean(),
      backupFrequency: z.enum(['daily', 'weekly']),
      layout: z.enum(['force', 'hierarchy', 'radial', 'timeline']),
    }),
    templates: z
      .array(
        z.object({
          id,
          name: text,
          description: text,
          icon: text,
          color: text,
          category: text,
          scope: z.enum(['stack', 'task', 'checklist']),
          title: text,
          notes: text,
          tags: strings,
          effort: z.number().finite(),
          priority,
          defaultStackId: nullable,
          headings: strings,
          variables: z.array(
            z.object({
              key: text,
              label: text,
              required: z.boolean(),
              type: z.enum(['text', 'select']),
              options: strings,
              defaultValue: text,
            }),
          ),
          items: z.array(
            z.object({
              id,
              title: text,
              kind: z.enum(['task', 'subtask', 'checklist', 'milestone']),
              heading: text,
              notes: text,
              tags: strings,
              effort: z.number().finite(),
              priority,
              selected: z.boolean(),
              parentId: nullable,
              blockedBy: strings,
              condition: z.object({ variable: text, equals: text }).optional(),
            }),
          ),
          favorite: z.boolean(),
          lastUsedAt: nullable,
        }),
      )
      .max(10000)
      .optional(),
  })
  .superRefine((data, ctx) => {
    for (const key of ['tasks', 'stacks', 'goals', 'templates'] as const) {
      const ids = (data[key] || []).map((v) => v.id);
      if (new Set(ids).size !== ids.length)
        ctx.addIssue({ code: 'custom', message: `Duplicate IDs in ${key}` });
    }
  });
export const syncSchema = z.object({
  baseVersion: z.number().int().nonnegative(),
  data: deckSchema,
});
