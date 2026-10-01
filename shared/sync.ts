import type { DeckData } from '../src/types';

export interface Conflict {
  path: string;
  local: unknown;
  remote: unknown;
}
export function sameValue(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const left = a as Record<string, unknown>,
    right = b as Record<string, unknown>;
  const keys = Object.keys(left);
  return (
    keys.length === Object.keys(right).length &&
    keys.every((key) => Object.hasOwn(right, key) && sameValue(left[key], right[key]))
  );
}
const equal = sameValue;
/** Three-way merge: independent fields combine; overlapping edits keep the incoming
 * value and report both alternatives for durable recovery. Deletions win over edits. */
export function mergeDeck(base: DeckData, local: DeckData, remote: DeckData) {
  const conflicts: Conflict[] = [];
  function merge(b: any, l: any, r: any, path: string): any {
    if (equal(l, b)) return r;
    if (equal(r, b) || equal(l, r)) return l;
    if (l === undefined || r === undefined) {
      conflicts.push({ path, local: l ?? null, remote: r ?? null });
      return undefined;
    }
    if (
      Array.isArray(l) &&
      Array.isArray(r) &&
      ['tasks', 'stacks', 'goals', 'templates'].includes(path)
    ) {
      const bm = new Map((b || []).map((v: any) => [v.id, v]));
      const lm = new Map(l.map((v: any) => [v.id, v]));
      const rm = new Map(r.map((v: any) => [v.id, v]));
      return [...new Set([...rm.keys(), ...lm.keys()])]
        .map((id) => merge(bm.get(id), lm.get(id), rm.get(id), `${path}.${id}`))
        .filter((v) => v !== undefined);
    }
    if (
      l &&
      r &&
      typeof l === 'object' &&
      typeof r === 'object' &&
      !Array.isArray(l) &&
      !Array.isArray(r)
    ) {
      return Object.fromEntries(
        [...new Set([...Object.keys(l), ...Object.keys(r)])]
          .map((k) => [k, merge(b?.[k], l[k], r[k], path ? `${path}.${k}` : k)])
          .filter(([, v]) => v !== undefined),
      );
    }
    conflicts.push({ path, local: l, remote: r });
    return l;
  }
  return { data: merge(base, local, remote, '') as DeckData, conflicts };
}
export function emptyDeck(settings: DeckData['settings']): DeckData {
  return { version: 1, tasks: [], stacks: [], goals: [], headings: [], templates: [], settings };
}
