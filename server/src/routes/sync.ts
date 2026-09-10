/**
 * SINXRONIZATSIYA — mijozdagi cache uchun.
 *
 * Nega kerak? Ilova har harfda `/products?search=` ga so'rov yuborardi.
 * Do'konda internet sekin va o'lchovli; bu esa har ekranda o'nlab
 * so'rov degani. Endi mahsulotlar bir marta yuklanadi, keyin faqat
 * O'ZGARGANI olinadi va qidiruv butunlay qurilmada bajariladi.
 *
 * KURSOR HAQIDA. `updated_at` — `now()`, ya'ni TRANZAKSIYA BOSHLANGAN
 * vaqt. Ikki tranzaksiya ustma-ust tushsa, kech commit bo'lgani erta
 * timestamp bilan yozilishi mumkin va `updated_at > T` uni o'tkazib
 * yuboradi. Shuning uchun mijoz kursorni bir necha soniya orqaga surib
 * so'raydi va takrorlangan qatorlarni `id` bo'yicha yig'ishtiradi.
 * Server javobda `now` ni qaytaradi — mijoz o'z soatiga tayanmasin.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { one, query } from '../db.js';
import { requireAuth } from '../lib/auth.js';

/**
 * Cache uchun mahsulot ustunlari.
 *
 * `is_active` filtri ATAYLAB yo'q: arxivlangan mahsulot ham qaytishi
 * kerak, aks holda mijoz uni o'z cache'idan hech qachon o'chira olmaydi.
 * `is_active: false` — bu yerda "tombstone" vazifasini bajaradi.
 */
const PRODUCT_COLS = `
  p.id, p.name, p.barcode, p.unit, p.cost_price, p.sale_price,
  p.stock, p.min_stock, p.photo_url, p.is_active,
  p.created_at, p.updated_at,
  c.name AS category,
  -- Asosiy + qo'shimcha kodlar. Skaner savdo ekranida MAHALLIY keshdan
  -- qidiradi, shuning uchun kodlar mahsulot bilan birga kelishi shart —
  -- aks holda qo'shimcha kod faqat internet bor paytda ishlardi.
  dokon_barcodes(p.id, p.barcode) AS barcodes`;

export default async function syncRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth);

  /**
   * O'zgargan mahsulotlar. `since` berilmasa — to'liq ro'yxat.
   * Sahifalash `limit` bilan: birinchi yuklashda do'konda minglab
   * mahsulot bo'lishi mumkin, hammasi bitta javobda ketmasin.
   */
  app.get('/products', async (req) => {
    const q = z.object({
      since: z.string().datetime().optional(),
      limit: z.coerce.number().min(1).max(2000).default(1000),
    }).parse(req.query);

    const where = ['p.shop_id = $1'];
    const params: unknown[] = [req.auth.shop_id];

    if (q.since) { params.push(q.since); where.push(`p.updated_at > $${params.length}`); }

    params.push(q.limit);
    const products = await query(
      `SELECT ${PRODUCT_COLS}
         FROM products p
         LEFT JOIN categories c ON c.id = p.category_id
        WHERE ${where.join(' AND ')}
        ORDER BY p.updated_at
        LIMIT $${params.length}`, params);

    // `now` — serverning vaqti. Mijoz keyingi kursor sifatida shuni
    // ishlatadi; qurilma soati noto'g'ri bo'lsa ham sync buzilmaydi.
    const { now } = await one<{ now: string }>(`SELECT now() AS now`) ?? { now: new Date().toISOString() };

    return {
      now,
      // To'liq javob kelgan bo'lsa — yana bor, mijoz qayta so'raydi.
      more: products.length === q.limit,
      products,
    };
  });

  /**
   * Ilova ochilganda kerak bo'ladigan hamma narsa BITTA so'rovda.
   * Ilgari bu 4 ta alohida so'rov edi (mahsulotlar, kategoriyalar,
   * filtrlar, mijozlar).
   */
  app.get('/bootstrap', async (req) => {
    const shop = req.auth.shop_id;

    const [products, categories, customers, expenseCategories, nowRow] = await Promise.all([
      query(
        `SELECT ${PRODUCT_COLS}
           FROM products p
           LEFT JOIN categories c ON c.id = p.category_id
          WHERE p.shop_id = $1
          ORDER BY p.updated_at
          LIMIT 2000`, [shop]),

      query(`SELECT id, name FROM categories WHERE shop_id = $1 ORDER BY name`, [shop]),

      query(
        `SELECT id, name, phone FROM customers
          WHERE shop_id = $1 ORDER BY name LIMIT 1000`, [shop]),

      query(
        `SELECT category AS name, COUNT(*)::int AS count, SUM(amount) AS total
           FROM expenses
          WHERE shop_id = $1 AND deleted_at IS NULL
            AND created_at > now() - interval '90 days'
          GROUP BY category ORDER BY count DESC LIMIT 20`, [shop]),

      one<{ now: string }>(`SELECT now() AS now`),
    ]);

    return {
      now: nowRow?.now ?? new Date().toISOString(),
      products,
      categories,
      customers,
      expense_categories: expenseCategories,
    };
  });
}
