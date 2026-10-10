import { z } from 'zod';

export const githubUrl = z
  .string()
  .url()
  .refine((v) => {
    const u = new URL(v);
    return u.protocol === 'https:' && u.hostname === 'github.com' && !u.username && !u.password;
  }, 'Expected a GitHub HTTPS URL');
export const repositorySchema = z.object({
  id: z.string().regex(/^\d+$/),
  owner: z.string().max(100),
  name: z.string().max(200),
  url: githubUrl,
  defaultBranch: z.string().max(300),
  description: z.string().max(10000),
  language: z.string().nullable(),
  topics: z.array(z.string()).max(100),
  visibility: z.enum(['public', 'private', 'internal']),
  archived: z.boolean(),
  pushedAt: z.string().nullable(),
});
export type Repository = z.infer<typeof repositorySchema>;
export const projectCommandSchema = z.object({
  repository: repositorySchema.optional(),
  lifecycle: z.enum(['active', 'paused', 'archived']).optional(),
  importance: z.number().int().min(0).max(100).optional(),
  risks: z
    .array(
      z.object({
        id: z.string().max(200),
        title: z.string().min(1).max(1000),
        critical: z.boolean(),
      }),
    )
    .max(100)
    .optional(),
  externalTasks: z.record(z.string().max(200), z.string().max(200)).optional(),
  pitBoss: z
    .object({
      projectId: z.string().min(1).max(200),
      // Reference metadata only. No invented executable URLs or shell commands.
      actions: z
        .array(z.object({ id: z.string().min(1).max(200), name: z.string().min(1).max(200) }))
        .max(100),
    })
    .optional(),
});
export const weightsSchema = z.object({
  deployment: z.number().min(0).max(100),
  blocker: z.number().min(0).max(100),
  ci: z.number().min(0).max(100),
  overdue: z.number().min(0).max(100),
  deadline: z.number().min(0).max(100),
  review: z.number().min(0).max(100),
  issue: z.number().min(0).max(100),
});
export const commandPreferencesSchema = z.object({
  sort: z.enum(['urgency', 'activity', 'name', 'importance']).optional(),
  weights: weightsSchema.optional(),
});
export type Weights = z.infer<typeof weightsSchema>;
export const defaultWeights: Weights = {
  deployment: 40,
  blocker: 35,
  ci: 25,
  overdue: 20,
  deadline: 15,
  review: 10,
  issue: 10,
};
export interface ExternalWork {
  id: string;
  provider: 'github';
  repositoryId: string;
  type: 'issue' | 'pull' | 'workflow' | 'deployment' | 'milestone';
  title: string;
  url: string;
  state: string;
  priority?: 'high';
  assignees: string[];
  createdAt: string;
  updatedAt: string;
  syncedAt: string;
  reviewRequested?: boolean;
  blocked?: boolean;
  defaultBranch?: boolean;
  production?: boolean;
  deadline?: string;
  workflowId?: string;
  evidenceKey?: string;
}
export interface Activity {
  id: string;
  repositoryId: string;
  type: 'commit' | 'issue' | 'pull' | 'workflow' | 'release' | 'deployment';
  title: string;
  url: string;
  occurredAt: string;
}
export interface RepositorySnapshot {
  repository: Repository;
  work: ExternalWork[];
  activity: Activity[];
  lastSuccess: string | null;
  lastAttempt: string | null;
  status: 'pending' | 'syncing' | 'ready' | 'error' | 'revoked';
  error?: string;
  nextAttempt?: string;
  failures?: number;
}
export interface CommandSnapshot {
  configured: boolean;
  connected: boolean;
  login?: string;
  error?: string;
  repositories: RepositorySnapshot[];
}

const externalSchema: z.ZodType<ExternalWork> = z.object({
  id: z.string(),
  provider: z.literal('github'),
  repositoryId: z.string(),
  type: z.enum(['issue', 'pull', 'workflow', 'deployment', 'milestone']),
  title: z.string().max(1000),
  url: githubUrl,
  state: z.string(),
  priority: z.literal('high').optional(),
  assignees: z.array(z.string()),
  createdAt: z.string(),
  updatedAt: z.string(),
  syncedAt: z.string(),
  reviewRequested: z.boolean().optional(),
  blocked: z.boolean().optional(),
  defaultBranch: z.boolean().optional(),
  production: z.boolean().optional(),
  deadline: z.string().optional(),
  workflowId: z.string().optional(),
  evidenceKey: z.string().optional(),
});
const activitySchema: z.ZodType<Activity> = z.object({
  id: z.string(),
  repositoryId: z.string(),
  type: z.enum(['commit', 'issue', 'pull', 'workflow', 'release', 'deployment']),
  title: z.string().max(1000),
  url: githubUrl,
  occurredAt: z.string(),
});
export const commandSnapshotSchema: z.ZodType<CommandSnapshot> = z.object({
  configured: z.boolean(),
  connected: z.boolean(),
  login: z.string().optional(),
  error: z.string().optional(),
  repositories: z.array(
    z.object({
      repository: repositorySchema,
      work: z.array(externalSchema),
      activity: z.array(activitySchema),
      lastSuccess: z.string().nullable(),
      lastAttempt: z.string().nullable(),
      status: z.enum(['pending', 'syncing', 'ready', 'error', 'revoked']),
      error: z.string().optional(),
      nextAttempt: z.string().optional(),
      failures: z.number().optional(),
    }),
  ),
});
