import type { FastifyInstance } from 'fastify';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { one, tx } from '../db.js';
import { requireAuth } from '../lib/auth.js';

const RegisterBody = z.object({
  shop_name: z.string().min(2),
  name: z.string().min(2),
  phone: z.string().min(6),
  password: z.string().min(4),
});

const LoginBody = z.object({
  phone: z.string().min(6),
  password: z.string().min(4),
});

export default async function authRoutes(app: FastifyInstance) {
  /** Yangi do'kon + egasi ro'yxatdan o'tkaziladi. */
  app.post('/register', async (req, reply) => {
    const body = RegisterBody.parse(req.body);

    const exists = await one(`SELECT id FROM users WHERE phone = $1`, [body.phone]);
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

  app.post('/login', async (req, reply) => {
    const body = LoginBody.parse(req.body);
    const row = await one<{
      id: string; shop_id: string; role: 'owner' | 'seller';
      name: string; password_hash: string; is_active: boolean;
    }>(`SELECT id, shop_id, role, name, password_hash, is_active
          FROM users WHERE phone = $1`, [body.phone]);

    if (!row || !row.is_active) return reply.code(401).send({ error: 'Login yoki parol xato' });
    if (!(await bcrypt.compare(body.password, row.password_hash))) {
      return reply.code(401).send({ error: 'Login yoki parol xato' });
    }

    const user = { id: row.id, shop_id: row.shop_id, role: row.role, name: row.name };
    return { token: app.jwt.sign(user), user };
  });

  app.post('/staff', { preHandler: requireAuth }, async (req, reply) => {
    if (req.auth.role !== 'owner') {
      return reply.code(403).send({ error: 'Faqat do\'kon egasi xodim qo\'sha oladi' });
    }
    const body = z.object({
      name: z.string().min(2), phone: z.string().min(6), password: z.string().min(4),
    }).parse(req.body);

    const exists = await one(`SELECT id FROM users WHERE phone = $1`, [body.phone]);
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
