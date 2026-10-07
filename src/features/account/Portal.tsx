import { invoke, isTauri } from '@tauri-apps/api/core';
import { useEffect, useState, type ReactNode } from 'react';
import { ArrowRight, ShieldCheck } from 'lucide-react';
import {
  authClient,
  portalEnabled,
  useCloud,
  startSync,
  completeSetup,
  keepLocalOnly,
  switchLocalProfile,
  signOut,
  reviewSync,
  api,
} from '../../lib/cloud';
import { deckHasContent } from '../../lib/sync-policy';
import { useDeck } from '../../stores/deck';
import { DeckMark, Modal } from '../../components/ui';
import './account.css';

export function Portal({ children }: { children: ReactNode }) {
  const { authMode } = useCloud();
  const reset =
    location.pathname === '/reset-password' && new URLSearchParams(location.search).has('token');
  return (
    <>
      {children}
      {isTauri() ? <DesktopSession /> : portalEnabled ? <BrowserSession /> : null}
      <SyncLifecycle />
      <SignOutDialog />
      {portalEnabled && <DesktopApproval />}
      <Modal
        open={!!authMode || reset}
        onClose={() => {
          useCloud.setState({ authMode: null });
          if (reset) {
            history.replaceState({}, '', '/app');
            location.reload();
          }
        }}
        title={reset ? 'Reset your password' : 'Sign in to sync'}
        className="account-auth-modal"
      >
        {(authMode || reset) && (
          <AuthScreen
            initial={reset ? 'reset' : authMode || 'signin'}
            onClose={() => {
              useCloud.setState({ authMode: null });
              if (reset) {
                history.replaceState({}, '', '/app');
                location.reload();
              }
            }}
          />
        )}
      </Modal>
    </>
  );
}
function BrowserSession() {
  const session = authClient.useSession();
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);
  useEffect(() => {
    let next = session.data?.user;
    if (!next && (!online || session.error)) {
      try {
        next = JSON.parse(localStorage.getItem('deck-offline-user') || 'null');
      } catch {
        /* no cached identity */
      }
    }
    if (next?.id) {
      const { id, name, email } = next;
      useCloud.setState({ user: { id, name, email }, authMode: null });
      localStorage.setItem('deck-offline-user', JSON.stringify({ id, name, email }));
    } else if (!session.isPending && online && !session.error) {
      useCloud.setState({ user: null, status: 'Local only', setup: null, firstSync: false });
      localStorage.removeItem('deck-offline-user');
    }
  }, [session.data, session.isPending, session.error, online]);
  useEffect(() => {
    const refresh = (event: StorageEvent) => {
      if (event.key === 'deck-active-profile') location.reload();
      if (event.key === 'deck-offline-user') {
        try {
          if (!event.newValue || JSON.parse(event.newValue).id !== useCloud.getState().user?.id)
            location.reload();
        } catch {
          location.reload();
        }
      }
    };
    window.addEventListener('storage', refresh);
    return () => window.removeEventListener('storage', refresh);
  }, []);
  return null;
}
function DesktopSession() {
  const ready = useDeck((s) => s.ready);
  useEffect(() => {
    if (!ready) return;
    try {
      const cached = JSON.parse(localStorage.getItem('deck-native-user') || 'null');
      if (cached?.id) useCloud.setState({ user: cached });
    } catch {
      /* no cached identity */
    }
    const connect = () =>
      void invoke<{ id: string; name: string; email: string }>('cloud_request', {
        path: 'me',
        body: null,
      })
        .then((next) => {
          localStorage.setItem('deck-native-user', JSON.stringify(next));
          useCloud.setState({ user: next });
        })
        .catch(() => {});
    connect();
    window.addEventListener('online', connect);
    return () => window.removeEventListener('online', connect);
  }, [ready]);
  return null;
}
function SyncLifecycle() {
  const ready = useDeck((s) => s.ready);
  const data = useDeck((s) => s.data);
  const { user, firstSync, setup, error } = useCloud();
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (ready && user && location.pathname !== '/desktop-connect') {
      useCloud.setState({ lastSynced: useDeck.getState().data.local?.lastSynced || null });
      return startSync();
    }
  }, [ready, user?.id]);
  const scenario = setup?.scenario;
  const act = async (action: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await action();
    } catch (e) {
      useCloud.setState({ error: String(e), status: 'Sync issue' });
    } finally {
      setBusy(false);
    }
  };
  const title =
    scenario === 'upload'
      ? 'Back up this Deck?'
      : scenario === 'restore'
        ? 'Restore your Deck'
        : scenario === 'account-switch'
          ? 'This Deck belongs to another account'
          : 'Both this device and your account contain Deck data.';
  return (
    <Modal open={firstSync} onClose={keepLocalOnly} title={title} className="first-sync">
      {setup && (
        <>
          <p>
            {data.tasks.length} tasks · {data.stacks.length} Stacks · {data.templates?.length || 0}{' '}
            templates on this device
          </p>
          {scenario === 'upload' && (
            <p>Sync this Deck to back it up and make it available on your other devices.</p>
          )}
          {scenario === 'restore' && (
            <p>
              Cloud Deck found: {setup.remote.data.tasks.length} tasks ·{' '}
              {setup.remote.data.stacks.length} Stacks.
              {setup.remote.updated_at && (
                <> Last synced: {new Date(setup.remote.updated_at).toLocaleString()}.</>
              )}{' '}
              Restore it to this device and keep working offline.
            </p>
          )}
          {scenario === 'merge' && (
            <p>
              Merge unique items by their IDs. Overlapping edits remain recoverable in Account →
              Sync history.
            </p>
          )}
          {scenario === 'account-switch' && (
            <p>
              Your current Deck stays in its own local profile. It cannot sync to {user?.email}.
              Switch to a separate profile to restore or start this account’s Deck.
            </p>
          )}
          <div className="account-actions">
            {scenario === 'account-switch' ? (
              <button
                className="primary-button"
                disabled={busy}
                onClick={() => void act(() => switchLocalProfile(user!.id))}
              >
                Switch to this account’s Deck
              </button>
            ) : (
              <button
                className="primary-button"
                disabled={busy}
                onClick={() =>
                  void act(() => completeSetup(scenario === 'restore' ? 'cloud' : 'merge'))
                }
              >
                {busy
                  ? 'Connecting…'
                  : scenario === 'upload'
                    ? 'Sync This Deck'
                    : scenario === 'restore'
                      ? 'Restore and Sync'
                      : 'Merge Decks'}
              </button>
            )}
            <button className="secondary-button" disabled={busy} onClick={keepLocalOnly}>
              Keep Local Only
            </button>
          </div>
          {scenario === 'merge' && (
            <div className="sync-alternatives">
              <p>
                Use Cloud Deck replaces the visible local Deck. A local backup and recovery copy
                preserve this device’s current content.
              </p>
              <button
                disabled={busy}
                onClick={() => {
                  if (
                    confirm(
                      'Replace the visible local Deck with your cloud Deck? Your current content is retained in a local backup and sync recovery.',
                    )
                  )
                    void act(() => completeSetup('cloud'));
                }}
              >
                Use Cloud Deck
              </button>
              <p>
                Keep This Device’s Deck replaces the cloud Deck with this device’s content. Other
                devices will receive that change. The previous cloud revision stays in sync history.
              </p>
              <button
                disabled={busy}
                onClick={() => {
                  if (
                    confirm(
                      'Replace your cloud Deck with this device’s Deck? Other devices will receive that change.',
                    )
                  )
                    void act(() => completeSetup('device'));
                }}
              >
                Keep This Device’s Deck
              </button>
            </div>
          )}
        </>
      )}
      {error && <p role="alert">{error}</p>}
      {error && (
        <button disabled={busy} onClick={() => void act(reviewSync)}>
          Check cloud again
        </button>
      )}
    </Modal>
  );
}
function DesktopApproval() {
  const { user, authMode } = useCloud();
  const id = new URLSearchParams(location.search).get('pair');
  const active = location.pathname === '/desktop-connect' && !!id;
  const [device, setDevice] = useState<{
    name: string;
    platform: string;
    architecture: string;
    appVersion: string;
  } | null>(null);
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [done, setDone] = useState(false);
  useEffect(() => {
    if (active)
      void api<typeof device>(`devices/pair/${id}`)
        .then(setDevice)
        .catch((e) => setError(String(e)));
  }, [active, id]);
  return (
    <Modal
      open={active && !authMode}
      onClose={() => location.assign('/app')}
      title={done ? 'Desktop connected' : 'Connect Deck Desktop'}
    >
      {done ? (
        <p>You can return to Deck Desktop. Choose which Deck to sync there.</p>
      ) : (
        <>
          {device && (
            <p>
              Connect <strong>{device.name}</strong> ({device.platform} {device.architecture}, Deck{' '}
              {device.appVersion}) to your account.
            </p>
          )}
          <p>
            Approve only a connection you started from Deck Desktop. Your local data will stay on
            that device until you choose to sync it.
          </p>
          {user ? (
            <>
              <p>{user.email}</p>
              <button
                className="primary-button"
                disabled={busy || !device}
                onClick={async () => {
                  setBusy(true);
                  setError('');
                  try {
                    await api('devices/pair/approve', { id });
                    setDone(true);
                  } catch (e) {
                    setError(String(e));
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Approve this device
              </button>
            </>
          ) : (
            <button
              className="primary-button"
              onClick={() => useCloud.setState({ authMode: 'signin' })}
            >
              Sign in to connect
            </button>
          )}
        </>
      )}
      {error && <p role="alert">{error}</p>}
      <button onClick={() => location.assign('/app')}>{done ? 'Open Deck Web' : 'Not now'}</button>
    </Modal>
  );
}
function SignOutDialog() {
  const open = useCloud((s) => s.signOutOpen);
  const data = useDeck((s) => s.data);
  const [remove, setRemove] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  useEffect(() => {
    if (open) {
      setRemove(false);
      setError('');
    }
  }, [open]);
  return (
    <Modal
      open={open}
      onClose={() => {
        if (!busy) useCloud.setState({ signOutOpen: false });
      }}
      title="Sign out of Deck"
    >
      <p>What should happen to the Deck stored on this device?</p>
      <label className="account-signout-choice">
        <input
          type="radio"
          name="signout-data"
          checked={!remove}
          onChange={() => setRemove(false)}
        />
        <span>
          <strong>Keep data on this device</strong>
          <small>Your tasks remain available locally. Future changes will not sync.</small>
        </span>
      </label>
      <label className="account-signout-choice">
        <input type="radio" name="signout-data" checked={remove} onChange={() => setRemove(true)} />
        <span>
          <strong>Remove synced data from this device</strong>
          <small>
            This profile’s local Deck and backups will be removed. Cloud data remains in your
            account. Unsynced changes will be lost.
          </small>
        </span>
      </label>
      {error && <p role="alert">{error}</p>}
      <div className="account-actions">
        <button
          className={remove ? 'danger-button' : 'primary-button'}
          disabled={busy}
          onClick={async () => {
            if (
              remove &&
              deckHasContent(data) &&
              !confirm(
                'Remove this profile’s Deck and local backups from this device? Unsynced changes cannot be recovered.',
              )
            )
              return;
            setBusy(true);
            try {
              await signOut(remove);
            } catch (e) {
              setError(String(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy
            ? 'Signing out…'
            : remove
              ? 'Remove local data and sign out'
              : 'Keep data and sign out'}
        </button>
        <button disabled={busy} onClick={() => useCloud.setState({ signOutOpen: false })}>
          Cancel
        </button>
      </div>
    </Modal>
  );
}

function AuthScreen({ initial = 'signin', onClose }: { initial?: string; onClose: () => void }) {
  const [mode, setMode] = useState(initial);
  const callbackURL =
    location.pathname === '/desktop-connect' ? location.pathname + location.search : '/app';
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [google, setGoogle] = useState(false);
  const [entra, setEntra] = useState(false);
  const [emailEnabled, setEmailEnabled] = useState(true);
  useEffect(() => {
    fetch('/api/v1/config')
      .then((r) => r.json())
      .then((v) => {
        setGoogle(v.google);
        setEntra(!!v.entra);
        setEmailEnabled(v.email !== false);
      })
      .catch(() => {});
  }, []);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    setMessage('');
    try {
      let result;
      if (mode === 'signup')
        result = await authClient.signUp.email({ name, email, password, callbackURL });
      else if (mode === 'forgot')
        result = await authClient.requestPasswordReset({ email, redirectTo: '/reset-password' });
      else if (mode === 'reset')
        result = await authClient.resetPassword({
          newPassword: password,
          token: new URLSearchParams(location.search).get('token') || '',
        });
      else result = await authClient.signIn.email({ email, password, callbackURL });
      if (result.error) throw new Error(result.error.message);
      if (mode === 'signup') setMessage('Check your email to verify your account, then open Deck.');
      if (mode === 'forgot')
        setMessage('If an account exists, a password reset link is on its way.');
      if (mode === 'reset') {
        history.replaceState({}, '', '/app');
        setMode('signin');
        setPassword('');
        setMessage('Password updated. Sign in to your Deck.');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to connect. Please try again.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="account-auth">
      <section className="auth-benefits">
        <a className="auth-brand" href="/app">
          <DeckMark size={34} />
          Deck
        </a>
        <h2>Take your Deck anywhere</h2>
        <p>Back up your Deck and access it from other devices.</p>
        <ul>
          <li>Back up your tasks, Stacks, and templates</li>
          <li>Sync across devices, including Deck Web and mobile browsers</li>
          <li>Recover your Deck on a new computer</li>
        </ul>
        <p>Your Deck stays available offline. You choose what to sync after signing in.</p>
      </section>
      <section className="auth-form-panel">
        <div className="auth-form-wrap">
          <span className="auth-eyebrow">YOUR QUIET CORNER</span>
          <h2>
            {mode === 'signup'
              ? 'A fresh start.'
              : mode === 'forgot'
                ? 'Find your way back.'
                : mode === 'reset'
                  ? 'A new password.'
                  : 'Welcome back.'}
          </h2>
          <p>
            {mode === 'signup'
              ? 'Create an account when you’re ready to sync.'
              : mode === 'forgot'
                ? 'We’ll email you a link to reset your password.'
                : mode === 'reset'
                  ? 'Choose a password with at least 12 characters.'
                  : 'Sign in to pick up where you left off.'}
          </p>
          {entra ? (
            <button
              className="primary-button auth-submit"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                setError('');
                const result = await authClient.signIn.social({ provider: 'entra', callbackURL });
                if (result.error) {
                  setError(result.error.message || 'Sign-in failed');
                  setBusy(false);
                }
              }}
            >
              {busy ? 'One moment…' : 'Continue with email'}
              <ArrowRight size={16} />
            </button>
          ) : null}
          {google && ['signin', 'signup'].includes(mode) && (
            <>
              <button
                className="google-button"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  const r = await authClient.signIn.social({
                    provider: 'google',
                    callbackURL,
                  });
                  if (r.error) {
                    setError(r.error.message || 'Google sign-in failed');
                    setBusy(false);
                  }
                }}
              >
                <b>G</b>Continue with Google
              </button>
              <div className="auth-divider">or with email</div>
            </>
          )}
          {emailEnabled && (
            <form onSubmit={submit}>
              {mode === 'signup' && (
                <label>
                  Your name
                  <input
                    autoComplete="name"
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                </label>
              )}
              {mode !== 'reset' && (
                <label>
                  Email
                  <input
                    type="email"
                    autoComplete="email"
                    placeholder="you@example.com"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </label>
              )}
              {mode !== 'forgot' && (
                <label>
                  Password
                  <input
                    type="password"
                    autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
                    minLength={mode === 'signin' ? 1 : 12}
                    maxLength={128}
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </label>
              )}
              {mode === 'signin' && (
                <button
                  className="auth-link forgot"
                  type="button"
                  onClick={() => {
                    setMode('forgot');
                    setError('');
                  }}
                >
                  Forgot password?
                </button>
              )}
              {error && (
                <p className="auth-error" role="alert">
                  {error}
                </p>
              )}
              {message && (
                <p className="auth-message" role="status">
                  {message}
                </p>
              )}
              <button className="primary-button auth-submit" disabled={busy}>
                {busy
                  ? 'One moment…'
                  : mode === 'signup'
                    ? 'Create account with email'
                    : mode === 'forgot'
                      ? 'Send reset link'
                      : mode === 'reset'
                        ? 'Update password'
                        : 'Continue with Email'}
                <ArrowRight size={16} />
              </button>
            </form>
          )}
          {emailEnabled && (
            <p className="auth-switch">
              {mode === 'signin' ? 'New to Deck? ' : 'Already have an account? '}
              <button
                className="auth-link"
                onClick={() => {
                  setMode(mode === 'signin' ? 'signup' : 'signin');
                  setError('');
                  setMessage('');
                }}
              >
                {mode === 'signin' ? 'Create an account' : 'Sign in'}
              </button>
            </p>
          )}
          {entra && error && (
            <p className="auth-error" role="alert">
              {error}
            </p>
          )}
          {entra && (
            <p className="auth-switch">
              Create an account, sign in, or reset your password on Deck’s secure sign-in page.
            </p>
          )}
          <button className="secondary-button" onClick={onClose}>
            Not now
          </button>
          <div className="auth-reassurance">
            <ShieldCheck size={17} />
            <span>
              Private by design.
              <br />
              Your cards belong to you.
            </span>
          </div>
        </div>
        <small className="auth-bottom">A fast, calm, local-first task manager.</small>
      </section>
    </div>
  );
}
