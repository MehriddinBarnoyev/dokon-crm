import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { one } from '../db.js';

export interface AuthUser {
  id: string;
  shop_id: string;
  role: 'owner' | 'seller';
  name: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    auth: AuthUser;
  }
}

/**
 * Foydalanuvchi hali mavjud va faolmi — qisqa muddatli kesh.
 *
 * Nega kerak? JWT o'zi-o'zicha to'liq: unda shop_id va user_id yozilgan va
 * server ularni tekshirmasa, token 90 kun davomida "ishlayveradi" — hatto
 * foydalanuvchi o'chirilgan yoki bloklangan bo'lsa ham. Bunda so'rovlar
 * xatosiz, lekin BO'SH javob qaytaradi (do'kon yo'q → ma'lumot yo'q),
 * bu esa "nega hech narsa ko'rinmayapti?" degan chalkashlikka olib keladi.
 *
 * Har so'rovda bazaga bormaslik uchun natijani 60 soniya saqlaymiz.
 */
const TEKSHIRUV_MUDDATI = 60_000;
const kesh = new Map<string, { yaroqli: boolean; vaqt: number }>();

async function foydalanuvchiYaroqli(userId: string, shopId: string): Promise<boolean> {
  const kalit = `${userId}:${shopId}`;
  const bor = kesh.get(kalit);
  const hozir = Date.now();
  if (bor && hozir - bor.vaqt < TEKSHIRUV_MUDDATI) return bor.yaroqli;

  const row = await one<{ ok: boolean }>(
    `SELECT true AS ok FROM users u
       JOIN shops s ON s.id = u.shop_id
      WHERE u.id = $1 AND u.shop_id = $2 AND u.is_active`,
    [userId, shopId]);

  const yaroqli = row !== null;
  kesh.set(kalit, { yaroqli, vaqt: hozir });
  return yaroqli;
}

/** Himoyalangan marshrutlar uchun: tokenni tekshirib, req.auth ni to'ldiradi. */
export async function requireAuth(req: FastifyRequest, reply: FastifyReply) {
  let auth: AuthUser;
  try {
    await req.jwtVerify();
    auth = req.user as unknown as AuthUser;
  } catch {
    return reply.code(401).send({ error: 'Avtorizatsiya talab qilinadi' });
  }

  if (!(await foydalanuvchiYaroqli(auth.id, auth.shop_id))) {
    return reply.code(401).send({
      error: 'Seans eskirgan — qaytadan kiring',
      detail: "Hisob yoki do'kon o'zgargan.",
    });
  }

  req.auth = auth;
}

/** Faqat do'kon egasi bajara oladigan amallar uchun. */
export async function requireOwner(req: FastifyRequest, reply: FastifyReply) {
  if (req.auth?.role !== 'owner') {
    return reply.code(403).send({ error: 'Bu amal faqat do\'kon egasi uchun' });
  }
}

export function registerAuthHooks(app: FastifyInstance) {
  app.decorateRequest('auth', null as any);
}
