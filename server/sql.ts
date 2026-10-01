import sql from 'mssql';

const config: sql.config = {
  server: process.env.AZURE_SQL_SERVER!,
  database: process.env.AZURE_SQL_DATABASE!,
  user: process.env.AZURE_SQL_USER!,
  password: process.env.AZURE_SQL_PASSWORD!,
  port: 1433,
  options: { encrypt: true, trustServerCertificate: false },
  pool: { min: 0, max: 3, idleTimeoutMillis: 30000 },
  connectionTimeout: 60000,
  requestTimeout: 60000,
};

let poolPromise: Promise<sql.ConnectionPool> | undefined;
export function getSqlPool() {
  if (!poolPromise) {
    poolPromise = new sql.ConnectionPool(config).connect().catch((error) => {
      poolPromise = undefined;
      throw error;
    });
  }
  return poolPromise;
}

export async function query<T extends object = Record<string, unknown>>(
  statement: string,
  values: unknown[] = [],
  transaction?: sql.Transaction,
) {
  const request = transaction ? new sql.Request(transaction) : (await getSqlPool()).request();
  values.forEach((value, index) => request.input(`p${index + 1}`, value));
  const result = await request.query<T>(statement);
  return { rows: result.recordset || [], rowCount: result.rowsAffected?.[0] || 0 };
}

export async function beginTransaction() {
  const transaction = new sql.Transaction(await getSqlPool());
  await transaction.begin(sql.ISOLATION_LEVEL.READ_COMMITTED);
  return transaction;
}

export async function closeSqlPool() {
  if (poolPromise) await (await poolPromise).close();
  poolPromise = undefined;
}
