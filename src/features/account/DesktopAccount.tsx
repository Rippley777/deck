import { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useCloud } from '../../lib/cloud';
import { useDeck, flushPersistence } from '../../stores/deck';

export function DesktopAccount() {
  const { user, status, error } = useCloud();
  const [origin, setOrigin] = useState('');
  const [token, setToken] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <div className="account-panel">
      <h4>Your Deck, anywhere.</h4>
      <p>
        Connect to your Deck web portal. Your desktop database stays on this computer and works
        offline.
      </p>
      {user ? (
        <>
          <p>
            {user.email} · {status}
          </p>
          {error && <p role="alert">{error}</p>}
          {!useDeck.getState().data.cloud && (
            <button
              onClick={() => {
                useCloud.setState({ firstSync: true, firstSyncDeferred: false });
                useDeck.getState().setModal(null);
              }}
            >
              Review first sync
            </button>
          )}
          <button
            onClick={async () => {
              try {
                await invoke('disconnect_cloud');
                localStorage.removeItem('deck-native-user');
                useCloud.setState({ user: null });
                location.reload();
              } catch (e) {
                setMessage(String(e));
              }
            }}
          >
            Disconnect this desktop
          </button>
        </>
      ) : (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setMessage('');
            try {
              const next = await invoke<{ id: string; name: string; email: string }>(
                'connect_cloud',
                { origin, token },
              );
              const old = useDeck.getState().data.cloud?.userId;
              if (old && old !== next.id) {
                await invoke('disconnect_cloud');
                throw new Error(
                  'This desktop Deck belongs to a different account. Export it and use a separate local profile before connecting another account.',
                );
              }
              await flushPersistence();
              setToken('');
              localStorage.setItem('deck-native-user', JSON.stringify(next));
              useCloud.setState({ user: next });
            } catch (e) {
              setMessage(String(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          <p>
            Sign in on the web, open Account → Sessions, and create a desktop connection token.
            Paste it here once; Deck stores it in your operating system’s credential vault.
          </p>
          <label>
            Portal address
            <input
              type="url"
              placeholder="https://app.deck.example.com"
              value={origin}
              onChange={(e) => setOrigin(e.target.value)}
              required
            />
          </label>
          <label>
            Connection token
            <input
              type="password"
              autoComplete="off"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              required
            />
          </label>
          <button className="primary-button" disabled={busy}>
            {busy ? 'Connecting…' : 'Connect desktop'}
          </button>
        </form>
      )}
      {message && <p role="alert">{message}</p>}
    </div>
  );
}
