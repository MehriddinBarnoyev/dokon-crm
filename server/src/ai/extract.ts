/**
 * MATN → JSON (bitta Groq chaqiruvi)
 * ===================================
 * AI ning bu yerdagi YAGONA vazifasi — do'konchining erkin gapini qat'iy
 * JSON ga o'girish. U bazani KO'RMAYDI: mahsulot qidirmaydi, narx bilmaydi,
 * mijoz izlamaydi. Faqat "nima deyilgan" ni yozib beradi.
 *
 * Nega shunday?
 *   • Qidiruv — bazaning ishi. `dokon_search_products` aniq, tez va bepul;
 *     AI orqali qidirish esa har mahsulotga bitta Groq chaqiruvi degani edi
 *     (4 ta mahsulot = 4 ta chaqiruv, ~11 500 token — daqiqalik limitdan katta).
 *   • Endi bitta chaqiruv, vosita sxemalarisiz: ~700 token.
 *   • Natija deterministik: bir xil matn → bir xil JSON → bir xil qidiruv.
 *
 * Nomni bazaga bog'lash keyingi bosqichda, lib/resolve.ts da — sof SQL bilan.
 */
import { z } from 'zod';
import { TEXT_MODEL, aiError, groqCall, jsonSchema } from './client.js';
import { UNITS } from '../lib/actions.js';

/** Xom qator: do'konchi aytgan nom va miqdor. ID yo'q — AI uni bilmaydi. */
const XomQator = z.object({
  nom: z.string().describe("Mahsulot nomi, gapda qanday aytilgan bo'lsa shundayligicha"),
  miqdor: z.number().describe('Miqdor. Aytilmasa 1'),
  birlik: z.enum(UNITS).nullable().describe("Aytilgan bo'lsa o'lchov birligi, aks holda null"),
  narx: z.number().nullable().describe("Bir birlik SOTUV narxi. Aytilmasa null — bazadan olinadi"),
  tan_narx: z.number().nullable().describe('Kirim uchun bir birlik TAN narxi. Aytilmasa null'),
});

const XomAmal = z.object({
  tur: z.enum(['savdo', 'kirim', 'qarz', 'qarz_tolov', 'chiqim', 'yangi_mahsulot']),
  mahsulotlar: z.array(XomQator).describe('savdo/kirim/yangi_mahsulot uchun. Boshqalarda bo\'sh'),
  mijoz: z.string().nullable().describe('Mijoz ismi, aytilmasa null'),
  telefon: z.string().nullable(),
  summa: z.number().nullable().describe('qarz/qarz_tolov/chiqim uchun summa'),
  tolov_turi: z.enum(['naqd', 'karta', 'qarz', 'aralash']).describe("Aytilmasa 'naqd'"),
  tolangan: z.number().nullable().describe("Qisman to'langan summa, aks holda null"),
  muddat: z.string().nullable().describe("Qarz muddati YYYY-MM-DD, aks holda null"),
  kategoriya: z.string().nullable().describe('Chiqim kategoriyasi yoki mahsulot kategoriyasi'),
  izoh: z.string().nullable(),
});

export const XomBuyruq = z.object({
  amallar: z.array(XomAmal).describe('Gapda nechta amal bo\'lsa shuncha'),
  savol: z.string().nullable()
    .describe("Ma'lumot yetishmasa — do'konchiga beriladigan qisqa savol. Aks holda null"),
});

export type XomBuyruqT = z.infer<typeof XomBuyruq>;
export type XomAmalT = z.infer<typeof XomAmal>;

export interface ExtractResult {
  xom: XomBuyruqT;
  usage: { input: number; output: number };
}

/** Erkin matnni bitta Groq chaqiruvida JSON ga o'giradi. */
export async function extractCommand(text: string): Promise<ExtractResult> {
  const bugun = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Tashkent' });

  const system = `Do'kon CRM uchun o'zbekcha gapni JSON ga o'girasan.
BUGUN: ${bugun} (Asia/Tashkent). Pul: so'm. "ming"=1000, "million"=1000000. "kilo"→kg.

QOIDALAR:
1. Faqat gapda AYTILGANINI yoz. Narx aytilmasa narx=null — TAXMIN QILMA,
   bazadagi narx keyin o'zi qo'yiladi. Bu xato emas.
2. Mahsulot nomini o'zgartirmay ko'chir ("kolbasa" → "kolbasa"), to'ldirma.
3. Miqdor aytilmasa 1. To'lov turi aytilmasa "naqd".
4. Bir gapda bir necha amal bo'lsa — har biri alohida element.
5. savol: faqat ASOSIY narsa yetishmasa to'ldiriladi (masalan "qarz berdim"
   deyilgan-u, kim va qancha aytilmagan). Narxning yo'qligi savol EMAS.`;

  const res = await groqCall((c) => c.chat.completions.create({
    model: TEXT_MODEL,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: text },
    ],
    temperature: 0,
    // Chiqish qisqa JSON. Groq max_tokens ni limitdan OLDINDAN band qiladi,
    // shuning uchun uni kichik tutamiz.
    max_tokens: 900,
    reasoning_effort: 'low',
    response_format: {
      type: 'json_schema',
      json_schema: {
        name: 'buyruq',
        strict: true,
        schema: jsonSchema(XomBuyruq, 'output') as any,
      },
    },
  }));

  const raw = res.choices[0]?.message?.content ?? '{}';
  let xom: XomBuyruqT;
  try {
    xom = XomBuyruq.parse(JSON.parse(raw));
  } catch (e) {
    throw aiError(new Error("Buyruq tushunilmadi. Boshqacha yozib ko'ring."));
  }

  return {
    xom: { ...xom, amallar: birlashtir(xom.amallar) },
    usage: {
      input: res.usage?.prompt_tokens ?? 0,
      output: res.usage?.completion_tokens ?? 0,
    },
  };
}

/**
 * Ketma-ket kelgan bir xil turdagi savdo/kirimlarni bitta amalga qo'shadi.
 *
 * Do'konchi ro'yxat yozganda ("kartoshka 10 kg / non 5 ta / tuxum 10 ta") model
 * ko'pincha har qatorni ALOHIDA savdo qilib beradi — u holda bazaga uchta
 * chek tushardi, aslida bu bitta savdo. Buni promptga ishonib qo'ymaymiz:
 * shart aniq, shuning uchun kodda birlashtiramiz.
 *
 * Faqat mijoz, to'lov turi va to'langan summa bir xil bo'lsa qo'shiladi —
 * "Alisherga qarzga" va "naqd" savdolar aralashib ketmasin.
 */
function birlashtir(amallar: XomAmalT[]): XomAmalT[] {
  const out: XomAmalT[] = [];

  for (const a of amallar) {
    const oxirgi = out[out.length - 1];
    const qoshsaBoladi =
      oxirgi !== undefined
      && (a.tur === 'savdo' || a.tur === 'kirim')
      && oxirgi.tur === a.tur
      && oxirgi.mijoz === a.mijoz
      && oxirgi.tolov_turi === a.tolov_turi
      && oxirgi.tolangan === a.tolangan;

    if (qoshsaBoladi) {
      oxirgi.mahsulotlar.push(...a.mahsulotlar);
      oxirgi.izoh ??= a.izoh;
    } else {
      out.push({ ...a, mahsulotlar: [...a.mahsulotlar] });
    }
  }

  return out;
}
