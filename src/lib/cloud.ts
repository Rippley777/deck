import { createAuthClient } from 'better-auth/react';
import { create } from 'zustand';
import { invoke, isTauri } from '@tauri-apps/api/core';
import type { DeckData } from '../types';
import { mergeDeck, emptyDeck, sameValue } from '../../shared/sync';
import { defaultSettings } from '../types';
import { useDeck, flushPersistence } from '../stores/deck';
import { repository } from './repository';
import { rememberProfile } from './profiles';
import {
  cloudData,
  deckOwner,
  localIdentity,
  remoteSchema,
  setupScenario,
  type CloudDeck,
  type SetupScenario,
} from './sync-policy';

export const portalEnabled = import.meta.env.VITE_DECK_PORTAL === 'true' && !isTauri();
const createBrowserAuth = () => createAuthClient();
let browserAuth: ReturnType<typeof createBrowserAuth> | undefined;
export const authClient = new Proxy({} as ReturnType<typeof createBrowserAuth>, {
  get(_target, key) {
    if (isTauri()) throw new Error('Use the secure desktop connection to sign in');
    browserAuth ??= createBrowserAuth();
    return Reflect.get(browserAuth, key);
  },
});
export type SyncStatus =
  'Local only' | 'Synced' | 'Syncing' | 'Offline' | 'Changes pending' | 'Sync issue';
export const useCloud = create<{
  user: { id: string; name: string; email: string } | null;
  status: SyncStatus;
  lastSynced: string | null;
  error: string | null;
  firstSync: boolean;
  firstSyncDeferred: boolean;
  setup: { scenario: SetupScenario; remote: CloudDeck } | null;
  authMode: 'signin' | 'signup' | null;
  signOutOpen: boolean;
}>(() => ({
  user: null,
  status: 'Local only',
  lastSynced: null,
  error: null,
  firstSync: false,
  firstSyncDeferred: false,
  setup: null,
  authMode: null,
  signOutOpen: false,
}));
class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}
export async function api<T>(path: string, body?: unknown): Promise<T> {
  if (isTauri())
    return invoke<T>('cloud_request', {
      path,
      body: body ?? null,
      expectedUserId: useCloud.getState().user?.id || null,
    });
  const res = await fetch(`/api/v1/${path}`, {
    credentials: 'include',
    cache: 'no-store',
    signal: AbortSignal.timeout(30000),
    headers: {
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(useCloud.getState().user ? { 'X-Deck-Account': useCloud.getState().user!.id } : {}),
    },
    ...(body !== undefined ? { method: 'POST', body: JSON.stringify(body) } : {}),
  });
  if (!res.ok) {
    const message = await res.json().catch(() => ({}));
    throw new ApiError(
      message.error || 'Cloud is unavailable. Your Deck is saved locally.',
      res.status,
    );
  }
  return res.json();
}
export const cleanData = cloudData;
export const newDeck = (): DeckData => ({
  ...emptyDeck({ ...defaultSettings }),
  local: { deckId: crypto.randomUUID(), syncEnabled: false },
});
let running = false;
let stopped = true;
let generation = 0;
function stopSync() {
  stopped = true;
  generation++;
  running = false;
}
function active(uid: string, epoch: number) {
  return !stopped && epoch === generation && useCloud.getState().user?.id === uid;
}
function failure(error: unknown) {
  const unavailable =
    !navigator.onLine ||
    error instanceof TypeError ||
    (error instanceof DOMException && error.name === 'TimeoutError') ||
    (error instanceof ApiError && error.status >= 500) ||
    String(error).includes('Cloud unavailable');
  useCloud.setState({ status: unavailable ? 'Offline' : 'Sync issue', error: String(error) });
}
export function openAccount() {
  useDeck.setState({ settingsTab: 'Account', modal: 'settings' });
}
export function openSignIn(mode: 'signin' | 'signup' = 'signin') {
  useDeck.getState().setModal(null);
  useCloud.setState({ authMode: mode });
}
export function openSignOut() {
  useDeck.getState().setModal(null);
  useCloud.setState({ signOutOpen: true });
}
export async function reviewSync() {
  const data = useDeck.getState().data;
  useDeck
    .getState()
    .commit({ ...data, local: { ...localIdentity(data), declinedAccountId: undefined } });
  useCloud.setState({ firstSyncDeferred: false, setup: null });
  await synchronize();
}
export async function switchLocalProfile(profile: string) {
  stopSync();
  await flushPersistence();
  if (useDeck.getState().error)
    throw new Error('Save your current Deck before switching profiles.');
  const saved = await repository.switchProfile(profile);
  localStorage.setItem('deck-active-profile', profile);
  const data = saved || newDeck();
  useDeck.setState({
    data,
    ready: true,
    view: 'today',
    selected: null,
    selection: [],
    toast: null,
    graphFocus: null,
    search: '',
    modal: null,
  });
  useDeck.getState().commit(data);
  await flushPersistence();
  if (useDeck.getState().error) throw new Error('Could not open the new local profile.');
  useCloud.setState({
    setup: null,
    firstSync: false,
    firstSyncDeferred: false,
    lastSynced: data.local?.lastSynced || null,
    error: null,
    status: 'Local only',
  });
  rememberProfile(
    profile,
    data,
    useCloud.getState().user?.id === profile
      ? useCloud.getState().user?.name + '’s Deck'
      : undefined,
  );
  stopped = false;
  void synchronize();
}

