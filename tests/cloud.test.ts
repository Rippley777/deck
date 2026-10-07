import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { emptyDeck } from '../shared/sync';
import { defaultSettings, type DeckData } from '../src/types';
import { makeTask } from '../src/lib/seed';
import { deckHasContent, setupScenario, remoteSchema, cloudData } from '../src/lib/sync-policy';

vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => false, invoke: vi.fn() }));
vi.mock('better-auth/react', () => ({ createAuthClient: () => ({ signOut: async () => ({}) }) }));
vi.mock('../src/lib/repository', () => ({
  repository: {
    load: vi.fn(),
    save: vi.fn(async () => {}),
    backup: vi.fn(async () => {}),
    clear: vi.fn(async () => {}),
    switchProfile: vi.fn(async () => null),
  },
}));
import { repository } from '../src/lib/repository';
import { useDeck, flushPersistence } from '../src/stores/deck';
import {
  useCloud,
  startSync,
  synchronize,
  completeSetup,
  keepLocalOnly,
  signOut,
  switchLocalProfile,
} from '../src/lib/cloud';
const user = { id: 'account-a', name: 'A', email: 'a@example.test' };
const deck = (): DeckData => ({
  ...emptyDeck({ ...defaultSettings }),
  local: { deckId: 'local-id', syncEnabled: false },
});
const remote = (data = emptyDeck(defaultSettings), version = 0) => ({ data, version });
let stop: (() => void) | undefined;
let fetchMock: ReturnType<typeof vi.fn>;
let stored: Map<string, string>;
const uploads = () =>
  fetchMock.mock.calls.filter(
    ([, options]) => options?.method === 'POST' && options?.body && JSON.parse(options.body).data,
  );
async function begin() {
  stop = startSync();
  await vi.waitFor(() =>
    expect(
      useCloud.getState().setup || useCloud.getState().lastSynced || useCloud.getState().error,
    ).toBeTruthy(),
  );
}
beforeEach(async () => {
  await flushPersistence();
  vi.clearAllMocks();
  stored = new Map();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => stored.get(k) || null,
    setItem: (k: string, v: string) => stored.set(k, v),
    removeItem: (k: string) => stored.delete(k),
  });
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('navigator', { onLine: true, platform: 'test' });
  vi.stubGlobal('__DECK_VERSION__', 'test');
  useDeck.setState({ data: deck(), ready: true, error: null, saving: false, toast: null });
  useCloud.setState({
    user,
    status: 'Local only',
    firstSync: false,
    firstSyncDeferred: false,
    setup: null,
    lastSynced: null,
    error: null,
  });
  fetchMock = vi.fn(async (_url: string, options?: RequestInit) => {
    const body = options?.body ? JSON.parse(String(options.body)) : undefined;
    return Response.json(body?.data ? remote(body.data, 1) : body ? { success: true } : remote());
  });
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  stop?.();
  stop = undefined;
  vi.unstubAllGlobals();
});

