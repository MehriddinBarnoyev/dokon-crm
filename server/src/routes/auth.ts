import type { FastifyInstance } from 'fastify';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { one, tx } from '../db.js';
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

  app.get('/me', { preHandler: requireAuth }, async (req) => {
    const shop = await one(`SELECT id, name, currency FROM shops WHERE id = $1`,
      [req.auth.shop_id]);
    return { user: req.auth, shop };
  });
}
