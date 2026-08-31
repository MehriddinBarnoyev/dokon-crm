/**
 * MAHALLIY AQLLI QIDIRUV
 * =======================
 * Savdo ekranida mahsulotlar allaqachon yuklangan bo'ladi, shuning uchun
 * qidiruvni telefonning o'zida qilamiz — natija darhol chiqadi, internet
 * kutilmaydi.
 *
 * Qoidalar serverdagi `dokon_match_score` bilan bir xil (db/002-search.sql):
 * apostrof olib tashlanadi, tinish belgilari bo'sh joyga aylanadi, kirill
 * lotinga o'giriladi, so'zlar alohida taqqoslanadi va xato yozilganiga yo'l
 * qo'yiladi. Ikki joyda bir xil qoida bo'lishi muhim: do'konchi ekranda
 * ko'rgan tartib AI topgani bilan mos tushsin.
 */

const KIRILL_KOP: Array<[RegExp, string]> = [
  [/ё/g, 'yo'], [/ц/g, 'ts'], [/ч/g, 'ch'],
  [/ш/g, 'sh'], [/ю/g, 'yu'], [/я/g, 'ya'],
];

const KIRILL_BIR: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ж: 'j', з: 'z',
  и: 'i', й: 'j', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p',
  р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'x', ъ: '', ы: 'i',
  ь: '', э: 'e', ў: 'o', қ: 'q', ғ: 'g', ҳ: 'h',
};

/** "O'simlik yog'i 1L" → "osimlik yogi 1l" ko'rinishiga keltiradi. */
export function normalize(input: string): string {
  let t = (input ?? '').toLowerCase();
  for (const [re, to] of KIRILL_KOP) t = t.replace(re, to);
  t = t.replace(/[а-яўқғҳ]/g, (c) => KIRILL_BIR[c] ?? c);
  t = t.replace(/[ʻʼ‘’'`´]/g, '');            // apostroflar — o'chiriladi
  t = t.replace(/[-–—(),/[\]_+*"]/g, ' ');    // tinish belgilari — bo'sh joy
  return t.replace(/\s+/g, ' ').trim();       // nuqta ataylab qoldiriladi: "1.5l"
}

/** Ikki so'z orasidagi tahrir masofasi (Levenshtein). */
function distance(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  let cur = new Array<number>(b.length + 1);

  for (let i = 1; i <= a.length; i++) {
    cur[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(cur[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    [prev, cur] = [cur, prev];
  }
  return prev[b.length];
}

/** So'z uzunligiga qarab nechta xatoga yo'l qo'yiladi. */
function tolerance(len: number): number {
  if (len <= 3) return 1;
  if (len <= 7) return 2;
  return 3;
}

/**
 * 1-BOSQICH — ANIQ moslik: aynan, boshlanishi, ichida borligi yoki
 * so'zma-so'z moslik. Taxmin yo'q.
 * Bitta so'rov so'zi ham topilmasa 0 qaytadi.
 */
export function directScore(name: string, queryText: string): number {
  const n = normalize(name);
  const q = normalize(queryText);
  if (!n || !q) return 0;

  if (n === q) return 1;
  if (n.startsWith(q)) return 0.95;
  if (n.includes(q)) return 0.9;

  const nToks = n.split(' ').filter(Boolean);
  const qToks = q.split(' ').filter(Boolean);
  if (qToks.length === 0) return 0;

  let total = 0;
  for (const tok of qToks) {
    let best = 0;
    for (const nt of nToks) {
      if (nt === tok) best = Math.max(best, 1);
      else if (nt.startsWith(tok)) best = Math.max(best, 0.9);
      else if (nt.includes(tok)) best = Math.max(best, 0.75);
    }
    if (best === 0) return 0;      // so'z topilmadi → aniq moslik emas
    total += best;
  }
  return (total / qToks.length) * 0.85;
}

/**
 * 2-BOSQICH — TAXMINIY moslik: xato yozilgan nomlarni ham qamrab oladi.
 * Faqat aniq qidiruv hech narsa topmagandan keyin ishlatiladi.
 */
export function matchScore(name: string, queryText: string): number {
  const direct = directScore(name, queryText);
  if (direct > 0) return direct;

  const n = normalize(name);
  const q = normalize(queryText);
  const nToks = n.split(' ').filter(Boolean);
  const qToks = q.split(' ').filter(Boolean);
  if (qToks.length === 0) return 0;

  let total = 0;
  for (const tok of qToks) {
    let best = 0;
    for (const nt of nToks) {
      if (nt === tok) best = Math.max(best, 1);
      else if (nt.startsWith(tok)) best = Math.max(best, 0.9);
      else if (nt.includes(tok)) best = Math.max(best, 0.75);
      else {
        const d = distance(tok, nt);
        if (d <= tolerance(tok.length)) best = Math.max(best, 0.72 - 0.08 * d);
      }
    }
    total += best;
  }
  return (total / qToks.length) * 0.85;
}

export interface SearchResult<T> {
  items: T[];
  /** true — aniq moslik topilmadi, bular taxminiy variantlar. */
  taxminiy: boolean;
}

/**
 * Ikki bosqichli qidiruv (serverdagi dokon_search_products bilan bir xil):
 * avval aniq moslik, faqat hech narsa topilmasa — o'xshashlari.
 *
 * Shu sabab "sut" yozganda "Suv 5L" chiqmaydi: aniq moslik bor ekan,
 * taxminlar aralashtirilmaydi.
 */
export function search<T>(
  items: T[],
  queryText: string,
  nameOf: (item: T) => string,
  { min = 0.3, limit = 40 }: { min?: number; limit?: number } = {},
): SearchResult<T> {
  if (!queryText.trim()) return { items: items.slice(0, limit), taxminiy: false };

  const rank = (score: (n: string, q: string) => number) =>
    items
      .map((item) => ({ item, s: score(nameOf(item), queryText) }))
      .filter((x) => x.s >= min)
      .sort((a, b) => b.s - a.s || nameOf(a.item).length - nameOf(b.item).length)
      .slice(0, limit)
      .map((x) => x.item);

  const aniq = rank(directScore);
  if (aniq.length > 0) return { items: aniq, taxminiy: false };

  return { items: rank(matchScore), taxminiy: true };
}

/** Faqat ro'yxat kerak bo'lganda qulay qisqartma. */
export function searchBy<T>(
  items: T[],
  queryText: string,
  nameOf: (item: T) => string,
  opts?: { min?: number; limit?: number },
): T[] {
  return search(items, queryText, nameOf, opts).items;
}
