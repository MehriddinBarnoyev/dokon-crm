/**
 * MIGRATSIYA — SQL fayllarni bazaga qo'yadi.
 *
 * Mahalliyda `npm run db:schema` docker exec + psql orqali ishlaydi, lekin
 * Render'da na docker, na psql bor — faqat DATABASE_URL. Shuning uchun
 * fayllarni `pg` orqali o'zimiz bajaramiz.
 *
 * Barcha SQL ataylab IDEMPOTENT (CREATE TABLE IF NOT EXISTS, CREATE OR
 * REPLACE FUNCTION, DO $$ ... EXCEPTION WHEN duplicate_object $$). Shuning
 * uchun buni har deploy'da qayta ishlatish xavfsiz — versiya jadvali kerak
 * emas va mavjud ma'lumot yo'qolmaydi.
 */
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';
import { env } from './env.js';
import { sslConfig } from './db.js';

const DB_DIR = path.resolve('db');

/**
 * Bajarilish TARTIBI — alifbo bo'yicha emas.
 * `schema.sql` birinchi bo'lishi shart (jadvallar), keyin qidiruv
 * funksiyalari; 003 esa 002 dagi funksiyani DROP qilib qayta yaratadi.
 */
const TARTIB = [
  'schema.sql',
  '002-search.sql',
  '003-search-staged.sql',
];

async function main() {
  // Ro'yxatga tushmay qolgan fayl bo'lsa — jim o'tkazib yubormaymiz.
  // Unutilgan migratsiya deploy'dan keyin tushunarsiz xatolarga olib keladi.
  const bor = (await readdir(DB_DIR)).filter((f) => f.endsWith('.sql'));
  const yetishmaydi = bor.filter((f) => !TARTIB.includes(f));
  if (yetishmaydi.length > 0) {
    throw new Error(
      `db/ da ro'yxatga qo'shilmagan SQL fayl bor: ${yetishmaydi.join(', ')}. `
      + 'src/migrate.ts dagi TARTIB ga qo\'shing.');
  }

  const client = new pg.Client({
    connectionString: env.databaseUrl,
    ssl: sslConfig(env.databaseUrl),
  });
  await client.connect();

  try {
    for (const fayl of TARTIB) {
      const sql = await readFile(path.join(DB_DIR, fayl), 'utf8');
      process.stdout.write(`[migrate] ${fayl} … `);
      // Har fayl bitta tranzaksiyada: yarim bajarilgan sxema qolmasin.
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('COMMIT');
        console.log('ok');
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      }
    }
    console.log('[migrate] Baza tayyor.');
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error('[migrate] XATO:', e instanceof Error ? e.message : e);
  process.exit(1);
});
