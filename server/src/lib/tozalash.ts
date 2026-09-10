/**
 * DAVRIY TOZALASH.
 *
 * `mutation_log` — oflayn navbat uchun "bu o'zgarish allaqachon
 * bajarilgan" darvozasi. Har bir savdo, qarz va chiqim shu yerga bitta
 * qator qo'shadi va u HECH QACHON o'chirilmasdi.
 *
 * Mijoz bir necha kundan keyin baribir qayta yubormaydi (navbat
 * qurilmada shuncha turmaydi), shuning uchun eski yozuvlar faqat joy
 * egallaydi — bepul Postgres'da esa joy cheklangan.
 *
 * NEGA START'DA EMAS. Server ko'tarilishi tez bo'lishi kerak: Render
 * uyqudan uyg'onganda do'konchi javob kutib turadi. Shuning uchun
 * birinchi tozalash bir oz kechiktiriladi.
 */
import type { FastifyBaseLogger } from 'fastify';
import { pool } from '../db.js';

/** Shundan eski yozuv kerak emas. */
const SAQLASH_KUNI = 30;

/** Birinchi tozalashgacha — ko'tarilishga xalaqit bermasin. */
const BIRINCHI_KECHIKISH = 60_000;

/** Keyingilari orasidagi vaqt. */
const ORALIQ = 12 * 60 * 60 * 1000;

async function tozala(log: FastifyBaseLogger): Promise<void> {
  try {
    const res = await pool.query(
      `DELETE FROM mutation_log
        WHERE created_at < now() - ($1::int || ' days')::interval`,
      [SAQLASH_KUNI]);

    if (res.rowCount) {
      log.info(`[tozalash] mutation_log: ${res.rowCount} ta eski yozuv o'chirildi`);
    }
  } catch (e) {
    // Tozalash ixtiyoriy ish — u yiqilsa ham server ishlashda davom etadi.
    log.warn({ err: e }, '[tozalash] bajarilmadi');
  }
}

/**
 * Davriy tozalashni yoqadi. Taymerlar `unref` qilingan: ular tufayli
 * jarayon yopilmay qolmasin (SIGTERM da darhol chiqsin).
 */
export function boshlaTozalash(log: FastifyBaseLogger): void {
  setTimeout(() => {
    void tozala(log);
    setInterval(() => void tozala(log), ORALIQ).unref();
  }, BIRINCHI_KECHIKISH).unref();
}
