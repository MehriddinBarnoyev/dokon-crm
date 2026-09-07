/**
 * MAHSULOTLAR OMBORI (mijoz tomonida).
 *
 * Muammo: ilova har harfda `/products?search=` ga so'rov yuborardi,
 * savdo ekrani ochilganda esa 300 ta mahsulotni qaytadan tortardi.
 * Do'konda internet sekin va o'lchovli — bu qimmatga tushardi.
 *
 * Yechim: mahsulotlar bir marta yuklanadi va shifrlangan holda
 * qurilmada saqlanadi. Keyin faqat O'ZGARGANI olinadi
 * (`GET /sync/products?since=`). Qidiruv butunlay qurilmada bajariladi.
 *
 * KURSOR SILJISHI. `updated_at` — tranzaksiya boshlangan vaqt, shuning
 * uchun kech commit bo'lgan qator erta timestamp bilan yozilib, oddiy
 * `> T` shartidan tushib qolishi mumkin. Buning oldini olish uchun
 * kursor bir necha soniya orqaga suriladi; takroriy qatorlar `id`
 * bo'yicha ustma-ust yozilgani uchun zarar qilmaydi.
 */
import { api } from '../api/client';
import type { Product, Unit } from '../api/types';
import type { Filters, FilterOptions } from '../components/FilterSheet';
import * as cache from '../lib/cache';
import { search } from '../lib/search';

/** Server javobidagi qo'shimcha maydonlar bilan. */
interface SyncProduct extends Product {
  is_active: boolean;
  updated_at: string;
  created_at: string;
}

interface Snapshot {
  /** Serverning oxirgi bergan vaqti — keyingi so'rov shundan boshlanadi. */
  cursor: string | null;
  products: Product[];
}

const NOM = 'products';

/** Kursorni shuncha orqaga suramiz — yuqoridagi izohga qarang. */
const SLACK_MS = 5000;

/** Cache shundan eski bo'lsa fon sync ishga tushadi. */
const YANGILASH_MS = 60_000;

let snapshot: Snapshot | null = null;
let shopId: string | null = null;
let oxirgiSync = 0;
/** Bir vaqtda bitta sync — ekranlar bir zumda ochilsa takrorlanmasin. */
let ketayotgan: Promise<void> | null = null;

/** Do'kon almashganda (kirish/chiqish) chaqiriladi. */
export function setShop(id: string | null) {
  if (id === shopId) return;
  shopId = id;
  snapshot = null;
  oxirgiSync = 0;
  ketayotgan = null;
}

/**
 * Cache'dagi ro'yxat. Server kutilmaydi — ekran darhol chiziladi.
 * Hech narsa bo'lmasa bo'sh massiv qaytadi va `sync()` uni to'ldiradi.
 */
export async function load(): Promise<Product[]> {
  if (!shopId) return [];
  if (snapshot) return snapshot.products;

  const saqlangan = await cache.read<Snapshot>(shopId, NOM);
  snapshot = saqlangan ?? { cursor: null, products: [] };
  return snapshot.products;
}

/**
 * Serverdan o'zgarishlarni oladi.
 *
 * `force` bo'lmasa va oxirgi sync yaqinda bo'lgan bo'lsa — hech narsa
 * qilmaydi. Shu sabab har `useFocusEffect` da chaqirish xavfsiz.
 */
export async function sync(force = false): Promise<Product[]> {
  if (!shopId) return [];
  if (ketayotgan) { await ketayotgan; return snapshot?.products ?? []; }
  if (!force && Date.now() - oxirgiSync < YANGILASH_MS) {
    return snapshot?.products ?? load();
  }

  ketayotgan = (async () => {
    const id = shopId!;
    if (!snapshot) await load();
    const hozirgi = snapshot ?? { cursor: null, products: [] };

    const since = hozirgi.cursor
      ? new Date(new Date(hozirgi.cursor).getTime() - SLACK_MS).toISOString()
      : null;

    const res = await api<{ now: string; more: boolean; products: SyncProduct[] }>(
      `/sync/products${since ? `?since=${encodeURIComponent(since)}` : ''}`);

    // `id` bo'yicha birlashtiramiz: slack tufayli kelgan takrorlar
    // ustma-ust yoziladi, arxivlanganlari esa butunlay chiqib ketadi.
    const map = new Map(hozirgi.products.map((p) => [p.id, p]));
    for (const row of res.products) {
      if (row.is_active === false) { map.delete(row.id); continue; }
      const { is_active, updated_at, ...product } = row;
      map.set(row.id, product);
    }

    snapshot = {
      cursor: res.now,
      products: [...map.values()].sort((a, b) => a.name.localeCompare(b.name)),
    };
    oxirgiSync = Date.now();
    await cache.write(id, NOM, snapshot);
  })();

  try {
    await ketayotgan;
  } catch {
    // Internet yo'q — cache'dagi ro'yxat baribir ishlaydi.
    // Keyingi urinish uchun `oxirgiSync` yangilanmaydi.
  } finally {
    ketayotgan = null;
  }

  return snapshot?.products ?? [];
}

/** Cache'ni ko'rsatib, orqadan yangilaydi. Ekranlar shuni chaqiradi. */
export async function loadAndRefresh(
  onUpdate?: (items: Product[]) => void,
): Promise<Product[]> {
  const darhol = await load();
  sync().then((yangi) => {
    // Havola o'zgarmagan bo'lsa qayta render qilishning hojati yo'q.
    if (onUpdate && yangi !== darhol) onUpdate(yangi);
  }).catch(() => {});
  return darhol;
}

