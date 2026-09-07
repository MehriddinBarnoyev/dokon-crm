import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { one, query, tx } from '../db.js';
import { requireAuth } from '../lib/auth.js';
import { executeActions } from '../lib/actions.js';

/** Bir sahifadagi qarz yozuvlari soni. */
const TARIX_SAHIFA = 20;
/** Bir sahifadagi xaridlar soni — har biri o'z mahsulotlari bilan keladi. */
const XARID_SAHIFA = 10;

/** Qarz tarixi — birinchi sahifa ham, keyingilari ham shu so'rov bilan. */
const TARIX_SQL = (keyset: string, limitIndex: number) =>
  `SELECT d.id, d.amount, d.due_date, d.note, d.created_at, d.sale_id,
          u.name AS user_name
     FROM debts d LEFT JOIN users u ON u.id = d.user_id
    WHERE d.customer_id = $1 AND d.shop_id = $2${keyset}
    ORDER BY d.created_at DESC, d.id DESC
    LIMIT $${limitIndex}`;

/* --------------------------- Sahifalash ---------------------------- */

/**
 * Kursor OFFSET emas, `(created_at, id)` juftligi.
 *
 * Sabab: sahifa ochiq turganda mijozga yangi to'lov yozilishi mumkin —
 * u ro'yxat TEPASIGA qo'shiladi va offset bilan ikkinchi sahifa bir qatorni
 * takrorlab ko'rsatardi. Juftlik bo'yicha esa "shu yozuvdan keyingilari"
 * har doim aniq.
 */
interface Kursor { vaqt: string; id: string }

function kursor(r: { created_at: Date | string; id: string }): string {
  const t = r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at);
  return `${t}|${r.id}`;
}

function kursorOch(s?: string): Kursor | null {
  if (!s) return null;
  const i = s.lastIndexOf('|');
  if (i <= 0) return null;
  const vaqt = s.slice(0, i), id = s.slice(i + 1);
  // Yaroqsiz kursor — xato emas, shunchaki boshidan: sahifa baribir
  // ko'rinadi, faqat "Yana" bir joyda takrorlanadi.
  if (Number.isNaN(Date.parse(vaqt))) return null;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return null;
  return { vaqt, id };
}

/**
 * `limit + 1` ta olingan qatordan sahifa yasaydi. Ortiqcha qator faqat
 * "yana bormi?" savoliga javob beradi va javobga tushmaydi — shu bilan
 * "Yana" tugmasi bosilmasdan turib keyingi so'rov ketmaydi.
 */
function sahifala<T extends { created_at: Date | string; id: string }>(
  rows: T[], limit: number,
): { items: T[]; next: string | null } {
  const yana = rows.length > limit;
  const items = yana ? rows.slice(0, limit) : rows;
  return { items, next: yana && items.length ? kursor(items[items.length - 1]) : null };
}

