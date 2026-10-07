import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { api, reviewSync, useCloud, openSignOut } from '../../lib/cloud';
import { useDeck } from '../../stores/deck';
import { LocalProfiles } from './Account';
import { download } from '../../lib/transfer';

export function DesktopAccount() {
  const { user, status, lastSynced, error } = useCloud();
  const data = useDeck((s) => s.data);
  const [origin, setOrigin] = useState(
    localStorage.getItem('deck-portal-origin') || import.meta.env.VITE_DECK_CLOUD_URL || '',
  );
  const [token, setToken] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [pairing, setPairing] = useState<{ id: string; secret: string; origin: string } | null>(
    null,
  );
  const [devices, setDevices] = useState<
    {
      id: string;
      name: string;
      platform?: string;
      architecture?: string;
      app_version?: string;
      last_sync?: string;
    }[]
  >([]);
  useEffect(() => {
    if (!user) return;
    void api<typeof devices>('devices')
      .then(setDevices)
      .catch(() => {});
  }, [user?.id]);
  useEffect(() => {
    if (!pairing) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const result = await invoke<{ pending?: boolean; user?: NonNullable<typeof user> }>(
          'poll_cloud_signin',
          pairing,
        );
        if (cancelled) return;
        if (result.user) {
          localStorage.setItem('deck-native-user', JSON.stringify(result.user));
          useCloud.setState({ user: result.user, firstSyncDeferred: false, setup: null });
          setPairing(null);
          useDeck.getState().setModal(null);
        } else timer = setTimeout(() => void poll(), 2000);
      } catch (e) {
        if (!cancelled) {
          setMessage(String(e));
          setPairing(null);
        }
      }
    };
    timer = setTimeout(() => void poll(), 2000);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [pairing]);
  const connect = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setMessage('');
    try {
      const next = await invoke<NonNullable<typeof user>>('connect_cloud', { origin, token });
      setToken('');
      localStorage.setItem('deck-native-user', JSON.stringify(next));
      localStorage.setItem('deck-portal-origin', origin);
      useCloud.setState({ user: next, firstSyncDeferred: false, setup: null });
      useDeck.getState().setModal(null);
    } catch (e) {
      setMessage(String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="account-panel">
      <h4>Deck Account</h4>
      {user ? (
        <>
          <p>
            {user.email} · <strong>{status}</strong>
          </p>
          {lastSynced && <p>Last successful sync: {new Date(lastSynced).toLocaleString()}</p>}
          {error && <p role="alert">{error}</p>}
          <button
            disabled={busy}
            onClick={() => {
              void reviewSync();
              useDeck.getState().setModal(null);
            }}
          >
            {data.local?.syncEnabled ? 'Retry sync' : 'Set up sync'}
          </button>
          <button onClick={openSignOut}>Sign out</button>
          <h4>Devices</h4>
          {devices.map((device) => (
            <p key={device.id}>
              {device.name}
              <small>
                {device.platform} {device.architecture} · Deck {device.app_version}
                {device.last_sync && ` · Last sync ${new Date(device.last_sync).toLocaleString()}`}
              </small>
            </p>
          ))}
          {!!data.cloud?.recovery?.length && (
            <button
              onClick={() =>
                void download(
                  'deck-sync-recovery.json',
                  JSON.stringify(data.cloud?.recovery, null, 2),
                  'application/json',
                )
              }
            >
              Download edits recovered during sync
            </button>
          )}
        </>
      ) : (
        <>
          <p>You’re currently using Deck locally. Your data is stored only on this device.</p>
          <h4>Take your Deck anywhere</h4>
          <p>
            Sign in with email or Google in your browser to back up your Deck, sync across devices,
            and recover it on a new computer. Deck stays available offline.
          </p>
          <label>
            Portal address
            <input
              type="url"
              placeholder="Your HTTPS Deck portal address"
              value={origin}
              onChange={(e) => setOrigin(e.target.value)}
            />
          </label>
          <button
            className="primary-button"
            disabled={busy || !origin || !!pairing}
            onClick={async () => {
              setBusy(true);
              setMessage('');
              try {
                const bytes = crypto.getRandomValues(new Uint8Array(32));
                const secret = btoa(String.fromCharCode(...bytes))
                  .replace(/\+/g, '-')
                  .replace(/\//g, '_')
                  .replace(/=+$/, '');
                let deviceId = localStorage.getItem('deck-device-id');
                if (!deviceId) {
                  deviceId = crypto.randomUUID();
                  localStorage.setItem('deck-device-id', deviceId);
                }
                const result = await invoke<{ id: string }>('begin_cloud_signin', {
                  origin,
                  secret,
                  deviceId,
                });
                localStorage.setItem('deck-portal-origin', origin);
                setPairing({ id: result.id, secret, origin });
              } catch (e) {
                setMessage(String(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? 'Opening browser…' : 'Sign in or create an account'}
          </button>
          {pairing && (
            <p role="status">
              Finish signing in and approve this device in your browser.{' '}
              <button onClick={() => setPairing(null)}>Cancel</button>
            </p>
          )}
          <details>
            <summary>Connect with a desktop token</summary>
            <form onSubmit={connect}>
              <p>
                You can also create a token in Deck Web → Settings → Account → Sessions. It is
                stored in your operating system’s credential vault.
              </p>
              <label>
                Connection token
                <input
                  type="password"
                  autoComplete="off"
                  required
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                />
              </label>
              <button disabled={busy || !origin}>Connect desktop</button>
            </form>
          </details>
        </>
      )}
      {message && <p role="alert">{message}</p>}
      <LocalProfiles />
    </div>
  );
}
