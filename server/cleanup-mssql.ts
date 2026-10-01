import { query, closeSqlPool } from './sql';

// Keep compact deletion markers indefinitely to prevent old clients resurrecting data.
await query("UPDATE deck_tombstones SET value=NULL WHERE deleted_at < DATEADD(day, -90, SYSUTCDATETIME())");
await query("DELETE r FROM deck_revisions r WHERE created_at < DATEADD(day, -90, SYSUTCDATETIME()) AND version < (SELECT version FROM deck_workspaces w WHERE w.user_id=r.user_id)");
await closeSqlPool();