describe('sync consent and data safety', () => {
  it('counts empty stacks, goals, headings and templates as real local data', () => {
    expect(deckHasContent(deck())).toBe(false);
    expect(deckHasContent({ ...deck(), headings: ['A heading'] })).toBe(true);
    expect(setupScenario({ ...deck(), tasks: [makeTask('Local')] }, deck(), user.id)).toBe(
      'upload',
    );
    expect(setupScenario(deck(), { ...deck(), tasks: [makeTask('Cloud')] }, user.id)).toBe(
      'restore',
    );
  });
  it('waits for consent before uploading a local Deck and keeps its identity', async () => {
    useDeck.setState({ data: { ...deck(), tasks: [makeTask('Local')] } });
    await begin();
    expect(useCloud.getState().setup?.scenario).toBe('upload');
    expect(uploads()).toHaveLength(0);
    await completeSetup('merge');
    expect(useDeck.getState().data.tasks[0].title).toBe('Local');
    expect(useDeck.getState().data.local).toMatchObject({
      deckId: 'local-id',
      accountId: user.id,
      syncEnabled: true,
    });
    expect(repository.backup).toHaveBeenCalled();
    expect(uploads()).toHaveLength(1);
  });
  it('offers to restore a cloud Deck without uploading an empty device', async () => {
    const cloud = { ...deck(), tasks: [makeTask('Cloud')] };
    fetchMock.mockImplementation(async () => Response.json(remote(cloud, 7)));
    await begin();
    expect(useCloud.getState().setup?.scenario).toBe('restore');
    expect(uploads()).toHaveLength(0);
    await completeSetup('cloud');
    expect(useDeck.getState().data.tasks[0].title).toBe('Cloud');
    expect(uploads()).toHaveLength(0);
  });
  it('establishes sync without an onboarding modal when both Decks are empty', async () => {
    await begin();
    await vi.waitFor(() => expect(useCloud.getState().status).toBe('Synced'));
    expect(useCloud.getState().firstSync).toBe(false);
    expect(useDeck.getState().data.local?.syncEnabled).toBe(true);
  });
  it('merges unique items and preserves both overlapping versions in local recovery', async () => {
    const local = {
      ...deck(),
      tasks: [makeTask('Local title', { id: 'same' }), makeTask('Only local')],
    };
    const cloud = {
      ...deck(),
      tasks: [makeTask('Cloud title', { id: 'same' }), makeTask('Only cloud')],
    };
    useDeck.setState({ data: local });
    fetchMock.mockImplementation(async (_url: string, options?: RequestInit) => {
      const body = options?.body && JSON.parse(String(options.body));
      return Response.json(body?.data ? remote(body.data, 9) : body ? {} : remote(cloud, 8));
    });
    await begin();
    expect(useCloud.getState().setup?.scenario).toBe('merge');
    await completeSetup('merge');
    expect(useDeck.getState().data.tasks).toHaveLength(3);
    expect(useDeck.getState().data.cloud?.recovery).toHaveLength(2);
    expect(uploads()[0][1].body).not.toContain('local-id');
  });
  it('persists Keep Local Only and does not repeatedly ask or upload after restart', async () => {
    useDeck.setState({ data: { ...deck(), tasks: [makeTask('Private')] } });
    await begin();
    keepLocalOnly();
    await flushPersistence();
    stop?.();
    useCloud.setState({ firstSyncDeferred: false });
    stop = startSync();
    await synchronize();
    expect(useCloud.getState().firstSync).toBe(false);
    expect(uploads()).toHaveLength(0);
    expect(useDeck.getState().data.local?.declinedAccountId).toBe(user.id);
  });
  it('rejects malformed or incomplete cloud data and retains the exact local Deck', async () => {
    const original = { ...deck(), tasks: [makeTask('Keep this')] };
    useDeck.setState({ data: original });
    fetchMock.mockImplementation(async () => Response.json({ version: 9, data: { tasks: [] } }));
    await begin();
    expect(useCloud.getState().status).toBe('Sync issue');
    expect(useDeck.getState().data).toBe(original);
    expect(
      remoteSchema.safeParse({ ...remote(), data: { ...deck(), templates: undefined } }).success,
    ).toBe(false);
  });
  it('does not replace either Deck if the cloud changes during approval', async () => {
    const original = { ...deck(), tasks: [makeTask('Private')] };
    useDeck.setState({ data: original });
    await begin();
    fetchMock.mockImplementation(async () =>
      Response.json(remote({ ...deck(), tasks: [makeTask('Changed cloud')] }, 1)),
    );
    await completeSetup('device');
    expect(useDeck.getState().data).toBe(original);
    expect(uploads()).toHaveLength(0);
    expect(useCloud.getState().error).toContain('changed');
  });
  it('preserves edits made while an upload is in flight', async () => {
    const task = makeTask('Before', { id: 'task-a' });
    useDeck.setState({ data: { ...deck(), tasks: [task] } });
    await begin();
    let finish!: (response: Response) => void;
    fetchMock.mockImplementation(async (_url: string, options?: RequestInit) => {
      const body = options?.body && JSON.parse(String(options.body));
      if (body?.data)
        return new Promise<Response>((resolve) => {
          finish = resolve;
        });
      return Response.json(body ? {} : remote());
    });
    const approval = completeSetup('merge');
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
    useDeck.getState().updateTask(task.id, { notes: 'Edited while syncing' });
    finish(Response.json(remote({ ...deck(), tasks: [task] }, 1)));
    await approval;
    expect(useDeck.getState().data.tasks[0].notes).toBe('Edited while syncing');
    expect(useCloud.getState().status).toBe('Changes pending');
  });
  it('keeps account ownership after sign-out and blocks uploads to a different account', async () => {
    const data = {
      ...deck(),
      tasks: [makeTask('A private task')],
      local: { deckId: 'a-deck', accountId: user.id, syncEnabled: true },
    };
    useDeck.setState({ data });
    await signOut();
    await flushPersistence();
    expect(useDeck.getState().data.tasks).toEqual(data.tasks);
    expect(useDeck.getState().data.local?.accountId).toBe(user.id);
    useCloud.setState({ user: { ...user, id: 'account-b' } });
    await begin();
    expect(useCloud.getState().setup?.scenario).toBe('account-switch');
    await completeSetup('device');
    expect(uploads()).toHaveLength(0);
  });
  it('ignores a delayed cloud response after changing the local profile', async () => {
    const task = makeTask('Account A task');
    const data = {
      ...deck(),
      tasks: [task],
      local: { deckId: 'a', accountId: user.id, syncEnabled: true },
      cloud: { userId: user.id, version: 1, base: { ...deck(), tasks: [task] } },
    };
    useDeck.setState({ data });
    let finish!: (response: Response) => void;
    fetchMock.mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          finish = resolve;
        }),
    );
    stop = startSync();
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
    keepLocalOnly();
    await signOut();
    finish(Response.json(remote({ ...deck(), tasks: [makeTask('Remote A')] }, 2)));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(useDeck.getState().data.tasks[0].title).toBe('Account A task');
  });
  it('keeps local edits during outages and retries after reconnecting', async () => {
    const data = deck(),
      base = emptyDeck(defaultSettings);
    data.local = { deckId: 'local-id', accountId: user.id, syncEnabled: true };
    data.cloud = { userId: user.id, version: 1, base };
    data.tasks = [makeTask('Offline edit')];
    useDeck.setState({ data });
    fetchMock.mockRejectedValue(new TypeError('Network unavailable'));
    await begin();
    expect(useCloud.getState().status).toBe('Offline');
    expect(useDeck.getState().data).toBe(data);
    fetchMock.mockImplementation(async (_url: string, options?: RequestInit) => {
      const body = options?.body && JSON.parse(String(options.body));
      return Response.json(body?.data ? remote(body.data, 2) : body ? {} : remote(base, 1));
    });
    await synchronize();
    expect(useCloud.getState().status).toBe('Synced');
    expect(useDeck.getState().data.tasks[0].title).toBe('Offline edit');
  });
  it('removes only the active local copy when explicitly requested at sign-out', async () => {
    useDeck.setState({ data: { ...deck(), tasks: [makeTask('Remove on this device')] } });
    await signOut(true);
    expect(repository.clear).toHaveBeenCalledOnce();
    expect(useDeck.getState().data.tasks).toEqual([]);
    expect(useDeck.getState().data.cloud).toBeUndefined();
  });
  it('opens a separate saved account profile without carrying over another account’s tasks', async () => {
    useDeck.setState({ data: { ...deck(), tasks: [makeTask('A')] } });
    useCloud.setState({ user: null });
    await switchLocalProfile('account-b');
    expect(repository.switchProfile).toHaveBeenCalledWith('account-b');
    expect(useDeck.getState().data.tasks).toEqual([]);
  });
  it('uses a cloud allowlist to strip account identity and unknown filesystem metadata', () => {
    const data = {
      ...deck(),
      repositoryPath: '/private/repo',
      local: { deckId: 'a', accountId: 'private-id', syncEnabled: false },
    };
    expect(cloudData(data)).not.toHaveProperty('local');
    expect(cloudData(data)).not.toHaveProperty('repositoryPath');
  });
});
