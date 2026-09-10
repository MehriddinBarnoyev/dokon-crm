import Fastify from 'fastify';
import cors from '@fastify/cors';
import compress from '@fastify/compress';
import rateLimit from '@fastify/rate-limit';
import jwt from '@fastify/jwt';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { ZodError } from 'zod';

import { env } from './env.js';
import { pool } from './db.js';
import { registerAuthHooks, requireAuth } from './lib/auth.js';
import { boshlaTozalash } from './lib/tozalash.js';
import authRoutes from './routes/auth.js';
import productRoutes from './routes/products.js';
import saleRoutes from './routes/sales.js';
import debtRoutes from './routes/debts.js';
import expenseRoutes from './routes/expenses.js';
import syncRoutes from './routes/sync.js';
import flushRoutes from './routes/flush.js';
import reportRoutes from './routes/reports.js';
import aiRoutes from './routes/ai.js';

const UPLOAD_DIR = path.resolve('uploads');

/**
 * TLS sertifikati ko'rsatilgan bo'lsa — HTTPS, aks holda oddiy HTTP.
 * Fastify uchun bu tanlov yaratish paytida qilinishi kerak.
 */
function tlsOptions() {
  if (!env.httpsEnabled) return null;
  try {
    return {
      key: readFileSync(path.resolve(env.tlsKey)),
      cert: readFileSync(path.resolve(env.tlsCert)),
    };
  } catch {
    // Sertifikat topilmasa jim qolib HTTP ga tushish xavfli: HTTPS kutgan
    // mijoz ulanolmaydi, sababi esa noma'lum bo'lib qoladi.
    throw new Error(
      `TLS sertifikatini o'qib bo'lmadi (${env.tlsKey}, ${env.tlsCert}). `
      + 'Yaratish uchun: npm run cert');
  }
}

const tls = tlsOptions();

const app = Fastify({
  logger: { level: process.env.LOG_LEVEL ?? 'info' },
  bodyLimit: 15 * 1024 * 1024,   // rasm base64 sig'ishi uchun

  /**
   * Render (va har qanday reverse-proxy) orqasida `req.ip` proxy'ning
   * manzilini ko'rsatadi — hamma do'konchi bitta IP dan kelayotgandek.
   * So'rov chegarasi shunda MA'NOSIZ bo'lardi: bir odamning noto'g'ri
   * paroli qolganlarni ham bloklardi.
   *
   * Faqat BITTA hop ishonchli (bizga to'g'ridan-to'g'ri ulangan proxy).
   * `true` emas: u holda mijozning o'zi `X-Forwarded-For` yozib
   * chegaradan o'tib ketishi mumkin edi.
   */
  trustProxy: (_address: string, hop: number) => hop === 0,

  ...(tls ? { https: tls } : {}),
});

await mkdir(UPLOAD_DIR, { recursive: true });

await app.register(cors, { origin: true });

/**
 * GZIP. Do'kondagi internet sekin va o'lchovli, javoblarning kattasi esa
 * JSON — u 8-10 barobar siqiladi. `/sync/products` da 300 mahsulot ~150 KB
 * edi, siqilgach ~15 KB. Kassada bu bir necha soniya farq qiladi.
 *
 * `threshold` — kichik javobni siqishning ma'nosi yo'q: sarlavha va
 * protsessor vaqti yutuqdan ko'p bo'lib ketadi.
 *
 * `/uploads/` dagi rasmlar allaqachon siqilgan (jpg/png/webp), ularni
 * qayta siqish faqat protsessorni band qiladi.
 */
await app.register(compress, {
  global: true,
  threshold: 1024,
  encodings: ['gzip', 'deflate'],
  customTypes: /^application\/json/,
});

/**
 * SO'ROV CHEGARASI. Global emas — do'konchi kun bo'yi ishlaydi va uni
 * cheklash noto'g'ri bo'lardi. Chegara faqat parol tekshiriladigan
 * marshrutlarga qo'yiladi (`routes/auth.ts`), ya'ni parolni ketma-ket
 * taxmin qilishga qarshi.
 */
