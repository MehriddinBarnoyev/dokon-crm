/**
 * SANA O'QISH — do'konchi yozadigan ko'rinishdan "YYYY-MM-DD" ga.
 *
 * Nega kerak? Eski qog'oz daftardagi qarzlar ilovaga ko'chirilganda har
 * yozuvning o'z sanasi bo'ladi va uni qo'lda kiritish kerak. "2026-08-15"
 * deb yozdirish esa — planshetda 10 ta belgi, har yozuvda. Daftarda esa
 * "15.08" deb yozilgan.
 *
 * Shuning uchun ko'p ko'rinish qabul qilinadi. Nuqtasiz variant ("1508")
 * ataylab: Android raqam klaviaturasida nuqta har doim ham bo'lavermaydi,
 * do'konchi esa klaviatura almashtirib o'tirmasligi kerak.
 */
import { kunKaliti } from '../theme';

function tekshir(yil: number, oy: number, kun: number): string | null {
  const d = new Date(yil, oy - 1, kun);
  // Sana "mavjudmi": 31.02 → 3-mart bo'lib ketadi, uni qabul qilmaymiz.
  if (d.getFullYear() !== yil || d.getMonth() !== oy - 1 || d.getDate() !== kun) return null;
  return kunKaliti(d);
}

/**
 * Qabul qilinadi: "15.08", "15.08.2026", "15/8/26", "15-8", "2026-08-15",
 * shuningdek nuqtasiz "1508", "150826" va "15082026".
 *
 * Yil yozilmasa joriy yil olinadi — daftar ko'chirishda ko'pincha shunday.
 * Tushunarsiz matn uchun `null` — chaqiruvchi buni foydalanuvchiga aytadi.
 */
export function sanaOqi(matn: string): string | null {
  const t = matn.trim();
  if (!t) return null;

  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t);
  if (iso) return tekshir(+iso[1], +iso[2], +iso[3]);

  const m = /^(\d{1,2})[./-](\d{1,2})(?:[./-](\d{2}|\d{4}))?$/.exec(t)
    // kkoo / kkooyy / kkooyyyy
    ?? /^(\d{2})(\d{2})(\d{4}|\d{2})?$/.exec(t);
  if (!m) return null;

  let yil = m[3] ? Number(m[3]) : new Date().getFullYear();
  if (yil < 100) yil += 2000;
  return tekshir(yil, Number(m[2]), Number(m[1]));
}

/** "2026-08-15" + 7 kun → "2026-08-22". */
export function qoshKun(iso: string, kun: number): string {
  const [y, o, k] = iso.split('-').map(Number);
  return kunKaliti(new Date(y, o - 1, k + kun));
}