export async function synchronize() {
  const uid = useCloud.getState().user?.id;
  const state = useDeck.getState();
  if (!uid || !state.ready || running || stopped || useCloud.getState().firstSyncDeferred) return;
  const epoch = generation;
  if (localIdentity(state.data).declinedAccountId === uid) {
    useCloud.setState({ status: 'Local only' });
    return;
  }
  if (!navigator.onLine) {
    useCloud.setState({ status: 'Offline' });
    return;
  }
  running = true;
  try {
    const meta = state.data.cloud;
    const identity = localIdentity(state.data);
    if (identity.declinedAccountId === uid) {
      useCloud.setState({ status: 'Local only' });
      return;
    }
    if (deckOwner(state.data) !== uid || !meta || !identity.syncEnabled) {
      if (useCloud.getState().setup) return;
      const remote = remoteSchema.parse(await api('sync'));
      if (!active(uid, epoch)) return;
      const scenario = setupScenario(useDeck.getState().data, remote.data, uid);
      if (scenario !== 'empty' && useDeck.getState().modal === 'settings')
        useDeck.getState().setModal(null);
      useCloud.setState({
        setup: { scenario, remote },
        firstSync: scenario !== 'empty',
        status: 'Local only',
        error: null,
      });
      if (scenario === 'empty') {
        running = false;
        await completeSetup('merge');
      }
      return;
    }
    // SQLite/IndexedDB durability comes before network upload.
    await flushPersistence();
    if (useDeck.getState().error)
      throw new Error('Local storage needs attention. Export a copy before syncing.');
    if (!active(uid, epoch)) return;
    useCloud.setState({ status: 'Syncing', error: null });
    const sent = cleanData(useDeck.getState().data);
    const dirty = !sameValue(sent, meta.base);
    const remote = remoteSchema.parse(
      await api(
        'sync',
        dirty
          ? {
              baseVersion: meta.version,
              data: sent,
            }
          : undefined,
      ),
    );
    if (!active(uid, epoch)) return;
    if (remote.version < meta.version)
      throw new Error('Cloud returned an older revision. Reconnect from Account settings.');
    const current = cleanData(useDeck.getState().data);
    const next = mergeDeck(sent, current, remote.data);
    const recovery = [
      ...(meta.recovery || []),
      ...(next.conflicts.length ? [current, remote.data] : []),
    ];
    const stamp = new Date().toISOString();
    useDeck.getState().commit({
      ...next.data,
      local: {
        ...identity,
        accountId: uid,
        syncEnabled: true,
        declinedAccountId: undefined,
        lastSynced: stamp,
      },
      cloud: { ...meta, userId: uid, version: remote.version, base: remote.data, recovery },
    });
    await flushPersistence();
    if (!active(uid, epoch)) return;
    if (useDeck.getState().error)
      throw new Error('Cloud received, but local storage failed. Export a copy before closing.');
    if (Date.now() - lastDeviceUpdate > 60000) await registerDevice(stamp);
    if (!active(uid, epoch)) return;
    useCloud.setState({
      status: sameValue(cleanData(useDeck.getState().data), remote.data)
        ? 'Synced'
        : 'Changes pending',
      lastSynced: stamp,
    });
    if (remote.conflicts || next.conflicts.length)
      useDeck.getState().notify('Overlapping edits are available in Account → Sync history.');
  } catch (e) {
    if (active(uid, epoch)) failure(e);
  } finally {
    if (epoch === generation) running = false;
  }
}

