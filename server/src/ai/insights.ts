/**
 * SAVDO TAHLILI VA MASLAHAT
 * ==========================
 * Bazadan raqamlarni O'ZIMIZ yig'amiz va modelga tayyor holda beramiz.
 * Nega? AI'ga bazani o'zi kovlashiga ruxsat bersak, sekin va qimmat bo'ladi;
 * bu yerda esa kerakli raqamlar oldindan ma'lum. AI ishi — raqamlardan
 * do'konchiga foydali xulosa chiqarish.
 */
import { one, query } from '../db.js';
import { TEXT_MODEL, aiError, groqCall, stripThinking } from './client.js';

export interface InsightResult {
  summary: string;
  data: Record<string, unknown>;
  usage: { input: number; output: number };
}

/** Tahlil uchun kerakli barcha raqamlarni bitta joyga yig'adi. */
export async function collectStats(shopId: string, days = 30) {
  const [daily, top, slow, debtors, inventory, expenses] = await Promise.all([
    query(
      `SELECT day, sales_total, cash_in, expense_total, net_profit, sales_count
         FROM daily_summary
        WHERE shop_id = $1
          AND day > (now() AT TIME ZONE 'Asia/Tashkent')::date - $2::int
        ORDER BY day DESC`, [shopId, days]),

    query(
      `SELECT si.name_snap AS nom, si.unit AS birlik,
              SUM(si.qty) AS sotilgan,
              SUM(si.subtotal) AS tushum,
              SUM(si.subtotal - si.qty * si.cost_price) AS foyda
         FROM sale_items si JOIN sales s ON s.id = si.sale_id
        WHERE s.shop_id = $1 AND s.created_at > now() - ($2::int || ' days')::interval
        GROUP BY 1, 2 ORDER BY tushum DESC LIMIT 10`, [shopId, days]),

    // Qimmatga tushib turgan, lekin sotilmayotgan tovar — "o'lik pul"
    query(
      `SELECT p.name AS nom, p.stock AS qoldiq, p.unit AS birlik,
              (p.stock * p.cost_price) AS bogliq_pul,
              COALESCE(sold.qty, 0) AS sotilgan
         FROM products p
         LEFT JOIN (
           SELECT si.product_id, SUM(si.qty) AS qty
             FROM sale_items si JOIN sales s ON s.id = si.sale_id
            WHERE s.shop_id = $1 AND s.created_at > now() - ($2::int || ' days')::interval
            GROUP BY si.product_id
         ) sold ON sold.product_id = p.id
        WHERE p.shop_id = $1 AND p.is_active AND p.stock > 0
        ORDER BY (p.stock * p.cost_price) DESC, COALESCE(sold.qty, 0) ASC
        LIMIT 10`, [shopId, days]),

    query(
      `SELECT name AS mijoz, balance AS qarz, nearest_due AS muddat,
              (nearest_due < CURRENT_DATE) AS muddati_otgan
         FROM customer_balances
        WHERE shop_id = $1 AND balance > 0
        ORDER BY balance DESC LIMIT 15`, [shopId]),

    one(
      `SELECT COUNT(*) AS mahsulot_soni,
              COALESCE(SUM(stock * cost_price), 0) AS ombor_qiymati,
              COUNT(*) FILTER (WHERE stock <= 0) AS tugagan,
              COUNT(*) FILTER (WHERE stock <= min_stock AND stock > 0) AS tugayotgan
         FROM products WHERE shop_id = $1 AND is_active`, [shopId]),

    query(
      `SELECT category AS kategoriya, SUM(amount) AS summa
         FROM expenses
        WHERE shop_id = $1 AND created_at > now() - ($2::int || ' days')::interval
        GROUP BY 1 ORDER BY summa DESC LIMIT 10`, [shopId, days]),
  ]);

  return { kunlar: daily, top_mahsulotlar: top, sekin_ketayotgan: slow,
           qarzdorlar: debtors, ombor: inventory, chiqimlar: expenses };
}

/**
 * @param question Do'konchining aniq savoli. Bo'sh bo'lsa — umumiy sharh.
 */
export async function analyze(
  shopId: string,
  shopName: string,
  days = 30,
  question?: string,
): Promise<InsightResult> {
  const data = await collectStats(shopId, days);

  const hasData =
    (data.kunlar as unknown[]).length > 0 || (data.qarzdorlar as unknown[]).length > 0;
  if (!hasData) {
    return {
      summary: 'Hali yetarli ma\'lumot yo\'q. Bir necha kun savdo yozilgach tahlil qila olaman.',
      data,
      usage: { input: 0, output: 0 },
    };
  }

  const bugun = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Tashkent' });

  let res;
  try {
    res = await groqCall((c) => c.chat.completions.create({
      model: TEXT_MODEL,
      temperature: 0.3,
      max_tokens: 2048,
      messages: [
        {
          role: 'system',
          content:
            `Sen "${shopName}" do'koni egasining biznes maslahatchisisan. Bugun: ${bugun}.\n`
            + "Senga do'konning haqiqiy raqamlari JSON ko'rinishida beriladi.\n\n"
            + 'QOIDALAR:\n'
            + "1. Faqat berilgan raqamlarga tayan. Raqam to'qib chiqarma.\n"
            + '2. Eng muhim 3-5 xulosani ayt — hammasini sanab chiqma.\n'
            + '3. Har bir xulosaga aniq harakat taklif qil ("Falon tovarni buyurtma qiling", '
            + '"Falonchidan qarzni undiring") — quruq kuzatuv emas.\n'
            + "4. Pul summalarini so'mda, ming ajratgichi bilan yoz.\n"
            + "5. O'zbek tilida, sodda, do'konchi tiliga yaqin yoz. Markdown sarlavha "
            + 'ishlatma, oddiy qatorlar va "—" bilan ro\'yxat qil.',
        },
        {
          role: 'user',
          content:
            (question
              ? `Savol: ${question}\n\n`
              : `So'nggi ${days} kunlik holatga qisqa sharh ber.\n\n`)
            + `Do'kon ma'lumotlari:\n${JSON.stringify(data, null, 1)}`,
        },
      ],
    }));
  } catch (e) {
    throw aiError(e);
  }

  return {
    summary: stripThinking(res.choices[0]?.message?.content ?? ''),
    data,
    usage: {
      input: res.usage?.prompt_tokens ?? 0,
      output: res.usage?.completion_tokens ?? 0,
    },
  };
}
