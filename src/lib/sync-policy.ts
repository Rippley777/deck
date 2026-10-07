import type { DeckData } from '../types';
import { deckSchema } from '../../shared/validation';
import { z } from 'zod';

// An allowlist removes credentials, profile identity and future device-only fields.
export function cloudData(data: DeckData): DeckData {
  return deckSchema.parse(data);
}
export const remoteSchema = z.object({
  version: z.number().int().nonnegative(),
  data: deckSchema.refine(
    (data) => data.templates !== undefined,
    'Incomplete cloud Deck: template collection missing',
  ),
  updated_at: z.string().optional(),
  conflicts: z.number().int().nonnegative().optional(),
});
export type CloudDeck = z.infer<typeof remoteSchema>;
export type SetupScenario = 'upload' | 'restore' | 'merge' | 'empty' | 'account-switch';
export function deckHasContent(data: DeckData) {
  return !!(
    data.tasks.length ||
    data.stacks.length ||
    data.goals.length ||
    data.headings.length ||
    data.templates?.length
  );
}
export function deckOwner(data: DeckData) {
  return data.local?.accountId || data.cloud?.userId;
}
export function setupScenario(local: DeckData, remote: DeckData, accountId: string): SetupScenario {
  if (deckOwner(local) && deckOwner(local) !== accountId) return 'account-switch';
  const l = deckHasContent(local),
    r = deckHasContent(remote);
  return l ? (r ? 'merge' : 'upload') : r ? 'restore' : 'empty';
}
export function localIdentity(data: DeckData) {
  return (
    data.local || {
      deckId: crypto.randomUUID(),
      accountId: data.cloud?.userId,
      // Previously connected Decks retain their consent during migration.
      syncEnabled: !!data.cloud,
    }
  );
}
