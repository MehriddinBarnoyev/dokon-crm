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
  '004-tezlik.sql',
  '005-shtrix.sql',
];

/** Ulanish xatosimi (bazaga umuman yetib bo'lmadi) yoki boshqa xatomi? */
function ulanishXatosi(e: unknown): boolean {
  const kod = (e as { code?: string })?.code;
  return kod === 'ENOTFOUND' || kod === 'ECONNREFUSED'
    || kod === 'ETIMEDOUT' || kod === 'EAI_AGAIN';
}

/**
 * Bazaga ulanadi. Birinchi deploy'da baza hali ko'tarilmagan bo'lishi mumkin,
 * shuning uchun bir necha marta urinamiz.
 *
 * Urinishlar tugasa xatoni AYTIB beramiz: ENOTFOUND deyarli har doim bitta
 * narsani anglatadi — servis va baza HAR XIL MINTAQADA. Render bazaga ichki
 * manzil beradi va u boshqa mintaqadan ko'rinmaydi.
 */
async function ulan(urinishlar = 5): Promise<pg.Client> {
  for (let i = 1; i <= urinishlar; i++) {
    // Har urinishda YANGI klient: muvaffaqiyatsiz connect() dan keyin
    // pg klientni qayta ishlatib bo'lmaydi ("cannot reuse a client").
    const client = new pg.Client({
      connectionString: env.databaseUrl,
      ssl: sslConfig(env.databaseUrl),
    });
    try {
      await client.connect();
      return client;
    } catch (e) {
      await client.end().catch(() => {});
      if (!ulanishXatosi(e) || i === urinishlar) {
        if (ulanishXatosi(e)) {
          const host = (() => {
            try { return new URL(env.databaseUrl).hostname; } catch { return '?'; }
          })();
          throw new Error(
            `Bazaga ulanib bo'lmadi: ${host}\n`
            + '  Render ichki manzili (dpg-…-a) faqat BIR XIL MINTAQADAGI\n'
            + '  servisdan ko\'rinadi. render.yaml da baza va web servisning\n'
            + '  `region:` qiymati bir xil ekanini tekshiring.');
        }
        throw e;
      }
      console.log(`[migrate] baza hali tayyor emas, ${i}/${urinishlar} — 3s kutamiz…`);
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
  throw new Error('ulanib bo\'lmadi');   // bu yerga yetib kelmaydi
}

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

  const client = await ulan();

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
