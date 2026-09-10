/**
 * MIJOZLAR (mijoz tomonida).
 *
 * MUAMMO. `CustomerPicker` har ochilganda `/debts/customers` ga so'rov
 * yuborardi. Savdo yozayotgan do'konchi uchun bu — mijozni tanlashdan
 * oldin har safar kutish, internet yo'q bo'lsa esa BO'SH ro'yxat va
 * "yangi mijoz" dan boshqa iloj yo'q. Natijada ayni mijoz ikki marta
 * ochilib ketardi.
 *
 * YECHIM. `data/products.ts` bilan bir xil yondashuv: ro'yxat shifrlangan
 * keshda turadi, ekran undan DARHOL chiziladi, fon so'rovi esa uni
 * yangilaydi. Qidiruv baribir qurilmada bajarilardi — demak, ro'yxat
 * mahalliy bo'lgani hech narsani buzmaydi.
 *
 * NEGA DELTA-SYNC EMAS. Mahsulotlarda `updated_at` bor va minglab qator
 * bo'lishi mumkin. Mijozlar esa bir do'konda odatda yuzlab va server
 * ularni `LIMIT 1000` bilan qaytaradi — to'liq ro'yxat bir necha o'n
 * kilobayt, gzip bilan undan ham kam. Delta murakkabligi bu yerda
 * o'zini oqlamaydi.
 */
import { api } from '../api/client';
import * as cache from '../lib/cache';

export interface Customer {
  id: string;
  name: string;
  phone: string | null;
  balance?: number;
}

const NOM = 'customers';

/** Kesh shundan eski bo'lsa fon so'rovi ketadi. */
const YANGILASH_MS = 60_000;

let shopId: string | null = null;
let royxat: Customer[] | null = null;
let oxirgiSync = 0;
/** Bir vaqtda bitta so'rov — modal tez ochilib-yopilsa takrorlanmasin. */
let ketayotgan: Promise<void> | null = null;

/** Do'kon almashganda (kirish/chiqish) chaqiriladi. */
export function setShop(id: string | null) {
  if (id === shopId) return;
  shopId = id;
  royxat = null;
  oxirgiSync = 0;
  ketayotgan = null;
}

/** Keshdagi ro'yxat. Server kutilmaydi. */
export async function load(): Promise<Customer[]> {
  if (!shopId) return [];
  if (royxat) return royxat;
  royxat = (await cache.read<Customer[]>(shopId, NOM)) ?? [];
  return royxat;
}

/** Serverdan qayta o'qiydi. Yaqinda o'qilgan bo'lsa — hech narsa qilmaydi. */
export async function sync(force = false): Promise<Customer[]> {
  if (!shopId) return [];
  if (ketayotgan) { await ketayotgan; return royxat ?? []; }
  if (!force && Date.now() - oxirgiSync < YANGILASH_MS) {
    return royxat ?? load();
  }

  ketayotgan = (async () => {
    const id = shopId!;
    const yangi = await api<Customer[]>('/debts/customers');
    royxat = yangi;
    oxirgiSync = Date.now();
    await cache.write(id, NOM, yangi);
  })();

  try {
    await ketayotgan;
  } catch {
    // Internet yo'q — keshdagi ro'yxat baribir ishlaydi.
    // `oxirgiSync` yangilanmagani uchun keyingi urinish darhol o'tadi.
  } finally {
    ketayotgan = null;
  }

  return royxat ?? [];
}

/** Keshni ko'rsatib, orqadan yangilaydi. Ekranlar shuni chaqiradi. */
export async function loadAndRefresh(
  onUpdate?: (items: Customer[]) => void,
): Promise<Customer[]> {
  const darhol = await load();
  sync().then((yangi) => {
    if (onUpdate && yangi !== darhol) onUpdate(yangi);
  }).catch(() => {});
  return darhol;
}

/**
 * Yangi qo'shilgan mijozni keshga darhol qo'shadi — keyingi sync'ni
 * kutmasdan ro'yxatda ko'rinsin.
 */
export async function qosh(c: Customer): Promise<void> {
  if (!shopId) return;
  const hozir = royxat ?? await load();
  if (hozir.some((x) => x.id === c.id)) return;
  royxat = [c, ...hozir];
  await cache.write(shopId, NOM, royxat).catch(() => {});
}

/** Qarz/to'lov yozilgandan keyin — balanslar o'zgardi, keyingi sync darhol o'tsin. */
export function invalidate() {
  oxirgiSync = 0;
}
