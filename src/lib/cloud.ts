import { createAuthClient } from 'better-auth/react';
import { create } from 'zustand';
import { invoke, isTauri } from '@tauri-apps/api/core';
import type { DeckData } from '../types';
import { mergeDeck, emptyDeck, sameValue } from '../../shared/sync';
import { defaultSettings } from '../types';
import { useDeck, flushPersistence } from '../stores/deck';

export const portalEnabled = import.meta.env.VITE_DECK_PORTAL === 'true' && !isTauri();
// Browser auth is lazy: Tauri's custom URL scheme is not an HTTP auth origin.
// Native clients use the credential-vault transport instead.
let browserAuth: ReturnType<typeof createAuthClient> | undefined;
export const authClient = new Proxy({} as ReturnType<typeof createAuthClient>, {
  get(_target, key) {
    if (isTauri()) throw new Error('Browser authentication is unavailable in the desktop client');
    browserAuth ??= createAuthClient();
    return Reflect.get(browserAuth, key);
  },
});
export const useCloud = create<{
  user: { id: string; name: string; email: string } | null;
  status: string;
  lastSynced: string | null;
  error: string | null;
  firstSync: boolean;
  firstSyncDeferred: boolean;
}>(() => ({
  user: null,
  status: 'Changes pending',
  lastSynced: null,
  error: null,
  firstSync: false,
  firstSyncDeferred: false,
}));
export async function api<T>(path: string, body?: unknown): Promise<T> {
  if (isTauri()) return invoke<T>('cloud_request', { path, body: body ?? null });
  const res = await fetch(`/api/v1/${path}`, {
    credentials: 'include',
    cache: 'no-store',
    headers: body ? { 'Content-Type': 'application/json' } : {},
    ...(body ? { method: 'POST', body: JSON.stringify(body) } : {}),
  });
  if (!res.ok) {
    const message = await res.json().catch(() => ({}));
    if (res.status === 401) useCloud.setState({ status: 'Sign in required' });
    throw new Error(
      message.error || 'The server could not be reached. Your changes are saved locally.',
    );
  }
  return res.json();
}
export function cleanData(data: DeckData): DeckData {
  const { cloud: _cloud, cloudPristine: _pristine, ...content } = data;
  return content;
}
let running = false;
let stopped = false;
export async function synchronize(first = false) {
  const uid = useCloud.getState().user?.id;
  const state = useDeck.getState();
  if (!uid || !state.ready || running || stopped) return;
  if (!navigator.onLine) {
    useCloud.setState({ status: 'Offline' });
    return;
  }
  if (!state.data.cloud && !first) {
    if (useCloud.getState().firstSyncDeferred) return;
    useCloud.setState({ firstSync: true, status: 'Set up sync' });
    return;
  }
  running = true;
  useCloud.setState({ status: 'Syncing…', error: null });
  try {
    const sent = cleanData(state.data);
    const meta = state.data.cloud;
    if (meta && meta.userId !== uid) throw new Error('This local Deck belongs to another account.');
    const dirty = !meta || !sameValue(sent, meta.base);
    const existing =
      state.data.cloudPristine && !meta
        ? await api<{ data: DeckData; version: number; conflicts?: number }>('sync')
        : null;
    const remote =
      existing && existing.version > 0
        ? existing
        : dirty
          ? await api<{ data: DeckData; version: number; conflicts?: number }>('sync', {
              baseVersion: meta?.version || 0,
              data: sent,
            })
          : await api<{ data: DeckData; version: number; conflicts?: number }>('sync');
    if (stopped) return;
    // Capture edits made while the request was in flight; never overwrite them.
    const current = cleanData(useDeck.getState().data);
    if (!dirty && remote.version === meta?.version && sameValue(current, sent)) {
      useCloud.setState({ status: 'Synced', lastSynced: new Date().toISOString() });
      return;
    }
    const next = mergeDeck(sent, current, remote.data);
    const recovery = [...(meta?.recovery || []), ...(next.conflicts.length ? [current] : [])];
    useDeck.getState().commit({
      ...next.data,
      cloud: { userId: uid, version: remote.version, base: remote.data, recovery },
    });
    await flushPersistence();
    if (useDeck.getState().error)
      throw new Error('Sync received, but local storage failed. Export your Deck before closing.');
    useCloud.setState({
      firstSync: false,
      status: sameValue(next.data, remote.data) ? 'Synced' : 'Changes pending',
      lastSynced: new Date().toISOString(),
    });
    if (remote.conflicts)
      useDeck.getState().notify('Overlapping edits were preserved in Account → Sync history.');
  } catch (e) {
    useCloud.setState({
      status: navigator.onLine ? 'Changes pending' : 'Offline',
      error: String(e),
    });
  } finally {
    running = false;
  }
}
export function startSync() {
  stopped = false;
  let timer: ReturnType<typeof setTimeout>;
  const trigger = () => {
    clearTimeout(timer);
    timer = setTimeout(() => void synchronize(), 700);
  };
  const unsubscribe = useDeck.subscribe((state, previous) => {
    if (state.data !== previous.data && !sameValue(cleanData(state.data), cleanData(previous.data)))
      trigger();
  });
  const interval = setInterval(() => void synchronize(), 10000);
  window.addEventListener('online', trigger);
  const offline = () => useCloud.setState({ status: 'Offline' });
  window.addEventListener('offline', offline);
  void synchronize();
  return () => {
    stopped = true;
    clearTimeout(timer);
    clearInterval(interval);
    unsubscribe();
    window.removeEventListener('online', trigger);
    window.removeEventListener('offline', offline);
  };
}
export async function signOut() {
  if (
    useCloud.getState().status !== 'Synced' &&
    !confirm('Some changes may exist only on this device. They remain saved here. Sign out?')
  )
    return;
  const result = await authClient.signOut();
  if (result.error) throw new Error(result.error.message);
  stopped = true;
  localStorage.removeItem('deck-offline-user');
  location.assign('/app');
}
export const newDeck = () => emptyDeck(defaultSettings);
