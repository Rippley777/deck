import { pool } from './auth';
// Keep compact deletion markers indefinitely to prevent old clients resurrecting data.
await pool.query(
  "UPDATE deck_tombstones SET value=NULL WHERE deleted_at < now() - interval '90 days'",
);
await pool.query(
  "DELETE FROM deck_revisions r WHERE created_at < now() - interval '90 days' AND version < (SELECT version FROM deck_workspaces w WHERE w.user_id=r.user_id)",
);
await pool.end();
