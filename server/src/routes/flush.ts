/**
 * NAVBATNI YUBORISH — offline yozishning server tomoni.
 *
 * Ilova internet yo'q bo'lganda o'zgarishlarni navbatga qo'yadi va
 * ulanish tiklanganda shu yerga yuboradi.
 *
 * IDEMPOTENTLIK — eng muhim qismi. Yuborish yarim yo'lda uzilishi
 * mumkin: server yozib ulgurdi, javob esa yetib bormadi. Mijoz qayta
 * urinsa, savdo ikki marta yozilib, qoldiq ikki marta kamayardi.
 *
 * Shuning uchun har bir o'zgarishga MIJOZ o'zi uuid beradi. Server uni
 * `mutation_log` ga yozadi. Ikkinchi marta kelganda amal qayta
 * bajarilmaydi — saqlangan natija qaytariladi.
 *
 * HAR MUTATSIYA O'Z TRANZAKSIYASIDA. Bitta savdo "qoldiq yetmaydi" deb
 * rad etilsa, undan keyingi chiqim ham yo'qolib ketmasligi kerak.
 * (`POST /ai/execute` dan farqi shu — u yerda hammasi bitta tranzaksiya,
 * chunki bir buyruqning bo'laklari bo'linmasligi kerak edi.)
 *
 * QAYTA URINISH MUMKINMI. Javobdagi `retryable`:
 *   false — biznes yoki tekshiruv xatosi (qoldiq yetmadi, summa manfiy).
 *           Qayta yuborish ayni natijani beradi, navbatdan chiqarish kerak.
 *   true  — vaqtinchalik (baza band, ulanish uzildi). Keyin qayta urinsa
 *           bo'ladi.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type pg from 'pg';
import { one, query, tx } from '../db.js';
import { requireAuth } from '../lib/auth.js';
import { ActionSchema, executeActions, type ActionResult } from '../lib/actions.js';

/**
 * `ActionSchema` qamramaydigan o'zgarishlar.
 *
 * Ular `executeActions` ichida emas — chunki AI ularni hech qachon
 * bajarmaydi va u yerga qo'shish `extract.ts` → `resolve.ts` zanjirini
 * ham o'zgartirishni talab qilardi. Bu yerda ular oddiy SQL.
 */
const QoshimchaSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('expense_update'),
    id: z.string().uuid(),
    category: z.string().trim().min(1).optional(),
    amount: z.number().positive().optional(),
    note: z.string().nullable().optional(),
  }),
  z.object({
    kind: z.literal('expense_delete'),
    id: z.string().uuid(),
  }),
  z.object({
    kind: z.literal('product_update'),
    id: z.string().uuid(),
    name: z.string().min(1).optional(),
    cost_price: z.number().nonnegative().optional(),
    sale_price: z.number().nonnegative().optional(),
    min_stock: z.number().nonnegative().optional(),
    barcode: z.string().nullable().optional(),
    is_active: z.boolean().optional(),
  }),
]);

const MutationSchema = z.object({
  /** Mijoz bergan uuid — idempotentlik kaliti. */
  id: z.string().uuid(),
  kind: z.string().min(1),
  body: z.record(z.string(), z.unknown()).default({}),
});

const FlushSchema = z.object({
  mutations: z.array(MutationSchema).min(1).max(50),
});

interface FlushResult {
  id: string;
  ok: boolean;
  result?: unknown;
  error?: string;
  retryable?: boolean;
}

/**
 * Xato vaqtinchalikmi?
 *
 * Postgres kodlari: 40001 serialization_failure, 40P01 deadlock,
 * 53300 too_many_connections, 57014 query_canceled, 08* ulanish.
 * Qolgani — biznes yoki tekshiruv xatosi, qayta urinish yordam bermaydi.
 */
function qaytaUrinsaBoladi(e: any): boolean {
  const kod: string | undefined = e?.code;
  if (!kod) return false;
  return kod === '40001' || kod === '40P01' || kod === '53300'
    || kod === '57014' || kod.startsWith('08');
}

export default async function flushRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth);

  app.post('/flush', async (req) => {
    const { mutations } = FlushSchema.parse(req.body);
    const ctx = {
      shopId: req.auth.shop_id,
      userId: req.auth.id,
      source: 'manual' as const,
    };

    const results: FlushResult[] = [];

    for (const m of mutations) {
      try {
        const result = await tx(async (c) => {
          /*
           * Idempotentlik darvozasi. `ON CONFLICT DO NOTHING` qator
           * qaytarmasa — bu uuid allaqachon bajarilgan.
           *
           * Bir vaqtda kelgan ikkinchi so'rov shu INSERT'da BIRINCHISI
           * commit bo'lguncha kutadi, keyin konflikt oladi. READ COMMITTED
           * da undan keyingi SELECT commit bo'lgan qatorni ko'radi.
           */
          const yangi = await one<{ client_mutation_id: string }>(
            `INSERT INTO mutation_log (client_mutation_id, shop_id, user_id, kind)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (client_mutation_id) DO NOTHING
             RETURNING client_mutation_id`,
            [m.id, ctx.shopId, ctx.userId, m.kind], c);

          if (!yangi) {
            const eski = await one<{ result: unknown; shop_id: string }>(
              `SELECT result, shop_id FROM mutation_log WHERE client_mutation_id = $1`,
              [m.id], c);
            // Boshqa do'konning uuid'i bilan kelgan bo'lsa — bermaymiz.
            if (!eski || eski.shop_id !== ctx.shopId) {
              throw Object.assign(new Error('Bu o\'zgarish sizga tegishli emas'),
                { statusCode: 403 });
            }
            return { takror: true, value: eski.result };
          }

          const value = await bajar(c, ctx, m.kind, m.body);

          await query(
            `UPDATE mutation_log SET result = $1 WHERE client_mutation_id = $2`,
            [JSON.stringify(value), m.id], c);

          return { takror: false, value };
        });

        results.push({ id: m.id, ok: true, result: result.value });
      } catch (e: any) {
        results.push({
          id: m.id,
          ok: false,
          error: e?.message ?? 'Noma\'lum xato',
          retryable: qaytaUrinsaBoladi(e),
        });
      }
    }

    return { results };
  });
}

