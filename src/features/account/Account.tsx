import { useEffect, useState } from 'react';
import { authClient, api, signOut, useCloud } from '../../lib/cloud';
import { download, exportData } from '../../lib/transfer';
import { useDeck } from '../../stores/deck';

export function Account() {
  const { user, status, lastSynced, error } = useCloud();
  const [section, setSection] = useState('Profile');
  const [name, setName] = useState(user?.name || '');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [sessions, setSessions] = useState<
    { id: string; token: string; userAgent?: string | null; updatedAt: string | Date }[] | null
  >([]);
  const [accounts, setAccounts] = useState<{ id: string; providerId: string }[] | null>([]);
  const [history, setHistory] = useState<
    { version: number; created_at: string; conflicts: unknown }[]
  >([]);
  const [devices, setDevices] = useState<{ id: string; name: string; last_active_at: string }[]>(
    [],
  );
  const [deviceName, setDeviceName] = useState('My desktop');
  const [deviceToken, setDeviceToken] = useState('');
  const [entra, setEntra] = useState(false);
  const current = authClient.useSession();
  useEffect(() => {
    fetch('/api/v1/config')
      .then((response) => response.json())
      .then((config) => setEntra(!!config.entra))
      .catch(() => {});
  }, []);
  async function run(action: () => Promise<any>, success = 'Saved.') {
    setBusy(true);
    setMessage('');
    try {
      const result = await action();
      if (result?.error) throw new Error(result.error.message);
      setMessage(success);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    if (section === 'Sessions')
      void run(async () => {
        const r = await authClient.listSessions();
        if (r.error) throw new Error(r.error.message);
        setSessions(r.data);
        setDevices(await api('devices'));
      }, '');
    if (section === 'Connected accounts')
      void run(async () => {
        const r = await authClient.listAccounts();
        if (r.error) throw new Error(r.error.message);
        setAccounts(r.data);
      }, '');
    if (section === 'Sync') void run(async () => setHistory(await api('history')), '');
  }, [section]);
  return (
    <div className="account-panel">
      <nav className="account-tabs" aria-label="Account sections">
        {[
          'Profile',
          ...(!entra ? ['Email', 'Password', 'Connected accounts'] : []),
          'Sessions',
          'Sync',
          'Data',
          'Security',
        ].map((s) => (
          <button
            key={s}
            aria-pressed={s === section}
            onClick={() => {
              setSection(s);
              setMessage('');
            }}
          >
            {s}
          </button>
        ))}
      </nav>
      <h4>{section}</h4>
      {section === 'Profile' && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void run(() => authClient.updateUser({ name }));
          }}
        >
          <label>
            Name
            <input value={name} onChange={(e) => setName(e.target.value)} required />
          </label>
          <p>{user?.email}</p>
          {entra && <p>Email and password are managed by Microsoft’s sign-in page.</p>}
          <button className="primary-button" disabled={busy}>
            Save profile
          </button>
        </form>
      )}
      {section === 'Email' && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void run(
              () => authClient.changeEmail({ newEmail: email, callbackURL: '/app' }),
              'Check your email to confirm the change.',
            );
          }}
        >
          <p>Current email: {user?.email}</p>
          <label>
            New email
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </label>
          <button className="primary-button" disabled={busy}>
            Change email
          </button>
        </form>
      )}
      {section === 'Password' && (
        <>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void run(
                () =>
                  authClient.changePassword({
                    currentPassword,
                    newPassword: password,
                    revokeOtherSessions: true,
                  }),
                'Password changed. Other sessions have been signed out.',
              );
            }}
          >
            <label>
              Current password
              <input
                type="password"
                autoComplete="current-password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                required
              />
            </label>
            <label>
              New password
              <input
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={12}
                maxLength={128}
              />
            </label>
            <button className="primary-button" disabled={busy}>
              Update password
            </button>
          </form>
          <p>Signed up with Google? Use an email reset link to securely set your first password.</p>
          <button
            disabled={busy}
            onClick={() =>
              void run(
                () =>
                  authClient.requestPasswordReset({
                    email: user!.email,
                    redirectTo: '/reset-password',
                  }),
                'Check your email for a secure password link.',
              )
            }
          >
            Send password link
          </button>
        </>
      )}
      {section === 'Connected accounts' && (
        <>
          <p>Only accounts using your verified email can be linked.</p>
          {accounts?.map((a) => (
            <p key={a.id}>{a.providerId === 'credential' ? 'Email & password' : a.providerId}</p>
          ))}
          <button
            className="primary-button"
            disabled={busy}
            onClick={() =>
              void run(() => authClient.linkSocial({ provider: 'google', callbackURL: '/app' }))
            }
          >
            Connect Google
          </button>
        </>
      )}
      {section === 'Sessions' && (
        <>
          <p>Devices with access to your Deck.</p>
          {sessions?.map((s) => (
            <div className="account-session" key={s.id}>
              <div>
                <strong>
                  {s.id === current.data?.session.id
                    ? 'This device · Current session'
                    : s.userAgent || 'Unknown device'}
                </strong>
                <small>Last active {new Date(s.updatedAt).toLocaleString()}</small>
              </div>
              <button
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    if (s.id === current.data?.session.id) return signOut();
                    const r = await authClient.revokeSession({ token: s.token });
                    if (r.error) return r;
                    const refreshed = await authClient.listSessions();
                    setSessions(refreshed.data);
                  })
                }
              >
                Sign out
              </button>
            </div>
          ))}
          <button
            disabled={busy}
            onClick={() =>
              void run(async () => {
                await api('devices/revoke-all', {});
                const r = await authClient.revokeSessions();
                if (r.error) return r;
                localStorage.removeItem('deck-offline-user');
                location.reload();
              })
            }
          >
            Sign out everywhere
          </button>
          <h4>Connected desktops</h4>
          {devices.map((d) => (
            <div className="account-session" key={d.id}>
              <span>
                {d.name}
                <small>Last active {new Date(d.last_active_at).toLocaleString()}</small>
              </span>
              <button
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    await api('devices/revoke', { id: d.id });
                    setDevices(await api('devices'));
                  })
                }
              >
                Disconnect
              </button>
            </div>
          ))}
          <label>
            Desktop name
            <input
              value={deviceName}
              maxLength={100}
              onChange={(e) => setDeviceName(e.target.value)}
            />
          </label>
          <button
            disabled={busy}
            onClick={() =>
              void run(async () => {
                const result = await api<{ token: string }>('devices', { name: deviceName });
                setDeviceToken(result.token);
                setDevices(await api('devices'));
              }, 'Paste this token in desktop Deck → Settings → Account. It is shown only here and expires after 90 days.')
            }
          >
            Create desktop connection token
          </button>
          {deviceToken && (
            <label>
              Connection token
              <input
                readOnly
                type="password"
                value={deviceToken}
                onFocus={(e) => {
                  e.target.type = 'text';
                  e.target.select();
                }}
                onBlur={(e) => {
                  e.target.type = 'password';
                }}
              />
            </label>
          )}
        </>
      )}
      {section === 'Sync' && (
        <>
          <p>
            <strong>{status}</strong>
            {lastSynced && ` · Last synced ${new Date(lastSynced).toLocaleString()}`}
          </p>
          {error && (
            <>
              <p role="alert">{error}</p>
              <button
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    const data = useDeck.getState().data;
                    await exportData(data, 'json');
                    useDeck.getState().commit({ ...data, cloud: undefined });
                    useCloud.setState({ firstSync: true });
                    useDeck.getState().setModal(null);
                  }, '')
                }
              >
                Export local copy & review sync setup
              </button>
            </>
          )}
          <p>
            Changes sync automatically while connected. Previous revisions and conflicting edits can
            be downloaded for 90 days.
          </p>
          {(useDeck.getState().data.cloud?.recovery?.length || 0) > 0 && (
            <button
              onClick={() =>
                void download(
                  'deck-local-recovery.json',
                  JSON.stringify(useDeck.getState().data.cloud?.recovery, null, 2),
                  'application/json',
                )
              }
            >
              Download edits recovered during sync
            </button>
          )}
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
          <h4>Sync history</h4>
          {history.length === 0 && <p>No cloud revisions yet.</p>}
          {history.map((h) => (
            <div className="account-session" key={h.version}>
              <span>
                Revision {h.version}
                <small>
                  {new Date(h.created_at).toLocaleString()}
                  {!Array.isArray(h.conflicts) ? ' · Preserved conflict' : ''}
                </small>
              </span>
              <button
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    const revision = await api(`history/${h.version}`);
                    await download(
                      `deck-revision-${h.version}.json`,
                      JSON.stringify(revision, null, 2),
                      'application/json',
                    );
                  }, 'Revision downloaded.')
                }
              >
                Download
              </button>
            </div>
          ))}
        </>
      )}
      {section === 'Data' && (
        <>
          <p>Your Deck belongs to you. Export it whenever you need.</p>
          <div className="account-actions">
            {(['json', 'csv', 'md'] as const).map((f) => (
              <button
                key={f}
                disabled={busy}
                onClick={() =>
                  void run(() => exportData(useDeck.getState().data, f), 'Export ready.')
                }
              >
                {f === 'md' ? 'Markdown' : f.toUpperCase()}
              </button>
            ))}
          </div>
          <button
            disabled={busy}
            onClick={() =>
              void run(
                async () =>
                  download(
                    'deck-cloud-archive.json',
                    JSON.stringify(await api('export'), null, 2),
                    'application/json',
                  ),
                'Cloud archive downloaded.',
              )
            }
          >
            Download full cloud archive
          </button>
        </>
      )}
      {section === 'Security' && (
        <>
          <p>
            Delete your account and all synchronized cloud data, including revision history. Local
            desktop databases and offline copies on other devices are not erased.
          </p>
          <p>
            {entra
              ? 'You must have signed in within the last 10 minutes. Your Microsoft sign-in identity is managed separately and will remain available. This cannot be undone.'
              : 'We will email a confirmation link. This cannot be undone.'}
          </p>
          <label>
            Type DELETE to continue
            <input value={confirmation} onChange={(e) => setConfirmation(e.target.value)} />
          </label>
          <button
            className="danger-button"
            disabled={busy || confirmation !== 'DELETE'}
            onClick={() =>
              void run(
                async () => {
                  if (!entra) return authClient.deleteUser({ callbackURL: '/app' });
                  const response = await fetch('/api/v1/account', {
                    method: 'DELETE',
                    credentials: 'include',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ confirmation: 'DELETE' }),
                  });
                  if (!response.ok) {
                    const error = await response.json().catch(() => ({}));
                    throw new Error(error.error || 'Could not delete your Deck account');
                  }
                  localStorage.removeItem('deck-offline-user');
                  location.assign('/app');
                },
                entra ? 'Deck account deleted.' : 'Check your email to confirm permanent account deletion.',
              )
            }
          >
            Delete account
          </button>
        </>
      )}
      {message && <p role="status">{message}</p>}
      <hr />
      <button disabled={busy} onClick={() => void run(signOut, '')}>
        Sign out of Deck
      </button>
    </div>
  );
}
