import express from 'express';
import { rateLimit } from 'express-rate-limit';
import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { DeviceQuery } from '../devices';
import type { CommandSnapshot, RepositorySnapshot } from '../../shared/command-center';
import { GitHub, GitHubError, synchronizeRepository } from './github';

type Secret = { accessToken: string; refreshToken?: string; expiresAt?: number };
interface State {
  credentials?: string;
  authorizing?: string;
  deliveries?: string[];
  retryAt?: number;
  login?: string;
  githubId?: string;
  error?: string;
  oauth?: { hash: string; verifier: string; expiresAt: number };
  repositories: RepositorySnapshot[];
  lease?: { id: string; expiresAt: number };
}
export function seal(value: unknown, key: Buffer, account: string) {
  const iv = randomBytes(12),
    cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(account));
  const body = Buffer.concat([cipher.update(JSON.stringify(value)), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64');
}
export function unseal<T>(value: string, key: Buffer, account: string): T {
  const bytes = Buffer.from(value, 'base64'),
    decipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12));
  decipher.setAAD(Buffer.from(account));
  decipher.setAuthTag(bytes.subarray(12, 28));
  return JSON.parse(
    Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString(),
  );
}
export class IntegrationStore {
  constructor(
    private query: DeviceQuery,
    private azure: boolean,
  ) {}
  async read(uid: string): Promise<{ state: State; version: number }> {
    const row = (await this.query('SELECT data,version FROM deck_github WHERE user_id=@p1', [uid]))
      .rows[0];
    return row
      ? { state: JSON.parse(row.data), version: row.version }
      : { state: { repositories: [] }, version: 0 };
  }
  async write(uid: string, state: State, version: number) {
    if (!version) {
      try {
        await this.query('INSERT INTO deck_github(user_id,version,data) VALUES(@p1,1,@p2)', [
          uid,
          JSON.stringify(state),
        ]);
        return true;
      } catch (e) {
        if ((await this.read(uid)).version) return false;
        throw e;
      }
    }
    const result = await this.query(
      this.azure
        ? 'UPDATE deck_github SET data=@p2,version=version+1 OUTPUT INSERTED.version WHERE user_id=@p1 AND version=@p3'
        : 'UPDATE deck_github SET data=@p2,version=version+1 WHERE user_id=@p1 AND version=@p3 RETURNING version',
      [uid, JSON.stringify(state), version],
    );
    return !!result.rows.length;
  }
  async change(uid: string, fn: (state: State) => void) {
    for (let attempt = 0; attempt < 5; attempt++) {
      const { state, version } = await this.read(uid);
      fn(state);
      if (await this.write(uid, state, version)) return state;
    }
    throw new GitHubError('Another update is in progress. Try again.', 409);
  }
}
export function commandCenterRoutes(query: DeviceQuery, azure: boolean, origin: string) {
  const router = express.Router(),
    store = new IntegrationStore(query, azure);
  const clientId = process.env.GITHUB_APP_CLIENT_ID,
    clientSecret = process.env.GITHUB_APP_CLIENT_SECRET;
  const key = Buffer.from(process.env.GITHUB_TOKEN_ENCRYPTION_KEY || '', 'base64');
  const configured = !!(clientId && clientSecret && key.length === 32);
  const interval = Math.max(15, Number(process.env.GITHUB_SYNC_INTERVAL_MINUTES) || 30) * 60000;
  const hash = (s: string) => createHash('sha256').update(s).digest('hex');
  const callback = `${origin}/api/v1/command-center/github/callback`;
  async function exchange(params: Record<string, string>): Promise<Secret> {
    const response = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, ...params }),
      signal: AbortSignal.timeout(20000),
      redirect: 'error',
    });
    const body = (await response.json()) as Record<string, any>;
    if (!response.ok || typeof body.access_token !== 'string')
      throw new GitHubError('GitHub authorization failed. Reconnect GitHub.', 401);
    return {
      accessToken: body.access_token,
      refreshToken: body.refresh_token,
      expiresAt: body.expires_in ? Date.now() + body.expires_in * 1000 : undefined,
    };
  }
  async function client(uid: string, state: State) {
    if (!configured || !state.credentials)
      throw new GitHubError('Connect GitHub in the portal first.', 409);
    let secret = unseal<Secret>(state.credentials, key, uid);
    if (secret.expiresAt && secret.expiresAt < Date.now() + 60000) {
      if (!secret.refreshToken)
        throw new GitHubError('GitHub authorization expired. Reconnect GitHub.', 401);
      secret = await exchange({ grant_type: 'refresh_token', refresh_token: secret.refreshToken });
      state.credentials = seal(secret, key, uid);
    }
    return new GitHub(secret.accessToken);
  }
  const publicState = (state: State): CommandSnapshot => ({
    configured,
    connected: !!state.credentials,
    login: state.login,
    error:
      state.error ||
      (state.retryAt && state.retryAt > Date.now()
        ? `GitHub rate limit reached. Try again after ${new Date(state.retryAt).toISOString()}.`
        : undefined),
    repositories: state.repositories,
  });
  router.use(
    rateLimit({ windowMs: 60000, limit: 30, standardHeaders: 'draft-8', legacyHeaders: false }),
  );
  router.get('/', async (_req, res) =>
    res.json(publicState((await store.read(res.locals.userId)).state)),
  );
  router.post('/github/connect', async (_req, res) => {
    if (!configured)
      throw new GitHubError(
        'The server needs GitHub App credentials and an encryption key. See Command Center setup.',
        503,
      );
    if (!res.locals.session)
      throw new GitHubError('Connect GitHub from your signed-in Deck web portal.', 403);
    const nonce = randomBytes(32).toString('base64url'),
      verifier = randomBytes(32).toString('base64url');
    await store.change(res.locals.userId, (state) => {
      delete state.authorizing;
      state.oauth = {
        hash: hash(nonce),
        verifier: seal(verifier, key, res.locals.userId),
        expiresAt: Date.now() + 600000,
      };
    });
    const params = new URLSearchParams({
      client_id: clientId!,
      redirect_uri: callback,
      state: nonce,
      code_challenge: createHash('sha256').update(verifier).digest('base64url'),
      code_challenge_method: 'S256',
    });
    res.json({ url: `https://github.com/login/oauth/authorize?${params}` });
  });
  router.get('/github/callback', async (req, res) => {
    try {
      const authorizationId = randomUUID();
      if (
        !configured ||
        !res.locals.session ||
        typeof req.query.state !== 'string' ||
        typeof req.query.code !== 'string'
      )
        throw new GitHubError('Invalid callback', 400);
      let verifier = '';
      await store.change(res.locals.userId, (state) => {
        if (
          !state.oauth ||
          state.oauth.expiresAt < Date.now() ||
          state.oauth.hash !== hash(String(req.query.state))
        )
          throw new GitHubError('Authorization expired. Start again.', 400);
        verifier = unseal<string>(state.oauth.verifier, key, res.locals.userId);
        delete state.oauth;
        state.authorizing = authorizationId;
      });
      const secret = await exchange({
        code: req.query.code,
        redirect_uri: callback,
        code_verifier: verifier,
      });
      const user = await new GitHub(secret.accessToken).get('/user');
      if (!Number.isSafeInteger(user.id) || typeof user.login !== 'string')
        throw new GitHubError('Invalid GitHub identity');
      await store.change(res.locals.userId, (state) => {
        if (state.authorizing !== authorizationId)
          throw new GitHubError('Authorization cancelled.', 409);
        delete state.authorizing;
        if (state.githubId !== String(user.id)) state.repositories = [];
        state.githubId = String(user.id);
        state.login = user.login;
        state.credentials = seal(secret, key, res.locals.userId);
        delete state.error;
        delete state.retryAt;
        delete state.lease;
      });
      res.redirect(`${origin}/?github=connected`);
    } catch {
      res.redirect(`${origin}/?github=failed`);
    }
  });
  router.post('/github/disconnect', async (_req, res) => {
    await store.change(res.locals.userId, (state) => {
      for (const k of Object.keys(state)) delete (state as any)[k];
      state.repositories = [];
    });
    res.json({ success: true });
  });
  // A durable lease bounds concurrent authorization refreshes and background jobs across processes.
  async function withLease<T>(
    uid: string,
    fn: (state: State, github: GitHub) => Promise<T>,
  ): Promise<T> {
    const leaseId = randomUUID();
    const state = await store.change(uid, (current) => {
      if (current.retryAt && current.retryAt > Date.now())
        throw new GitHubError(
          'GitHub rate limit reached. Wait for the reset before retrying.',
          429,
          current.retryAt,
        );
      if (current.lease && current.lease.expiresAt > Date.now())
        throw new GitHubError('Synchronization in progress. Try again shortly.', 409);
      current.lease = { id: leaseId, expiresAt: Date.now() + 20 * 60000 };
    });
    try {
      const github = await client(uid, state);
      // Persist refreshed credentials before API work, only if this connection is still current.
      await store.change(uid, (current) => {
        if (current.lease?.id !== leaseId) throw new GitHubError('GitHub connection changed.', 409);
        current.credentials = state.credentials;
      });
      const result = await fn(state, github);
      await store.change(uid, (current) => {
        if (current.lease?.id !== leaseId) throw new GitHubError('GitHub connection changed.', 409);
        current.repositories = state.repositories;
        current.error = state.error;
        current.retryAt = state.retryAt;
        delete current.lease;
      });
      return result;
    } catch (error) {
      await store.change(uid, (current) => {
        if (current.lease?.id === leaseId) {
          delete current.lease;
          if (error instanceof GitHubError && error.status === 429) current.retryAt = error.retryAt;
          if (error instanceof GitHubError && error.status === 401) {
            current.error = error.message;
            current.repositories = [];
          }
        }
      });
      throw error;
    }
  }
  router.get('/github/repositories', async (_req, res) => {
    const repos = await withLease(res.locals.userId, async (_state, github) => github.discover());
    res.json(repos);
  });
  router.post('/github/import', async (req, res) => {
    const ids = z.array(z.string().regex(/^\d+$/)).min(1).max(100).parse(req.body?.repositoryIds);
    const result = await withLease(res.locals.userId, async (state, github) => {
      const allowed = await github.discover();
      if (ids.some((id) => !allowed.some((r) => r.id === id)))
        throw new GitHubError(
          'One or more repositories are no longer accessible. Discover repositories again.',
          403,
        );
      for (const repo of allowed.filter((r) => ids.includes(r.id))) {
        const previous = state.repositories.find((s) => s.repository.id === repo.id);
        if (previous) previous.repository = repo;
        else
          state.repositories.push({
            repository: repo,
            work: [],
            activity: [],
            lastSuccess: null,
            lastAttempt: null,
            status: 'pending',
          });
      }
      return publicState(state);
    });
    res.json(result);
    void tick().catch(() => {});
  });
  router.post('/github/refresh', async (_req, res) => {
    const state = await store.change(res.locals.userId, (s) => {
      if (s.lease && s.lease.expiresAt > Date.now())
        throw new GitHubError('Synchronization already in progress.', 409);
      if (!s.credentials) throw new GitHubError('Connect GitHub first.', 409);
      for (const repo of s.repositories) {
        // Keep GitHub rate-limit/backoff deadlines, even on manual refresh.
        if (!repo.nextAttempt || Date.parse(repo.nextAttempt) <= Date.now())
          repo.status = 'pending';
      }
    });
    res.json(publicState(state));
    void tick().catch(() => {});
  });
  let running = false;
  async function tick() {
    if (!configured || running) return;
    running = true;
    try {
      const users = (await query('SELECT user_id FROM deck_github')).rows;
      let cursor = 0;
      const worker = async () => {
        while (cursor < users.length) {
          const uid = users[cursor++].user_id;
          try {
            const { state } = await store.read(uid);
            if (
              !state.credentials ||
              state.error ||
              (state.retryAt && state.retryAt > Date.now()) ||
              (state.lease && state.lease.expiresAt > Date.now())
            )
              continue;
            const due = (r: RepositorySnapshot) =>
              (!r.nextAttempt || Date.parse(r.nextAttempt) <= Date.now()) &&
              (r.status === 'pending' ||
                !r.lastSuccess ||
                Date.parse(r.lastSuccess) < Date.now() - interval);
            if (!state.repositories.some(due)) continue;
            await withLease(uid, async (current, github) => {
              // One repository per account per tick keeps large imports fair and bounded.
              const index = current.repositories.findIndex(due);
              if (index < 0) return;
              const repo = current.repositories[index];
              await store.change(uid, (saved) => {
                if (saved.lease?.id !== current.lease?.id)
                  throw new GitHubError('Connection changed.', 409);
                saved.repositories[index] = {
                  ...repo,
                  status: 'syncing',
                  lastAttempt: new Date().toISOString(),
                };
              });
              try {
                current.repositories[index] = await synchronizeRepository(
                  github,
                  repo,
                  current.login!,
                );
                delete current.error;
              } catch (error) {
                const failure =
                  error instanceof GitHubError
                    ? error
                    : new GitHubError('Synchronization failed. Check permissions and retry.');
                if (failure.status === 401) throw failure;
                if (failure.status === 429) current.retryAt = failure.retryAt;
                const failures = (repo.failures || 0) + 1;
                current.repositories[index] = {
                  ...repo,
                  ...(failure.status === 403 || failure.status === 404
                    ? { work: [], activity: [], lastSuccess: null }
                    : {}),
                  status: 'error',
                  error: failure.message,
                  failures,
                  lastAttempt: new Date().toISOString(),
                  nextAttempt: new Date(
                    failure.retryAt ||
                      Date.now() + Math.min(3600000, 60000 * 2 ** Math.min(failures, 6)),
                  ).toISOString(),
                };
              }
            });
          } catch {
            /* Isolated repository/account failures never stop Deck or other accounts. */
          }
        }
      };
      await Promise.all([worker(), worker()]);
    } finally {
      running = false;
    }
  }
  if (configured) {
    const timer = setInterval(() => {
      void tick().catch(() => {});
    }, 60000);
    timer.unref();
  }
  router.use(
    (error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      res
        .status(
          error instanceof z.ZodError ? 400 : error instanceof GitHubError ? error.status : 500,
        )
        .json({
          error:
            error instanceof z.ZodError
              ? 'Invalid integration request.'
              : error instanceof GitHubError
                ? error.message
                : 'Command Center is unavailable. Your local tasks are safe.',
        });
    },
  );
  return router;
}
