import Fastify from 'fastify';
import cors from '@fastify/cors';
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
  ...(tls ? { https: tls } : {}),
});

await mkdir(UPLOAD_DIR, { recursive: true });

await app.register(cors, { origin: true });
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
