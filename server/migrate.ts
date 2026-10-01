import { getMigrations } from 'better-auth/db/migration';
import { readFile } from 'node:fs/promises';
import { auth, pool } from './auth';
const { runMigrations } = await getMigrations(auth.options);
await runMigrations();
await pool.query(await readFile(new URL('./schema.sql', import.meta.url), 'utf8'));
await pool.end();
console.log('Deck database migrated.');
