import { afterEach, expect, it, vi } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import { commandCenterRoutes, unseal } from '../server/command-center/routes';

const nativeFetch = globalThis.fetch;
let server: Server | undefined;
afterEach(async () => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  if (server) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server!.close(() => resolve()));
    server = undefined;
  }
});
it('binds OAuth to a Deck account, uses one-use state/PKCE, encrypts tokens and clears revoked data', async () => {
  const key = Buffer.alloc(32, 8);
  vi.stubEnv('GITHUB_APP_CLIENT_ID', 'fixture-client');
  vi.stubEnv('GITHUB_APP_CLIENT_SECRET', 'fixture-secret');
  vi.stubEnv('GITHUB_TOKEN_ENCRYPTION_KEY', key.toString('base64'));
  const rows = new Map<string, { data: string; version: number }>();
  const query = async (sql: string, values: unknown[] = []) => {
    const uid = String(values[0]),
      old = rows.get(uid);
    if (sql === 'SELECT user_id FROM deck_github')
      return { rows: [...rows.keys()].map((user_id) => ({ user_id })) };
    if (sql.startsWith('SELECT')) return { rows: old ? [old] : [] };
    if (sql.startsWith('INSERT')) {
      if (old) throw new Error('duplicate');
      rows.set(uid, { data: String(values[1]), version: 1 });
      return { rows: [] };
    }
    if (old && old.version === values[2]) {
      rows.set(uid, { data: String(values[1]), version: old.version + 1 });
      return { rows: [{ version: old.version + 1 }] };
    }
    return { rows: [] };
  };
  const remote = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    if (String(input).includes('/login/oauth/access_token')) {
      const body = JSON.parse(String(init?.body));
      expect(body.code_verifier).toHaveLength(43);
      expect(body.client_secret).toBe('fixture-secret');
      return new Response(
        JSON.stringify({
          access_token: 'fixture-access',
          refresh_token: 'fixture-refresh',
          expires_in: 3600,
        }),
      );
    }
    if (String(input).endsWith('/user'))
      return new Response('{"id":777,"login":"any-github-user"}');
    return new Response('{}', { status: 401 });
  });
  vi.stubGlobal('fetch', remote);
  const app = express();
  app.use(express.json());
  // Session identity is injected only in this harness. Production middleware is tested in local-first.mjs.
  app.use((req, res, next) => {
    res.locals.userId = req.get('x-test-account') || 'alice';
    if (req.get('x-test-device') !== 'true')
      res.locals.session = { user: { id: res.locals.userId } };
    next();
  });
  app.use('/command', commandCenterRoutes(query, false, 'https://deck.example'));
  server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve, reject) => {
    server!.once('listening', resolve);
    server!.once('error', reject);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No address');
  const base = `http://127.0.0.1:${address.port}/command`;
  const call = (path: string, body?: unknown, headers: Record<string, string> = {}) =>
    nativeFetch(base + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      redirect: 'manual',
    });
  expect((await call('/github/connect', {}, { 'x-test-device': 'true' })).status).toBe(403);
  const start = await (await call('/github/connect', {})).json();
  const url = new URL(start.url);
  expect(url.searchParams.has('scope')).toBe(false);
  expect(url.searchParams.get('code_challenge_method')).toBe('S256');
  const state = url.searchParams.get('state')!;
  const mismatch = await call(`/github/callback?state=${state}&code=fake`, undefined, {
    'x-test-account': 'bob',
  });
  expect(mismatch.headers.get('location')).toContain('github=failed');
  expect(remote).not.toHaveBeenCalled();
  const callback = await call(`/github/callback?state=${state}&code=fake`);
  expect(callback.headers.get('location')).toContain('github=connected');
  const saved = JSON.parse(rows.get('alice')!.data);
  expect(saved.credentials).not.toContain('fixture-access');
  expect(unseal<{ accessToken: string }>(saved.credentials, key, 'alice').accessToken).toBe(
    'fixture-access',
  );
  const exposed = await (await call('/')).json();
  expect(exposed.login).toBe('any-github-user');
  expect(JSON.stringify(exposed)).not.toMatch(
    /fixture-access|fixture-refresh|credentials|verifier/,
  );
  expect((await (await call('/', undefined, { 'x-test-account': 'bob' })).json()).connected).toBe(
    false,
  );
  const replay = await call(`/github/callback?state=${state}&code=fake`);
  expect(replay.headers.get('location')).toContain('github=failed');
  expect((await call('/github/repositories')).status).toBe(401);
  expect((await (await call('/')).json()).error).toContain('revoked');
  await call('/github/disconnect', {});
  expect(JSON.parse(rows.get('alice')!.data)).toEqual({ repositories: [] });
});
