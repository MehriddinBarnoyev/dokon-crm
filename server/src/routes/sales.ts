import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { one, query, tx } from '../db.js';
import { requireAuth } from '../lib/auth.js';
import { ActionSchema, executeActions, PaymentSchema, UnitSchema } from '../lib/actions.js';

export default async function saleRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth);

  /** Savdolar ro'yxati (sana bo'yicha filtr bilan) */
  app.get('/', async (req) => {
    const q = z.object({
      from: z.string().optional(),
      to: z.string().optional(),
      customer_id: z.string().uuid().optional(),
      limit: z.coerce.number().min(1).max(200).default(50),
      offset: z.coerce.number().min(0).default(0),
    }).parse(req.query);

    const where = ['s.shop_id = $1'];
    const params: unknown[] = [req.auth.shop_id];
    if (q.from) { params.push(q.from); where.push(`s.created_at >= $${params.length}::date`); }
    if (q.to)   { params.push(q.to);   where.push(`s.created_at < ($${params.length}::date + 1)`); }
    if (q.customer_id) { params.push(q.customer_id); where.push(`s.customer_id = $${params.length}`); }
    params.push(q.limit, q.offset);

    return query(
      `SELECT s.id, s.total, s.paid, s.cost_total, s.payment_method, s.note,
              s.source, s.created_at,
              c.name AS customer_name, u.name AS seller_name,
              (SELECT json_agg(json_build_object(
                        'name', si.name_snap, 'qty', si.qty,
                        'unit', si.unit, 'unit_price', si.unit_price,
                        'subtotal', si.subtotal))
                 FROM sale_items si WHERE si.sale_id = s.id) AS items
         FROM sales s
         LEFT JOIN customers c ON c.id = s.customer_id
         LEFT JOIN users u ON u.id = s.user_id
        WHERE ${where.join(' AND ')}
        ORDER BY s.created_at DESC
        LIMIT $${params.length - 1} OFFSET $${params.length}`, params);
  });

  /** Yangi savdo */
  app.post('/', async (req, reply) => {
    const body = z.object({
      items: z.array(z.object({
        product_id: z.string().uuid().nullable().default(null),
        name: z.string().min(1),
        unit: UnitSchema.default('dona'),
        qty: z.number().positive(),
        unit_price: z.number().nonnegative(),
      })).min(1),
      customer_id: z.string().uuid().nullable().default(null),
      customer_name: z.string().nullable().default(null),
      payment_method: PaymentSchema.default('naqd'),
      paid: z.number().nonnegative().nullable().default(null),
      note: z.string().nullable().default(null),
    }).parse(req.body);

    try {
      const [res] = await tx((c) => executeActions(c,
        { shopId: req.auth.shop_id, userId: req.auth.id, source: 'manual' },
        [{ type: 'sale', ...body }]));
      return res;
    } catch (e: any) {
      return reply.code(400).send({ error: e.message });
    }
  });

  /** Omborga kirim */
  app.post('/purchase', async (req, reply) => {
    const body = z.object({
      supplier: z.string().nullable().default(null),
      items: z.array(z.object({
        product_id: z.string().uuid().nullable().default(null),
        name: z.string().min(1),
        unit: UnitSchema.default('dona'),
        qty: z.number().positive(),
        cost_price: z.number().nonnegative(),
        sale_price: z.number().nonnegative().nullable().default(null),
      })).min(1),
      note: z.string().nullable().default(null),
    }).parse(req.body);

    try {
      const [res] = await tx((c) => executeActions(c,
        { shopId: req.auth.shop_id, userId: req.auth.id, source: 'manual' },
        [{ type: 'purchase', ...body }]));
      return res;
    } catch (e: any) {
      return reply.code(400).send({ error: e.message });
    }
  });

  /** Chiqim yozish */
  app.post('/expense', async (req) => {
    const body = z.object({
      category: z.string().default('boshqa'),
      amount: z.number().positive(),
      note: z.string().nullable().default(null),
    }).parse(req.body);

    const [res] = await tx((c) => executeActions(c,
      { shopId: req.auth.shop_id, userId: req.auth.id, source: 'manual' },
      [{ type: 'expense', ...body }]));
    return res;
  });

  app.get('/expense', async (req) => {
    const q = z.object({ from: z.string().optional(), to: z.string().optional() }).parse(req.query);
    const where = ['shop_id = $1'];
    const params: unknown[] = [req.auth.shop_id];
    if (q.from) { params.push(q.from); where.push(`created_at >= $${params.length}::date`); }
    if (q.to)   { params.push(q.to);   where.push(`created_at < ($${params.length}::date + 1)`); }
    return query(
      `SELECT id, category, amount, note, created_at FROM expenses
        WHERE ${where.join(' AND ')} ORDER BY created_at DESC LIMIT 200`, params);
  });

  /** Savdoni bekor qilish — qoldiqni qaytaradi */
  app.delete('/:id', async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);

    const sale = await one<{ id: string }>(
      `SELECT id FROM sales WHERE id = $1 AND shop_id = $2`, [id, req.auth.shop_id]);
    if (!sale) return reply.code(404).send({ error: 'Savdo topilmadi' });

    await tx(async (c) => {
      const items = await query<{ product_id: string | null; qty: number; name_snap: string }>(
        `SELECT product_id, qty, name_snap FROM sale_items WHERE sale_id = $1`, [id], c);

      for (const it of items) {
        if (!it.product_id) continue;
        const upd = await one<{ stock: number }>(
          `UPDATE products SET stock = stock + $1, updated_at = now()
            WHERE id = $2 RETURNING stock`, [it.qty, it.product_id], c);
        await query(
          `INSERT INTO stock_moves (shop_id, product_id, type, qty, stock_after, ref_type, ref_id, note, user_id)
           VALUES ($1,$2,'kirim',$3,$4,'qaytarish',$5,'Savdo bekor qilindi',$6)`,
          [req.auth.shop_id, it.product_id, it.qty, upd!.stock, id, req.auth.id], c);
      }
      // Shu savdoga bog'langan qarz ham bekor bo'ladi
      await query(`DELETE FROM debts WHERE sale_id = $1`, [id], c);
      await query(`DELETE FROM sales WHERE id = $1`, [id], c);
    });

    return { ok: true, summary: 'Savdo bekor qilindi, qoldiq qaytarildi' };
  });
}
