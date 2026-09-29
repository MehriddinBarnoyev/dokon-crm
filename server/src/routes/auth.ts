import type { FastifyInstance } from 'fastify';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { one, query, tx } from '../db.js';
import { requireAuth } from '../lib/auth.js';
import { KOD, SQL_TEL_MOS, SQL_TEL_TARTIB, XONA, telMilliy, telNormal } from '../lib/telefon.js';

/**
 * Yangi hisob uchun raqam to'liq bo'lishi shart — 9 xona.
 *
 * Kirishda bu tekshiruv YO'Q: u yerda yarim raqam "Login yoki parol xato"
 * bo'lib qaytishi kerak, "ma'lumot noto'g'ri" emas. Aks holda mavjud bo'lgan
 * va bo'lmagan hisoblar bir-biridan ajralib qolardi.
 */
const YangiTel = z.string().transform(telNormal)
  .refine((v) => v.length === KOD.length + XONA,
          { message: "Telefon raqami to'liq emas — 9 xona kerak" });

/**
 * Raqam bo'yicha hisob qidirish.
 *
 * Ikki yo'lli taqqoslash kerak: ilova endi `+998901234567` yuboradi, lekin
 * bazada eski shakldagi qatorlar ham bor. Batafsil — `lib/telefon.ts`.
 */
const TOPISH = (ustunlar: string) =>
  `SELECT ${ustunlar} FROM users WHERE ${SQL_TEL_MOS(1)} ${SQL_TEL_TARTIB(1)} LIMIT 1`;

const RegisterBody = z.object({
  shop_name: z.string().min(2),
  name: z.string().min(2),
  phone: YangiTel,
  password: z.string().min(4),
});

const LoginBody = z.object({
  phone: z.string().min(6),
  password: z.string().min(4),
});

/**
 * Parol tekshiriladigan marshrutlar uchun so'rov chegarasi.
 *
 * Nega kerak: `/login` ga cheksiz urinish mumkin edi — 4 belgili parol
 * (`z.string().min(4)`) esa bir necha daqiqada topiladi.
 *
 * Chegara IP bo'yicha. Bitta do'konda bir nechta sotuvchi bitta Wi-Fi
 * orqali kirishi mumkin, shuning uchun raqam qattiq emas: 5 daqiqada
 * 15 urinish odatdagi ishga xalaqit bermaydi, taxminlashni esa
 * amalda imkonsiz qiladi.
 */
const KIRISH_CHEGARASI = {
  config: { rateLimit: { max: 15, timeWindow: '5 minutes' } },
};

/** Ro'yxatdan o'tish kamdan-kam bo'ladi — chegara qattiqroq. */
const ROYXAT_CHEGARASI = {
  config: { rateLimit: { max: 5, timeWindow: '1 hour' } },
};

