// Uses only disposable local PostgreSQL and SMTP fixtures. No production config.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import net from 'node:net';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { once } from 'node:events';
import { Pool } from 'pg';
import { emptyDeck } from '../../shared/sync.ts';
import { defaultSettings } from '../../src/types/index.ts';
import { makeTask } from '../../src/lib/seed.ts';

const folder = await mkdtemp(join(tmpdir(), 'deck-local-first-test-'));
const children = [];
let smtp, db;
const messages = [];
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function port() {
  const server = net.createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const result = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return result;
}
async function command(binary, args, env) {
  const child = spawn(binary, args, { env: env || process.env, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', (bytes) => (output += bytes));
  child.stderr.on('data', (bytes) => (output += bytes));
  const [code] = await once(child, 'exit');
  if (code) throw new Error(`${binary} failed: ${output.slice(-2000)}`);
}
function background(binary, args, env) {
  const child = spawn(binary, args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
  children.push(child);
  child.stdout.on('data', () => {});
  child.stderr.on('data', () => {});
  return child;
}
try {
  const pgPort = await port(),
    apiPort = await port();
  await command('initdb', [
    '-D',
    join(folder, 'postgres'),
    '-U',
    'deck_test',
    '-A',
    'trust',
    '--no-locale',
  ]);
  background(
    'postgres',
    ['-D', join(folder, 'postgres'), '-h', '127.0.0.1', '-p', String(pgPort), '-k', folder, '-F'],
    process.env,
  );
  db = new Pool({ connectionString: `postgresql://deck_test@127.0.0.1:${pgPort}/postgres` });
  for (let i = 0; i < 80; i++) {
    try {
      await db.query('SELECT 1');
      break;
    } catch {
      if (i === 79) throw new Error('Test PostgreSQL did not start');
      await pause(100);
    }
  }
  await db.query('CREATE DATABASE deck_test');
  await db.end();
  const databaseUrl = `postgresql://deck_test@127.0.0.1:${pgPort}/deck_test`;
  db = new Pool({ connectionString: databaseUrl });
  smtp = net.createServer((socket) => {
    socket.write('220 Deck test SMTP\r\n');
    let buffer = '',
      data = false,
      message = '';
    socket.on('data', (chunk) => {
      buffer += chunk;
      while (buffer.includes('\r\n')) {
        const index = buffer.indexOf('\r\n'),
          line = buffer.slice(0, index);
        buffer = buffer.slice(index + 2);
        if (data) {
          if (line === '.') {
            messages.push(message);
            message = '';
            data = false;
            socket.write('250 Received\r\n');
          } else message += line + '\r\n';
        } else if (/^(EHLO|HELO)/.test(line)) socket.write('250-localhost\r\n250 OK\r\n');
        else if (line === 'DATA') {
          data = true;
          socket.write('354 Send message\r\n');
        } else if (line === 'QUIT') socket.end('221 Bye\r\n');
        else socket.write('250 OK\r\n');
      }
    });
  });
  smtp.listen(0, '127.0.0.1');
  await once(smtp, 'listening');
  const origin = `http://127.0.0.1:${apiPort}`;
  const env = {
    ...process.env,
    DATABASE_PROVIDER: 'postgres',
    DATABASE_URL: databaseUrl,
    APP_URL: origin,
    PORT: String(apiPort),
    SMTP_URL: `smtp://127.0.0.1:${smtp.address().port}`,
    MAIL_FROM: 'Deck <deck@example.test>',
    BETTER_AUTH_SECRET: randomBytes(48).toString('base64url'),
    AZURE_COMMUNICATION_CONNECTION_STRING: '',
    ENTRA_TENANT_ID: '',
    ENTRA_CLIENT_ID: '',
    ENTRA_CLIENT_SECRET: '',
    GOOGLE_CLIENT_ID: '',
    GOOGLE_CLIENT_SECRET: '',
    NODE_ENV: 'test',
    TRUST_PROXY: '0',
    DOTENV_CONFIG_PATH: join(folder, 'no-env-file'),
  };
  await command(process.execPath, ['--import', 'tsx', 'server/migrate.ts'], env);
  background(process.execPath, ['--import', 'tsx', 'server/index.ts'], env);
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(`${origin}/healthz`)).ok) break;
    } catch {
      /* booting */
    }
    if (i === 99) throw new Error('Test API did not start');
    await pause(100);
  }
  console.log('Disposable PostgreSQL, SMTP and Deck API ready.');
  const jar = () => new Map();
  async function request(path, body, cookies = jar(), expected = 200, headers = {}) {
    const response = await fetch(origin + path, {
      method: body === undefined ? 'GET' : 'POST',
      redirect: 'manual',
      headers: {
        Origin: origin,
        Cookie: [...cookies].map(([k, v]) => `${k}=${v}`).join('; '),
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...headers,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    for (const cookie of response.headers.getSetCookie()) {
      const pair = cookie.split(';')[0],
        at = pair.indexOf('=');
      cookies.set(pair.slice(0, at), pair.slice(at + 1));
    }
    assert.equal(response.status, expected, `${path} status`);
    return response;
  }
  async function mailUrl(start) {
    for (let i = 0; i < 100 && messages.length <= start; i++) await pause(30);
    assert.ok(messages.length > start, 'A fixture email was delivered');
    const text = messages
      .at(-1)
      .replace(/=\r\n/g, '')
      .replace(/=([\da-f]{2})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
    const match = text.match(/https?:\/\/[^\s<>]+/);
    assert.ok(match, 'Fixture email includes action URL');
    return match[0];
  }
  async function account(email) {
    const cookies = jar(),
      before = messages.length;
    await request(
      '/api/auth/sign-up/email',
      { name: 'Fixture User', email, password: 'a-long-fixture-password', callbackURL: '/app' },
      cookies,
    );
    const link = await mailUrl(before);
    await request(new URL(link).pathname + new URL(link).search, undefined, cookies, 302);
    await request(
      '/api/auth/sign-in/email',
      { email, password: 'a-long-fixture-password' },
      cookies,
    );
    const session = await (await request('/api/auth/get-session', undefined, cookies)).json();
    assert.equal(session.user.emailVerified, true);
    return { cookies, user: session.user };
  }
  const a = await account('a@example.test'),
    b = await account('b@example.test');
  // Command Center uses the same real session/account boundary, never a caller-supplied ID.
  await request('/api/v1/command-center', undefined, '', 401);
  await db.query('INSERT INTO deck_github(user_id,version,data) VALUES($1,1,$2)', [
    a.user.id,
    JSON.stringify({
      credentials: 'encrypted-fixture-secret',
      login: 'fixture-github',
      repositories: [],
    }),
  ]);
  const commandA = await (await request('/api/v1/command-center', undefined, a.cookies)).json();
  assert.equal(commandA.login, 'fixture-github');
  assert.equal(commandA.credentials, undefined);
  assert.equal(JSON.stringify(commandA).includes('encrypted-fixture-secret'), false);
  const commandB = await (await request('/api/v1/command-center', undefined, b.cookies)).json();
  assert.equal(commandB.connected, false);
  await request('/api/v1/command-center/github/disconnect', {}, b.cookies, 409, {
    'X-Deck-Account': a.user.id,
  });
  await request('/api/v1/command-center/github/disconnect', {}, a.cookies, 403, {
    Origin: 'https://untrusted.example',
  });
  await request(
    '/api/v1/command-center/github/import',
    { repositoryIds: ['invalid'] },
    a.cookies,
    400,
  );
  await request('/api/v1/command-center/github/disconnect', {}, a.cookies);
  assert.equal(
    (await (await request('/api/v1/command-center', undefined, a.cookies)).json()).connected,
    false,
  );
  const empty = await (await request('/api/v1/sync', undefined, a.cookies)).json();
  assert.equal(empty.version, 0);
  assert.equal(empty.data.tasks.length, 0);
  assert.equal(empty.data.templates.length, 0);
  const task = makeTask('Local task', { id: randomUUID() });
  const initial = {
    ...emptyDeck(defaultSettings),
    tasks: [task],
    local: {
      deckId: 'device-only',
      syncEnabled: true,
      projectPaths: { private: '/private/repository' },
    },
  };
  const one = await (
    await request('/api/v1/sync', { baseVersion: 0, data: initial, mode: 'replace' }, a.cookies)
  ).json();
  await request('/api/v1/sync', { baseVersion: 0, data: initial }, b.cookies, 409, {
    'X-Deck-Account': a.user.id,
  });
  assert.equal(one.version, 1);
  assert.equal(one.data.local, undefined);
  assert.equal(
    (await (await request('/api/v1/sync', undefined, b.cookies)).json()).data.tasks.length,
    0,
  );
  await request(
    '/api/v1/sync',
    { baseVersion: 0, data: emptyDeck(defaultSettings), mode: 'replace' },
    a.cookies,
    409,
  );
  assert.equal(
    (await (await request('/api/v1/sync', undefined, a.cookies)).json()).data.tasks[0].title,
    'Local task',
  );
  const left = structuredClone(one.data),
    right = structuredClone(one.data);
  left.tasks[0].title = 'Edited title';
  right.tasks[0].notes = 'Edited notes';
  await Promise.all([
    request('/api/v1/sync', { baseVersion: 1, data: left }, a.cookies),
    request('/api/v1/sync', { baseVersion: 1, data: right }, a.cookies),
  ]);
  const combined = await (await request('/api/v1/sync', undefined, a.cookies)).json();
  assert.equal(combined.data.tasks[0].title, 'Edited title');
  assert.equal(combined.data.tasks[0].notes, 'Edited notes');
  await request(
    '/api/v1/sync',
    { baseVersion: combined.version, data: emptyDeck(defaultSettings) },
    a.cookies,
  );
  const stale = await (
    await request('/api/v1/sync', { baseVersion: 1, data: one.data }, a.cookies)
  ).json();
  assert.equal(stale.data.tasks.length, 0, 'Stale clients cannot resurrect deleted tasks');
  assert.equal((await db.query('SELECT count(*) AS n FROM deck_tombstones')).rows[0].n, '1');
  console.log(
    'Verified email accounts, account isolation, atomic revision checks, concurrent merge and soft deletion.',
  );
  const device = {
    id: randomUUID(),
    name: 'Fixture desktop',
    platform: 'macos',
    architecture: 'arm64',
    appVersion: '0.1.0',
    lastSync: new Date().toISOString(),
  };
  await request('/api/v1/devices/register', device, a.cookies);
  await request('/api/v1/devices/register', device, b.cookies);
  assert.equal((await (await request('/api/v1/devices', undefined, a.cookies)).json()).length, 1);
  const proof = randomBytes(32).toString('base64url');
  const pair = await (
    await request('/api/v1/devices/pair/start', device, jar(), 200, {
      Origin: '',
      Authorization: `Pairing ${proof}`,
    })
  ).json();
  await request('/api/v1/devices/pair/poll', { id: pair.id }, jar(), 404, {
    Origin: '',
    Authorization: `Pairing ${randomBytes(32).toString('base64url')}`,
  });
  await request('/api/v1/devices/pair/approve', { id: pair.id }, a.cookies);
  const connected = await (
    await request('/api/v1/devices/pair/poll', { id: pair.id }, jar(), 200, {
      Origin: '',
      Authorization: `Pairing ${proof}`,
    })
  ).json();
  await request('/api/v1/devices/pair/poll', { id: pair.id }, jar(), 404, {
    Origin: '',
    Authorization: `Pairing ${proof}`,
  });
  const native = await fetch(`${origin}/api/v1/me`, {
    headers: { Authorization: `Bearer ${connected.token}` },
  });
  assert.equal(native.status, 200);
  assert.equal((await native.json()).id, a.user.id);
  const credential = (await db.query('SELECT token_hash FROM deck_devices WHERE id=$1', [pair.id]))
    .rows[0].token_hash;
  assert.equal(credential, createHash('sha256').update(connected.token).digest('hex'));
  assert.notEqual(credential, connected.token);
  await request('/api/v1/devices/revoke', { id: pair.id }, b.cookies);
  assert.equal(
    (
      await fetch(`${origin}/api/v1/me`, {
        headers: { Authorization: `Bearer ${connected.token}` },
      })
    ).status,
    200,
  );
  await request('/api/v1/devices/revoke', { id: pair.id }, a.cookies);
  assert.equal(
    (
      await fetch(`${origin}/api/v1/me`, {
        headers: { Authorization: `Bearer ${connected.token}` },
      })
    ).status,
    401,
  );
  console.log(
    'Verified device metadata, proof-protected one-use pairing, credential hashing and scoped revocation.',
  );
  const before = messages.length;
  await request('/api/auth/request-password-reset', {
    email: 'a@example.test',
    redirectTo: '/reset-password',
  });
  const link = await mailUrl(before);
  const redirect = await request(
    new URL(link).pathname + new URL(link).search,
    undefined,
    jar(),
    302,
  );
  const token = new URL(redirect.headers.get('location'), origin).searchParams.get('token');
  assert.ok(token);
  await request('/api/auth/reset-password', { token, newPassword: 'new-long-fixture-password' });
  await request('/api/v1/sync', undefined, a.cookies, 401);
  const fresh = jar();
  await request(
    '/api/auth/sign-in/email',
    { email: 'a@example.test', password: 'new-long-fixture-password' },
    fresh,
  );
  await request('/api/auth/sign-out', {}, fresh);
  await request('/api/v1/sync', undefined, fresh, 401);
  await command(process.execPath, ['--import', 'tsx', 'server/migrate.ts'], env);
  assert.ok(
    (await db.query('SELECT count(*) AS n FROM deck_revisions')).rows[0].n > 0,
    'Re-running migrations preserves revisions',
  );
  console.log(
    'Verified password reset, session revocation, sign-out and non-destructive migrations. All integration checks passed.',
  );
} finally {
  if (db) await db.end();
  for (const child of children.reverse()) {
    if (child.exitCode === null) {
      child.kill('SIGTERM');
      await Promise.race([once(child, 'exit'), pause(3000)]);
      if (child.exitCode === null) child.kill('SIGKILL');
    }
  }
  if (smtp) await new Promise((resolve) => smtp.close(resolve));
  await rm(folder, { recursive: true, force: true });
}
