/**
 * Telefon raqami — O'zbekiston.
 *
 * Ilova ichida raqam ikki ko'rinishda yuradi va bu ikkalasi hech qachon
 * aralashmasligi kerak:
 *
 *   - MILLIY   — faqat 9 xona, "901234567". Kirish maydonlari shuni ushlaydi.
 *   - TO'LIQ   — "+998901234567". Serverga faqat shu yuboriladi.
 *
 * Nega `+998` maydonga yozilmaydi? Do'konchilarning hammasi bitta
 * mamlakatda. Kodni har safar qo'lda terish ortiqcha ish edi va eng ko'p
 * uchraydigan xato manbai ham o'sha edi: "998 90...", "8 90...",
 * "+99890..." — har biri bazada boshqa qator bo'lib tushardi. Endi kod
 * maydonning chapida o'zgarmas matn bo'lib turadi.
 */

/** O'zbekiston kodi. */
export const KOD = '+998';

/** Milliy qism uzunligi: 90 123 45 67 */
export const XONA = 9;

/**
 * Har qanday yozuvdan milliy 9 xonani ajratadi.
 * "+998 90 123 45 67", "998901234567", "8901234567" → "901234567"
 */
export function milliy(raw: string): string {
  const d = String(raw ?? '').replace(/[^0-9]/g, '');
  return d.length > XONA ? d.slice(-XONA) : d;
}

/** Serverga yuboriladigan shakl: "901234567" → "+998901234567". */
export function toliq(raw: string): string {
  return KOD + milliy(raw);
}

/** Ko'rinish uchun bo'laklarga ajratadi: "901234567" → "90 123 45 67". */
export function chiroyli(raw: string): string {
  const d = milliy(raw);
  return [d.slice(0, 2), d.slice(2, 5), d.slice(5, 7), d.slice(7, 9)]
    .filter(Boolean)
    .join(' ');
}

/** Raqam to'liq terilganmi? */
export function toliqmi(raw: string): boolean {
  return milliy(raw).length === XONA;
}
