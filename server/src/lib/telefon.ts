/**
 * Telefon raqami — yagona ko'rinish.
 *
 * Ilova (1.9.0 dan boshlab) raqamni doim `+998901234567` shaklida yuboradi:
 * kirish maydonida `+998` o'zgarmas prefiks bo'lib turadi, do'konchi faqat
 * o'zining 9 xonasini yozadi. Shu sababli bazaga ham aynan shu shakl
 * yoziladi.
 *
 * Lekin eski hisoblar bazada boshqacha yotibdi — "998901234567",
 * "90 123 45 67", "+998 90 123 45 67". Ularni ko'chirmaymiz: `users.phone`
 * ustunida UNIQUE bor va normallashtirishda ikkita eski qator bitta
 * raqamga tushib, migratsiya yarim yo'lda to'xtab qolishi mumkin edi.
 * O'rniga QIDIRUV ikki yo'lli: aynan moslik va oxirgi 9 xona bo'yicha
 * ({@link SQL_TEL_MOS}). Shunda eski foydalanuvchi ham, yangi ham kira
 * oladi, hech kim seansidan ayrilmaydi.
 */

/** O'zbekiston kodi. */
export const KOD = '+998';

/** Milliy qism uzunligi: 90 123 45 67 */
export const XONA = 9;

/** Har qanday yozuvdan milliy 9 xonani ajratadi. */
export function telMilliy(raw: string): string {
  const d = String(raw ?? '').replace(/[^0-9]/g, '');
  return d.length > XONA ? d.slice(-XONA) : d;
}

/** Saqlanadigan shakl: "90 123 45 67" → "+998901234567". */
export function telNormal(raw: string): string {
  return KOD + telMilliy(raw);
}

/**
 * `phone` ustunini ikki yo'l bilan taqqoslash uchun WHERE bo'lagi.
 * `$n` — normallashtirilgan raqam, `$n+1` — uning oxirgi 9 xonasi.
 *
 * Ishlatilishi: `WHERE ${SQL_TEL_MOS(1)}` va params = [telNormal(x), telMilliy(x)].
 */
export function SQL_TEL_MOS(n: number): string {
  return `(phone = $${n} OR right(regexp_replace(phone, '[^0-9]', '', 'g'), ${XONA}) = $${n + 1})`;
}

/**
 * Aynan mos kelgan qator birinchi bo'lsin — eski va yangi shakl bir vaqtda
 * bazada bo'lib qolgan holatda to'g'ri hisob tanlanadi.
 */
export function SQL_TEL_TARTIB(n: number): string {
  return `ORDER BY (phone = $${n}) DESC`;
}
