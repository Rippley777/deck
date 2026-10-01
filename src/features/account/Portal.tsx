import { invoke, isTauri } from '@tauri-apps/api/core';
import { useEffect, useState, type ReactNode } from 'react';
import { ArrowRight, Check, Cloud, Layers3, ShieldCheck } from 'lucide-react';
import { authClient, portalEnabled, useCloud, startSync, synchronize } from '../../lib/cloud';
import { exportData, importData } from '../../lib/transfer';
import { api } from '../../lib/cloud';
import { setRepositoryAccount } from '../../lib/repository';
import { useDeck } from '../../stores/deck';
import { DeckMark, Modal } from '../../components/ui';
import './account.css';

export function Portal({ children }: { children: ReactNode }) {
  if (isTauri())
    return (
      <>
        {children}
        <DesktopSync />
      </>
    );
  if (!portalEnabled) return children;
  return <AccountGate>{children}</AccountGate>;
}
let mountedAccount: string | null = null;
function AccountGate({ children }: { children: ReactNode }) {
  const session = authClient.useSession();
  const [offline, setOffline] = useState(!navigator.onLine);
  const [bound, setBound] = useState(false);
  const user = useCloud((s) => s.user);
  useEffect(() => {
    const update = () => setOffline(!navigator.onLine);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);
  useEffect(() => {
    let next = session.data?.user;
    if (offline && !next) {
      try {
        next = JSON.parse(localStorage.getItem('deck-offline-user') || 'null');
      } catch {
        /* no offline session */
      }
    }
    if (next) {
      if (mountedAccount && mountedAccount !== next.id) {
        location.reload();
        return;
      }
      mountedAccount = next.id;
      setRepositoryAccount(next.id);
      useCloud.setState({ user: next });
      localStorage.setItem(
        'deck-offline-user',
        JSON.stringify({ id: next.id, name: next.name, email: next.email }),
      );
      setBound(true);
    } else if (!session.isPending && !offline) {
      setBound(false);
      useCloud.setState({ user: null });
    }
  }, [session.data, session.isPending, offline, user?.id]);
  if (new URLSearchParams(location.search).has('token') && location.pathname === '/reset-password')
    return <AuthScreen initial="reset" />;
  if (!bound) {
    if (session.isPending && !offline)
      return (
        <div className="loading-screen">
          <DeckMark size={45} />
          <p>Opening your Deck…</p>
        </div>
      );
    if (session.error && !offline)
      return (
        <div className="loading-screen">
          <DeckMark size={45} />
          <h1>We couldn’t reach your account.</h1>
          <p>Your local Deck is still saved on this device.</p>
          <button className="primary-button" onClick={() => location.reload()}>
            Try again
          </button>
        </div>
      );
    return <AuthScreen />;
  }
  return (
    <>
      {children}
      <SyncLifecycle />
    </>
  );
}
function SyncLifecycle() {
  const ready = useDeck((s) => s.ready);
  const first = useCloud((s) => s.firstSync);
  const error = useCloud((s) => s.error);
  const [busy, setBusy] = useState(false);
  const [cloudCount, setCloudCount] = useState<number | null>(null);
  const [startWith, setStartWith] = useState('today');
  const localCount = useDeck((s) => s.data.tasks.length);
  useEffect(() => {
    if (first)
      api<{ data: { tasks: unknown[] } }>('sync')
        .then((r) => setCloudCount(r.data.tasks.length))
        .catch(() => {});
  }, [first]);
  useEffect(() => {
    if (ready) return startSync();
  }, [ready]);
  return (
    <Modal
      open={first}
      onClose={() =>
        useCloud.setState({ firstSync: false, firstSyncDeferred: true, status: 'Changes pending' })
      }
      title="Your Deck, anywhere."
      description="Connect this device to your private Deck. Independent changes will merge; overlapping versions stay recoverable."
      className="first-sync"
    >
      <div className="onboarding-icons">
        <Layers3 />
        <Cloud />
        <ShieldCheck />
      </div>
      <p>
        {localCount} cards on this device ·{' '}
        {cloudCount === null ? 'Checking cloud…' : `${cloudCount} cards in the cloud`}
      </p>
      <p>
        Your local cards and cloud cards will be combined. No Deck is replaced wholesale. You can
        export your local data from Settings before continuing.
      </p>
      <p>
        New here? Start with a Stack, or choose a starter from the template library once you’re in.
      </p>
      <div className="first-sync-tools">
        {cloudCount === 0 && localCount === 0 && (
          <label>
            Make it yours
            <select value={startWith} onChange={(e) => setStartWith(e.target.value)}>
              <option value="today">Start with Today</option>
              <option value="stack">Create my first Stack</option>
              <option value="templates">Choose a starter template</option>
            </select>
          </label>
        )}
        <button onClick={() => void exportData(useDeck.getState().data, 'json')}>
          Export local Deck
        </button>
        <label>
          Import a Deck archive
          <input
            type="file"
            accept=".json"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              try {
                const imported = importData(await file.text(), 'json', useDeck.getState().data);
                useDeck.getState().commit({ ...imported, cloud: undefined });
              } catch (e) {
                useCloud.setState({ error: String(e) });
              }
            }}
          />
        </label>
      </div>
      {error && <p role="alert">{error}</p>}
      <button
        className="primary-button"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          await synchronize(true);
          if (!useCloud.getState().firstSync) {
            if (startWith === 'stack') useDeck.getState().setModal('stack');
            if (startWith === 'templates') useDeck.getState().openTemplates({ library: true });
          }
          setBusy(false);
        }}
      >
        {busy ? 'Connecting…' : 'Connect & merge safely'}
        <ArrowRight size={16} />
      </button>
    </Modal>
  );
}
function AuthScreen({ initial = 'signin' }: { initial?: string }) {
  const [mode, setMode] = useState(initial);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [google, setGoogle] = useState(false);
  const [entra, setEntra] = useState(false);
  useEffect(() => {
    fetch('/api/v1/config')
      .then((r) => r.json())
      .then((v) => {
        setGoogle(v.google);
        setEntra(!!v.entra);
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
        result = await authClient.signUp.email({ name, email, password, callbackURL: '/app' });
      else if (mode === 'forgot')
        result = await authClient.requestPasswordReset({ email, redirectTo: '/reset-password' });
      else if (mode === 'reset')
        result = await authClient.resetPassword({
          newPassword: password,
          token: new URLSearchParams(location.search).get('token') || '',
        });
      else result = await authClient.signIn.email({ email, password, callbackURL: '/app' });
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
    <main className="auth-shell">
      <section className="auth-story">
        <a className="auth-brand" href="/app">
          <DeckMark size={34} />
          Deck
        </a>
        <div>
          <span className="auth-eyebrow">A LITTLE MORE HEADSPACE.</span>
          <h1>
            Your Deck,
            <br />
            <em>anywhere.</em>
          </h1>
          <p>
            The things on your mind.
            <br />
            The place to put them down.
          </p>
          <div className="auth-card">
            <span>
              <span className="auth-checkbox">
                <Check size={13} />
              </span>
              Make room for what matters
            </span>
            <span>
              <span className="auth-checkbox" />
              Pick up where you left off
            </span>
            <span>
              <span className="auth-checkbox" />
              Take your Deck with you <span className="auth-tag">Today</span>
            </span>
            <div className="auth-card-footer">
              <span className="status-dot" /> One Deck. All your devices.
            </div>
          </div>
        </div>
        <small>Fast. Calm. Always yours.</small>
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
              ? 'Create your account and make a little space.'
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
                const result = await authClient.signIn.social({ provider: 'entra', callbackURL: '/app' });
                if (result.error) {
                  setError(result.error.message || 'Sign-in failed');
                  setBusy(false);
                }
              }}
            >
              {busy ? 'One moment…' : 'Continue with email'}
              <ArrowRight size={16} />
            </button>
          ) : google && ['signin', 'signup'].includes(mode) && (
            <>
              <button
                className="google-button"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  const r = await authClient.signIn.social({
                    provider: 'google',
                    callbackURL: '/app',
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
          {!entra && <form onSubmit={submit}>
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
                      : 'Open my Deck'}
              <ArrowRight size={16} />
            </button>
          </form>}
          {!entra && <p className="auth-switch">
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
          </p>}
          {entra && error && <p className="auth-error" role="alert">{error}</p>}
          {entra && <p className="auth-switch">Create an account, sign in, or reset your password on Deck’s secure sign-in page.</p>}
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
    </main>
  );
}

function DesktopSync() {
  const user = useCloud((s) => s.user);
  const ready = useDeck((s) => s.ready);
  useEffect(() => {
    if (!ready) return;
    try {
      const cached = JSON.parse(localStorage.getItem('deck-native-user') || 'null');
      const owner = useDeck.getState().data.cloud?.userId;
      if (cached?.id && (!owner || owner === cached.id)) useCloud.setState({ user: cached });
    } catch {
      /* no cached native identity */
    }
    const connect = () => {
      invoke<{ id: string; name: string; email: string }>('cloud_request', {
        path: 'me',
        body: null,
      })
        .then((next) => {
          const owner = useDeck.getState().data.cloud?.userId;
          if (!owner || owner === next.id) {
            localStorage.setItem('deck-native-user', JSON.stringify(next));
            useCloud.setState({ user: next });
          }
        })
        .catch(() => {});
    };
    connect();
    window.addEventListener('online', connect);
    return () => window.removeEventListener('online', connect);
  }, [ready]);
  return user ? <SyncLifecycle /> : null;
}
