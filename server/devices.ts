import express from 'express';
import { createHash, createHmac, randomUUID, randomBytes } from 'node:crypto';
import { z } from 'zod';
import { deviceSchema } from '../shared/validation';

type Row = Record<string, any>;
export type DeviceQuery = (sql: string, params?: unknown[]) => Promise<{ rows: Row[] }>;
export function deviceRoutes(query: DeviceQuery, azure: boolean, origin: string, secret: string) {
  const publicRoutes = express.Router(),
    privateRoutes = express.Router();
  const hash = (value: string) => createHash('sha256').update(value).digest('hex');
  const pairToken = (id: string, proof: string) =>
    createHmac('sha256', secret).update(`deck-pair:${id}:${proof}`).digest('base64url');
  const proof = (req: express.Request) => {
    const value = req.headers.authorization?.match(/^Pairing ([A-Za-z0-9_-]{43})$/)?.[1];
    if (!value) return null;
    return hash(value);
  };
  publicRoutes.post('/devices/pair/start', async (req, res) => {
    const parsed = deviceSchema.safeParse(req.body);
    if (!parsed.success || !proof(req)) {
      res.status(400).json({ error: 'Invalid device registration' });
      return;
    }
    const id = randomUUID(),
      expiry = new Date(Date.now() + 10 * 60000);
    // Expired requests hold no credentials and are periodically cleared here.
    await query('DELETE FROM deck_pairings WHERE expires_at < @p1', [new Date()]);
    await query(
      'INSERT INTO deck_pairings(id,secret_hash,metadata,expires_at) VALUES(@p1,@p2,@p3,@p4)',
      [id, proof(req), JSON.stringify(parsed.data), expiry],
    );
    res.json({ id, url: `${origin}/desktop-connect?pair=${id}`, expiresAt: expiry.toISOString() });
  });
  publicRoutes.get('/devices/pair/:id', async (req, res) => {
    if (!z.string().uuid().safeParse(req.params.id).success) {
      res.status(400).json({ error: 'Invalid connection' });
      return;
    }
    const row = (
      await query('SELECT metadata FROM deck_pairings WHERE id=@p1 AND expires_at>@p2', [
        req.params.id,
        new Date(),
      ])
    ).rows[0];
    if (!row) {
      res.status(404).json({ error: 'Connection expired. Start again in Deck Desktop.' });
      return;
    }
    const device = deviceSchema.parse(JSON.parse(row.metadata));
    res.json({
      name: device.name,
      platform: device.platform,
      architecture: device.architecture,
      appVersion: device.appVersion,
    });
  });
  publicRoutes.post('/devices/pair/poll', async (req, res) => {
    const id = req.body?.id;
    if (!z.string().uuid().safeParse(id).success) {
      res.status(400).json({ error: 'Invalid connection' });
      return;
    }
    const challenge = proof(req);
    if (!challenge) {
      res.status(400).json({ error: 'Invalid pairing proof' });
      return;
    }
    const row = (
      await query(
        'SELECT user_id FROM deck_pairings WHERE id=@p1 AND secret_hash=@p2 AND expires_at>@p3',
        [id, challenge, new Date()],
      )
    ).rows[0];
    if (!row) {
      res.status(404).json({ error: 'Connection expired. Start again.' });
      return;
    }
    if (
      !row.user_id ||
      !(await query('SELECT id FROM deck_devices WHERE id=@p1 AND user_id=@p2', [id, row.user_id]))
        .rows[0]
    ) {
      res.json({ pending: true });
      return;
    }
    const consumed = (
      await query(
        azure
          ? 'DELETE FROM deck_pairings OUTPUT DELETED.user_id WHERE id=@p1 AND secret_hash=@p2 AND expires_at>@p3 AND user_id IS NOT NULL'
          : 'DELETE FROM deck_pairings WHERE id=@p1 AND secret_hash=@p2 AND expires_at>@p3 AND user_id IS NOT NULL RETURNING user_id',
        [id, challenge, new Date()],
      )
    ).rows[0];
    if (!consumed) {
      res.status(409).json({ error: 'Connection already used' });
      return;
    }
    res.json({ token: pairToken(id, challenge), origin });
  });
  privateRoutes.post('/devices/pair/approve', async (req, res) => {
    const id = req.body?.id;
    if (
      !res.locals.session ||
      Date.now() - new Date(res.locals.session.session.createdAt).getTime() > 600000
    ) {
      res.status(403).json({ error: 'Sign in again before connecting a device.' });
      return;
    }
    if (!z.string().uuid().safeParse(id).success) {
      res.status(400).json({ error: 'Invalid connection' });
      return;
    }
    const row = (
      await query(
        azure
          ? 'UPDATE deck_pairings SET user_id=@p2 OUTPUT INSERTED.secret_hash, INSERTED.metadata WHERE id=@p1 AND expires_at>@p3 AND user_id IS NULL'
          : 'UPDATE deck_pairings SET user_id=@p2 WHERE id=@p1 AND expires_at>@p3 AND user_id IS NULL RETURNING secret_hash,metadata',
        [id, res.locals.userId, new Date()],
      )
    ).rows[0];
    if (!row) {
      res.status(409).json({ error: 'Connection expired or already approved.' });
      return;
    }
    const device = deviceSchema.parse(JSON.parse(row.metadata));
    await query(
      'INSERT INTO deck_devices(id,user_id,name,token_hash,platform,architecture,app_version,installation_id) VALUES(@p1,@p2,@p3,@p4,@p5,@p6,@p7,@p8)',
      [
        id,
        res.locals.userId,
        device.name,
        hash(pairToken(id, row.secret_hash)),
        device.platform,
        device.architecture,
        device.appVersion,
        device.id,
      ],
    );
    res.json({ success: true });
  });
  privateRoutes.post('/devices/register', async (req, res) => {
    const parsed = deviceSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid device metadata' });
      return;
    }
    const d = parsed.data,
      uid = res.locals.userId;
    if (res.locals.deviceId) {
      await query(
        'UPDATE deck_devices SET name=@p3,platform=@p4,architecture=@p5,app_version=@p6,last_sync=@p7 WHERE id=@p1 AND user_id=@p2',
        [
          res.locals.deviceId,
          uid,
          d.name,
          d.platform,
          d.architecture,
          d.appVersion,
          d.lastSync ? new Date(d.lastSync) : null,
        ],
      );
    } else {
      const row = (
        await query('SELECT id FROM deck_devices WHERE user_id=@p1 AND installation_id=@p2', [
          uid,
          d.id,
        ])
      ).rows[0];
      if (row)
        await query(
          'UPDATE deck_devices SET name=@p3,platform=@p4,architecture=@p5,app_version=@p6,last_sync=@p7,last_active_at=@p8 WHERE id=@p1 AND user_id=@p2',
          [
            row.id,
            uid,
            d.name,
            d.platform,
            d.architecture,
            d.appVersion,
            d.lastSync ? new Date(d.lastSync) : null,
            new Date(),
          ],
        );
      else
        await query(
          'INSERT INTO deck_devices(id,user_id,name,token_hash,platform,architecture,app_version,installation_id,last_sync) VALUES(@p1,@p2,@p3,@p4,@p5,@p6,@p7,@p8,@p9)',
          [
            randomUUID(),
            uid,
            d.name,
            hash(randomBytes(32).toString('base64url')),
            d.platform,
            d.architecture,
            d.appVersion,
            d.id,
            d.lastSync ? new Date(d.lastSync) : null,
          ],
        );
    }
    res.json({ success: true });
  });
  return { publicRoutes, privateRoutes };
}
