/**
 * RASMDAN MAHSULOT TANISH (Groq)
 * ===============================
 * Do'konchi mahsulotni rasmga oladi → model nomi, birligi va kategoriyasini
 * to'ldiradi. Narxni AI o'ylab topmaydi (bozor narxini bilmaydi) — uni
 * do'konchi kiritadi. Agar mahsulot bazada bo'lsa, mavjudi taklif qilinadi.
 *
 * Groq'da rasmni faqat qwen oilasi qabul qiladi (gpt-oss — matn-only).
 * qwen javobni <think> bilan boshlaydi, shuning uchun stripThinking() kerak.
 */
import { z } from 'zod';
import { query } from '../db.js';
import { VISION_MODEL, aiError, groqCall, jsonSchema, stripThinking } from './client.js';
import { UNITS } from '../lib/actions.js';

const RecognizedSchema = z.object({
  nom: z.string().describe('Mahsulotning qisqa nomi, masalan "Coca-Cola 1L"'),
  kategoriya: z.string().describe('ichimlik, oziq-ovqat, maishiy kimyo, non-bulka va h.k.'),
  birlik: z.enum(UNITS).describe("Bu mahsulot odatda qanday o'lchanadi"),
  brend: z.string().nullable().describe("Brend nomi, ko'rinmasa null"),
  shtrix_kod: z.string().nullable().describe("Rasmda shtrix-kod raqami ko'rinsa"),
  ishonch: z.number().min(0).max(1).describe('Tanishga ishonch darajasi 0..1'),
  izoh: z.string().nullable().describe("Do'konchiga qisqa eslatma, kerak bo'lmasa null"),
});

export type Recognized = z.infer<typeof RecognizedSchema>;

export interface VisionResult extends Recognized {
  /** Bazada shunga o'xshash mahsulotlar — takroriy yaratmaslik uchun */
  mavjud: Array<{ id: string; name: string; unit: string; sale_price: number; stock: number }>;
  usage: { input: number; output: number };
}

const MEDIA: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
  webp: 'image/webp', gif: 'image/gif',
};

export async function recognizeProduct(
  shopId: string,
  base64: string,
  ext = 'jpg',
): Promise<VisionResult> {
  const mediaType = MEDIA[ext.toLowerCase()] ?? 'image/jpeg';

  let res;
  try {
    res = await groqCall((c) => c.chat.completions.create({
      model: VISION_MODEL,
      temperature: 0,
      // Tanish natijasi qisqa JSON (~90 token). Katta max_tokens Groq
      // limitidan behuda joy band qiladi.
      max_tokens: 700,
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'mahsulot',
          strict: true,
          schema: jsonSchema(RecognizedSchema, 'output') as any,
        },
      },
      messages: [
        {
          role: 'system',
          content:
            "Sen do'kon uchun mahsulot katalogini to'ldirasan. Rasmdagi mahsulotni aniqlab, "
            + "uni o'zbek do'konchisi tushunadigan qisqa nom bilan atang. "
            + "Agar o'ramda hajm/og'irlik yozilgan bo'lsa nomga qo'sh (masalan \"Guruch 1kg\"). "
            + 'NARXNI TAXMIN QILMA — narxni do\'konchi o\'zi kiritadi. '
            + "Rasmda mahsulot aniq ko'rinmasa, ishonch darajasini past qo'y va izohda ayt.",
        },
        {
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: `data:${mediaType};base64,${base64}` } },
            { type: 'text', text: "Bu mahsulotni katalogga qo'shish uchun ma'lumotlarini ajrat." },
          ],
        },
      ],
    }));
  } catch (e) {
    throw aiError(e);
  }

  const raw = stripThinking(res.choices[0]?.message?.content ?? '');
  let parsed: Recognized;
  try {
    parsed = RecognizedSchema.parse(JSON.parse(raw));
  } catch {
    throw new Error("Rasmni tanib bo'lmadi, qaytadan urinib ko'ring.");
  }

  // Bazada o'xshash bormi? Bo'lsa — yangi yaratish o'rniga uni taklif qilamiz.
  const mavjud = await query(
    `SELECT id, name, unit, sale_price, stock
       FROM dokon_search_products($1, $2, 5)
      WHERE NOT taxminiy`,
    [shopId, parsed.nom]);

  return {
    ...parsed,
    mavjud,
    usage: {
      input: res.usage?.prompt_tokens ?? 0,
      output: res.usage?.completion_tokens ?? 0,
    },
  };
}
