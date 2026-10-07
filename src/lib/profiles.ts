import type { DeckData } from '../types';
export interface LocalProfile {
  id: string;
  name: string;
  accountId?: string;
}
export function localProfiles(): LocalProfile[] {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem('deck-profiles') || '[]');
    if (Array.isArray(saved)) {
      const profiles = saved.filter(
        (p): p is LocalProfile => p && typeof p.id === 'string' && typeof p.name === 'string',
      );
      return profiles.some((p) => p.id === '')
        ? profiles
        : [{ id: '', name: 'Default Deck' }, ...profiles];
    }
  } catch {
    /* Registry failure must not affect stored Decks. */
  }
  return [{ id: '', name: 'Default Deck' }];
}
export function rememberProfile(id: string, data: DeckData, name?: string) {
  const existing = localProfiles();
  const accountId = data.local?.accountId || data.cloud?.userId;
  const prior = existing.find((p) => p.id === id);
  const entry = {
    id,
    name: name || prior?.name || (id ? `Local Deck ${id.slice(0, 6)}` : 'Default Deck'),
    accountId,
  };
  try {
    localStorage.setItem(
      'deck-profiles',
      JSON.stringify([...existing.filter((p) => p.id !== id), entry]),
    );
    window.dispatchEvent(new Event('deck-profiles-changed'));
  } catch {
    // The registry is auxiliary; do not block a valid SQLite workspace.
  }
}
