import initSqlJs, { type Database } from 'sql.js';
import wasmUrl from 'sql.js/dist/sql-wasm.wasm?url';
import { invoke, isTauri } from '@tauri-apps/api/core';
import type { DeckData } from '../types';
import { mergeDeck, emptyDeck, sameValue } from '../../shared/sync';
import { defaultSettings } from '../types';
import { today } from './dates';
export interface Backup {
  name: string;
  createdAt: string;
}
export interface DeckRepository {
  load(): Promise<DeckData | null>;
  save(data: DeckData): Promise<void>;
  backups(): Promise<Backup[]>;
  backup(): Promise<void>;
  restore(name: string): Promise<DeckData>;
  location(): Promise<string>;
  switchProfile(profile: string): Promise<DeckData | null>;
  clear(): Promise<void>;
}
function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function openIDB(scope: string) {
  const req = indexedDB.open(scope ? `deck-account-${scope}` : 'deck-local', 1);
  req.onupgradeneeded = () => {
    req.result.createObjectStore('files');
  };
  return request(req);
}
async function putMany(idb: IDBDatabase, items: [string, unknown][], remove: string[] = []) {
  await new Promise<void>((resolve, reject) => {
    const tx = idb.transaction('files', 'readwrite');
    const store = tx.objectStore('files');
    items.forEach(([k, v]) => store.put(v, k));
    remove.forEach((k) => store.delete(k));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Storage transaction aborted'));
  });
}
async function readFile(idb: IDBDatabase, key: string) {
  return request(idb.transaction('files', 'readonly').objectStore('files').get(key));
}
class BrowserRepository implements DeckRepository {
  private idb!: IDBDatabase;
  private scope: string;
  constructor(scope = localStorage.getItem('deck-active-profile') || '') {
    this.scope = scope;
  }
  private db!: Database;
  private journalKey = `pending-${crypto.randomUUID()}`;
  private recoveredKeys: string[] = [];
  async load() {
    // Previous portal releases kept account Decks in their own IndexedDB database.
    // Reopen that exact profile on upgrade; never move or reseed its contents.
    if (localStorage.getItem('deck-active-profile') === null && indexedDB.databases) {
      try {
        const cached = JSON.parse(localStorage.getItem('deck-offline-user') || 'null');
        const databases = await indexedDB.databases();
        if (cached?.id && databases.some((db) => db.name === `deck-account-${cached.id}`)) {
          this.scope = cached.id;
          localStorage.setItem('deck-active-profile', this.scope);
        }
      } catch {
        /* The default local database remains available. */
      }
    }
    this.idb = await openIDB(this.scope);
    const SQL = await initSqlJs({ locateFile: () => wasmUrl });
    const bytes = await readFile(this.idb, 'deck.db');
    this.db = bytes ? new SQL.Database(bytes) : new SQL.Database();
    this.db.run(
      'CREATE TABLE IF NOT EXISTS migrations (version INTEGER PRIMARY KEY); CREATE TABLE IF NOT EXISTS documents (collection TEXT NOT NULL, id TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY(collection,id)); INSERT OR IGNORE INTO migrations VALUES (1);',
    );
    let data = this.decode();
    {
      const store = this.idb.transaction('files', 'readonly').objectStore('files');
      const keys = await request(store.getAllKeys());
      this.recoveredKeys = keys.map(String).filter((key) => key.startsWith('pending-'));
      for (const key of this.recoveredKeys) {
        const pending = (await readFile(this.idb, key)) as DeckData;
        if (
          !pending ||
          (pending.cloud && data?.cloud && pending.cloud.userId !== data.cloud.userId)
        )
          continue;
        const clean = (v: DeckData) => {
          const { cloud: _cloud, cloudPristine: _pristine, local: _local, ...content } = v;
          return content;
        };
        const current = data || emptyDeck(defaultSettings);
        const merged = mergeDeck(
          pending.cloud?.base || emptyDeck(defaultSettings),
          clean(pending),
          clean(current),
        );
        data = {
          ...merged.data,
          local: current.local || pending.local,
          cloudPristine: current.cloudPristine && pending.cloudPristine,
          cloud: current.cloud
            ? {
                ...current.cloud,
                recovery: [
                  ...(current.cloud.recovery || []),
                  ...(merged.conflicts.length ? [clean(pending)] : []),
                ],
              }
            : undefined,
        };
      }
    }
    return data;
  }
  private decode(): DeckData | null {
    const rows = this.db.exec(
      "SELECT value FROM documents WHERE collection = 'workspace' AND id = 'default'",
    );
    return rows[0]?.values[0]?.[0] ? JSON.parse(String(rows[0].values[0][0])) : null;
  }
  async save(data: DeckData) {
    this.db.run('BEGIN IMMEDIATE');
    try {
      this.db.run('INSERT OR REPLACE INTO documents VALUES (?, ?, ?)', [
        'workspace',
        'default',
        JSON.stringify(data),
      ]);
      this.db.run('COMMIT');
    } catch (e) {
      this.db.run('ROLLBACK');
      throw e;
    }
    const { cloud, cloudPristine: _pristine, local: _local, ...content } = data;
    const synced = cloud && sameValue(content, cloud.base);
    await putMany(
      this.idb,
      [
        ['deck.db', this.db.export()],
        ...(cloud && !synced ? [[this.journalKey, data] as [string, unknown]] : []),
      ],
      synced ? [this.journalKey, ...this.recoveredKeys] : [],
    );
    if (synced) this.recoveredKeys = [];
    const existing = await this.backups();
    const newest = existing[0];
    const interval = data.settings.backupFrequency === 'weekly' ? 7 : 1;
    if (!newest || Date.parse(today()) - Date.parse(newest.createdAt) >= interval * 86400000)
      await this.backup();
  }
  async backups() {
    const keys = await request(
      this.idb.transaction('files', 'readonly').objectStore('files').getAllKeys(),
    );
    return keys
      .map(String)
      .filter((k) => k.startsWith('deck-backup-'))
      .sort()
      .reverse()
      .map((name) => ({ name, createdAt: name.slice(12, 22) }));
  }
  async backup() {
    const name = `deck-backup-${today()}.db`;
    const existing = await this.backups();
    await putMany(
      this.idb,
      [[name, this.db.export()]],
      existing
        .filter((b) => b.name !== name)
        .slice(13)
        .map((b) => b.name),
    );
  }
  async restore(name: string) {
    const bytes = await readFile(this.idb, name);
    if (!bytes) throw new Error('Backup not found');
    const SQL = await initSqlJs({ locateFile: () => wasmUrl });
    const replacement = new SQL.Database(bytes);
    const value = replacement.exec(
      "SELECT value FROM documents WHERE collection='workspace' AND id='default'",
    )[0]?.values[0]?.[0];
    if (!value) {
      replacement.close();
      throw new Error('Invalid backup');
    }
    const data = JSON.parse(String(value)) as DeckData;
    await putMany(this.idb, [
      ['deck.db', bytes],
      [`deck-backup-${today()}-before-restore.db`, this.db.export()],
    ]);
    this.db.close();
    this.db = replacement;
    return data;
  }
  async location() {
    return `This browser · IndexedDB / ${this.scope ? `deck-account-${this.scope}` : 'deck-local'} / deck.db`;
  }
  async switchProfile(profile: string) {
    const replacement = new BrowserRepository(profile);
    const data = await replacement.load();
    this.db?.close();
    this.idb?.close();
    this.scope = replacement.scope;
    this.db = replacement.db;
    this.idb = replacement.idb;
    this.journalKey = replacement.journalKey;
    this.recoveredKeys = replacement.recoveredKeys;
    localStorage.setItem('deck-active-profile', this.scope);
    return data;
  }
  async clear() {
    const keys = await request(this.idb.transaction('files').objectStore('files').getAllKeys());
    await putMany(this.idb, [], keys.map(String));
    this.db.run('DELETE FROM documents');
    this.recoveredKeys = [];
  }
}
class NativeRepository implements DeckRepository {
  async load() {
    const profile = localStorage.getItem('deck-active-profile') || '';
    const value = await invoke<string | null>(
      profile ? 'switch_profile' : 'load_data',
      profile ? { profile } : {},
    );
    return value ? JSON.parse(value) : null;
  }
  async save(data: DeckData) {
    await invoke('save_data', { data: JSON.stringify(data) });
  }
  async backups() {
    return invoke<Backup[]>('list_backups');
  }
  async backup() {
    await invoke('create_backup');
  }
  async restore(name: string) {
    return JSON.parse(await invoke<string>('restore_backup', { name }));
  }
  async location() {
    return invoke<string>('database_location');
  }
  async switchProfile(profile: string) {
    const value = await invoke<string | null>('switch_profile', { profile });
    return value ? (JSON.parse(value) as DeckData) : null;
  }
  async clear() {
    await invoke('clear_local_data');
  }
}
export const repository: DeckRepository = isTauri()
  ? new NativeRepository()
  : new BrowserRepository();
