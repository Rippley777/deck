import { isTauri } from '@tauri-apps/api/core';
import { ProjectDiscovery } from './ProjectDiscovery';
import { DesktopAccount } from '../account/DesktopAccount';
import { Account } from '../account/Account';
import { useEffect, useRef, useState } from 'react';
import {
  Archive,
  Check,
  Download,
  HardDrive,
  Keyboard,
  Monitor,
  Moon,
  Palette,
  Settings2,
  ShieldCheck,
  Sun,
  Upload,
  Wrench,
} from 'lucide-react';
import { Modal } from '../../components/ui';
import { flushPersistence, useDeck } from '../../stores/deck';
import { repository, type Backup } from '../../lib/repository';
import { exportData, importData } from '../../lib/transfer';
import type { DeckData, Settings as SettingsType } from '../../types';
const tabs = [
  { name: 'Account', icon: ShieldCheck },
  { name: 'General', icon: Settings2 },
  { name: 'Appearance', icon: Palette },
  { name: 'Keyboard', icon: Keyboard },
  { name: 'Data', icon: HardDrive },
  { name: 'Backups', icon: Archive },
  { name: 'Advanced', icon: Wrench },
];
export function Settings() {
  const { data, modal, setModal, commit, notify, error } = useDeck();
  const tab = useDeck((s) => s.settingsTab);
  const setTab = (settingsTab: string) => useDeck.setState({ settingsTab });
  const [backups, setBackups] = useState<Backup[]>([]);
  const [location, setLocation] = useState('');
  const [importError, setImportError] = useState('');
  const [importPreview, setImportPreview] = useState<DeckData | null>(null);
  const [restore, setRestore] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [goalTitle, setGoalTitle] = useState('');
  const file = useRef<HTMLInputElement>(null);
  const settings = data.settings;
  const patch = (p: Partial<SettingsType>) => commit({ ...data, settings: { ...settings, ...p } });
  useEffect(() => {
    if (modal === 'settings') {
      repository
        .backups()
        .then(setBackups)
        .catch((e) => setImportError(String(e)));
      repository
        .location()
        .then(setLocation)
        .catch((e) => setImportError(String(e)));
    }
  }, [modal, tab]);
  return (
    <Modal
      open={modal === 'settings'}
      onClose={() => setModal(null)}
      title="Make yourself at home."
      className="settings-modal"
    >
      <div className="settings-body">
        <nav className="settings-tabs" aria-label="Settings sections">
          {tabs.map(({ name, icon: Icon }) => (
            <button
              className={tab === name ? 'active' : ''}
              key={name}
              onClick={() => setTab(name)}
            >
              <Icon size={15} />
              {name}
            </button>
          ))}
        </nav>
        <div className="settings-content">
          <h3>{tab}</h3>
          {tab === 'Account' && (isTauri() ? <DesktopAccount /> : <Account />)}
          {tab === 'General' && (
            <>
              <p className="small-muted">A few preferences for your everyday.</p>
              <label className="setting-row">
                <span>Start the week on</span>
                <select
                  value={settings.startOfWeek}
                  onChange={(e) => patch({ startOfWeek: Number(e.target.value) as 0 | 1 })}
                >
                  <option value="1">Monday</option>
                  <option value="0">Sunday</option>
                </select>
              </label>
              <label className="setting-row">
                <span>Quick capture destination</span>
                <select
                  value={settings.defaultDestination}
                  onChange={(e) =>
                    patch({
                      defaultDestination: e.target.value as SettingsType['defaultDestination'],
                    })
                  }
                >
                  <option value="inbox">Inbox</option>
                  <option value="anytime">Anytime</option>
                  <option value="someday">Someday</option>
                </select>
              </label>
              <label className="setting-row">
                <span>Date format</span>
                <select
                  value={settings.dateFormat}
                  onChange={(e) => patch({ dateFormat: e.target.value as 'friendly' | 'iso' })}
                >
                  <option value="friendly">Sep 29, 2026</option>
                  <option value="iso">2026-09-29</option>
                </select>
              </label>
              <label className="setting-row">
                <span>24-hour clock</span>
                <input
                  type="checkbox"
                  role="switch"
                  checked={settings.clock24}
                  onChange={(e) => patch({ clock24: e.target.checked })}
                />
              </label>
              <label className="setting-row">
                <span>A little completion sound</span>
                <input
                  type="checkbox"
                  role="switch"
                  checked={settings.sound}
                  onChange={(e) => patch({ sound: e.target.checked })}
                />
              </label>
            </>
          )}
          {tab === 'Appearance' && (
            <>
              <p className="small-muted">Find your kind of calm.</p>
              <div className="theme-options">
                {(
                  [
                    { value: 'dark', label: 'Evening', icon: Moon },
                    { value: 'light', label: 'Daylight', icon: Sun },
                    { value: 'system', label: 'With your device', icon: Monitor },
                  ] as const
                ).map(({ value, label, icon: Icon }) => (
                  <button
                    key={value}
                    className={settings.theme === value ? 'selected' : ''}
                    onClick={() => patch({ theme: value })}
                  >
                    <div className={`theme-preview preview-${value}`}>
                      <i />
                      <span />
                      <span />
                      <span />
                    </div>
                    <Icon size={14} />
                    {label}
                    {settings.theme === value && <Check size={13} />}
                  </button>
                ))}
              </div>
              <label className="setting-row">
                <span>Gentle animations</span>
                <input
                  type="checkbox"
                  role="switch"
                  checked={settings.animations}
                  onChange={(e) => patch({ animations: e.target.checked })}
                />
              </label>
            </>
          )}
          {tab === 'Keyboard' && (
            <>
              <p className="small-muted">Keep your hands where your thoughts are.</p>
              <div className="shortcut-list">
                {[
                  ['Quick add', '⌘ / Ctrl N'],
                  ['Command palette', '⌘ / Ctrl K'],
                  ['Complete open card', '⌘ / Ctrl Enter'],
                  ['Jump to a section', 'Alt 1–7'],
                  ['Show all shortcuts', '?'],
                ].map(([label, key]) => (
                  <div key={label}>
                    <span>{label}</span>
                    <kbd>{key}</kbd>
                  </div>
                ))}
              </div>
              <button className="secondary-button" onClick={() => setModal('shortcuts')}>
                All keyboard shortcuts <Keyboard size={14} />
              </button>
            </>
          )}
          {tab === 'Data' && (
            <>
              <p className="small-muted">Your data belongs to you. Take it wherever you go.</p>
              <h4>Export your workspace</h4>
              <p className="small-muted">
                Export all {data.stacks.length} stacks and {data.tasks.length} cards, including
                completed cards and empty stacks. JSON also includes goals, templates, and settings.
              </p>
              <div className="export-options">
                {(['json', 'csv', 'md'] as const).map((format) => (
                  <button
                    className="secondary-button"
                    key={format}
                    disabled={exporting}
                    onClick={async () => {
                      setImportError('');
                      setExporting(true);
                      try {
                        if (await exportData(data, format)) notify('Your export is ready.');
                      } catch (error) {
                        setImportError(`Could not export your workspace: ${String(error)}`);
                      } finally {
                        setExporting(false);
                      }
                    }}
                  >
                    <Download size={14} />
                    {format === 'md' ? 'Markdown' : format.toUpperCase()}
                  </button>
                ))}
              </div>
              <h4>Bring your cards along</h4>
              <p className="small-muted">
                Import a Deck JSON or CSV export, or a CSV with a title column. Matching IDs update
                existing stacks and cards. Other stacks and cards are kept.
              </p>
              <input
                ref={file}
                type="file"
                accept=".json,.csv"
                hidden
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  if (!f) return;
                  setImportError('');
                  try {
                    if (f.size > 20000000)
                      throw new Error('Please choose a file smaller than 20 MB.');
                    const content = await f.text();
                    setImportPreview(
                      importData(content, f.name.endsWith('.csv') ? 'csv' : 'json', data),
                    );
                  } catch (err) {
                    setImportError(
                      err instanceof Error ? err.message : 'Could not read this file.',
                    );
                  }
                  e.target.value = '';
                }}
              />
              <button className="secondary-button" onClick={() => file.current?.click()}>
                <Upload size={14} /> Choose a file
              </button>
              {importPreview && (
                <div className="import-preview">
                  <p>
                    After import: <strong>{importPreview.tasks.length} cards</strong> in{' '}
                    {importPreview.stacks.length} stacks.
                  </p>
                  <button
                    className="primary-button"
                    onClick={async () => {
                      try {
                        await flushPersistence();
                        await repository.backup();
                        commit(importPreview);
                        setImportPreview(null);
                        notify('Your cards are right at home. Import complete.');
                      } catch (e) {
                        setImportError(String(e));
                      }
                    }}
                  >
                    Import workspace
                  </button>
                  <button className="text-button" onClick={() => setImportPreview(null)}>
                    Cancel
                  </button>
                </div>
              )}
            </>
          )}
          {tab === 'Backups' && (
            <>
              <div className="backup-intro">
                <ShieldCheck size={29} />
                <p>
                  Peace of mind, built in.<small>Deck keeps up to 14 local SQLite snapshots.</small>
                </p>
              </div>
              <label className="setting-row">
                <span>Automatic snapshots</span>
                <select
                  value={settings.backupFrequency}
                  onChange={(e) => patch({ backupFrequency: e.target.value as 'daily' | 'weekly' })}
                >
                  <option value="daily">Every day</option>
                  <option value="weekly">Every week</option>
                </select>
              </label>
              <button
                className="secondary-button"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await flushPersistence();
                    await repository.backup();
                    setBackups(await repository.backups());
                    notify('A fresh backup, just in case.');
                  } catch (e) {
                    setImportError(String(e));
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                <Archive size={14} /> Back up now
              </button>
              <div className="backup-list">
                {backups.map((b) => (
                  <div key={b.name}>
                    <span>{b.name}</span>
                    <button onClick={() => setRestore(b.name)}>Restore</button>
                  </div>
                ))}
              </div>
              {restore && (
                <div className="import-preview">
                  <p>Restore {restore}? A copy of the current workspace is saved first.</p>
                  <button
                    className="primary-button"
                    disabled={busy}
                    onClick={async () => {
                      setBusy(true);
                      try {
                        await flushPersistence();
                        const restored = await repository.restore(restore);
                        commit(restored);
                        setRestore(null);
                        notify('Workspace restored.');
                        setBackups(await repository.backups());
                      } catch (e) {
                        setImportError(String(e));
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    Restore backup
                  </button>
                  <button className="text-button" onClick={() => setRestore(null)}>
                    Keep current workspace
                  </button>
                </div>
              )}
            </>
          )}
          {tab === 'Advanced' && (
            <>
              <ProjectDiscovery />
              <p className="small-muted">Local by design. No account required.</p>
              <h4>Database location</h4>
              <code className="database-location">{location}</code>
              <p className="small-muted">
                Desktop data lives in your application data folder. Browser data stays in this
                browser; export a copy before clearing site storage.
              </p>
              <h4>Goals & milestones</h4>
              {data.goals.map((goal) => (
                <div className="goal-editor" key={goal.id}>
                  <input
                    className="field"
                    aria-label="Goal title"
                    value={goal.title}
                    onChange={(e) =>
                      commit({
                        ...data,
                        goals: data.goals.map((g) =>
                          g.id === goal.id ? { ...g, title: e.target.value } : g,
                        ),
                      })
                    }
                  />
                  <select
                    className="field"
                    multiple
                    aria-label="Goal stacks"
                    value={goal.stackIds}
                    onChange={(e) =>
                      commit({
                        ...data,
                        goals: data.goals.map((g) =>
                          g.id === goal.id
                            ? {
                                ...g,
                                stackIds: Array.from(e.target.selectedOptions, (o) => o.value),
                              }
                            : g,
                        ),
                      })
                    }
                  >
                    {data.stacks.map((s) => (
                      <option value={s.id} key={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                  <button
                    className="text-button"
                    onClick={() =>
                      commit({ ...data, goals: data.goals.filter((g) => g.id !== goal.id) })
                    }
                  >
                    Remove goal
                  </button>
                </div>
              ))}
              <form
                className="goal-add"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (goalTitle.trim()) {
                    commit({
                      ...data,
                      goals: [
                        ...data.goals,
                        { id: crypto.randomUUID(), title: goalTitle.trim(), stackIds: [] },
                      ],
                    });
                    setGoalTitle('');
                  }
                }}
              >
                <input
                  className="field"
                  value={goalTitle}
                  onChange={(e) => setGoalTitle(e.target.value)}
                  placeholder="A new goal…"
                />
                <button className="secondary-button">Add goal</button>
              </form>
              <div className="storage-status">
                <span className="status-dot" />
                {error ? 'Storage needs attention' : 'SQLite · Schema 1 · Local-first'}
              </div>
            </>
          )}
          {importError && (
            <p role="alert" className="error-text">
              {importError}
            </p>
          )}
        </div>
      </div>
      <div className="settings-footer">
        <span>
          Deck <small>0.1.0</small>
        </span>
        <span>A thoughtful home for your everyday.</span>
      </div>
    </Modal>
  );
}
