/**
 * OMBORGA KIRIM (TOVAR XARIDI) — ro'yxat va statistika.
 *
 * Nega alohida modul. Yozish tomoni `POST /sales/purchase` da, `sales`
 * ichida qolgan: u `executeActions` orqali o'tadi va AI ham o'sha yo'ldan
 * yuradi. Lekin O'QISH tomoni chiqimlarnikiga o'xshaydi — davr bo'yicha
 * ro'yxat, yetkazib beruvchi bo'yicha filtr, kunlik yig'indi. Uni
 * `/sales` ga tiqishtirish u yerdagi yo'llarni chalkashtirardi.
 *
 * NEGA UMUMAN KERAK. Kirim yozilardi, lekin ilovada uni ko'rsatadigan
 * birorta ekran yo'q edi: do'konchi "kecha qancha tovar oldim, qaysi
 * narxda?" degan savolga javob topa olmasdi. Chiqimlar ro'yxati bor edi,
 * kirimlarniki esa yo'q — holbuki do'konda pul aynan shu yerga ketadi.
 *
 * QATORLAR BIRGA QAYTADI. Chiqimda bitta summa bo'ladi, kirimda esa
 * "nima, qancha, qaysi narxda" — asosiy ma'lumot shu. Ro'yxat ochilganda
 * ular allaqachon ekranda bo'lsin, har qator uchun alohida so'rov
 * ketmasin (savdolar ro'yxatida ham shunday).
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { query } from '../db.js';
import { requireAuth } from '../lib/auth.js';

export default async function purchaseRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth);

  /** Ro'yxat: davr va yetkazib beruvchi bo'yicha. */
  app.get('/', async (req) => {
    const q = z.object({
      from: z.string().optional(),
      to: z.string().optional(),
      supplier: z.string().optional(),
      limit: z.coerce.number().min(1).max(500).default(200),
      offset: z.coerce.number().min(0).default(0),
    }).parse(req.query);

    const where = ['p.shop_id = $1'];
    const params: unknown[] = [req.auth.shop_id];

    if (q.from) { params.push(q.from); where.push(`p.created_at >= $${params.length}::date`); }
    if (q.to)   { params.push(q.to);   where.push(`p.created_at < ($${params.length}::date + 1)`); }
    if (q.supplier) {
      params.push(q.supplier);
      where.push(`COALESCE(p.supplier, '') = $${params.length}`);
    }

    params.push(q.limit, q.offset);
    return query(
      `SELECT p.id, p.supplier, p.total, p.note, p.source,
              p.created_at, u.name AS user_name,
              (SELECT json_agg(json_build_object(
                        'name', pi.name_snap, 'qty', pi.qty, 'unit', pi.unit,
                        'cost_price', pi.cost_price, 'subtotal', pi.subtotal))
                 FROM purchase_items pi WHERE pi.purchase_id = p.id) AS items
         FROM purchases p
         LEFT JOIN users u ON u.id = p.user_id
        WHERE ${where.join(' AND ')}
        ORDER BY p.created_at DESC
        LIMIT $${params.length - 1} OFFSET $${params.length}`, params);
  });

  /**
   * Yetkazib beruvchilar — ilovadagi chip'lar uchun.
   * Eng ko'p pul ketgani birinchi: do'konchini qiziqtirgani "kimdan ko'p
   * olaman", "kimdan ko'p marta olaman" emas.
   */
  app.get('/meta/suppliers', async (req) => {
    const q = z.object({ days: z.coerce.number().min(1).max(365).default(90) })
      .parse(req.query);

    return query(
      `SELECT COALESCE(NULLIF(supplier, ''), '(nomsiz)') AS name,
              COUNT(*)::int AS count,
              SUM(total)    AS total
         FROM purchases
        WHERE shop_id = $1
          AND created_at > now() - ($2::int || ' days')::interval
        GROUP BY 1
        ORDER BY total DESC
        LIMIT 20`, [req.auth.shop_id, q.days]);
  });

  /**
   * TOVAR AYLANMASI — "pulim qayerda?" degan savolga javob.
   *
   *   sarflandi — shu davrda tovarga ketgan pul
   *   sotilgan  — shu davrda sotilgan molning TAN NARXI (ya'ni qaytgani)
   *   omborda   — hozir javonda turgan molning tan narxdagi qiymati
   *
   * `omborda` DAVRGA BOG'LIQ EMAS — u hozirgi holat. Ataylab shunday:
   * "shu oyda omborda qancha edi" degan savol tarixiy qoldiqni talab
   * qiladi, uni esa hech qayerda saqlamaymiz.
   *
   * Manfiy qoldiq hisobga OLINMAYDI (`GREATEST(stock, 0)`): minusdagi
   * qoldiq ombor qiymatini kamaytirishi mantiqsiz bo'lardi — yo'q mol
   * qarz emas, u shunchaki hisobga olinmagan.
   */
  app.get('/meta/aylanma', async (req) => {
    const q = z.object({
      from: z.string().optional(),
      to: z.string().optional(),
    }).parse(req.query);

    const davr = (ustun: string, params: unknown[]) => {
      const w: string[] = [];
      if (q.from) { params.push(q.from); w.push(`${ustun} >= $${params.length}::date`); }
      if (q.to)   { params.push(q.to);   w.push(`${ustun} < ($${params.length}::date + 1)`); }
      return w.length ? ' AND ' + w.join(' AND ') : '';
    };

    const p1: unknown[] = [req.auth.shop_id];
    const sarf = query<{ sarflandi: string }>(
      `SELECT COALESCE(SUM(total), 0) AS sarflandi FROM purchases
        WHERE shop_id = $1${davr('created_at', p1)}`, p1);

    const p2: unknown[] = [req.auth.shop_id];
    const sotildi = query<{ sotilgan: string; savdo: string }>(
      `SELECT COALESCE(SUM(cost_total), 0) AS sotilgan,
              COALESCE(SUM(total), 0)      AS savdo
         FROM sales WHERE shop_id = $1${davr('created_at', p2)}`, p2);

    const omborda = query<{ omborda: string }>(
      `SELECT COALESCE(SUM(GREATEST(stock, 0) * cost_price), 0) AS omborda
         FROM products WHERE shop_id = $1 AND is_active`, [req.auth.shop_id]);

    const [a, b, c] = await Promise.all([sarf, sotildi, omborda]);
    return {
      sarflandi: Number(a[0]?.sarflandi ?? 0),
      sotilgan:  Number(b[0]?.sotilgan ?? 0),
      savdo:     Number(b[0]?.savdo ?? 0),
      omborda:   Number(c[0]?.omborda ?? 0),
    };
  });

  /**
   * ENG KO'P PUL KETGAN MAHSULOTLAR. Chiqimlardagi kategoriya chip'lari
   * kabi: do'konchi "pulim aynan nimaga ketyapti?" ni ko'rsin.
   */
  app.get('/meta/top', async (req) => {
    const q = z.object({
      from: z.string().optional(),
      to: z.string().optional(),
      limit: z.coerce.number().min(1).max(50).default(10),
    }).parse(req.query);

    const where = ['p.shop_id = $1'];
    const params: unknown[] = [req.auth.shop_id];
    if (q.from) { params.push(q.from); where.push(`p.created_at >= $${params.length}::date`); }
    if (q.to)   { params.push(q.to);   where.push(`p.created_at < ($${params.length}::date + 1)`); }

    params.push(q.limit);
    return query(
      `SELECT pi.name_snap AS name, pi.unit,
              SUM(pi.qty)      AS qty,
              SUM(pi.subtotal) AS total,
              COUNT(*)::int    AS marta
         FROM purchase_items pi
         JOIN purchases p ON p.id = pi.purchase_id
        WHERE ${where.join(' AND ')}
        GROUP BY pi.name_snap, pi.unit
        ORDER BY total DESC
        LIMIT $${params.length}`, params);
  });
}
