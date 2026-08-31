import pg from 'pg';
import { env } from './env.js';

// numeric (DECIMAL) ustunlari default holda string qaytadi — bu pul uchun
// to'g'ri, lekin bizga hisob-kitob kerak, shuning uchun raqamga o'giramiz.
// Kattaligi so'm uchun xavfsiz (JS raqami 9e15 gacha aniq).
pg.types.setTypeParser(pg.types.builtins.NUMERIC, (v) => (v === null ? null : Number(v)));
pg.types.setTypeParser(pg.types.builtins.INT8, (v) => (v === null ? null : Number(v)));

/**
 * Boshqariladigan Postgres (Render, Neon, Supabase…) SSL talab qiladi,
 * mahalliy docker esa umuman qo'llab-quvvatlamaydi. Shuning uchun manzilga
 * qarab o'zi hal qilamiz: localhost bo'lsa SSL yo'q, aks holda bor.
 *
 * `rejectUnauthorized: false` kerak, chunki bulut provayderlari o'z ildiz
 * sertifikatini ishlatadi va u Node'ning standart ro'yxatida bo'lmaydi.
 * Ulanish baribir shifrlangan — faqat sertifikat zanjiri tekshirilmaydi.
 * DATABASE_SSL=false/true bilan qo'lda ham belgilash mumkin.
 */
export function sslConfig(url: string): { rejectUnauthorized: boolean } | undefined {
  const qolda = process.env.DATABASE_SSL;
  if (qolda === 'false') return undefined;
  if (qolda === 'true') return { rejectUnauthorized: false };

  const host = (() => {
    try { return new URL(url).hostname; } catch { return ''; }
  })();
  const mahalliy = host === 'localhost' || host === '127.0.0.1' || host === '::1'
    || host === 'host.docker.internal';
  return mahalliy ? undefined : { rejectUnauthorized: false };
}

export const pool = new pg.Pool({
  connectionString: env.databaseUrl,
  ssl: sslConfig(env.databaseUrl),
  max: 10,
});

export type Sql = pg.Pool | pg.PoolClient;

export async function query<T extends pg.QueryResultRow = any>(
  sql: string,
  params: unknown[] = [],
  client: Sql = pool,
): Promise<T[]> {
  const res = await client.query<T>(sql, params as any[]);
  return res.rows;
}

export async function one<T extends pg.QueryResultRow = any>(
  sql: string,
  params: unknown[] = [],
  client: Sql = pool,
): Promise<T | null> {
  const rows = await query<T>(sql, params, client);
  return rows[0] ?? null;
}

/** Tranzaksiya: xato bo'lsa hammasi bekor qilinadi. */
export async function tx<T>(fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}
