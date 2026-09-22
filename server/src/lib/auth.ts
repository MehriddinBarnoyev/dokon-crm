import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { one, query } from '../db.js';

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

/**
 * QURILMA KUZATUVI — xavfsizlik uchun.
 *
 * Ilova har so'rovda o'z qurilmasi haqida header yuboradi (`X-Device-Id`
 * va h.k. — mobil tomonda `src/lib/device.ts`). Bu yerda uni yozib
 * boramiz: kim, qaysi qurilmadan va qachondan beri kirib turgani
 * ko'rinishi kerak — shubhali (o'g'irlangan token, begona telefon)
 * kirishni sezish shundan boshlanadi.
 *
 * Har so'rovda bazaga yozmaymiz — headerlar deyarli hech qachon
 * o'zgarmaydi, faqat `foydalanuvchiYaroqli` kabi keshlanadi.
 */
const QURILMA_MUDDATI = 60 * 60_000; // 1 soat
const qurilmaKeshi = new Map<string, number>();

interface QurilmaHeaderlari {
  deviceId: string;
  platform?: string;
  model?: string;
  osVersion?: string;
  appVersion?: string;
}

function qurilmaHeaderlariniOl(req: FastifyRequest): QurilmaHeaderlari | null {
  const deviceId = req.headers['x-device-id'];
  if (typeof deviceId !== 'string' || !deviceId) return null;

  const ol = (nom: string) => {
    const v = req.headers[nom];
    return typeof v === 'string' && v ? v.slice(0, 200) : undefined;
  };
  return {
    deviceId: deviceId.slice(0, 200),
    platform: ol('x-device-platform'),
    model: ol('x-device-model'),
    osVersion: ol('x-device-os-version'),
    appVersion: ol('x-app-version'),
  };
}

async function qurilmaniQayd(userId: string, h: QurilmaHeaderlari) {
  const kalit = `${userId}:${h.deviceId}`;
  const hozir = Date.now();
  const oxirgi = qurilmaKeshi.get(kalit);
  if (oxirgi && hozir - oxirgi < QURILMA_MUDDATI) return;
  qurilmaKeshi.set(kalit, hozir);

  await query(
    `INSERT INTO user_devices (user_id, device_id, platform, model, os_version, app_version)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (user_id, device_id) DO UPDATE
        SET last_seen_at = now(),
            platform     = EXCLUDED.platform,
            model        = EXCLUDED.model,
            os_version   = EXCLUDED.os_version,
            app_version  = EXCLUDED.app_version`,
    [userId, h.deviceId, h.platform ?? null, h.model ?? null, h.osVersion ?? null, h.appVersion ?? null],
  ).catch(() => {
    // Yozib bo'lmasa ham so'rov davom etadi — bu faqat kuzatuv,
    // foydalanuvchining ishini to'xtatmasligi kerak.
    qurilmaKeshi.delete(kalit);
  });
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

  const qurilma = qurilmaHeaderlariniOl(req);
  if (qurilma) void qurilmaniQayd(auth.id, qurilma);
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
