import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { one, query, tx } from '../db.js';
import { requireAuth } from '../lib/auth.js';
import { ActionSchema, executeActions } from '../lib/actions.js';
import { parseCommand } from '../ai/agent.js';
import { recognizeProduct } from '../ai/vision.js';
import { analyze } from '../ai/insights.js';
import { env } from '../env.js';

export default async function aiRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth);

  // AI kalitsiz ilova ishlashda davom etadi — faqat shu marshrutlar o'chadi.
  app.addHook('preHandler', async (req, reply) => {
    if (!env.aiEnabled) {
      return reply.code(503).send({
        error: 'AI o\'chirilgan',
        detail: 'Serverda GROQ_API_KEY sozlanmagan.',
      });
    }
  });

  async function shopName(shopId: string): Promise<string> {
    const s = await one<{ name: string }>(`SELECT name FROM shops WHERE id = $1`, [shopId]);
    return s?.name ?? 'Do\'kon';
  }

  /**
   * 1-BOSQICH — buyruqni tushunish.
   * AI faqat matnni JSON ga o'giradi; mahsulotni bazadan SQL topadi.
   * Bazaga HECH NARSA yozilmaydi. Qaytadi: xulosa + amallar + tanlovlar.
   */
  app.post('/command', async (req, reply) => {
    const body = z.object({ text: z.string().min(2).max(2000) }).parse(req.body);

    try {
      const result = await parseCommand(req.auth.shop_id, body.text);

      const log = await one<{ id: string }>(
        `INSERT INTO ai_logs (shop_id, user_id, kind, input, actions, summary, executed, tokens_in, tokens_out)
         VALUES ($1,$2,'command',$3,$4,$5,false,$6,$7) RETURNING id`,
        [req.auth.shop_id, req.auth.id, body.text,
         JSON.stringify(result.actions), result.summary,
         result.usage.input, result.usage.output]);

      return {
        log_id: log!.id,
        summary: result.summary,
        actions: result.actions,
        // Bir nom bir nechta mahsulotga to'g'ri kelgan joylar — do'konchi tanlaydi.
        choices: result.tanlovlar,
        warnings: result.warnings,
        needs_confirm: result.needsConfirm,
        needs_choice: result.needsChoice,
        savol: result.savol,
      };
    } catch (e: any) {
      req.log.error({ err: e }, 'AI buyrug\'ini tahlil qilishda xato');
      return reply.code(502).send({ error: 'AI javob bera olmadi', detail: e.message });
    }
  });

  /**
   * 2-BOSQICH — tasdiqlangan amallarni bajarish.
   * AI qayta chaqirilmaydi: amallar tayyor, faqat tranzaksiyada yoziladi.
   */
  app.post('/execute', async (req, reply) => {
    const body = z.object({
      actions: z.array(ActionSchema).min(1).max(20),
      log_id: z.string().uuid().optional(),
    }).parse(req.body);

    try {
      const results = await tx((c) => executeActions(c,
        { shopId: req.auth.shop_id, userId: req.auth.id, source: 'ai' },
        body.actions));

      if (body.log_id) {
        await query(`UPDATE ai_logs SET executed = true WHERE id = $1 AND shop_id = $2`,
          [body.log_id, req.auth.shop_id]);
      }

      return {
        ok: true,
        results,
        summary: results.map((r) => r.summary).join('\n'),
        warnings: results.flatMap((r) => r.warnings),
      };
    } catch (e: any) {
      req.log.error({ err: e }, 'Amallarni bajarishda xato');
      return reply.code(400).send({ error: e.message });
    }
  });

  /** Rasmdan mahsulotni tanish (base64 JSON orqali). */
  app.post('/vision', async (req, reply) => {
    const body = z.object({
      image_base64: z.string().min(100),
      ext: z.string().default('jpg'),
    }).parse(req.body);

    // "data:image/jpeg;base64,..." prefiksi kelsa kesib tashlaymiz
    const clean = body.image_base64.replace(/^data:image\/[a-zA-Z]+;base64,/, '');

    try {
      const result = await recognizeProduct(req.auth.shop_id, clean, body.ext);
      await query(
        `INSERT INTO ai_logs (shop_id, user_id, kind, summary, tokens_in, tokens_out)
         VALUES ($1,$2,'vision',$3,$4,$5)`,
        [req.auth.shop_id, req.auth.id, result.nom, result.usage.input, result.usage.output]);
      return result;
    } catch (e: any) {
      req.log.error({ err: e }, 'Rasmni tanishda xato');
      return reply.code(502).send({ error: 'Rasmni tanib bo\'lmadi', detail: e.message });
    }
  });

  /** Savdo tahlili va maslahat. */
  app.post('/insights', async (req, reply) => {
    const body = z.object({
      days: z.number().int().min(1).max(365).default(30),
      question: z.string().max(500).optional(),
    }).parse(req.body ?? {});

    try {
      const result = await analyze(
        req.auth.shop_id, await shopName(req.auth.shop_id), body.days, body.question);

      await query(
        `INSERT INTO ai_logs (shop_id, user_id, kind, input, summary, tokens_in, tokens_out)
         VALUES ($1,$2,'insight',$3,$4,$5,$6)`,
        [req.auth.shop_id, req.auth.id, body.question ?? null,
         result.summary, result.usage.input, result.usage.output]);

      return { summary: result.summary, data: result.data };
    } catch (e: any) {
      req.log.error({ err: e }, 'Tahlilda xato');
      return reply.code(502).send({ error: 'Tahlil qilib bo\'lmadi', detail: e.message });
    }
  });

  /** AI tarixi — nima so'ralgan, nima bajarilgan. */
  app.get('/history', async (req) => {
    const q = z.object({ limit: z.coerce.number().min(1).max(100).default(30) }).parse(req.query);
    return query(
      `SELECT id, kind, input, summary, executed, created_at
         FROM ai_logs WHERE shop_id = $1
        ORDER BY created_at DESC LIMIT $2`, [req.auth.shop_id, q.limit]);
  });
}
