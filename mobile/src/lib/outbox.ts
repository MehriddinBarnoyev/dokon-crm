/**
 * NAVBAT (outbox) — internet yo'q bo'lganda yozish.
 *
 * Do'konda internet uzilib turadi. Ilgari bunday paytda savdo yozib
 * bo'lmasdi: "Serverga ulanib bo'lmadi" chiqardi va kassir qo'lda
 * qog'ozga yozib qo'yishga majbur edi.
 *
 * Endi har bir o'zgarish avval SHU NAVBATGA tushadi, keyin serverga
 * yuborishga urinib ko'riladi. Muvaffaqiyatli bo'lsa navbatdan chiqadi;
 * bo'lmasa qurilmada (shifrlangan holda) kutib turadi va ulanish
 * tiklanganda avtomatik yuboriladi.
 *
 * IKKI MARTA YOZILMASLIGI. Har o'zgarishga mijoz o'zi uuid beradi.
 * Server uni `mutation_log` da eslab qoladi, shuning uchun qayta
 * yuborilgan o'zgarish ikkinchi marta bajarilmaydi. Busiz "yubordim,
 * javob kelmadi, qayta yuboraman" holati savdoni ikkilantirardi.
 *
 * RAD ETILGANLAR. Serverning "bu noto'g'ri" degan javobini qayta
 * yuborishning ma'nosi yo'q — ayni javob keladi. Bunday o'zgarish
 * navbatdan chiqarilib, alohida ro'yxatga o'tadi va do'konchiga
 * ko'rsatiladi. Jimgina yo'qotib yuborish — eng yomon variant.
 */
import * as Crypto from 'expo-crypto';
import { api, ApiError } from '../api/client';
import * as cache from './cache';

export interface Mutation {
  id: string;
  kind: string;
  body: Record<string, unknown>;
  /** Qurilmada yozilgan vaqt — ro'yxatda ko'rsatish uchun. */
  at: string;
  /** Nechta marta urinildi (kutish oralig'ini hisoblash uchun). */
  tries: number;
  /** Do'konchi tushunadigan qisqa tavsif: "Savdo — 38 000 so'm". */
  label: string;
}

export interface Rejected extends Mutation {
  error: string;
}

const NAVBAT = 'outbox';
const RAD = 'outbox.rejected';

/** Bir yuborishda ko'pi bilan shuncha — server ham 50 tani qabul qiladi. */
const PARTIYA = 50;

interface FlushResult {
  id: string;
  ok: boolean;
  result?: { warnings?: string[]; summary?: string };
  error?: string;
  retryable?: boolean;
}

let shopId: string | null = null;
let navbat: Mutation[] = [];
let radEtilgan: Rejected[] = [];
let yuklandi = false;
let ketayotgan: Promise<void> | null = null;

/** Navbat o'zgarganda UI xabardor bo'lsin. */
type Kuzatuvchi = (holat: { kutayotgan: number; radEtilgan: number }) => void;
const kuzatuvchilar = new Set<Kuzatuvchi>();

function xabarBer() {
  const holat = { kutayotgan: navbat.length, radEtilgan: radEtilgan.length };
  for (const k of kuzatuvchilar) k(holat);
}

export function kuzat(fn: Kuzatuvchi): () => void {
  kuzatuvchilar.add(fn);
  fn({ kutayotgan: navbat.length, radEtilgan: radEtilgan.length });
  return () => { kuzatuvchilar.delete(fn); };
}

export function setShop(id: string | null) {
  if (id === shopId) return;
  shopId = id;
  navbat = [];
  radEtilgan = [];
  yuklandi = false;
  xabarBer();
}

async function yukla(): Promise<void> {
  if (yuklandi || !shopId) return;
  navbat = (await cache.read<Mutation[]>(shopId, NAVBAT)) ?? [];
  radEtilgan = (await cache.read<Rejected[]>(shopId, RAD)) ?? [];
  yuklandi = true;
  xabarBer();
}

async function saqla(): Promise<void> {
  if (!shopId) return;
  await cache.write(shopId, NAVBAT, navbat);
  await cache.write(shopId, RAD, radEtilgan);
  xabarBer();
}

/**
 * O'zgarishni navbatga qo'yadi va darhol yuborishga urinadi.
 *
 * Qaytaradi: `yuborildi` — serverga yetib bordimi. `false` bo'lsa
 * o'zgarish yo'qolmagan, navbatda turibdi.
 */
