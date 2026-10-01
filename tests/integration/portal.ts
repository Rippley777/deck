// Run against a disposable database only. Starts a real HTTP API and capture-only SMTP server.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import net from 'node:net';
import { Pool } from 'pg';
import { emptyDeck } from '../../shared/sync';
import { defaultSettings } from '../../src/types';
import { makeTask } from '../../src/lib/seed';
if (!process.env.DATABASE_URL?.includes('deck_test'))
  throw new Error('Use a disposable deck_test database');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const messages: string[] = [];
const smtp = net.createServer((socket) => {
  socket.write('220 test SMTP\r\n');
  let buffer = '',
    data = false,
    mail = '';
  socket.on('data', (chunk) => {
    buffer += chunk.toString();
    let end;
    while ((end = buffer.indexOf('\r\n')) >= 0) {
      const line = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      if (data) {
        if (line === '.') {
          messages.push(mail);
          data = false;
          mail = '';
          socket.write('250 accepted\r\n');
        } else mail += line + '\r\n';
      } else if (line.startsWith('DATA')) {
        data = true;
        socket.write('354 send\r\n');
      } else if (line.startsWith('QUIT')) socket.end('221 bye\r\n');
      else socket.write('250 OK\r\n');
    }
  });
});
await new Promise<void>((r) => smtp.listen(11025, '127.0.0.1', r));
const server = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
  env: { ...process.env, PORT: '3002' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let logs = '';
server.stdout.on('data', (b) => (logs += b));
server.stderr.on('data', (b) => (logs += b));
const base = 'http://localhost:3002';
async function call(
  path: string,
  body?: unknown,
  cookie?: string,
  origin = 'http://localhost:1432',
) {
  return fetch(base + path, {
    method: body ? 'POST' : 'GET',
    headers: {
      ...(body ? { 'Content-Type': 'application/json', Origin: origin } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    redirect: 'manual',
  });
}
const delay = () => new Promise((r) => setTimeout(r, 100));
try {
  for (let i = 0; i < 100; i++) {
    try {
      if ((await call('/api/v1/config')).ok) break;
    } catch {}
    await delay();
  }
  const suffix = Date.now();
  async function account(label: string) {
    const email = `${label}-${suffix}@deck.test`,
      password = 'Correct-horse-deck-2026!';
    const signup = await call('/api/auth/sign-up/email', {
      name: label,
      email,
      password,
      callbackURL: 'http://localhost:1432/app',
    });
    assert.equal(signup.status, 200, await signup.text());
    assert.equal(
      (await call('/api/auth/sign-in/email', { email, password })).status,
      403,
      'unverified email must be rejected',
    );
    for (let i = 0; i < 40 && !messages.some((m) => m.includes(email)); i++) await delay();
    const mail = messages.find((m) => m.includes(email));
    assert.ok(mail, 'verification email was delivered');
    const decoded = mail.replace(/=\r\n/g, '').replace(/=3D/g, '=');
    const link = decoded.match(/http:\/\/localhost:1432\/api\/auth\/verify-email\?[^\s<>]+/)?.[0];
    assert.ok(link, decoded);
    const verified = await fetch(link.replace('localhost:1432', 'localhost:3002'), {
      redirect: 'manual',
    });
    assert.ok([200, 302].includes(verified.status), await verified.text());
    const signed = await call('/api/auth/sign-in/email', { email, password });
    assert.equal(signed.status, 200, await signed.text());
    const cookie = signed.headers
      .getSetCookie()
      .map((c) => c.split(';')[0])
      .join('; ');
    assert.ok(cookie.includes('session_token'));
    return { cookie, email, password };
  }
  const alice = await account('alice');
  await new Promise((r) => setTimeout(r, 11000));
  const bob = await account('bob');
  assert.equal((await call('/api/v1/sync')).status, 401);
  assert.equal((await call('/api/v1/sync', {}, alice.cookie, 'https://evil.test')).status, 403);
  assert.equal((await call('/api/v1/sync', { data: {} }, alice.cookie)).status, 400);
  const data = {
    ...emptyDeck(defaultSettings),
    tasks: [makeTask('Private Alice card', { id: crypto.randomUUID() })],
  };
  const write = await call('/api/v1/sync', { baseVersion: 0, data, user_id: 'bob' }, alice.cookie);
  assert.equal(write.status, 200, await write.clone().text());
  const first = await write.json();
  assert.equal(first.version, 1);
  const bobDeck = await (await call('/api/v1/sync', undefined, bob.cookie)).json();
  assert.equal(bobDeck.data.tasks.length, 0);
  assert.equal((await call('/api/v1/history/1', undefined, bob.cookie)).status, 404);
  const phone = structuredClone(data),
    desktop = structuredClone(data);
  phone.tasks[0].notes = 'Phone thought';
  desktop.tasks[0].notes = 'Desktop thought';
  const results = await Promise.all(
    [phone, desktop].map((data) =>
      call('/api/v1/sync', { baseVersion: 1, data }, alice.cookie).then((r) => r.json()),
    ),
  );
  assert.equal(Math.max(...results.map((r) => r.version)), 3);
  assert.equal(results.filter((r) => r.conflicts > 0).length, 1);
  const history = await (await call('/api/v1/history/3', undefined, alice.cookie)).json();
  assert.ok(JSON.stringify(history.conflicts).includes('Phone thought'));
  assert.ok(JSON.stringify(history.conflicts).includes('Desktop thought'));
  const beforeDelete = await (await call('/api/v1/sync', undefined, alice.cookie)).json();
  const deleted = { ...beforeDelete.data, tasks: [] };
  await call('/api/v1/sync', { baseVersion: beforeDelete.version, data: deleted }, alice.cookie);
  const stale = await (await call('/api/v1/sync', { baseVersion: 0, data }, alice.cookie)).json();
  assert.equal(stale.data.tasks.length, 0, 'tombstones prevent resurrection');
  assert.equal(
    (await pool.query('SELECT count(*) FROM deck_tombstones')).rows[0].count !== '0',
    true,
  );
  const token = await (
    await call('/api/v1/devices', { name: 'Integration desktop' }, alice.cookie)
  ).json();
  assert.ok(token.token);
  const native = await fetch(base + '/api/v1/me', {
    headers: { Authorization: `Bearer ${token.token}` },
  });
  assert.equal(native.status, 200);
  assert.equal((await native.json()).email, alice.email);
  const devices = await (await call('/api/v1/devices', undefined, alice.cookie)).json();
  await call('/api/v1/devices/revoke', { id: devices[0].id }, bob.cookie);
  assert.equal(
    (await fetch(base + '/api/v1/me', { headers: { Authorization: `Bearer ${token.token}` } }))
      .status,
    200,
    'other user cannot revoke device',
  );
  await call('/api/v1/devices/revoke', { id: devices[0].id }, alice.cookie);
  assert.equal(
    (await fetch(base + '/api/v1/me', { headers: { Authorization: `Bearer ${token.token}` } }))
      .status,
    401,
  );
  await call('/api/auth/request-password-reset', {
    email: alice.email,
    redirectTo: 'http://localhost:1432/reset-password',
  });
  for (let i = 0; i < 40 && !messages.some((m) => m.includes('Reset your Deck password')); i++)
    await delay();
  assert.ok(messages.some((m) => m.includes('Reset your Deck password')));
  const signout = await call('/api/auth/sign-out', {}, alice.cookie);
  assert.equal(signout.status, 200);
  assert.equal((await call('/api/v1/sync', undefined, alice.cookie)).status, 401);
  const resetMail = messages
    .find((m) => m.includes('Reset your Deck password'))!
    .replace(/=\r\n/g, '')
    .replace(/=3D/g, '=');
  const resetToken = resetMail.match(/\/api\/auth\/reset-password\/([^?\s]+)/)?.[1];
  assert.ok(resetToken);
  const reset = await call('/api/auth/reset-password', {
    token: resetToken,
    newPassword: 'Updated-deck-password-2026!',
  });
  assert.equal(reset.status, 200, await reset.text());
  const relogin = await call('/api/auth/sign-in/email', {
    email: alice.email,
    password: 'Updated-deck-password-2026!',
  });
  assert.equal(relogin.status, 200, await relogin.text());
  const newCookie = relogin.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ');
  const uid = (await pool.query('SELECT id FROM "user" WHERE email=$1', [alice.email])).rows[0].id;
  const deletion = await call(
    '/api/auth/delete-user',
    { callbackURL: 'http://localhost:1432/app' },
    newCookie,
  );
  assert.equal(deletion.status, 200, await deletion.text());
  assert.equal(
    (await pool.query('SELECT id FROM "user" WHERE id=$1', [uid])).rowCount,
    1,
    'deletion waits for email confirmation',
  );
  for (let i = 0; i < 40 && !messages.some((m) => m.includes('Confirm deletion')); i++)
    await delay();
  const deletionMail = messages
    .find((m) => m.includes('Confirm deletion'))!
    .replace(/=\r\n/g, '')
    .replace(/=3D/g, '=');
  const deletionLink = deletionMail.match(
    /http:\/\/localhost:1432\/api\/auth\/delete-user\/callback\?[^\s<>]+/,
  )?.[0];
  assert.ok(deletionLink);
  const removed = await fetch(deletionLink.replace('localhost:1432', 'localhost:3002'), {
    headers: { Cookie: newCookie },
    redirect: 'manual',
  });
  assert.ok([200, 302].includes(removed.status), await removed.text());
  for (const table of ['deck_workspaces', 'deck_revisions', 'deck_tombstones', 'deck_devices'])
    assert.equal(
      (await pool.query(`SELECT count(*) FROM ${table} WHERE user_id=$1`, [uid])).rows[0].count,
      '0',
    );
  assert.equal((await call('/api/v1/sync', undefined, newCookie)).status, 401);
  console.log(
    'PASS: verification email, auth, CSRF, validation, ownership, concurrent conflicts, tombstones, native tokens, revocation, password reset, confirmed account deletion/cascade, and sign-out.',
  );
} catch (e) {
  console.error(logs);
  throw e;
} finally {
  server.kill();
  smtp.close();
  await pool.end();
}
