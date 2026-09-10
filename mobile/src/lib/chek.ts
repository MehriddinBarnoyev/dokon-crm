/**
 * CHEK.
 *
 * Do'konchidan eng ko'p so'raladigan narsa: "chek beringchi". Ilgari
 * savdo yozilgandan keyin faqat "yozildi" degan xabar chiqardi va
 * xaridorga ko'rsatadigan hech narsa qolmasdi.
 *
 * IKKI MANBA. Chek savdo saqlanganda SAVATDAN yig'iladi — serverdan
 * qayta so'ramaydi. Sabab: do'konda internet uzilib turadi va savdo
 * navbatga tushishi mumkin, chek esa xaridor ketguncha kerak. Eski
 * savdoning cheki esa savdolar ro'yxatidagi yozuvdan tiklanadi.
 *
 * QAYERDA SAQLANADI. Ekranlar orasida uzun JSON ni manzil qatorida
 * uzatish noqulay va cheklangan, shuning uchun tayyor chek shu modulda
 * turadi va `/chek` ekrani uni shu yerdan oladi.
 */
import type { PaymentMethod } from '../api/types';
import { money, qty as fq } from '../theme';

export interface ChekQator {
  nom: string;
  miqdor: number;
  birlik: string;
  narx: number;
  summa: number;
}

export interface Chek {
  /** Qisqa raqam — xaridor va do'konchi bir-biriga ko'rsatishi uchun. */
  raqam: string;
  dokon: string;
  /** ISO. Ekranda ham, PDF da ham shundan chiqariladi. */
  sana: string;
  sotuvchi: string | null;
  mijoz: string | null;
  qatorlar: ChekQator[];
  jami: number;
  tolangan: number;
  /** `jami - tolangan`, manfiy bo'lmaydi. */
  qarz: number;
  usul: PaymentMethod;
  /**
   * Aralash to'lovda to'langan qismning taqsimoti. Bazada bunday ustun
   * yo'q (hisobot naqd bilan kartani ajratmaydi), lekin XARIDOR uchun bu
   * muhim: "kartadan qancha o'tdi?" degan savol chek qo'lda turganda
   * beriladi. Ikkalasi ham bo'sh bo'lsa chekda ko'rsatilmaydi.
   */
  naqd?: number;
  karta?: number;
  /**
   * Serverga yetib bordimi. `false` — savdo navbatda: chek haqiqiy,
   * lekin raqami qurilmaniki. Buni chekda ham aytamiz, aks holda
   * do'konchi ikki xil raqamni ko'rib chalkashardi.
   */
  yuborildi: boolean;
}

/** Aralash to'lovda naqd/karta qatorlari. Aks holda bo'sh satr. */
function taqsimotQatorlari(c: Chek): Array<[string, number]> {
  if (c.usul !== 'aralash') return [];
  const r: Array<[string, number]> = [];
  if (c.naqd && c.naqd > 0) r.push(['— naqd', c.naqd]);
  if (c.karta && c.karta > 0) r.push(['— karta', c.karta]);
  // Bitta qator qolsa taqsimot ko'rsatishning ma'nosi yo'q: u
  // "To'landi" bilan bir xil raqamni takrorlagan bo'lardi.
  return r.length > 1 ? r : [];
}

export const TOLOV_NOMI: Record<PaymentMethod, string> = {
  naqd: 'Naqd',
  karta: 'Karta',
  qarz: 'Qarz',
  aralash: 'Aralash',
};

/**
 * uuid dan qisqa raqam: oxirgi 6 belgi, katta harflarda.
 *
 * Nega oxiridan: uuid v4 ning boshi vaqtga bog'liq emas, lekin oxirgi
 * bo'lagi butunlay tasodifiy — bir kunda yozilgan cheklar bir-biridan
 * ishonchli farq qiladi.
 */
export function chekRaqami(id: string): string {
  return id.replace(/-/g, '').slice(-6).toUpperCase();
}

/* ------------------------- Ekranlar orasidagi qutı ------------------------- */

let oxirgi: Chek | null = null;

export function saqla(c: Chek) { oxirgi = c; }
export function ol(): Chek | null { return oxirgi; }

/* --------------------------------- PDF ---------------------------------- */

/** HTML ga tushib qolmasin: nom ichida `&`, `<` bo'lishi mumkin. */
function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function sanaMatni(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()}`
    + ` ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/**
 * Chekning HTML ko'rinishi — `expo-print` shundan PDF yasaydi.
 *
 * Kenglik 80 mm li kassa qog'ozi o'lchamida (226 punkt): telefonda
 * o'qishga ham qulay, termal printerga ham to'g'ri keladi. Shrift —
 * monospace: raqamlar ustma-ust tushib, summani ko'z bilan tekshirish
 * oson bo'ladi.
 */