export default async function debtRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth);

  /** Qarzdorlar ro'yxati — eng kattasi yuqorida. */
  app.get('/', async (req) => {
    const q = z.object({
      only_owing: z.string().optional(),   // '1' => faqat qarzi borlar
      search: z.string().optional(),
    }).parse(req.query);

    const where = ['shop_id = $1'];
    const params: unknown[] = [req.auth.shop_id];
    if (q.only_owing === '1') where.push('balance > 0');
    if (q.search) {
      params.push(q.search.trim());
      where.push(`dokon_match_score(name, $${params.length}) >= 0.3`);
    }

    return query(
      `SELECT customer_id, name, phone, balance, nearest_due, last_activity,
              (nearest_due IS NOT NULL AND nearest_due < CURRENT_DATE AND balance > 0) AS overdue
         FROM customer_balances
        WHERE ${where.join(' AND ')}
        ORDER BY balance DESC, name`, params);
  });

  /* ---------------------------- Bitta mijoz ---------------------------- */

  /**
   * Mijoz sahifasi UCH bo'lakda tortiladi va bu ataylab shunday.
   *
   *   1) shu yerda — balans, xaridlar yig'indisi va qarz tarixining
   *      birinchi sahifasi. Ekran ochilishi bilan ko'rinadigan hamma narsa,
   *      bitta so'rovda.
   *   2) `/history` — tarixning keyingi sahifalari, "Yana" bosilganda.
   *   3) `/purchases` — xaridlar, har biri mahsulotlari va narxlari bilan;
   *      faqat "Xaridlari" bo'limi ochilganda.
   *
   * Ilgari uchalasi bitta javobda kelardi: 200 ta qarz yozuvi va 100 ta
   * savdo har biri o'z mahsulotlari bilan — ya'ni sahifadagi eng og'ir
   * qism hech kim ochmagan bo'lim uchun edi. Do'kondagi mobil internetda
   * bu bir necha soniyalik kutish, har safar ekranga qaytganda qaytadan.
   */
  app.get('/customer/:id', async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const c = await one(
      `SELECT * FROM customer_balances WHERE customer_id = $1 AND shop_id = $2`,
      [id, req.auth.shop_id]);
    if (!c) return reply.code(404).send({ error: 'Mijoz topilmadi' });

    const [tarix, jami] = await Promise.all([
      query(TARIX_SQL('', 3), [id, req.auth.shop_id, TARIX_SAHIFA + 1]),
      // Xaridlar bo'limi yopiq turganda ham sarlavhada "12 ta · 1 250 000"
      // ko'rinadi. Bu bitta yengil agregat — mahsulotlar tortilmaydi.
      one(`SELECT COUNT(*)::int AS xaridlar_soni,
                  COALESCE(SUM(total), 0) AS jami_xarid,
                  MAX(created_at)         AS oxirgi_xarid
             FROM sales WHERE customer_id = $1 AND shop_id = $2`,
          [id, req.auth.shop_id]),
    ]);

    return { ...c, jami, history: sahifala(tarix, TARIX_SAHIFA) };
  });

  /** Qarz tarixining keyingi sahifasi. */
  app.get('/customer/:id/history', async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const { before } = z.object({ before: z.string().optional() }).parse(req.query);
    const k = kursorOch(before);

    const params: unknown[] = [id, req.auth.shop_id];
    let keyset = '';
    if (k) {
      params.push(k.vaqt, k.id);
      keyset = ' AND (d.created_at, d.id) < ($3::timestamptz, $4::uuid)';
    }
    params.push(TARIX_SAHIFA + 1);

    return sahifala(await query(TARIX_SQL(keyset, params.length), params), TARIX_SAHIFA);
  });

  /**
   * Mijozning xaridlari — har biri qanday mahsulot, qancha miqdorda va
   * qaysi narxda olinganigacha. Naqd sotib olganlari ham shu yerda:
   * "shu odam mendan nima olgan" degan savol qarzdan mustaqil.
   */
  app.get('/customer/:id/purchases', async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const { before } = z.object({ before: z.string().optional() }).parse(req.query);
    const k = kursorOch(before);

    const params: unknown[] = [id, req.auth.shop_id];
    let keyset = '';
    if (k) {
      params.push(k.vaqt, k.id);
      keyset = ' AND (s.created_at, s.id) < ($3::timestamptz, $4::uuid)';
    }
    params.push(XARID_SAHIFA + 1);

    const rows = await query(
      `SELECT s.id, s.total, s.paid, s.payment_method, s.created_at,
              (SELECT json_agg(json_build_object(
                        'name', si.name_snap, 'qty', si.qty, 'unit', si.unit,
                        'unit_price', si.unit_price, 'subtotal', si.subtotal)
                      ORDER BY si.id)
                 FROM sale_items si WHERE si.sale_id = s.id) AS items
         FROM sales s
        WHERE s.customer_id = $1 AND s.shop_id = $2${keyset}
        ORDER BY s.created_at DESC, s.id DESC
        LIMIT $${params.length}`, params);

    return sahifala(rows, XARID_SAHIFA);
  });

  /** Qarz berish */
  app.post('/', async (req, reply) => {
    const body = z.object({
      customer_id: z.string().uuid().nullable().default(null),
      customer_name: z.string().min(1),
      customer_phone: z.string().nullable().default(null),
      amount: z.number().positive(),
      due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().default(null),
      /** Eski daftardan ko'chirilayotgan qarz uchun — berilgan sana. */
      created_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().default(null),
      note: z.string().nullable().default(null),
    }).parse(req.body);

    try {
      const [res] = await tx((c) => executeActions(c,
        { shopId: req.auth.shop_id, userId: req.auth.id, source: 'manual' },
        [{ type: 'debt', ...body }]));
      return res;
    } catch (e: any) {
      return reply.code(400).send({ error: e.message });
    }
  });

  /** Qarz to'lovi */
  app.post('/payment', async (req, reply) => {
    const body = z.object({
      customer_id: z.string().uuid().nullable().default(null),
      customer_name: z.string().min(1),
      amount: z.number().positive(),
      note: z.string().nullable().default(null),
    }).parse(req.body);

    try {
      const [res] = await tx((c) => executeActions(c,
        { shopId: req.auth.shop_id, userId: req.auth.id, source: 'manual' },
        [{ type: 'debt_payment', ...body }]));
      return res;
    } catch (e: any) {
      return reply.code(400).send({ error: e.message });
    }
  });

  /* ------------------------------- Mijozlar ------------------------------- */

  app.get('/customers', async (req) => {
    const q = z.object({ search: z.string().optional() }).parse(req.query);
    if (q.search && q.search.trim()) {
      // Ism xato yozilgan bo'lsa ham topadi: "Alsiher" → "Alisher Karimov"
      return query(
        `SELECT id, name, phone, balance, taxminiy FROM dokon_search_customers($1, $2, 50)`,
        [req.auth.shop_id, q.search.trim()]);
    }
    return query(
      `SELECT id, name, phone, note, created_at FROM customers
        WHERE shop_id = $1 ORDER BY name LIMIT 200`, [req.auth.shop_id]);
  });

  app.post('/customers', async (req) => {
    const body = z.object({
      name: z.string().min(1),
      phone: z.string().nullable().default(null),
      note: z.string().nullable().default(null),
    }).parse(req.body);
    return one(
      `INSERT INTO customers (shop_id, name, phone, note) VALUES ($1,$2,$3,$4) RETURNING *`,
      [req.auth.shop_id, body.name, body.phone, body.note]);
  });
}