export default async function authRoutes(app: FastifyInstance) {
  app.post('/register', ROYXAT_CHEGARASI, async (req, reply) => {
    const body = RegisterBody.parse(req.body);

    // `body.phone` — YangiTel normallashtirib bergan `+998...`. Band-emaslik
    // ham shu bo'yicha tekshiriladi: aks holda "998901234567" bilan
    // ro'yxatdan o'tgan odam "+998901234567" yozib, ikkinchi do'kon ocha
    // olardi va eski hisobiga boshqa kira olmasdi.
    const exists = await one(TOPISH('id'), [body.phone, telMilliy(body.phone)]);
    if (exists) return reply.code(409).send({ error: 'Bu telefon raqami band' });

    const hash = await bcrypt.hash(body.password, 10);

    const user = await tx(async (c) => {
      const shop = await one<{ id: string }>(
        `INSERT INTO shops (name) VALUES ($1) RETURNING id`, [body.shop_name], c);
      return one<{ id: string; shop_id: string; role: 'owner'; name: string }>(
        `INSERT INTO users (shop_id, phone, name, password_hash, role)
         VALUES ($1,$2,$3,$4,'owner') RETURNING id, shop_id, role, name`,
        [shop!.id, body.phone, body.name, hash], c);
    });

    const token = app.jwt.sign({ ...user });
    return { token, user };
  });

  app.post('/login', KIRISH_CHEGARASI, async (req, reply) => {
    const body = LoginBody.parse(req.body);
    const phone = telNormal(body.phone);
    const row = await one<{
      id: string; shop_id: string; role: 'owner' | 'seller';
      name: string; password_hash: string; is_active: boolean;
    }>(TOPISH('id, shop_id, role, name, password_hash, is_active'),
       [phone, telMilliy(phone)]);

    if (!row || !row.is_active) return reply.code(401).send({ error: 'Login yoki parol xato' });
    if (!(await bcrypt.compare(body.password, row.password_hash))) {
      return reply.code(401).send({ error: 'Login yoki parol xato' });
    }

    const user = { id: row.id, shop_id: row.shop_id, role: row.role, name: row.name };
    return { token: app.jwt.sign(user), user };
  });

  app.post('/staff', { preHandler: requireAuth, ...ROYXAT_CHEGARASI }, async (req, reply) => {
    if (req.auth.role !== 'owner') {
      return reply.code(403).send({ error: 'Faqat do\'kon egasi xodim qo\'sha oladi' });
    }
    const body = z.object({
      name: z.string().min(2), phone: YangiTel, password: z.string().min(4),
    }).parse(req.body);

    // Xodim ham bitta ko'rinishda yoziladi — u ham shu raqam bilan kiradi.
    const exists = await one(TOPISH('id'), [body.phone, telMilliy(body.phone)]);
    if (exists) return reply.code(409).send({ error: 'Bu telefon raqami band' });

    const hash = await bcrypt.hash(body.password, 10);
    const user = await one(
      `INSERT INTO users (shop_id, phone, name, password_hash, role)
       VALUES ($1,$2,$3,$4,'seller') RETURNING id, name, phone, role`,
      [req.auth.shop_id, body.phone, body.name, hash]);
    return user;
  });

  /**
   * XODIMLAR RO'YXATI — faqat do'kon egasi.
   *
   * Kim savdo qilgani, kim qarz berib/yig'ib yurgani ilgari hech qayerda
   * ko'rinmasdi — bazada `user_id` bor edi, lekin uni ko'rsatadigan ekran
   * yo'q edi. Bugungi faoliyat shu ro'yxatning o'zida: alohida "statistika"
   * ekrani ochish shart emas, do'kon egasi bir qarashda "kim nima qildi"ni
   * ko'radi.
   */
  app.get('/staff', { preHandler: requireAuth }, async (req, reply) => {
    if (req.auth.role !== 'owner') {
      return reply.code(403).send({ error: "Faqat do'kon egasi ko'ra oladi" });
    }
    return query(
      `SELECT u.id, u.name, u.phone, u.role, u.is_active, u.created_at,
              COALESCE(s.soni, 0)::int AS today_sales_count,
              COALESCE(s.summa, 0)     AS today_sales_total,
              COALESCE(qb.summa, 0)    AS today_debt_given,
              COALESCE(qt.summa, 0)    AS today_debt_collected
         FROM users u
         LEFT JOIN (
                SELECT user_id, COUNT(*) AS soni, SUM(total) AS summa
                  FROM sales
                 WHERE shop_id = $1 AND dokon_kun(created_at) = dokon_kun(now())
                 GROUP BY user_id
              ) s ON s.user_id = u.id
         LEFT JOIN (
                -- Qarz BERILGANI (amount > 0) — savdodan chiqqani ham,
                -- qo'lda yozilgani ham.
                SELECT user_id, SUM(amount) AS summa
                  FROM debts
                 WHERE shop_id = $1 AND deleted_at IS NULL AND amount > 0
                   AND dokon_kun(created_at) = dokon_kun(now())
                 GROUP BY user_id
              ) qb ON qb.user_id = u.id
         LEFT JOIN (
                -- Qarz YIG'ILGANI (amount < 0 — to'lov).
                SELECT user_id, SUM(-amount) AS summa
                  FROM debts
                 WHERE shop_id = $1 AND deleted_at IS NULL AND amount < 0
                   AND dokon_kun(created_at) = dokon_kun(now())
                 GROUP BY user_id
              ) qt ON qt.user_id = u.id
        WHERE u.shop_id = $1
        ORDER BY (u.role = 'owner') DESC, u.name`, [req.auth.shop_id]);
  });

  /**
   * Xodimni faollashtirish/blokirovka qilish.
   *
   * O'CHIRILMAYDI — faqat `is_active = false`. Xodim ishdan ketsa ham
   * uning yozgan savdo, qarz va chiqimlari tarixda qolishi kerak.
   * Bloklangan xodim `/auth/login`da rad etiladi (`lib/auth.ts` → `is_active`).
   */
  app.patch('/staff/:id', { preHandler: requireAuth }, async (req, reply) => {
    if (req.auth.role !== 'owner') {
      return reply.code(403).send({ error: "Faqat do'kon egasi o'zgartira oladi" });
    }
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = z.object({ is_active: z.boolean() }).parse(req.body);

    if (id === req.auth.id) {
      return reply.code(400).send({ error: "O'zingizni bloklay olmaysiz" });
    }
    const target = await one<{ role: string }>(
      `SELECT role FROM users WHERE id = $1 AND shop_id = $2`, [id, req.auth.shop_id]);
    if (!target) return reply.code(404).send({ error: 'Xodim topilmadi' });
    if (target.role === 'owner') {
      return reply.code(400).send({ error: "Do'kon egasini bloklab bo'lmaydi" });
    }

    return one(
      `UPDATE users SET is_active = $1 WHERE id = $2 AND shop_id = $3
        RETURNING id, name, phone, role, is_active, created_at`,
      [body.is_active, id, req.auth.shop_id]);
  });

  app.get('/me', { preHandler: requireAuth }, async (req) => {
    const shop = await one(`SELECT id, name, currency FROM shops WHERE id = $1`,
      [req.auth.shop_id]);
    return { user: req.auth, shop };
  });
}
