/**
 * NOMNI BAZAGA BOG'LASH — sof SQL, AI'siz
 * =========================================
 * AI faqat "kolbasa, 2 ta" deb yozib beradi. Qaysi kolbasa ekanini shu yer
 * hal qiladi: `dokon_search_products` (db/003-search-staged.sql) bilan.
 *
 * Qoida sodda va oldindan aytsa bo'ladigan:
 *   • bitta moslik        → o'zi tanlanadi. Nom xato yozilgan bo'lsa
 *                           ("kartoska" → Kartoshka) qanday tushunilgani
 *                           ogohlantirishda aytiladi;
 *   • bir nechta moslik   → HAMMASI ro'yxat qilib qaytariladi, do'konchi
 *                           o'zi tanlaydi (rasm bo'lsa rasm bilan);
 *   • hech narsa topilmasa → ogohlantirish, savdo baribir yoziladi, lekin
 *                           ombor qoldig'iga tegmaydi.
 *
 * "Sirliy kolbasa" va "Doktorskiy kolbasa" bor bo'lsa, "kolbasa" so'ziga
 * ikkalasi ham chiqadi — bittasini AI o'zicha tanlab qo'ymaydi.
 */
import { query } from '../db.js';
import { ActionSchema, type Action, type Unit } from './actions.js';
import type { XomAmalT, XomBuyruqT } from '../ai/extract.js';

const fmt = (n: number) => new Intl.NumberFormat('uz-UZ').format(Math.round(n));
/** Miqdor: 2 → "2", 2.5 → "2,5" (butun songa keraksiz ",00" qo'shilmaydi). */
const son = (n: number) => new Intl.NumberFormat('uz-UZ', { maximumFractionDigits: 3 }).format(n);

/** Tanlash uchun ko'rsatiladigan variant. */
export interface Nomzod {
  id: string;
  name: string;
  /* mahsulot maydonlari */
  unit?: Unit;
  sale_price?: number;
  cost_price?: number;
  stock?: number;
  photo_url?: string | null;
  /* mijoz maydonlari */
  phone?: string | null;
  balance?: number;
}

/** Do'konchi tanlashi kerak bo'lgan joy. */
export interface Tanlov {
  /** `actions[]` dagi indeks. */
  amal: number;
  /** `items[]` dagi indeks; mijoz uchun -1. */
  qator: number;
  nima: 'mahsulot' | 'mijoz';
  /** Do'konchi yozgan so'z: "kolbasa". */
  soralgan: string;
  /** Aniq moslik topilmadi — bular shunchaki o'xshashlari. */
  taxminiy: boolean;
  nomzodlar: Nomzod[];
}

export interface ResolveResult {
  actions: Action[];
  tanlovlar: Tanlov[];
  warnings: string[];
  summary: string;
}

interface ProductRow {
  id: string; name: string; unit: Unit;
  cost_price: string | number; sale_price: string | number; stock: string | number;
  photo_url: string | null; taxminiy: boolean;
}

interface CustomerRow {
  id: string; name: string; phone: string | null;
  balance: string | number; taxminiy: boolean;
}

const n = (v: string | number | null | undefined) => Number(v ?? 0);

async function qidirMahsulot(shopId: string, nom: string): Promise<ProductRow[]> {
  return query<ProductRow>(
    `SELECT id, name, unit, cost_price, sale_price, stock, photo_url, taxminiy
       FROM dokon_search_products($1, $2, $3)`, [shopId, nom, 12]);
}

async function qidirMijoz(shopId: string, ism: string): Promise<CustomerRow[]> {
  return query<CustomerRow>(
    `SELECT id, name, phone, balance, taxminiy
       FROM dokon_search_customers($1, $2, $3)`, [shopId, ism, 12]);
}

/**
 * Bitta nomzod qolsa — o'sha. Ikki va undan ko'p bo'lsa — do'konchi tanlaydi.
 *
 * Bitta nomzod taxminiy (xato yozilgan nom) bo'lsa ham o'zi olinadi: bitta
 * variantni ro'yxat qilib ko'rsatish do'konchini bekorga to'xtatadi. Buning
 * o'rniga nima deb tushunilgani ogohlantirishda aytiladi.
 */
function yagona(rows: ProductRow[]): ProductRow | null {
  return rows.length === 1 ? rows[0] : null;
}

const mahsulotNomzod = (p: ProductRow): Nomzod => ({
  id: p.id, name: p.name, unit: p.unit,
  sale_price: n(p.sale_price), cost_price: n(p.cost_price),
  stock: n(p.stock), photo_url: p.photo_url,
});