/* -------------------------------- Dispatch -------------------------------- */

/** `ActionSchema` qamraydigan turlar — sxemaning o'zidan olinadi. */
const ACTION_TURLARI = new Set(
  ActionSchema.options.map((o) => o.shape.type.value as string));

/** Zod xatosini do'konchi tushunadigan bitta qatorga aylantiradi. */
function xatoMatni(kind: string, err: z.ZodError): string {
  const i = err.issues[0];
  const maydon = i?.path.filter((p) => p !== 'type' && p !== 'kind').join('.');
  return `Noto'g'ri "${kind}"${maydon ? ` — ${maydon}` : ''}: ${i?.message ?? 'sxemaga mos emas'}`;
}

async function bajar(
  c: pg.PoolClient,
  ctx: { shopId: string; userId: string | null; source: 'manual' },
  kind: string,
  body: Record<string, unknown>,
): Promise<unknown> {
  // Mavjud amallar — hammasi `executeActions` orqali, ya'ni onlayn
  // yozish bilan AYNAN bir xil yo'ldan o'tadi.
  if (ACTION_TURLARI.has(kind)) {
    const asAction = ActionSchema.safeParse({ ...body, type: kind });
    if (!asAction.success) {
      // Xatoni AYNAN shu sxemadan olamiz. Aks holda quyidagi
      // `QoshimchaSchema` ga tushib, "expense_update kutilgan edi"
      // degan chalg'ituvchi xabar chiqardi.
      throw new Error(xatoMatni(kind, asAction.error));
    }
    const [res] = await executeActions(c, ctx, [asAction.data]);
    return res as ActionResult;
  }

  const qoshimcha = QoshimchaSchema.safeParse({ ...body, kind });
  if (!qoshimcha.success) {
    // Sxemaga tushmadi — bu qayta urinish bilan tuzalmaydi.
    throw new Error(xatoMatni(kind, qoshimcha.error));
  }
  const a = qoshimcha.data;

  if (a.kind === 'expense_update') {
    return patchQator(c, 'expenses', a.id, ctx.shopId,
      { category: a.category, amount: a.amount, note: a.note },
      'deleted_at IS NULL', 'Chiqim topilmadi');
  }

  if (a.kind === 'expense_delete') {
    const row = await one(
      `UPDATE expenses SET deleted_at = now(), updated_at = now()
        WHERE id = $1 AND shop_id = $2 AND deleted_at IS NULL
        RETURNING id`, [a.id, ctx.shopId], c);
    if (!row) throw new Error('Chiqim topilmadi');
    return { ok: true, id: a.id };
  }

  // product_update
  return patchQator(c, 'products', a.id, ctx.shopId, {
    name: a.name, cost_price: a.cost_price, sale_price: a.sale_price,
    min_stock: a.min_stock, barcode: a.barcode, is_active: a.is_active,
  }, null, 'Mahsulot topilmadi');
}

/** Berilgan maydonlarni yangilaydi. `undefined` bo'lganlari tegilmaydi. */
async function patchQator(
  c: pg.PoolClient,
  jadval: 'expenses' | 'products',
  id: string,
  shopId: string,
  maydonlar: Record<string, unknown>,
  qoshimchaShart: string | null,
  topilmadi: string,
): Promise<unknown> {
  const sets: string[] = [];
  const params: unknown[] = [];

  for (const [key, value] of Object.entries(maydonlar)) {
    if (value === undefined) continue;
    params.push(value);
    sets.push(`${key} = $${params.length}`);
  }
  if (sets.length === 0) throw new Error("O'zgartirish uchun maydon berilmadi");
  sets.push('updated_at = now()');

  params.push(id, shopId);
  const row = await one(
    `UPDATE ${jadval} SET ${sets.join(', ')}
      WHERE id = $${params.length - 1} AND shop_id = $${params.length}
        ${qoshimchaShart ? `AND ${qoshimchaShart}` : ''}
      RETURNING id`, params, c);

  if (!row) throw new Error(topilmadi);
  return { ok: true, id };
}
