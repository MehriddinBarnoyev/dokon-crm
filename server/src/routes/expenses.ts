/**
 * CHIQIMLAR — to'liq CRUD.
 *
 * Nega alohida modul, `/sales` ichida emas? U yerda `DELETE /sales/:id`
 * savdoni bekor qiladi. Chiqim o'chirishni o'sha prefiksga qo'shsak
 * (`DELETE /sales/expense/:id`) yo'llar chalkashadi va bir kun kimdir
 * xato marshrutga tushadi. `/expenses` — o'z resursi, o'z prefiksi.
 *
 * Eski `POST /sales/expense` va `GET /sales/expense` joyida qoldi:
 * ular AI oqimida va eski mijozlarda ishlatiladi.
 *
 * O'CHIRISH YUMSHOQ. `deleted_at` qo'yiladi, qator o'chmaydi. Sabab:
 * chiqimda `stock_moves` kabi jurnal yo'q — qattiq DELETE qilingan pul
 * yozuvini hech qanday yo'l bilan tiklab bo'lmasdi.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { one, query, tx } from '../db.js';
import { requireAuth, requireOwner } from '../lib/auth.js';
import { executeActions } from '../lib/actions.js';

export default async function expenseRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth);

  /** Ro'yxat: davr va kategoriya bo'yicha. */
  app.get('/', async (req) => {
    const q = z.object({
      from: z.string().optional(),
      to: z.string().optional(),
      category: z.string().optional(),
      limit: z.coerce.number().min(1).max(500).default(200),
      offset: z.coerce.number().min(0).default(0),
    }).parse(req.query);

    // `users` ga JOIN bor, unda ham `shop_id` bor — shuning uchun har bir
    // ustun `e.` bilan aniq ko'rsatiladi.
    const where = ['e.shop_id = $1', 'e.deleted_at IS NULL'];
    const params: unknown[] = [req.auth.shop_id];

    if (q.from)     { params.push(q.from);     where.push(`e.created_at >= $${params.length}::date`); }
    if (q.to)       { params.push(q.to);       where.push(`e.created_at < ($${params.length}::date + 1)`); }
    if (q.category) { params.push(q.category); where.push(`e.category = $${params.length}`); }

    params.push(q.limit, q.offset);
    return query(
      `SELECT e.id, e.category, e.amount, e.note, e.source,
              e.created_at, e.updated_at, u.name AS user_name
         FROM expenses e
         LEFT JOIN users u ON u.id = e.user_id
        WHERE ${where.join(' AND ')}
        ORDER BY e.created_at DESC
        LIMIT $${params.length - 1} OFFSET $${params.length}`, params);
  });

  /**
   * Kategoriya ro'yxati — mobil ilovadagi chip'lar uchun.
   * Faqat shu do'kon ilgari ishlatgan kategoriyalar qaytadi; ular eng ko'p
   * ishlatilgani bo'yicha saralanadi, ya'ni tez-tez yoziladigani birinchi.
   */
  app.get('/meta/categories', async (req) => {
    const q = z.object({ days: z.coerce.number().min(1).max(365).default(90) })
      .parse(req.query);

    return query(
      `SELECT category AS name, COUNT(*)::int AS count, SUM(amount) AS total
         FROM expenses
        WHERE shop_id = $1 AND deleted_at IS NULL
          AND created_at > now() - ($2::int || ' days')::interval
        GROUP BY category
        ORDER BY count DESC, total DESC
        LIMIT 20`, [req.auth.shop_id, q.days]);
  });

  app.get('/:id', async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const row = await one(
      `SELECT e.id, e.category, e.amount, e.note, e.source,
              e.created_at, e.updated_at, u.name AS user_name
         FROM expenses e
         LEFT JOIN users u ON u.id = e.user_id
        WHERE e.id = $1 AND e.shop_id = $2 AND e.deleted_at IS NULL`,
      [id, req.auth.shop_id]);
    if (!row) return reply.code(404).send({ error: 'Chiqim topilmadi' });
    return row;
  });

  /** Yangi chiqim — mavjud `expense` amali orqali (AI bilan bir xil yo'l). */
  app.post('/', async (req, reply) => {
    const body = z.object({
      category: z.string().trim().min(1).default('boshqa'),
      amount: z.number().positive(),
      note: z.string().nullable().default(null),
    }).parse(req.body);

    try {
      const [res] = await tx((c) => executeActions(c,
        { shopId: req.auth.shop_id, userId: req.auth.id, source: 'manual' },
        [{ type: 'expense', ...body }]));
      return res;
    } catch (e: any) {
      return reply.code(400).send({ error: e.message });
    }
  });

  /**
   * Tahrirlash. `amount` zod'da tekshiriladi: bazadagi CHECK (amount > 0)
   * ga tayanib qolsak, xato 400 emas, umumiy 500 bo'lib chiqardi.
   */
  app.patch('/:id', async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = z.object({
      category: z.string().trim().min(1).optional(),
      amount: z.number().positive().optional(),
      note: z.string().nullable().optional(),
    }).parse(req.body);

    const sets: string[] = [];
    const params: unknown[] = [];

    for (const key of ['category', 'amount', 'note'] as const) {
      if (body[key] === undefined) continue;
      params.push(body[key]);
      sets.push(`${key} = $${params.length}`);
    }
    if (sets.length === 0) {
      return reply.code(400).send({ error: "O'zgartirish uchun maydon berilmadi" });
    }
    sets.push('updated_at = now()');

    params.push(id, req.auth.shop_id);
    const row = await one(
      `UPDATE expenses SET ${sets.join(', ')}
        WHERE id = $${params.length - 1} AND shop_id = $${params.length}
          AND deleted_at IS NULL
        RETURNING id, category, amount, note, source, created_at, updated_at`, params);

    if (!row) return reply.code(404).send({ error: 'Chiqim topilmadi' });
    return row;
  });

  /**
   * O'chirish — faqat do'kon egasi.
   * Pulga tegishli, qaytarib bo'lmaydigan amal; sotuvchida bo'lmasin.
   */
  app.delete('/:id', { preHandler: requireOwner }, async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);

    const row = await one<{ id: string; amount: number; category: string }>(
      `UPDATE expenses SET deleted_at = now(), updated_at = now()
        WHERE id = $1 AND shop_id = $2 AND deleted_at IS NULL
        RETURNING id, amount, category`, [id, req.auth.shop_id]);

    if (!row) return reply.code(404).send({ error: 'Chiqim topilmadi' });
    return { ok: true, id: row.id };
  });
}
