import { deviceRoutes } from './devices';
import express from 'express';
import { randomBytes, createHash } from 'node:crypto';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import { fromNodeHeaders, toNodeHandler } from 'better-auth/node';
import { auth, origin, emailEnabled, entraEnabled } from './auth';
import { query, beginTransaction } from './sql';
import { syncSchema } from '../shared/validation';
import { emptyDeck, mergeDeck } from '../shared/sync';
import { defaultSettings, type DeckData } from '../src/types';
import { resolve } from 'node:path';

const app = express();
const devices = deviceRoutes(query, true, origin, process.env.BETTER_AUTH_SECRET!);
const parseJson = <T>(value: string | T): T =>
  typeof value === 'string' ? (JSON.parse(value) as T) : value;
app.disable('x-powered-by');
if (process.env.TRUST_PROXY === '1') app.set('trust proxy', 1);
app.get('/healthz', async (_req, res) => {
  try {
    await query('SELECT 1 AS ready');
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
      await query<{ user_id: string; id: string }>(
        'UPDATE deck_devices SET last_active_at=SYSUTCDATETIME() OUTPUT INSERTED.user_id, INSERTED.id WHERE token_hash=@p1 AND expires_at>SYSUTCDATETIME()',
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
  if (!session) {
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
  const user = (await query('SELECT id,name,email FROM [user] WHERE id=@p1', [res.locals.userId]))
    .rows[0];
  res.json(user);
});
app.delete('/api/v1/account', async (req, res) => {
  if (!res.locals.session || req.body?.confirmation !== 'DELETE') {
    res.status(403).json({ error: 'A browser session and DELETE confirmation are required' });
    return;
  }
  if (Date.now() - new Date(res.locals.session.session.createdAt).getTime() > 600000) {
    res.status(403).json({ error: 'Sign out and sign in again before deleting your account' });
    return;
  }
  await query('DELETE FROM [user] WHERE id=@p1', [res.locals.userId]);
  res.json({ success: true });
});
app.get('/api/v1/devices', async (_req, res) => {
  res.json(
    (
      await query(
        'SELECT id,name,platform,architecture,app_version,last_sync,last_active_at,expires_at FROM deck_devices WHERE user_id=@p1 ORDER BY last_active_at DESC',
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
  await query('INSERT INTO deck_devices(id,user_id,name,token_hash) VALUES(@p1,@p2,@p3,@p4)', [
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
  await query('DELETE FROM deck_devices WHERE user_id=@p1 AND id=@p2', [
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
  await query('DELETE FROM deck_devices WHERE user_id=@p1', [res.locals.userId]);
  res.json({ success: true });
});
app.get('/api/v1/sync', async (_req, res) => {
  const row = await query<{ version: number; data: string; updated_at: Date }>(
    'SELECT version, data, updated_at FROM deck_workspaces WHERE user_id=@p1',
    [res.locals.userId],
  );
  res.json(
    row.rows[0]
      ? { ...row.rows[0], data: parseJson<DeckData>(row.rows[0].data) }
      : { version: 0, data: emptyDeck(defaultSettings) },
  );
});
app.post('/api/v1/sync', async (req, res) => {
  const parsed = syncSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid Deck data', details: parsed.error.flatten() });
    return;
  }
  const uid = res.locals.userId;
  const transaction = await beginTransaction();
  try {
    // Serialize every write for one account, including first sync.
    const lock = await query<{ code: number }>(
      "DECLARE @result int; EXEC @result = sp_getapplock @Resource=@p1, @LockMode='Exclusive', @LockOwner='Transaction', @LockTimeout=10000; SELECT @result AS code",
      [`deck:${uid}`],
      transaction,
    );
    if ((lock.rows[0]?.code ?? -1) < 0) throw new Error('Could not acquire sync lock');
    const row = (
      await query<{ version: number; data: string }>(
        'SELECT version, data FROM deck_workspaces WHERE user_id=@p1',
        [uid],
        transaction,
      )
    ).rows[0];
    const version = row?.version || 0;
    const current: DeckData = row ? parseJson<DeckData>(row.data) : emptyDeck(defaultSettings);
    const { baseVersion, data, mode } = parsed.data;
    if (mode === 'replace' && baseVersion !== version) {
      await transaction.rollback();
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
              await query<{ data: string }>(
                'SELECT data FROM deck_revisions WHERE user_id=@p1 AND version=@p2',
                [uid, baseVersion],
                transaction,
              )
            ).rows[0]?.data;
      if (!base || baseVersion > version) {
        await transaction.rollback();
        res.status(409).json({
          error: 'Sync history expired. Export local data and reconnect to merge safely.',
        });
        return;
      }
      merged = mergeDeck(parseJson<DeckData>(base), data, current);
    }
    for (const collection of ['tasks', 'stacks', 'goals', 'templates'] as const) {
      const present = new Set((merged.data[collection] || []).map((v) => v.id));
      for (const entity of current[collection] || [])
        if (!present.has(entity.id))
          await query(
            'UPDATE deck_tombstones SET deleted_at=SYSUTCDATETIME(), value=@p4 WHERE user_id=@p1 AND collection=@p2 AND entity_id=@p3; IF @@ROWCOUNT=0 INSERT INTO deck_tombstones(user_id,collection,entity_id,value) VALUES(@p1,@p2,@p3,@p4)',
            [uid, collection, entity.id, JSON.stringify(entity)],
            transaction,
          );
      // A base-0 device must not resurrect previously deleted entities.
      if (baseVersion === 0 && version > 0) {
        const deleted = new Set(
          (
            await query<{ entity_id: string }>(
              'SELECT entity_id FROM deck_tombstones WHERE user_id=@p1 AND collection=@p2',
              [uid, collection],
              transaction,
            )
          ).rows.map((v) => v.entity_id),
        );
        (merged.data[collection] as any) = (merged.data[collection] || []).filter(
          (v) => !deleted.has(v.id),
        );
      }
    }
    for (const collection of ['tasks', 'stacks', 'goals', 'templates'] as const) {
      await query(
        'DELETE FROM deck_tombstones WHERE user_id=@p1 AND collection=@p2 AND entity_id IN (SELECT [value] FROM OPENJSON(@p3))',
        [uid, collection, JSON.stringify((merged.data[collection] || []).map((v) => v.id))],
        transaction,
      );
    }
    const next = version + 1;
    await query(
      'UPDATE deck_workspaces SET version=@p2,data=@p3,updated_at=SYSUTCDATETIME() WHERE user_id=@p1; IF @@ROWCOUNT=0 INSERT INTO deck_workspaces(user_id,version,data) VALUES(@p1,@p2,@p3)',
      [uid, next, JSON.stringify(merged.data)],
      transaction,
    );
    // The complete incoming document is retained too, so every losing edit is recoverable.
    await query(
      'INSERT INTO deck_revisions(user_id,version,data,conflicts) VALUES(@p1,@p2,@p3,@p4)',
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
      transaction,
    );
    await transaction.commit();
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
    await transaction.rollback();
    throw error;
  }
});
app.get('/api/v1/history', async (_req, res) => {
  res.json(
    (
      await query<{ version: number; created_at: Date; conflicts: string }>(
        'SELECT TOP(100) version,created_at,conflicts FROM deck_revisions WHERE user_id=@p1 ORDER BY version DESC',
        [res.locals.userId],
      )
    ).rows.map((row) => ({ ...row, conflicts: parseJson(row.conflicts) })),
  );
});
app.get('/api/v1/history/:version', async (req, res) => {
  const row = (
    await query<{ data: string; conflicts: string }>(
      'SELECT * FROM deck_revisions WHERE user_id=@p1 AND version=@p2',
      [res.locals.userId, Number(req.params.version) || -1],
    )
  ).rows[0];
  if (!row) {
    res.status(404).json({ error: 'Revision not found' });
    return;
  }
  res.json({ ...row, data: parseJson(row.data), conflicts: parseJson(row.conflicts) });
});
app.get('/api/v1/export', async (_req, res) => {
  const uid = res.locals.userId;
  const data = (
    await query<{ data: string }>('SELECT data FROM deck_workspaces WHERE user_id=@p1', [uid])
  ).rows[0]?.data;
  const history = (
    await query<{ version: number; data: string; conflicts: string; created_at: Date }>(
      'SELECT version,data,conflicts,created_at FROM deck_revisions WHERE user_id=@p1 ORDER BY version',
      [uid],
    )
  ).rows.map((row) => ({ ...row, data: parseJson(row.data), conflicts: parseJson(row.conflicts) }));
  const deleted = (
    await query<{ collection: string; entity_id: string; deleted_at: Date; value: string | null }>(
      'SELECT collection,entity_id,deleted_at,value FROM deck_tombstones WHERE user_id=@p1',
      [uid],
    )
  ).rows.map((row) => ({ ...row, value: row.value ? parseJson(row.value) : null }));
  res.json({ data: data ? parseJson(data) : null, history, deleted });
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