await app.register(rateLimit, {
  global: false,

  // Mahalliy ishlab chiqish va `npm run test:api` chegaraga urilmasin:
  // sinov bir yurishda bir necha marta kiradi. Render orqasida mijozning
  // manzili hech qachon loopback bo'lmaydi, shuning uchun bu ishlab
  // turgan serverni zaiflashtirmaydi.
  allowList: ['127.0.0.1', '::1'],
  // Xato xabari do'konchi tushunadigan tilda bo'lsin.
  errorResponseBuilder: (_req, ctx) => ({
    statusCode: 429,
    error: 'Juda ko\'p urinish',
    message: `Juda ko'p urinish. ${Math.ceil(ctx.ttl / 1000)} soniyadan keyin qayta urinib ko'ring.`,
  }),
});

await app.register(jwt, { secret: env.jwtSecret, sign: { expiresIn: '90d' } });
await app.register(multipart, { limits: { fileSize: 12 * 1024 * 1024 } });
await app.register(fastifyStatic, { root: UPLOAD_DIR, prefix: '/uploads/' });

registerAuthHooks(app);

/** Zod xatolarini do'konchiga tushunarli xabarga aylantiradi. */
app.setErrorHandler((err, req, reply) => {
  if (err instanceof ZodError) {
    return reply.code(400).send({
      error: 'Kiritilgan ma\'lumot noto\'g\'ri',
      fields: err.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
    });
  }
  req.log.error({ err }, 'So\'rovda xato');
  const e = err as { statusCode?: number; message?: string };
  const status = e.statusCode ?? 500;
  return reply.code(status).send({
    // 5xx da ichki tafsilotni foydalanuvchiga chiqarmaymiz
    error: status >= 500 ? 'Serverda xatolik' : (e.message ?? 'Xatolik'),
  });
});

app.get('/health', async () => {
  const { rows } = await pool.query('SELECT 1 AS ok');
  return {
    ok: rows[0].ok === 1,
    ai: env.aiEnabled,
    https: env.httpsEnabled,
    time: new Date().toISOString(),
  };
});

/** Mahsulot rasmini yuklash — URL qaytadi, uni product.photo_url ga yozasiz. */
app.post('/upload', { preHandler: requireAuth }, async (req, reply) => {
  const file = await req.file();
  if (!file) return reply.code(400).send({ error: 'Fayl yuborilmadi' });

  const ext = (path.extname(file.filename) || '.jpg').toLowerCase();
  if (!['.jpg', '.jpeg', '.png', '.webp'].includes(ext)) {
    return reply.code(400).send({ error: 'Faqat jpg, png yoki webp' });
  }

  const name = `${randomUUID()}${ext}`;
  await writeFile(path.join(UPLOAD_DIR, name), await file.toBuffer());
  return { url: `/uploads/${name}` };
});

await app.register(authRoutes, { prefix: '/auth' });
await app.register(productRoutes, { prefix: '/products' });
await app.register(saleRoutes, { prefix: '/sales' });
await app.register(debtRoutes, { prefix: '/debts' });
await app.register(expenseRoutes, { prefix: '/expenses' });
await app.register(reportRoutes, { prefix: '/reports' });
await app.register(aiRoutes, { prefix: '/ai' });
await app.register(syncRoutes, { prefix: '/sync' });
await app.register(flushRoutes, { prefix: '/sync' });

try {
  await app.listen({ port: env.port, host: env.host });
  app.log.info(`Protokol: ${tls ? 'HTTPS' : "HTTP (TLS yo'q)"}`);
  boshlaTozalash(app.log);
  app.log.info(
    `AI: ${env.aiEnabled ? `yoqilgan (${env.groqTextModel})` : "o'chirilgan (GROQ_API_KEY yo'q)"}`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, async () => {
    await app.close();
    await pool.end();
    process.exit(0);
  });
}
