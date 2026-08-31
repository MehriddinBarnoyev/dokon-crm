import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { one, query, tx } from '../db.js';
import { requireAuth } from '../lib/auth.js';
import { UnitSchema, executeActions } from '../lib/actions.js';

export default async function productRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth);

  /**
   * Ro'yxat, qidiruv va filtrlar.
   *   status   — hammasi | tugayapti | tugagan | bor
   *   category — kategoriya nomi
   *   unit     — o'lchov birligi (dona, kg, ...)
   *   sort     — nom | arzon | qimmat | kam_qoldiq | kop_qoldiq | yangi
   */
  app.get('/', async (req) => {
    const q = z.object({
      search: z.string().optional(),
      low: z.string().optional(),                 // eski mijozlar uchun qoldirilgan
      status: z.enum(['hammasi', 'tugayapti', 'tugagan', 'bor']).default('hammasi'),
      category: z.string().optional(),
      unit: UnitSchema.optional(),
      sort: z.enum(['nom', 'arzon', 'qimmat', 'kam_qoldiq', 'kop_qoldiq', 'yangi'])
        .default('nom'),
      limit: z.coerce.number().min(1).max(500).default(100),
      offset: z.coerce.number().min(0).default(0),
    }).parse(req.query);

    /** Filtrlar qidiruv natijasiga ham, oddiy ro'yxatga ham bir xil qo'llanadi. */
    const statusFilter = (row: any) => {
      const stock = Number(row.stock);
      const min = Number(row.min_stock);
      if (q.status === 'tugagan') return stock <= 0;
      if (q.status === 'tugayapti') return stock > 0 && stock <= min;
      if (q.status === 'bor') return stock > 0;
      return true;
    };

    // Qidiruv bo'lsa — bazadagi aqlli qidiruv funksiyasi.
    // U xato yozilgan nomni ham, faqat ikkinchi so'zni ham topadi.
    // Qidiruv natijasi mosligi bo'yicha saralangan; filtrlarni ustidan qo'llaymiz.
    if (q.search && q.search.trim().length > 0) {
      const rows = await query(
        `SELECT id, name, barcode, unit, cost_price, sale_price,
                stock, min_stock, photo_url, category, score, taxminiy
           FROM dokon_search_products($1, $2, $3)`,
        [req.auth.shop_id, q.search.trim(), q.limit]);

      return rows
        .filter(statusFilter)
        .filter((r: any) => !q.category || r.category === q.category)
        .filter((r: any) => !q.unit || r.unit === q.unit)
        .filter((r: any) => q.low !== '1' || Number(r.stock) <= Number(r.min_stock));
    }

    const where: string[] = ['p.shop_id = $1', 'p.is_active'];
    const params: unknown[] = [req.auth.shop_id];

    if (q.low === '1' || q.status === 'tugayapti') {
      where.push(q.status === 'tugayapti'
        ? 'p.stock > 0 AND p.stock <= p.min_stock'
        : 'p.stock <= p.min_stock');
    } else if (q.status === 'tugagan') where.push('p.stock <= 0');
    else if (q.status === 'bor')      where.push('p.stock > 0');

    if (q.category) { params.push(q.category); where.push(`c.name = $${params.length}`); }
    if (q.unit)     { params.push(q.unit);     where.push(`p.unit = $${params.length}`); }

    const ORDER: Record<string, string> = {
      nom:        'p.name',
      arzon:      'p.sale_price ASC, p.name',
      qimmat:     'p.sale_price DESC, p.name',
      kam_qoldiq: 'p.stock ASC, p.name',
      kop_qoldiq: 'p.stock DESC, p.name',
      yangi:      'p.created_at DESC',
    };

    params.push(q.limit, q.offset);
    return query(
      `SELECT p.id, p.name, p.barcode, p.unit, p.cost_price, p.sale_price,
              p.stock, p.min_stock, p.photo_url, c.name AS category
         FROM products p
         LEFT JOIN categories c ON c.id = p.category_id
        WHERE ${where.join(' AND ')}
        ORDER BY ${ORDER[q.sort]}
        LIMIT $${params.length - 1} OFFSET $${params.length}`, params);
  });

  app.get('/:id', async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const p = await one(
      `SELECT p.*, c.name AS category FROM products p
         LEFT JOIN categories c ON c.id = p.category_id
        WHERE p.id = $1 AND p.shop_id = $2`, [id, req.auth.shop_id]);
    if (!p) return reply.code(404).send({ error: 'Mahsulot topilmadi' });

    const moves = await query(
      `SELECT type, qty, stock_after, ref_type, note, created_at
         FROM stock_moves WHERE product_id = $1
        ORDER BY created_at DESC LIMIT 50`, [id]);
    return { ...p, moves };
  });

  app.post('/', async (req) => {
    const body = z.object({
      name: z.string().min(1),
      unit: UnitSchema.default('dona'),
      cost_price: z.number().nonnegative().default(0),
      sale_price: z.number().nonnegative().default(0),
      stock: z.number().nonnegative().default(0),
      min_stock: z.number().nonnegative().default(0),
      category: z.string().nullable().default(null),
      barcode: z.string().nullable().default(null),
      photo_url: z.string().nullable().default(null),
    }).parse(req.body);

    const [res] = await tx((c) => executeActions(c,
      { shopId: req.auth.shop_id, userId: req.auth.id, source: 'manual' },
      [{ type: 'create_product', ...body }]));

    if (body.min_stock > 0) {
      await query(`UPDATE products SET min_stock = $1 WHERE id = $2`, [body.min_stock, res.id]);
    }
    return one(`SELECT * FROM products WHERE id = $1`, [res.id]);
  });

  /**
   * Mahsulotni tahrirlash — xato kiritilgan nom, narx yoki birlikni to'g'rilash.
   *
   * Qoldiq bu yerda o'zgarmaydi: u ombor jurnaliga yozilishi kerak, shuning
   * uchun `/:id/adjust` orqali boradi. Narx tarixga ham tegmaydi — sotuvda
   * o'sha kundagi narx `sale_items` ichida saqlangan.
   *
   * `is_active: false` — mahsulotni arxivlash. O'chirmaymiz: eski savdolar
   * unga bog'liq, o'chirilsa hisobot buziladi.
   */
  app.patch('/:id', async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = z.object({
      name: z.string().min(1).optional(),
      unit: UnitSchema.optional(),
      cost_price: z.number().nonnegative().optional(),
      sale_price: z.number().nonnegative().optional(),
      min_stock: z.number().nonnegative().optional(),
      barcode: z.string().nullable().optional(),
      photo_url: z.string().nullable().optional(),
      is_active: z.boolean().optional(),
      /** Kategoriya nomi bilan keladi — yo'q bo'lsa yaratiladi. */
      category: z.string().nullable().optional(),
    }).parse(req.body);

    const { category, ...columns } = body;
    const keys = Object.keys(columns) as (keyof typeof columns)[];
    if (keys.length === 0 && category === undefined) {
      return reply.code(400).send({ error: 'O\'zgartirish uchun maydon yo\'q' });
    }

    const updated = await tx(async (c) => {
      const sets = keys.map((k, i) => `${k} = $${i + 1}`);
      const params: unknown[] = keys.map((k) => columns[k]);

      // Kategoriya alohida: bazada nom emas, category_id turadi.
      if (category !== undefined) {
        let categoryId: string | null = null;
        if (category && category.trim()) {
          const cat = await one<{ id: string }>(
            `INSERT INTO categories (shop_id, name) VALUES ($1, $2)
             ON CONFLICT (shop_id, name) DO UPDATE SET name = EXCLUDED.name
             RETURNING id`, [req.auth.shop_id, category.trim()], c);
          categoryId = cat!.id;
        }
        params.push(categoryId);
        sets.push(`category_id = $${params.length}`);
      }

      params.push(id, req.auth.shop_id);
      return one(
        `UPDATE products p SET ${sets.join(', ')}, updated_at = now()
          WHERE p.id = $${params.length - 1} AND p.shop_id = $${params.length}
        RETURNING p.*, (SELECT name FROM categories WHERE id = p.category_id) AS category`,
        params, c);
    });

    if (!updated) return reply.code(404).send({ error: 'Mahsulot topilmadi' });
    return updated;
  });

  /** Qoldiqni to'g'rilash (inventarizatsiya) */
  app.post('/:id/adjust', async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = z.object({
      new_stock: z.number().nonnegative(),
      note: z.string().nullable().default(null),
    }).parse(req.body);

    const [res] = await tx((c) => executeActions(c,
      { shopId: req.auth.shop_id, userId: req.auth.id, source: 'manual' },
      [{ type: 'stock_adjust', product_id: id, ...body }]));
    return res;
  });

  app.get('/meta/categories', async (req) =>
    query(`SELECT id, name FROM categories WHERE shop_id = $1 ORDER BY name`,
      [req.auth.shop_id]));

  /**
   * Shtrix-kod bo'yicha aniq qidiruv — skaner uchun.
   * Topilsa, do'konchi yangi mahsulot yaratish o'rniga mavjudini ochadi.
   * Yo'q bo'lsa 404 emas, `null` qaytadi: bu xato emas, oddiy holat.
   */
  app.get('/meta/barcode/:code', async (req) => {
    const { code } = z.object({ code: z.string().min(1).max(64) }).parse(req.params);
    const found = await one(
      `SELECT p.id, p.name, p.unit, p.cost_price, p.sale_price, p.stock, p.min_stock,
              p.barcode, p.photo_url, c.name AS category
         FROM products p
         LEFT JOIN categories c ON c.id = p.category_id
        WHERE p.shop_id = $1 AND p.is_active AND p.barcode = btrim($2)
        LIMIT 1`, [req.auth.shop_id, code]);
    return { product: found ?? null };
  });

  /**
   * Yangi mahsulot formasi uchun tayyor qiymatlar.
   *
   * markup — do'konning odatdagi ustamasi (mediana). Forma tan narxdan
   * sotuv narxini shuning asosida taklif qiladi, do'konchi ustidan yozadi.
   * Medianani olamiz: bitta g'alati mahsulot o'rtachani buzmasin.
   * Ma'lumot yetarli bo'lmasa 25% — quruq taxmin emas, shunchaki boshlang'ich.
   */
  app.get('/meta/defaults', async (req) => {
    const shop = req.auth.shop_id;
    const [row, categories] = await Promise.all([
      one<{ markup: number | null; soni: number }>(
        `SELECT percentile_cont(0.5) WITHIN GROUP (
                  ORDER BY (sale_price - cost_price) / cost_price)::float AS markup,
                COUNT(*)::int AS soni
           FROM products
          WHERE shop_id = $1 AND is_active
            AND cost_price > 0 AND sale_price > cost_price`, [shop]),

      query<{ name: string }>(
        `SELECT c.name
           FROM categories c
           JOIN products p ON p.category_id = c.id AND p.is_active
          WHERE c.shop_id = $1
          GROUP BY c.name
          ORDER BY COUNT(p.id) DESC, c.name
          LIMIT 8`, [shop]),
    ]);

    // Uchtadan kam mahsulotdan chiqqan "mediana" ishonchsiz — sukutga tushamiz.
    const raw = (row?.soni ?? 0) >= 3 ? row?.markup ?? null : null;
    const markup = raw === null ? 0.25 : Math.min(Math.max(raw, 0.02), 3);

    return { markup, categories: categories.map((c) => c.name) };
  });

  /**
   * Filtr uchun mavjud variantlar — har birida nechta mahsulot borligi bilan.
   * Bo'sh kategoriya yoki ishlatilmagan birlikni ekranda ko'rsatmaymiz.
   */
  app.get('/meta/filters', async (req) => {
    const shop = req.auth.shop_id;
    const [categories, units, counts] = await Promise.all([
      query(`SELECT c.name, COUNT(p.id)::int AS soni
               FROM categories c
               JOIN products p ON p.category_id = c.id AND p.is_active
              WHERE c.shop_id = $1
              GROUP BY c.name HAVING COUNT(p.id) > 0
              ORDER BY soni DESC, c.name`, [shop]),

      query(`SELECT unit, COUNT(*)::int AS soni
               FROM products WHERE shop_id = $1 AND is_active
              GROUP BY unit ORDER BY soni DESC, unit`, [shop]),

      one(`SELECT COUNT(*)::int AS hammasi,
                  COUNT(*) FILTER (WHERE stock > 0)::int AS bor,
                  COUNT(*) FILTER (WHERE stock > 0 AND stock <= min_stock)::int AS tugayapti,
                  COUNT(*) FILTER (WHERE stock <= 0)::int AS tugagan
             FROM products WHERE shop_id = $1 AND is_active`, [shop]),
    ]);
    return { categories, units, counts };
  });
}