export async function enqueue(
  kind: string,
  body: Record<string, unknown>,
  label: string,
): Promise<{ yuborildi: boolean; warnings: string[]; error?: string }> {
  await yukla();

  const m: Mutation = {
    id: Crypto.randomUUID(),
    kind,
    body,
    at: new Date().toISOString(),
    tries: 0,
    label,
  };
  navbat.push(m);
  await saqla();

  const natija = await flush();
  const meniki = natija.find((r) => r.id === m.id);

  if (meniki) {
    return {
      yuborildi: meniki.ok,
      warnings: meniki.result?.warnings ?? [],
      error: meniki.error,
    };
  }

  // Javobda yo'q. Ikki sabab bo'lishi mumkin:
  //   1. Yuborib bo'lmadi (internet yo'q) — navbatda turibdi;
  //   2. Ayni paytda boshqa flush ketayotgan edi va bizni o'sha yubordi.
  // Farqni navbatning o'zidan bilamiz: yo'q bo'lsa — yuborilgan.
  const hamon = navbat.some((x) => x.id === m.id);
  if (!hamon) {
    const rad = radEtilgan.find((r) => r.id === m.id);
    if (rad) return { yuborildi: false, warnings: [], error: rad.error };
    return { yuborildi: true, warnings: [] };
  }
  return { yuborildi: false, warnings: [] };
}

/**
 * Navbatni serverga yuboradi.
 *
 * Bir vaqtda faqat bitta yuborish ketadi — aks holda ayni mutatsiya
 * ikki so'rovda ketib, serverdagi idempotentlik darvozasini keraksiz
 * qulflardi.
 */
export async function flush(): Promise<FlushResult[]> {
  await yukla();
  if (navbat.length === 0) return [];
  if (ketayotgan) { await ketayotgan; return []; }

  let natijalar: FlushResult[] = [];

  ketayotgan = (async () => {
    const partiya = navbat.slice(0, PARTIYA);

    const res = await api<{ results: FlushResult[] }>('/sync/flush', {
      method: 'POST',
      body: {
        mutations: partiya.map((m) => ({ id: m.id, kind: m.kind, body: m.body })),
      },
    });
    natijalar = res.results;

    const holat = new Map(res.results.map((r) => [r.id, r]));

    const qoladi: Mutation[] = [];
    for (const m of navbat) {
      const r = holat.get(m.id);
      if (!r) { qoladi.push(m); continue; }          // partiyaga kirmagan
      if (r.ok) continue;                            // yozildi, navbatdan chiqdi

      if (r.retryable) {
        qoladi.push({ ...m, tries: m.tries + 1 });
      } else {
        // Server "bu noto'g'ri" dedi — qayta yuborish foydasiz.
        radEtilgan.push({ ...m, error: r.error ?? 'Server rad etdi' });
      }
    }
    navbat = qoladi;
    await saqla();
  })();

  try {
    await ketayotgan;
  } catch (e) {
    // Tarmoq yo'q yoki server javob bermadi — navbat o'z holicha qoladi
    // va keyingi urinishda yana yuboriladi. `ApiError.status === 0`
    // aynan "ulanib bo'lmadi" degani.
    if (!(e instanceof ApiError) || e.status !== 0) {
      // Kutilmagan xato — navbatni baribir saqlab qolamiz.
      console.warn('[outbox] yuborishda xato:', e);
    }
  } finally {
    ketayotgan = null;
  }

  return natijalar;
}

/** Kutayotganlar soni — banner uchun. */
export function kutayotgan(): number {
  return navbat.length;
}

export async function royxat(): Promise<{ navbat: Mutation[]; radEtilgan: Rejected[] }> {
  await yukla();
  return { navbat: [...navbat], radEtilgan: [...radEtilgan] };
}

/** Rad etilganni navbatga qaytaradi — do'konchi tuzatgandan keyin. */
export async function qaytaUrin(id: string): Promise<void> {
  await yukla();
  const i = radEtilgan.findIndex((r) => r.id === id);
  if (i < 0) return;

  const { error, ...m } = radEtilgan[i];
  radEtilgan.splice(i, 1);
  // YANGI uuid: eskisini server allaqachon ko'rgan bo'lishi mumkin va
  // idempotentlik darvozasi uni "bajarilgan" deb o'tkazib yuborardi.
  navbat.push({ ...m, id: Crypto.randomUUID(), tries: 0 });
  await saqla();
  await flush();
}

export async function radniOchir(id: string): Promise<void> {
  await yukla();
  radEtilgan = radEtilgan.filter((r) => r.id !== id);
  await saqla();
}