export function chekHtml(c: Chek): string {
  const chiziq = '<div class="ch"></div>';
  const qator = (chap: string, ong: string, kalin = false) =>
    `<div class="r${kalin ? ' b' : ''}"><span>${esc(chap)}</span><span>${esc(ong)}</span></div>`;

  const mahsulotlar = c.qatorlar.map((q) => `
    <div class="item">
      <div class="nom">${esc(q.nom)}</div>
      <div class="r">
        <span>${fq(q.miqdor)} ${esc(q.birlik)} × ${money(q.narx)}</span>
        <span>${money(q.summa)}</span>
      </div>
    </div>`).join('');

  return `<!doctype html><html><head><meta charset="utf-8">
<style>
  @page { margin: 0; }
  /* Android'da "Courier New" yo'q — Droid Sans Mono ga tushadi. Ro'yxat
     ataylab to'liq: fallback boshqa o'lchamda bo'lsa chek ikkinchi
     varaqqa oshib ketardi. */
  body { margin: 0; padding: 14px 12px;
         font-family: "Courier New", "Droid Sans Mono", "Roboto Mono", monospace;
         font-size: 11px; color: #000; }
  /* "Chop etish" tizim oynasi qog'oz o'lchamini O'ZI tanlaydi (odatda
     Letter yoki A4) va bizning kenglik sozlamamizni e'tiborsiz qoldiradi.
     Chegarasiz chek butun varaq bo'ylab cho'zilib, chekka o'xshamay
     qolardi. 80 mm — kassa qog'ozi kengligi; PDF varag'i ham shuncha,
     ya'ni u yerda hech narsa o'zgarmaydi. */
  .chek { max-width: 80mm; margin: 0 auto; }
  .mark { text-align: center; font-size: 15px; font-weight: bold;
          letter-spacing: .5px; margin-bottom: 2px; }
  .sub  { text-align: center; font-size: 10px; margin-bottom: 8px; }
  .ch   { border-top: 1px dashed #000; margin: 7px 0; }
  .r    { display: flex; justify-content: space-between; gap: 8px; line-height: 1.5; }
  .r.b  { font-weight: bold; font-size: 13px; }
  .item { margin: 5px 0; }
  .nom  { font-weight: bold; }
  .oxir { text-align: center; font-size: 10px; margin-top: 10px; }
  .ogoh { text-align: center; font-size: 10px; margin-top: 6px; font-weight: bold; }
</style></head><body>
<div class="chek">
  <div class="mark">${esc(c.dokon)}</div>
  <div class="sub">CHEK № ${esc(c.raqam)}</div>
  ${chiziq}
  ${qator('Sana', sanaMatni(c.sana))}
  ${c.sotuvchi ? qator('Sotuvchi', c.sotuvchi) : ''}
  ${c.mijoz ? qator('Mijoz', c.mijoz) : ''}
  ${chiziq}
  ${mahsulotlar}
  ${chiziq}
  ${qator('JAMI', `${money(c.jami)} so'm`, true)}
  ${qator("To'lov", TOLOV_NOMI[c.usul])}
  ${c.tolangan !== c.jami ? qator("To'landi", `${money(c.tolangan)} so'm`) : ''}
  ${taqsimotQatorlari(c).map(([nom, summa]) =>
      qator(nom, `${money(summa)} so'm`)).join('')}
  ${c.qarz > 0 ? qator('QARZ QOLDI', `${money(c.qarz)} so'm`, true) : ''}
  ${chiziq}
  <div class="oxir">Xaridingiz uchun rahmat!</div>
  ${c.yuborildi ? '' : '<div class="ogoh">Savdo navbatda — ulanish tiklanganda yuboriladi</div>'}
</div>
</body></html>`;
}

/**
 * PDF varag'ining o'lchami — punktda (1/72 dyuym), `expo-print` shunday
 * kutadi (uning sukut qiymati 612×792 — bu Letter formati punktda).
 *
 * Balandlik qatorlar soniga qarab hisoblanadi, chunki chek BIR varaqqa
 * sig'ishi kerak: qat'iy balandlik qo'yilsa uzun savdo ikkinchi varaqqa
 * oshib ketardi, kalta savdoda esa yarim varaq bo'sh qolardi.
 *
 * Raqamlar taxmin emas — chek HTML'i brauzerda o'lchab chiqarilgan
 * (bo'sh chek 179px, har mahsulot ~34px, sotuvchi/mijoz qatori 16px,
 * qarz bloki 36px, navbat ogohlantirishi 17px; 96dpi → punktga ×0.75).
 * Ustiga ~10% zaxira qo'shilgan: qurilmada shrift boshqacha bo'lsa
 * matn biroz balandroq chiqishi mumkin.
 */
export function pdfOlchami(c: Chek): { width: number; height: number } {
  const asos = 148;                       // sarlavha, sana bloki, yakun
  const qatorBalandligi = 28;             // bir mahsulot: nomi + narx qatori
  const qoshimcha = (c.sotuvchi ? 13 : 0) + (c.mijoz ? 13 : 0)
    + (c.qarz > 0 ? 30 : 0) + (c.yuborildi ? 0 : 15)
    // Aralash to'lovning naqd/karta qatorlari — har biri bitta satr.
    + taqsimotQatorlari(c).length * 13
    // "To'landi" qatori faqat to'liq to'lanmaganda chiqadi.
    + (c.tolangan !== c.jami ? 13 : 0);
  return {
    width: 226,                           // 80 mm — kassa qog'ozi kengligi
    height: asos + qoshimcha + c.qatorlar.length * qatorBalandligi,
  };
}
