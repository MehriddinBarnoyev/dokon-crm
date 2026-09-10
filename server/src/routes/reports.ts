import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { one, query } from '../db.js';
import { requireAuth } from '../lib/auth.js';

export default async function reportRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth);

  /**
   * Bosh sahifa uchun yig'ma ko'rsatkich.
   * Bugungi kirim/chiqim/foyda + ogohlantirishlar bitta so'rovda.
   */
  app.get('/dashboard', async (req) => {
    const shop = req.auth.shop_id;

    const today = await one(
      `SELECT COALESCE(sales_total,0) AS sales_total,
              COALESCE(cash_in,0)     AS cash_in,
              COALESCE(expense_total,0) AS expense_total,
              COALESCE(net_profit,0)  AS net_profit,
              COALESCE(sales_count,0) AS sales_count,
              COALESCE(credit_total,0)  AS credit_total,
              COALESCE(credit_profit,0) AS credit_profit,
              COALESCE(debt_given,0)  AS debt_given
         FROM daily_summary
        WHERE shop_id = $1
          AND day = (now() AT TIME ZONE 'Asia/Tashkent')::date`, [shop])
      ?? { sales_total: 0, cash_in: 0, expense_total: 0, net_profit: 0,
           sales_count: 0, credit_total: 0, credit_profit: 0, debt_given: 0 };

    const [debts, lowStock, week] = await Promise.all([
      one(`SELECT COALESCE(SUM(balance),0) AS total_owed,
                  COUNT(*) FILTER (WHERE balance > 0) AS debtor_count,
                  COUNT(*) FILTER (WHERE balance > 0 AND nearest_due < CURRENT_DATE) AS overdue_count
             FROM customer_balances WHERE shop_id = $1`, [shop]),
      query(`SELECT id, name, stock, min_stock, unit FROM products
              WHERE shop_id = $1 AND is_active AND stock <= min_stock
              ORDER BY (stock - min_stock) LIMIT 10`, [shop]),
      query(`SELECT day, sales_total, expense_total, net_profit, credit_profit
               FROM daily_summary
              WHERE shop_id = $1
                AND day > (now() AT TIME ZONE 'Asia/Tashkent')::date - 7
              ORDER BY day`, [shop]),
    ]);

    return { today, debts, low_stock: lowStock, week };
  });

  /** Kunlar kesimidagi hisobot */
  app.get('/daily', async (req) => {
    const q = z.object({
      from: z.string().optional(),
      to: z.string().optional(),
      days: z.coerce.number().min(1).max(365).default(30),
    }).parse(req.query);

    if (q.from || q.to) {
      const params: unknown[] = [req.auth.shop_id];
      const where = ['shop_id = $1'];
      if (q.from) { params.push(q.from); where.push(`day >= $${params.length}::date`); }
      if (q.to)   { params.push(q.to);   where.push(`day <= $${params.length}::date`); }
      return query(`SELECT * FROM daily_summary WHERE ${where.join(' AND ')} ORDER BY day DESC`, params);
    }

    return query(
      `SELECT * FROM daily_summary
        WHERE shop_id = $1
          AND day > (now() AT TIME ZONE 'Asia/Tashkent')::date - $2::int
        ORDER BY day DESC`, [req.auth.shop_id, q.days]);
  });

  /**
   * Bitta kunning to'liq manzarasi: savdolar, chiqimlar, qarzlar va yig'indi.
   * Do'konchi "o'tgan seshanba nima bo'lgan edi?" deb qarashi uchun.
   */
  app.get('/day/:date', async (req, reply) => {
    const { date } = z.object({
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Sana YYYY-MM-DD bo'lishi kerak"),
    }).parse(req.params);

    const shop = req.auth.shop_id;
    // Kun chegarasi do'kon vaqt mintaqasida hisoblanadi, UTC da emas —
    // aks holda kechqurungi savdo ertangi kunga tushib qolardi.
    const bounds = `($1::date AT TIME ZONE 'Asia/Tashkent')`;
    const range = `s.created_at >= ${bounds}
                   AND s.created_at < ((($1::date + 1))::timestamp AT TIME ZONE 'Asia/Tashkent')`;

    const [summary, sales, expenses, debts] = await Promise.all([
      one(`SELECT COALESCE(sales_total,0)   AS sales_total,
                  COALESCE(cash_in,0)       AS cash_in,
                  COALESCE(expense_total,0) AS expense_total,
                  COALESCE(net_profit,0)    AS net_profit,
                  COALESCE(sales_count,0)   AS sales_count,
                  COALESCE(credit_total,0)  AS credit_total,
                  COALESCE(credit_profit,0) AS credit_profit,
                  COALESCE(debt_given,0)    AS debt_given
             FROM daily_summary WHERE shop_id = $2 AND day = $1::date`, [date, shop]),

      query(`SELECT s.id, s.total, s.paid, s.cost_total, s.payment_method,
                    s.note, s.source, s.created_at,
                    c.name AS customer_name, u.name AS seller_name,
                    (SELECT json_agg(json_build_object(
                              'name', si.name_snap, 'qty', si.qty, 'unit', si.unit,
                              'unit_price', si.unit_price, 'subtotal', si.subtotal))
                       FROM sale_items si WHERE si.sale_id = s.id) AS items
               FROM sales s
               LEFT JOIN customers c ON c.id = s.customer_id
               LEFT JOIN users u ON u.id = s.user_id
              WHERE s.shop_id = $2 AND ${range}
              ORDER BY s.created_at DESC`, [date, shop]),

      query(`SELECT id, category, amount, note, created_at
               FROM expenses
              WHERE shop_id = $2
                AND deleted_at IS NULL
                AND created_at >= ${bounds}
                AND created_at < ((($1::date + 1))::timestamp AT TIME ZONE 'Asia/Tashkent')
              ORDER BY created_at DESC`, [date, shop]),

      query(`SELECT d.id, d.amount, d.note, d.created_at, c.name AS customer_name
               FROM debts d JOIN customers c ON c.id = d.customer_id
              WHERE d.shop_id = $2
                AND d.created_at >= ${bounds}
                AND d.created_at < ((($1::date + 1))::timestamp AT TIME ZONE 'Asia/Tashkent')
              ORDER BY d.created_at DESC`, [date, shop]),
    ]);

    return {
      day: date,
      summary: summary ?? {
        sales_total: 0, cash_in: 0, expense_total: 0, net_profit: 0,
        sales_count: 0, credit_total: 0, credit_profit: 0,
      },
      sales, expenses, debts,
    };
  });

  /**
   * Eng ko'p sotilgan mahsulotlar.
   *
   * `sort` NEGA KERAK. Tushum bo'yicha birinchi turgan mahsulot eng ko'p
   * FOYDA keltirgani emas: un yoki shakar katta summaga sotiladi, lekin
   * ustamasi bir necha foiz. Do'konchi "nima ko'p pul olib keladi" degan
   * savolga javob izlaydi, "nima ko'p pul aylantiradi" ga emas.
   *
   * `margin` — foyda tushumga nisbatan, foizda. Bir qatorda ikkita mahsulot
   * bir xil foyda bergan bo'lishi mumkin, lekin biri 300 ming, ikkinchisi
   * 3 million aylantirib. Ustama buni darhol ko'rsatadi.
   */
  app.get('/top-products', async (req) => {
    const q = z.object({
      days: z.coerce.number().min(1).max(365).default(30),
      limit: z.coerce.number().min(1).max(50).default(10),
      sort: z.enum(['tushum', 'foyda']).default('tushum'),
    }).parse(req.query);

    // Ustunlar ro'yxatdan olinadi — so'rovga tashqaridan matn tushmaydi.
    const ORDER = { tushum: 'revenue', foyda: 'profit' }[q.sort];

    return query(
      `SELECT si.name_snap AS name, si.unit,
              SUM(si.qty)      AS total_qty,
              SUM(si.subtotal) AS revenue,
              SUM(si.subtotal - si.qty * si.cost_price) AS profit,
              COUNT(DISTINCT s.id) AS sale_count,
              -- Tushum 0 bo'lsa (bepul berilgan) bo'lishni o'tkazib yuboramiz
              CASE WHEN SUM(si.subtotal) > 0
                   THEN ROUND(SUM(si.subtotal - si.qty * si.cost_price)
                              * 100 / SUM(si.subtotal), 1)
                   ELSE NULL END AS margin
         FROM sale_items si
         JOIN sales s ON s.id = si.sale_id
        WHERE s.shop_id = $1
          AND s.created_at > now() - ($2::int || ' days')::interval
        GROUP BY si.name_snap, si.unit
        ORDER BY ${ORDER} DESC
        LIMIT $3`, [req.auth.shop_id, q.days, q.limit]);
  });

  /**
   * ZARAR KELTIRGAN SAVDOLAR — tan narxidan arzon ketganlari.
   *
   * Bu do'konda eng jim yo'qotish: narx xato yozilgan, aksiya hisoblanmagan
   * yoki tan narx yangilangandan keyin sotuv narxi eskiligicha qolgan.
   * Kunlik yakunda bu ko'rinmaydi — foyda umumiy bo'lib qo'shilib ketadi.
   *
   * `cost_total = 0` bo'lganlar ATAYLAB chiqmaydi: ular zarar emas, tan
   * narxi kiritilmagan mahsulotlar. Ular uchun alohida ogohlantirish bor
   * (`/products?status=tannarxsiz`).
   */
  app.get('/loss-sales', async (req) => {
    const q = z.object({
      days: z.coerce.number().min(1).max(365).default(30),
      limit: z.coerce.number().min(1).max(50).default(20),
    }).parse(req.query);

    return query(
      `SELECT s.id, s.total, s.cost_total, s.created_at,
              (s.total - s.cost_total) AS profit,
              c.name AS customer_name,
              (SELECT string_agg(si.name_snap, ', ' ORDER BY si.subtotal DESC)
                 FROM sale_items si WHERE si.sale_id = s.id) AS items_text
         FROM sales s
         LEFT JOIN customers c ON c.id = s.customer_id
        WHERE s.shop_id = $1
          AND s.created_at > now() - ($2::int || ' days')::interval
          AND s.cost_total > 0
          AND s.total < s.cost_total
        ORDER BY (s.total - s.cost_total)
        LIMIT $3`, [req.auth.shop_id, q.days, q.limit]);
  });

  /** Ombor qiymati — pulingiz tokchada qancha turibdi */
  app.get('/inventory-value', async (req) => {
    return one(
      `SELECT COUNT(*) AS product_count,
              COALESCE(SUM(stock * cost_price), 0) AS cost_value,
              COALESCE(SUM(stock * sale_price), 0) AS retail_value,
              COUNT(*) FILTER (WHERE stock <= 0)          AS out_of_stock,
              COUNT(*) FILTER (WHERE stock <= min_stock AND stock > 0) AS low_stock
         FROM products WHERE shop_id = $1 AND is_active`, [req.auth.shop_id]);
  });
}
