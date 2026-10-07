import { deviceRoutes } from './devices';
import express from 'express';
import { randomBytes, createHash } from 'node:crypto';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import { fromNodeHeaders, toNodeHandler } from 'better-auth/node';
import { auth, pool, origin, emailEnabled, entraEnabled } from './auth';
import { syncSchema } from '../shared/validation';
import { emptyDeck, mergeDeck } from '../shared/sync';
import { defaultSettings, type DeckData } from '../src/types';
import { resolve } from 'node:path';

const app = express();
const devices = deviceRoutes(
  (sql, values) =>
    pool.query(
      sql.replace(/@p(\d+)/g, (_, index) => '$' + index),
      values,
    ),
  false,
  origin,
  process.env.BETTER_AUTH_SECRET!,
);
app.disable('x-powered-by');
if (process.env.TRUST_PROXY === '1') app.set('trust proxy', 1);
app.get('/healthz', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok' });
  } catch {
    res.status(503).json({ status: 'unavailable' });
  }
});
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        'script-src': ["'self'", "'wasm-unsafe-eval'"],
        'worker-src': ["'self'", 'blob:'],
      },
    },
  }),
);
app.get('/api/v1/config', (_req, res) =>
  res.json({
    google: !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
    entra: entraEnabled,
    email: emailEnabled,
  }),
);
app.use('/api/auth', (req, _res, next) => {
  req.headers['x-deck-client-ip'] = req.ip || req.socket.remoteAddress || 'unknown';
  next();
});
app.all('/api/auth/*splat', toNodeHandler(auth));
app.use(
  '/api/v1',
  rateLimit({ windowMs: 60000, limit: 120, standardHeaders: 'draft-8', legacyHeaders: false }),
);
app.use('/api/v1', (req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  if (
    !['GET', 'HEAD', 'OPTIONS'].includes(req.method) &&
    req.headers.origin !== origin &&
    !(req.headers.authorization?.startsWith('Bearer ') && !req.headers.origin) &&
    !(
      req.headers.authorization?.startsWith('Pairing ') &&
      !req.headers.origin &&
      ['/devices/pair/start', '/devices/pair/poll'].includes(req.path)
    )
  ) {
    res.status(403).json({ error: 'Untrusted origin' });
    return;
  }
  next();
});
app.use(express.json({ limit: '12mb' }));
app.use('/api/v1', devices.publicRoutes);
app.use('/api/v1', async (req, res, next) => {
  if (req.headers.authorization?.startsWith('Bearer ') && !req.headers.origin) {
    const hash = createHash('sha256').update(req.headers.authorization.slice(7)).digest('hex');
    const device = (
      await pool.query(
        'UPDATE deck_devices SET last_active_at=now() WHERE token_hash=$1 AND expires_at>now() RETURNING user_id,id',
        [hash],
      )
    ).rows[0];
    if (!device) {
      res.status(401).json({ error: 'Reconnect this desktop from Account settings' });
      return;
    }
    res.locals.userId = device.user_id;
    res.locals.deviceId = device.id;
    next();
    return;
  }
  const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
  if (!session || !session.user.emailVerified) {
    res.status(401).json({ error: 'Sign in with a verified account' });
    return;
  }
  res.locals.userId = session.user.id;
  res.locals.session = session;
  next();
});
app.use('/api/v1', (req, res, next) => {
  const expectedAccount = req.headers['x-deck-account'];
  if (expectedAccount && expectedAccount !== res.locals.userId) {
    res.status(409).json({
      error: 'The signed-in account changed. Reopen Account settings before syncing this Deck.',
    });
    return;
  }
  next();
});
app.use('/api/v1', devices.privateRoutes);
app.get('/api/v1/me', async (_req, res) => {
  const user = (
    await pool.query('SELECT id,name,email FROM "user" WHERE id=$1', [res.locals.userId])
  ).rows[0];
  res.json(user);
});
app.get('/api/v1/devices', async (_req, res) => {
  res.json(
    (
      await pool.query(
        'SELECT id,name,platform,architecture,app_version,last_sync,last_active_at,expires_at FROM deck_devices WHERE user_id=$1 ORDER BY last_active_at DESC',
        [res.locals.userId],
      )
    ).rows,
  );
});
app.post('/api/v1/devices', async (req, res) => {
  if (
    !res.locals.session ||
    Date.now() - new Date(res.locals.session.session.createdAt).getTime() > 600000
  ) {
    res.status(403).json({ error: 'Sign in again before connecting a desktop' });
    return;
  }
  if (typeof req.body.name !== 'string' || !req.body.name.trim() || req.body.name.length > 100) {
    res.status(400).json({ error: 'Enter a device name' });
    return;
  }
  const token = randomBytes(32).toString('base64url');
  await pool.query('INSERT INTO deck_devices(id,user_id,name,token_hash) VALUES($1,$2,$3,$4)', [
    crypto.randomUUID(),
    res.locals.userId,
    req.body.name,
    createHash('sha256').update(token).digest('hex'),
  ]);
  res.json({ token, origin });
});
app.post('/api/v1/devices/revoke', async (req, res) => {
  if (typeof req.body.id !== 'string' || !/^[a-f0-9-]{36}$/i.test(req.body.id)) {
    res.status(400).json({ error: 'Invalid device' });
    return;
  }
  await pool.query('DELETE FROM deck_devices WHERE user_id=$1 AND id=$2', [
    res.locals.userId,
    req.body.id,
  ]);
  res.json({ success: true });
});
app.post('/api/v1/devices/revoke-all', async (_req, res) => {
  if (!res.locals.session) {
    res.status(403).json({ error: 'Browser session required' });
    return;
  }
  await pool.query('DELETE FROM deck_devices WHERE user_id=$1', [res.locals.userId]);
  res.json({ success: true });
});
app.get('/api/v1/sync', async (_req, res) => {
  const row = await pool.query(
    'SELECT version, data, updated_at FROM deck_workspaces WHERE user_id=$1',
    [res.locals.userId],
  );
  res.json(row.rows[0] || { version: 0, data: emptyDeck(defaultSettings) });
});
app.post('/api/v1/sync', async (req, res) => {
  const parsed = syncSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid Deck data', details: parsed.error.flatten() });
    return;
  }
  const uid = res.locals.userId;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Serialize every write for one account, including first sync.
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [uid]);
    const row = (
      await client.query('SELECT version, data FROM deck_workspaces WHERE user_id=$1 FOR UPDATE', [
        uid,
      ])
    ).rows[0];
    const version = row?.version || 0;
    const current: DeckData = row?.data || emptyDeck(defaultSettings);
    const { baseVersion, data, mode } = parsed.data;
    if (mode === 'replace' && baseVersion !== version) {
      await client.query('ROLLBACK');
      res.status(409).json({
        error:
          'Cloud changed while you were reviewing sync. Check it again before replacing either Deck.',
      });
      return;
    }
    let merged = { data, conflicts: [] as ReturnType<typeof mergeDeck>['conflicts'] };
    if (baseVersion !== version) {
      const base =
        baseVersion === 0
          ? emptyDeck(defaultSettings)
          : (
              await client.query(
                'SELECT data FROM deck_revisions WHERE user_id=$1 AND version=$2',
                [uid, baseVersion],
              )
            ).rows[0]?.data;
      if (!base || baseVersion > version) {
        await client.query('ROLLBACK');
        res.status(409).json({
          error: 'Sync history expired. Export local data and reconnect to merge safely.',
        });
        return;
      }
      merged = mergeDeck(base, data, current);
    }
    for (const collection of ['tasks', 'stacks', 'goals', 'templates'] as const) {
      const present = new Set((merged.data[collection] || []).map((v) => v.id));
      for (const entity of current[collection] || [])
        if (!present.has(entity.id))
          await client.query(
            'INSERT INTO deck_tombstones(user_id,collection,entity_id,value) VALUES($1,$2,$3,$4) ON CONFLICT(user_id,collection,entity_id) DO UPDATE SET deleted_at=now(), value=EXCLUDED.value',
            [uid, collection, entity.id, JSON.stringify(entity)],
          );
      // A base-0 device must not resurrect previously deleted entities.
      if (baseVersion === 0 && version > 0) {
        const deleted = new Set(
          (
            await client.query(
              'SELECT entity_id FROM deck_tombstones WHERE user_id=$1 AND collection=$2',
              [uid, collection],
            )
          ).rows.map((v) => v.entity_id),
        );
        (merged.data[collection] as any) = (merged.data[collection] || []).filter(
          (v) => !deleted.has(v.id),
        );
      }
    }
    for (const collection of ['tasks', 'stacks', 'goals', 'templates'] as const) {
      await client.query(
        'DELETE FROM deck_tombstones WHERE user_id=$1 AND collection=$2 AND entity_id=ANY($3::text[])',
        [uid, collection, (merged.data[collection] || []).map((v) => v.id)],
      );
    }
    const next = version + 1;
    await client.query(
      'INSERT INTO deck_workspaces(user_id,version,data) VALUES($1,$2,$3) ON CONFLICT(user_id) DO UPDATE SET version=$2,data=$3,updated_at=now()',
      [uid, next, JSON.stringify(merged.data)],
    );
    // The complete incoming document is retained too, so every losing edit is recoverable.
    await client.query(
      'INSERT INTO deck_revisions(user_id,version,data,conflicts) VALUES($1,$2,$3,$4)',
      [
        uid,
        next,
        JSON.stringify(merged.data),
        JSON.stringify(
          merged.conflicts.length
            ? { fields: merged.conflicts, incoming: data, previous: current }
            : [],
        ),
      ],
    );
    await client.query('COMMIT');
    console.info(
      JSON.stringify({
        event: 'deck_sync',
        userId: uid,
        version: next,
        conflicts: merged.conflicts.length,
      }),
    );
    res.json({ version: next, data: merged.data, conflicts: merged.conflicts.length });
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
});
app.get('/api/v1/history', async (_req, res) => {
  res.json(
    (
      await pool.query(
        'SELECT version,created_at,conflicts FROM deck_revisions WHERE user_id=$1 ORDER BY version DESC LIMIT 100',
        [res.locals.userId],
      )
    ).rows,
  );
});
app.get('/api/v1/history/:version', async (req, res) => {
  const row = (
    await pool.query('SELECT * FROM deck_revisions WHERE user_id=$1 AND version=$2', [
      res.locals.userId,
      Number(req.params.version) || -1,
    ])
  ).rows[0];
  if (!row) {
    res.status(404).json({ error: 'Revision not found' });
    return;
  }
  res.json(row);
});
app.get('/api/v1/export', async (_req, res) => {
  const uid = res.locals.userId;
  const data = (await pool.query('SELECT data FROM deck_workspaces WHERE user_id=$1', [uid]))
    .rows[0]?.data;
  const history = (
    await pool.query(
      'SELECT version,data,conflicts,created_at FROM deck_revisions WHERE user_id=$1 ORDER BY version',
      [uid],
    )
  ).rows;
  const deleted = (
    await pool.query(
      'SELECT collection,entity_id,deleted_at,value FROM deck_tombstones WHERE user_id=$1',
      [uid],
    )
  ).rows;
  res.json({ data, history, deleted });
});
app.use('/api', (_req, res) => {
  res.status(404).json({ error: 'Endpoint not found' });
});
app.use(
  express.static(resolve('dist'), {
    setHeaders(res, path) {
      if (path.endsWith('sw.js') || path.endsWith('index.html'))
        res.setHeader('Cache-Control', 'no-cache');
    },
  }),
);
app.get('/{*splat}', (_req, res) => res.sendFile(resolve('dist/index.html')));
app.use(
  (err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error(
      JSON.stringify({
        event: 'request_failed',
        kind: err instanceof Error ? err.name : 'unknown',
      }),
    );
    res.status(500).json({ error: 'Unable to complete this request. Please try again.' });
  },
);
app.listen(Number(process.env.PORT || 3001), () => console.log('Deck API ready'));
