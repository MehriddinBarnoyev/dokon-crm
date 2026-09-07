import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { one, query, tx } from '../db.js';
import { requireAuth } from '../lib/auth.js';
import { executeActions } from '../lib/actions.js';

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

  /** Bitta mijozning qarz tarixi */
  app.get('/customer/:id', async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const c = await one(
      `SELECT * FROM customer_balances WHERE customer_id = $1 AND shop_id = $2`,
      [id, req.auth.shop_id]);
    if (!c) return reply.code(404).send({ error: 'Mijoz topilmadi' });

    const [history, purchases, jami] = await Promise.all([
      query(
        `SELECT d.id, d.amount, d.due_date, d.note, d.created_at, d.sale_id, u.name AS user_name
           FROM debts d LEFT JOIN users u ON u.id = d.user_id
          WHERE d.customer_id = $1 ORDER BY d.created_at DESC LIMIT 200`, [id]),

      // Mijozning xaridlari — naqd sotib olganlari ham shu yerda ko'rinadi
      query(
        `SELECT s.id, s.total, s.paid, s.payment_method, s.created_at,
                (SELECT json_agg(json_build_object(
                          'name', si.name_snap, 'qty', si.qty,
                          'unit', si.unit, 'subtotal', si.subtotal))
                   FROM sale_items si WHERE si.sale_id = s.id) AS items
           FROM sales s
          WHERE s.customer_id = $1
          ORDER BY s.created_at DESC LIMIT 100`, [id]),

      one(
        `SELECT COUNT(*)::int AS xaridlar_soni,
                COALESCE(SUM(total), 0) AS jami_xarid,
                MAX(created_at)         AS oxirgi_xarid
           FROM sales WHERE customer_id = $1`, [id]),
    ]);

    return { ...c, history, purchases, jami };
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