export type SetupChoice = 'merge' | 'cloud' | 'device';
export async function completeSetup(choice: SetupChoice) {
  const { user, setup } = useCloud.getState();
  if (!user || !setup || running || setup.scenario === 'account-switch') return;
  const uid = user.id,
    epoch = generation;
  running = true;
  try {
    await flushPersistence();
    if (useDeck.getState().error)
      throw new Error('Local storage needs attention before enabling sync.');
    const before = useDeck.getState().data;
    if (deckOwner(before) && deckOwner(before) !== uid)
      throw new Error('Switch to a separate local profile for this account.');
    // A fresh GET verifies that the user is approving the current cloud revision.
    const latest = remoteSchema.parse(await api('sync'));
    if (!active(uid, epoch)) return;
    if (latest.version !== setup.remote.version || !sameValue(latest.data, setup.remote.data)) {
      useCloud.setState({
        setup: { scenario: setupScenario(before, latest.data, uid), remote: latest },
        firstSync: true,
      });
      throw new Error('Your cloud Deck changed. Review the choices again before continuing.');
    }
    await repository.backup();
    if (!active(uid, epoch)) return;
    const local = cleanData(before),
      identity = localIdentity(before);
    const base = before.cloud?.userId === uid ? before.cloud.base : emptyDeck(defaultSettings);
    const merged = mergeDeck(base, local, latest.data);
    const desired = choice === 'cloud' ? latest.data : choice === 'device' ? local : merged.data;
    useCloud.setState({ status: 'Syncing', error: null });
    const remote =
      choice === 'cloud'
        ? latest
        : remoteSchema.parse(
            await api('sync', {
              baseVersion: latest.version,
              data: desired,
              mode: 'replace',
            }),
          );
    if (!active(uid, epoch)) return;
    // Preserve any local edits made while approval/upload was in progress.
    const current = cleanData(useDeck.getState().data);
    const next = mergeDeck(local, current, remote.data);
    const stamp = new Date().toISOString();
    useDeck.getState().commit({
      ...next.data,
      local: {
        ...identity,
        accountId: uid,
        syncEnabled: true,
        declinedAccountId: undefined,
        lastSynced: stamp,
      },
      cloud: {
        userId: uid,
        version: remote.version,
        base: remote.data,
        recovery: [
          ...(before.cloud?.recovery || []),
          ...(merged.conflicts.length || next.conflicts.length || choice === 'cloud'
            ? [local, latest.data]
            : []),
        ],
      },
    });
    await flushPersistence();
    if (!active(uid, epoch)) return;
    if (useDeck.getState().error)
      throw new Error('Could not save sync metadata. Your local Deck remains available.');
    rememberProfile(localStorage.getItem('deck-active-profile') || '', useDeck.getState().data);
    useCloud.setState({ setup: null, firstSync: false, lastSynced: stamp });
    await registerDevice(stamp);
    if (!active(uid, epoch)) return;
    useCloud.setState({
      setup: null,
      firstSync: false,
      firstSyncDeferred: false,
      status: sameValue(next.data, remote.data) ? 'Synced' : 'Changes pending',
      lastSynced: stamp,
      error: null,
    });
    if (setup.scenario === 'empty') useDeck.getState().notify('Sync enabled');
  } catch (e) {
    if (active(uid, epoch)) failure(e);
  } finally {
    if (epoch === generation) running = false;
  }
}

export function keepLocalOnly() {
  stopSync();
  stopped = false;
  const data = useDeck.getState().data;
  useDeck.getState().commit({
    ...data,
    local: {
      ...localIdentity(data),
      syncEnabled: false,
      declinedAccountId: useCloud.getState().user?.id,
    },
  });
  useCloud.setState({
    firstSync: false,
    firstSyncDeferred: true,
    setup: null,
    status: 'Local only',
    error: null,
  });
}
let lastDeviceUpdate = 0;
export async function registerDevice(stamp?: string) {
  let id = localStorage.getItem('deck-device-id');
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem('deck-device-id', id);
  }
  const metadata = isTauri()
    ? await invoke<Record<string, string>>('device_info')
    : {
        name: 'Deck Web',
        platform: navigator.platform || 'Web',
        architecture: 'browser',
        appVersion: __DECK_VERSION__,
      };
  await api('devices/register', { id, ...metadata, lastSync: stamp || null });
  lastDeviceUpdate = Date.now();
}
export function startSync() {
  stopped = false;
  let timer: ReturnType<typeof setTimeout>;
  const trigger = () => {
    clearTimeout(timer);
    timer = setTimeout(() => void synchronize(), 700);
  };
  const unsubscribe = useDeck.subscribe((state, previous) => {
    if (
      state.data !== previous.data &&
      !sameValue(cleanData(state.data), cleanData(previous.data))
    ) {
      if (state.data.local?.syncEnabled && useCloud.getState().user?.id === deckOwner(state.data))
        useCloud.setState({ status: navigator.onLine ? 'Changes pending' : 'Offline' });
      trigger();
    }
  });
  const interval = setInterval(() => void synchronize(), 10000);
  window.addEventListener('online', trigger);
  const offline = () => {
    if (useCloud.getState().user && useDeck.getState().data.local?.syncEnabled)
      useCloud.setState({ status: 'Offline' });
  };
  window.addEventListener('offline', offline);
  void synchronize();
  return () => {
    stopSync();
    clearTimeout(timer);
    clearInterval(interval);
    unsubscribe();
    window.removeEventListener('online', trigger);
    window.removeEventListener('offline', offline);
  };
}
export async function signOut(remove = false) {
  stopSync();
  await flushPersistence();
  try {
    if (isTauri()) await invoke('disconnect_cloud');
    else {
      const result = await authClient.signOut();
      if (result.error) throw new Error(result.error.message);
    }
    localStorage.removeItem('deck-offline-user');
    localStorage.removeItem('deck-native-user');
    if (remove) await repository.clear();
    const data = remove ? newDeck() : useDeck.getState().data;
    useDeck.getState().commit({
      ...data,
      local: { ...localIdentity(data), syncEnabled: false, declinedAccountId: undefined },
    });
    useDeck.setState({ selected: null, selection: [], toast: null, graphFocus: null });
    await flushPersistence();
    useCloud.setState({
      user: null,
      status: 'Local only',
      lastSynced: null,
      error: null,
      firstSync: false,
      firstSyncDeferred: false,
      setup: null,
      signOutOpen: false,
    });
  } catch (e) {
    stopped = false;
    throw e;
  }
}
