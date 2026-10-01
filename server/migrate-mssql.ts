import { getMigrations } from 'better-auth/db/migration';
import { readFile } from 'node:fs/promises';
import { auth, azureSql } from './auth';
import { query, closeSqlPool } from './sql';

if (!azureSql) throw new Error('Set DATABASE_PROVIDER=mssql');
const { runMigrations } = await getMigrations(auth.options);
await runMigrations();
await query(await readFile(new URL('./schema-mssql.sql', import.meta.url), 'utf8'));
await closeSqlPool();
console.log('Deck Azure SQL database migrated.');
process.exit(0);