/**
 * Qidiruv — SERVERGA BORMAYDI.
 *
 * `src/lib/search.ts` ataylab server'ning `dokon_match_score` bilan
 * bir xil qoidada yozilgan, shuning uchun natija tartibi ilgarigidek
 * qoladi.
 */
export function qidir(items: Product[], q: string, limit = 40) {
  const res = search(items, q, (p) => p.name, { limit });
  // Serverdagi kabi: taxminiy natijalar belgilanadi.
  return res.taxminiy
    ? res.items.map((p) => ({ ...p, taxminiy: true }))
    : res.items;
}

/**
 * Mahsulot o'zgargandan keyin (qo'shildi, tahrirlandi, sotildi)
 * chaqiriladi — keyingi sync darhol o'tsin.
 */
export function invalidate() {
  oxirgiSync = 0;
}

/** Bitta mahsulotni cache'da darhol yangilaydi (optimistik). */
export async function upsert(product: Product): Promise<void> {
  if (!shopId || !snapshot) return;
  const map = new Map(snapshot.products.map((p) => [p.id, p]));
  map.set(product.id, product);
  snapshot = {
    cursor: snapshot.cursor,
    products: [...map.values()].sort((a, b) => a.name.localeCompare(b.name)),
  };
  await cache.write(shopId, NOM, snapshot);
}

/* -------------------------- Mahalliy filtrlash --------------------------- */
/*
 * Ilgari status/kategoriya/birlik/saralash serverda bajarilardi va har
 * o'zgarishda yangi so'rov ketardi. Endi hammasi shu yerda.
 *
 * MUHIM: qoidalar `server/src/routes/products.ts` dagi bilan AYNAN bir
 * xil bo'lishi shart, aks holda bir xil filtr ikki xil natija berardi.
 */

/** `Product` cache'da `created_at` bilan saqlanadi (`yangi` saralashi uchun). */
type Cached = Product & { created_at?: string };

function statusMos(p: Cached, status: Filters['status']): boolean {
  const stock = Number(p.stock);
  const min = Number(p.min_stock);
  if (status === 'tugagan')    return stock <= 0;
  if (status === 'tugayapti')  return stock > 0 && stock <= min;
  if (status === 'bor')        return stock > 0;
  if (status === 'tannarxsiz') return Number(p.cost_price) <= 0;
  return true;
}

const SARALASH: Record<Filters['sort'], (a: Cached, b: Cached) => number> = {
  nom:        (a, b) => a.name.localeCompare(b.name),
  arzon:      (a, b) => Number(a.sale_price) - Number(b.sale_price) || a.name.localeCompare(b.name),
  qimmat:     (a, b) => Number(b.sale_price) - Number(a.sale_price) || a.name.localeCompare(b.name),
  kam_qoldiq: (a, b) => Number(a.stock) - Number(b.stock) || a.name.localeCompare(b.name),
  kop_qoldiq: (a, b) => Number(b.stock) - Number(a.stock) || a.name.localeCompare(b.name),
  yangi:      (a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? ''),
};

/**
 * Qidiruv + filtr + saralash — hammasi qurilmada.
 *
 * Qidiruv bo'lsa tartibni QIDIRUV belgilaydi (mosligi bo'yicha), xuddi
 * serverdagi kabi: `dokon_search_products` natijasiga saralash emas,
 * faqat filtrlar qo'llanadi.
 */
export function filtrla(
  items: Product[],
  q: string,
  f: Filters,
): { items: Product[]; taxminiy: boolean } {
  const filtered = (items as Cached[])
    .filter((p) => statusMos(p, f.status))
    .filter((p) => !f.category || p.category === f.category)
    .filter((p) => !f.unit || p.unit === f.unit);

  if (q.trim()) {
    const res = search(filtered, q, (p) => p.name, { limit: 300 });
    return {
      items: res.taxminiy ? res.items.map((p) => ({ ...p, taxminiy: true })) : res.items,
      taxminiy: res.taxminiy,
    };
  }

  return { items: [...filtered].sort(SARALASH[f.sort]), taxminiy: false };
}

/**
 * Filtr oynasi uchun variantlar — ilgari `/products/meta/filters`
 * so'rovi bilan olinardi, endi cache'dan hisoblanadi.
 */
export function filterOptions(items: Product[]): FilterOptions {
  const kat = new Map<string, number>();
  const bir = new Map<Unit, number>();

  for (const p of items) {
    if (p.category) kat.set(p.category, (kat.get(p.category) ?? 0) + 1);
    bir.set(p.unit, (bir.get(p.unit) ?? 0) + 1);
  }

  const soni = (status: Filters['status']) =>
    (items as Cached[]).filter((p) => statusMos(p, status)).length;

  return {
    categories: [...kat.entries()]
      .map(([name, n]) => ({ name, soni: n }))
      .sort((a, b) => b.soni - a.soni || a.name.localeCompare(b.name)),
    units: [...bir.entries()]
      .map(([unit, n]) => ({ unit, soni: n }))
      .sort((a, b) => b.soni - a.soni),
    counts: {
      hammasi: items.length,
      bor: soni('bor'),
      tugayapti: soni('tugayapti'),
      tugagan: soni('tugagan'),
      tannarxsiz: soni('tannarxsiz'),
    },
  };
}