const mijozNomzod = (c: CustomerRow): Nomzod => ({
  id: c.id, name: c.name, phone: c.phone, balance: n(c.balance),
});

/**
 * Xom buyruqni bajariladigan amallarga aylantiradi.
 * Hech qanday AI chaqirilmaydi — faqat baza.
 */
export async function resolveCommand(
  shopId: string,
  xom: XomBuyruqT,
): Promise<ResolveResult> {
  const actions: Action[] = [];
  const tanlovlar: Tanlov[] = [];
  const warnings: string[] = [];
  const satrlar: string[] = [];

  for (const amal of xom.amallar) {
    const i = actions.length;                       // shu amalning indeksi
    const tayyor = await amalniYig(shopId, amal, i, tanlovlar, warnings, satrlar);
    if (tayyor) actions.push(tayyor);
  }

  const summary = satrlar.length
    ? satrlar.join('\n')
    : (xom.savol ?? "Buyruq tushunilmadi. Boshqacha yozib ko'ring.");

  return { actions, tanlovlar, warnings, summary };
}

async function amalniYig(
  shopId: string,
  a: XomAmalT,
  amalIndex: number,
  tanlovlar: Tanlov[],
  warnings: string[],
  satrlar: string[],
): Promise<Action | null> {
  /** Mijoz nomini bazadagi mijozga bog'laydi. */
  async function mijoz(): Promise<{ id: string | null; name: string | null }> {
    if (!a.mijoz) return { id: null, name: null };
    const rows = await qidirMijoz(shopId, a.mijoz);

    if (rows.length === 0) return { id: null, name: a.mijoz };   // yangi mijoz ochiladi
    if (rows.length === 1) {
      if (rows[0].taxminiy) warnings.push(`"${a.mijoz}" → "${rows[0].name}" deb tushunildi.`);
      return { id: rows[0].id, name: rows[0].name };
    }
    tanlovlar.push({
      amal: amalIndex, qator: -1, nima: 'mijoz',
      soralgan: a.mijoz, taxminiy: Boolean(rows[0].taxminiy),
      nomzodlar: rows.map(mijozNomzod),
    });
    return { id: null, name: a.mijoz };
  }

  switch (a.tur) {
    /* ------------------------------- SAVDO ------------------------------- */
    case 'savdo': {
      if (a.mahsulotlar.length === 0) return null;
      const m = await mijoz();
      const items: any[] = [];
      const lines: string[] = [];
      let jami = 0;

      for (const q of a.mahsulotlar) {
        const rows = await qidirMahsulot(shopId, q.nom);
        const aniq = yagona(rows);

        if (rows.length === 0) {
          warnings.push(`"${q.nom}" bazada topilmadi — ombor qoldig'i o'zgarmaydi.`);
        } else if (!aniq) {
          tanlovlar.push({
            amal: amalIndex, qator: items.length, nima: 'mahsulot',
            soralgan: q.nom, taxminiy: Boolean(rows[0].taxminiy),
            nomzodlar: rows.map(mahsulotNomzod),
          });
        } else if (aniq.taxminiy) {
          warnings.push(`"${q.nom}" → "${aniq.name}" deb tushunildi.`);
        }

        const narx = q.narx ?? (aniq ? n(aniq.sale_price) : 0);
        if (aniq && narx === 0) warnings.push(`"${aniq.name}" uchun sotuv narxi belgilanmagan.`);
        if (aniq && n(aniq.stock) < q.miqdor) {
          warnings.push(
            `"${aniq.name}": omborda ${son(n(aniq.stock))} ${aniq.unit}, `
            + `sotilmoqchi ${son(q.miqdor)} ${aniq.unit} — yetmaydi.`);
        }

        const birlik: Unit = aniq?.unit ?? (q.birlik ?? 'dona');
        items.push({
          product_id: aniq?.id ?? null,
          name: aniq?.name ?? q.nom,
          unit: birlik,
          qty: q.miqdor,
          unit_price: narx,
        });
        jami += q.miqdor * narx;
        lines.push(aniq
          ? `${son(q.miqdor)} ${birlik} ${aniq.name} × ${fmt(narx)} = ${fmt(q.miqdor * narx)} so'm`
          : `${son(q.miqdor)} ${birlik} ${q.nom} — mahsulotni tanlang`);
      }

      satrlar.push(`Savdo:\n${lines.join('\n')}\nJami: ${fmt(jami)} so'm`
        + (m.name ? `\nMijoz: ${m.name}` : ''));

      return ActionSchema.parse({
        type: 'sale', items,
        customer_id: m.id, customer_name: m.name,
        payment_method: a.tolov_turi, paid: a.tolangan, note: a.izoh,
      });
    }

    /* ------------------------------- KIRIM ------------------------------- */
    case 'kirim': {
      if (a.mahsulotlar.length === 0) return null;
      const items: any[] = [];
      const lines: string[] = [];
      let jami = 0;

      for (const q of a.mahsulotlar) {
        const rows = await qidirMahsulot(shopId, q.nom);
        const aniq = yagona(rows);

        if (rows.length === 0) {
          warnings.push(`"${q.nom}" yangi mahsulot sifatida ochiladi.`);
        } else if (!aniq) {
          tanlovlar.push({
            amal: amalIndex, qator: items.length, nima: 'mahsulot',
            soralgan: q.nom, taxminiy: Boolean(rows[0].taxminiy),
            nomzodlar: rows.map(mahsulotNomzod),
          });
        } else if (aniq.taxminiy) {
          warnings.push(`"${q.nom}" → "${aniq.name}" deb tushunildi.`);
        }

        const tan = q.tan_narx ?? q.narx ?? (aniq ? n(aniq.cost_price) : 0);
        if (tan === 0) warnings.push(`"${aniq?.name ?? q.nom}" uchun tan narx ko'rsatilmagan.`);

        const birlik: Unit = aniq?.unit ?? (q.birlik ?? 'dona');
        items.push({
          product_id: aniq?.id ?? null,
          name: aniq?.name ?? q.nom,
          unit: birlik,
          qty: q.miqdor,
          cost_price: tan,
          sale_price: q.narx ?? null,
        });
        jami += q.miqdor * tan;
        lines.push(`${son(q.miqdor)} ${birlik} ${aniq?.name ?? q.nom} × ${fmt(tan)} = ${fmt(q.miqdor * tan)} so'm`);
      }

      satrlar.push(`Omborga kirim:\n${lines.join('\n')}\nJami: ${fmt(jami)} so'm`);
      return ActionSchema.parse({
        type: 'purchase', items, supplier: a.mijoz, note: a.izoh,
      });
    }

    /* -------------------------------- QARZ ------------------------------- */
    case 'qarz': {
      if (!a.mijoz || !a.summa) return null;
      const m = await mijoz();
      satrlar.push(`Qarz: ${m.name} — ${fmt(a.summa)} so'm`
        + (a.muddat ? `, muddat ${a.muddat}` : ''));
      return ActionSchema.parse({
        type: 'debt',
        customer_id: m.id, customer_name: m.name ?? a.mijoz,
        customer_phone: a.telefon, amount: a.summa,
        due_date: a.muddat, note: a.izoh,
      });
    }

    case 'qarz_tolov': {
      if (!a.mijoz || !a.summa) return null;
      const m = await mijoz();
      if (!m.id && !tanlovlar.some((t) => t.amal === amalIndex && t.nima === 'mijoz')) {
        warnings.push(`"${a.mijoz}" bazada topilmadi — qarz to'lovi uchun mijoz kerak.`);
      }
      satrlar.push(`Qarz to'lovi: ${m.name} — ${fmt(a.summa)} so'm`);
      return ActionSchema.parse({
        type: 'debt_payment',
        customer_id: m.id, customer_name: m.name ?? a.mijoz,
        amount: a.summa, note: a.izoh,
      });
    }

    /* ------------------------------- CHIQIM ------------------------------ */
    case 'chiqim': {
      if (!a.summa) return null;
      const kat = a.kategoriya ?? 'boshqa';
      satrlar.push(`Chiqim: ${kat} — ${fmt(a.summa)} so'm`);
      return ActionSchema.parse({
        type: 'expense', category: kat, amount: a.summa, note: a.izoh,
      });
    }

    /* --------------------------- YANGI MAHSULOT -------------------------- */
    case 'yangi_mahsulot': {
      const q = a.mahsulotlar[0];
      if (!q) return null;

      const bor = await qidirMahsulot(shopId, q.nom);
      if (bor[0] && !bor[0].taxminiy
          && bor[0].name.toLowerCase() === q.nom.toLowerCase()) {
        warnings.push(`"${q.nom}" bazada allaqachon bor (qoldiq ${son(n(bor[0].stock))} ${bor[0].unit}).`);
      }

      const birlik: Unit = q.birlik ?? 'dona';
      satrlar.push(`Yangi mahsulot: ${q.nom} — ${fmt(q.narx ?? 0)} so'm/${birlik}`);
      return ActionSchema.parse({
        type: 'create_product',
        name: q.nom, unit: birlik,
        cost_price: q.tan_narx ?? 0, sale_price: q.narx ?? 0,
        stock: q.miqdor, category: a.kategoriya,
      });
    }
  }

  return null;
}
