import pg from 'pg';
import { env } from './env.js';

// numeric (DECIMAL) ustunlari default holda string qaytadi — bu pul uchun
// to'g'ri, lekin bizga hisob-kitob kerak, shuning uchun raqamga o'giramiz.
// Kattaligi so'm uchun xavfsiz (JS raqami 9e15 gacha aniq).
pg.types.setTypeParser(pg.types.builtins.NUMERIC, (v) => (v === null ? null : Number(v)));
pg.types.setTypeParser(pg.types.builtins.INT8, (v) => (v === null ? null : Number(v)));

/**
 * `date` ustunlari MATN bo'lib qoladi ("2026-09-10"), JS Date emas.
 *
 * Sukut bo'yicha `pg` uni JS Date ga aylantiradi va u JARAYON vaqt
 * mintaqasidagi yarim tunga tushadi. JSON ga o'girilganda esa UTC ga
 * qaytadi: Toshkent mintaqasidagi mashinada "2026-09-10" → 
 * "2026-09-09T19:00:00.000Z" bo'lib chiqadi va mijoz uni kesib olganda
 * BIR KUN ORQAGA suriladi. Render'da (UTC) bu sezilmaydi — ya'ni xato
 * faqat ba'zi mashinalarda chiqadigan turdan.
 *
 * Postgres sanani allaqachon "YYYY-MM-DD" ko'rinishida beradi; uni
 * shundayligicha qoldirish butun bir xatolar sinfini yo'q qiladi.
 */
pg.types.setTypeParser(pg.types.builtins.DATE, (v) => v);

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

/**
 * SESSIYA VAQT MINTAQASI — har doim UTC.
 *
 * Nega qat'iy belgilanadi: ba'zi SQL ifodalari sessiya mintaqasiga
 * bog'liq (`date` → `timestamptz` o'girilishi shulardan biri). Mahalliy
 * docker'da mintaqa Asia/Tashkent (docker-compose: TZ), Render'da esa
 * UTC edi — natijada mahalliyda to'g'ri ishlagan so'rov ishlab turgan
 * serverda boshqacha javob berdi va buni sinovlar ham ko'rmadi.
 *
 * Mintaqani bir joyda qotirib qo'yish ikkalasini bir xil qiladi.
 * Do'kon vaqti kerak bo'lgan joyda u ATAYLAB va OCHIQ yoziladi
 * (`AT TIME ZONE 'Asia/Tashkent'`).
 */
pool.on('connect', (client) => {
  client.query("SET TIME ZONE 'UTC'").catch(() => {});
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
