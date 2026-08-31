/**
 * Groq API klienti — bir nechta kalit bilan.
 *
 * Modellar amalda sinab tanlangan (2026-08):
 *   • openai/gpt-oss-120b — tool calling ishonchli, 131k kontekst.
 *     Buyruq agenti va tahlil uchun.
 *   • qwen/qwen3.8-27b    — Groq'da rasm qabul qiladigan yagona oila.
 *     Rasmdan mahsulot tanish uchun.
 *   gpt-oss modellari rasmni QABUL QILMAYDI, qwen esa <think> bloklarini
 *   qaytaradi — quyidagi stripThinking() shuning uchun kerak.
 *
 * KALITLAR HAQIDA MUHIM ESLATMA
 * Groq limitni kalitga emas, AKKAUNTGA qo'yadi. Bitta akkauntning bir necha
 * kaliti bir xil kunlik byudjetni bo'lishadi — ular orasida almashish hech
 * narsa bermaydi. Bu almashinuv faqat kalitlar HAR XIL akkauntdan bo'lganda
 * foyda beradi.
 */
import Groq from 'groq-sdk';
import { z } from 'zod';
import { env } from '../env.js';

interface KeyState {
  client: Groq;
  /** Jurnalda ko'rsatish uchun — to'liq kalit hech qayerga yozilmaydi. */
  label: string;
  /** Limitga urilgan bo'lsa, shu vaqtgacha ishlatilmaydi (ms). */
  cooldownUntil: number;
}

let pool: KeyState[] | null = null;

function keys(): KeyState[] {
  if (pool) return pool;
  if (!env.aiEnabled) {
    throw new Error("GROQ_API_KEY sozlanmagan — AI funksiyalari o'chirilgan.");
  }
  pool = env.groqKeys.map((key) => ({
    client: new Groq({ apiKey: key, maxRetries: 1, timeout: 120_000 }),
    label: `…${key.slice(-6)}`,
    cooldownUntil: 0,
  }));
  return pool;
}

/** Eski kod uchun: birinchi mavjud klient. */
export function ai(): Groq {
  const now = Date.now();
  const free = keys().find((k) => k.cooldownUntil <= now) ?? keys()[0];
  return free.client;
}

export const TEXT_MODEL = env.groqTextModel;
export const VISION_MODEL = env.groqVisionModel;

/** "Please try again in 20m31.2s" → millisekund. */
function parseRetryMs(message: string): number | null {
  const m = message.match(/try again in ([\dhms.]+)/i)?.[1];
  if (!m) return null;
  const h = Number(m.match(/([\d.]+)h/)?.[1] ?? 0);
  const min = Number(m.match(/([\d.]+)m(?!s)/)?.[1] ?? 0);
  const sec = Number(m.match(/([\d.]+)s/)?.[1] ?? 0);
  const ms = (h * 3600 + min * 60 + sec) * 1000;
  return ms > 0 ? ms : null;
}

function isRateLimit(e: unknown): boolean {
  return (e as { status?: number })?.status === 429;
}

/**
 * Groq chaqiruvini bajaradi. Kalit limitga urilsa — keyingi kalitga o'tadi.
 * Hammasi tugagan bo'lsa, eng tez tiklanadigan kalit vaqti bilan xato qaytaradi.
 */
export async function groqCall<T>(fn: (client: Groq) => Promise<T>): Promise<T> {
  const all = keys();
  let oxirgiXato: unknown = null;

  for (let urinish = 0; urinish < all.length; urinish++) {
    const now = Date.now();
    const k = all.find((x) => x.cooldownUntil <= now);
    if (!k) {
      // Hamma kalit sovushda — eng tez tiklanadiganini aytamiz.
      // Bu "kalit yo'q" degani emas: kalitlar bor, faqat limitda.
      const eng = Math.min(...all.map((x) => x.cooldownUntil));
      const soniya = Math.max(1, Math.round((eng - now) / 1000));
      const daqiqa = Math.floor(soniya / 60);
      throw new Error(
        `Groq limiti tugadi (${all.length} ta kalit ham). `
        + `Taxminan ${daqiqa > 0 ? `${daqiqa} daq ${soniya % 60} s` : `${soniya} s`} dan keyin.`
        + (all.length > 1
          ? ' Kalitlar bitta akkauntda bo\'lsa, limit ular uchun umumiy.'
          : ''));
    }

    try {
      return await fn(k.client);
    } catch (e) {
      oxirgiXato = e;
      if (!isRateLimit(e)) throw aiError(e);

      const msg = String((e as { message?: string })?.message ?? '');
      // Kunlik limit uzoq, daqiqalik qisqa — Groq aytgan vaqtni ishlatamiz
      const ms = parseRetryMs(msg) ?? 60_000;
      k.cooldownUntil = Date.now() + ms;

      if (env.groqKeys.length > 1) {
        console.warn(
          `[groq] kalit ${k.label} limitda (${Math.round(ms / 1000)}s), keyingisiga o'tildi`);
      }
    }
  }

  throw aiError(oxirgiXato ?? new Error('Groq chaqiruvi bajarilmadi'));
}

