import express from 'express';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { rateLimit } from 'express-rate-limit';
import { IntegrationStore } from './routes';
import type { DeviceQuery } from '../devices';
export function verifySignature(body: Buffer, signature: string, secret: string) {
  if (!/^sha256=[a-f0-9]{64}$/.test(signature)) return false;
  return timingSafeEqual(
    Buffer.from(signature.slice(7), 'hex'),
    createHmac('sha256', secret).update(body).digest(),
  );
}
/** Webhooks only invalidate cached status. All evidence is re-read with each user's permissions. */
export function githubWebhook(query: DeviceQuery, azure: boolean) {
  const router = express.Router(),
    store = new IntegrationStore(query, azure);
  router.post(
    '/',
    rateLimit({ windowMs: 60000, limit: 60 }),
    express.raw({ type: 'application/json', limit: '1mb' }),
    async (req, res) => {
      const secret = process.env.GITHUB_WEBHOOK_SECRET;
      if (!secret) {
        res.status(503).json({ error: 'Webhooks are not configured' });
        return;
      }
      if (
        !Buffer.isBuffer(req.body) ||
        !verifySignature(req.body, req.get('x-hub-signature-256') || '', secret)
      ) {
        res.status(401).json({ error: 'Invalid webhook signature' });
        return;
      }
      let body;
      try {
        body = JSON.parse(req.body.toString());
      } catch {
        res.status(400).json({ error: 'Invalid JSON' });
        return;
      }
      if (!Number.isSafeInteger(body.repository?.id)) {
        res.sendStatus(202);
        return;
      }
      const id = String(body.repository.id);
      const delivery = req.get('x-github-delivery') || '';
      if (!/^[a-zA-Z0-9-]{1,100}$/.test(delivery)) {
        res.status(400).json({ error: 'Invalid delivery ID' });
        return;
      }
      for (const { user_id } of (await query('SELECT user_id FROM deck_github')).rows) {
        const { state } = await store.read(user_id);
        if (!state.credentials || !state.repositories.some((r) => r.repository.id === id)) continue;
        await store.change(user_id, (current) => {
          if (current.deliveries?.includes(delivery)) return;
          current.deliveries = [...(current.deliveries || []), delivery].slice(-100);
          const repo = current.repositories.find((r) => r.repository.id === id);
          if (repo && (!current.lease || current.lease.expiresAt < Date.now())) {
            // A duplicate delivery is the same idempotent invalidation. Respect rate-limit backoff.
            repo.status = 'pending';
          }
        });
      }
      res.sendStatus(202);
    },
  );
  return router;
}