/**
 * Model javobini ilovada ko'rsatishga tayyorlaydi:
 *   • qwen javobni <think>…</think> bilan boshlaydi — uni olib tashlaymiz;
 *   • ilova matnni oddiy Text sifatida chizadi, shuning uchun markdown
 *     belgilari (**qalin**, ### sarlavha) ekranda xom holda ko'rinadi.
 */
export function stripThinking(text: string): string {
  let t = text;
  if (t.includes('</think>')) t = t.slice(t.lastIndexOf('</think>') + 8);
  return t
    .replace(/<\/?think>/g, '')
    .replace(/\*\*(.+?)\*\*/g, '$1')     // **qalin** → qalin
    .replace(/^#{1,6}\s+/gm, '')          // ### sarlavha
    .replace(/`([^`]+)`/g, '$1')          // `kod`
    .trim();
}

/**
 * Zod sxemasini Groq kutadigan JSON Schema ga o'giradi.
 *
 * mode='input'  — vositalar uchun. `.default()` bo'lgan maydonlar `required` ga
 *   TUSHMAYDI, ya'ni model ularni tashlab ketsa ham Groq so'rovni rad etmaydi
 *   (aks holda "missing properties" xatosi chiqadi). Yetishmagan qiymatni
 *   keyin zod .parse() default bilan to'ldiradi.
 * mode='output' — response_format uchun. strict rejim hamma maydonni talab qiladi.
 */
export function jsonSchema(
  schema: z.ZodType,
  mode: 'input' | 'output' = 'input',
): Record<string, unknown> {
  const s = z.toJSONSchema(schema, { io: mode }) as Record<string, unknown>;
  delete s.$schema;                    // Groq buni qabul qilmaydi
  qatiyQil(s);
  return s;
}

/**
 * Groq strict rejimi HAR BIR obyektda `additionalProperties: false` talab qiladi,
 * z.toJSONSchema esa uni qo'ymaydi. Ichma-ich obyektlar (masalan savdo
 * qatorlari massivi) bo'lsa, faqat yuqori qavatga qo'yish yetmaydi —
 * Groq butun so'rovni 400 bilan rad etadi. Shuning uchun rekursiv yuramiz.
 */
function qatiyQil(node: unknown): void {
  if (Array.isArray(node)) {
    for (const el of node) qatiyQil(el);
    return;
  }
  if (node === null || typeof node !== 'object') return;

  const o = node as Record<string, unknown>;
  if (o.type === 'object') o.additionalProperties = false;
  for (const v of Object.values(o)) qatiyQil(v);
}

/** Groq xatolarini do'konchi tushunadigan xabarga aylantiradi. */
export function aiError(e: unknown): Error {
  const err = e as { status?: number; message?: string; error?: unknown };
  if (process.env.AI_DEBUG) {
    console.error('[AI_DEBUG] status=%s message=%s',
      err?.status, String(err?.message).slice(0, 400));
  }

  if (err?.status === 429) {
    // Groq ikki xil limit qo'yadi va xabarda qancha kutish kerakligini aytadi.
    // Uni o'qiymiz: "daqiqalik" va "kunlik" limit farqi juda katta —
    // do'konchiga "bir daqiqa kuting" deyish, aslida 20 daqiqa bo'lsa, yomon.
    const msg = String(err.message ?? '');
    const kutish = msg.match(/try again in ([\dhms.]+)/i)?.[1]?.replace(/\.$/, '');
    const kunlik = /per day|TPD/i.test(msg);

    return new Error(
      (kunlik
        ? "Groq'ning KUNLIK bepul limiti tugadi."
        : "Groq'ning daqiqalik limitiga yetdingiz.")
      + (kutish ? ` Taxminan ${kutish} dan keyin qayta urinib ko'ring.` : '')
      + (kunlik ? ' Doimiy ishlatish uchun console.groq.com/settings/billing' : ''));
  }
  if (err?.status === 503) {
    return new Error('Model hozir band. Bir oz kutib qayta urining.');
  }
  if (err?.status === 401) {
    return new Error("GROQ_API_KEY noto'g'ri yoki eskirgan.");
  }
  return new Error(err?.message ?? "AI bilan bog'lanib bo'lmadi");
}
