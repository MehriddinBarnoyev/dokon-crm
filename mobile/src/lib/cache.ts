/**
 * CACHE — shifrlangan mahalliy saqlash.
 *
 * `vault` ustidagi yupqa qatlam: qiymat JSON → AES-256-GCM → base64
 * ko'rinishida AsyncStorage'ga tushadi.
 *
 * HAJM. O'lchandi: 300 ta mahsulot shifrlangan holda ~33 KB, ya'ni
 * 2000 tasi ham ~220 KB. Android'dagi ~6 MB chegarasidan ancha uzoq,
 * shuning uchun bo'laklarga bo'lish kerak emas. Baribir yozishdan
 * oldin hajm tekshiriladi — kutilmagan o'sish jimgina buzilishga
 * emas, ogohlantirishga olib kelsin.
 *
 * DO'KONGA BOG'LANGAN. Kalitlar `dokon.v1.<shop_id>.<nom>` ko'rinishida.
 * Bitta telefonda ikkita do'kon hisobiga kirilsa, biri ikkinchisining
 * ma'lumotini ko'rmaydi. Chiqishda o'sha do'konning hammasi tozalanadi.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { open, seal, destroyKey } from './vault';

const PREFIX = 'dokon.v1.';

/** Bir yozuv uchun ogohlantirish chegarasi (base64 belgilarida ≈ 2 MB). */
const OGOHLANTIRISH_HAJMI = 2_000_000;

/**
 * RAM'dagi nusxa. Har o'qishda deshifrlash 3-4 ms — ko'p emas, lekin
 * ro'yxat ekranida har renderda takrorlanishi mumkin. `client.ts` dagi
 * `memoryToken` bilan bir xil mulohaza.
 */
const memo = new Map<string, unknown>();

function fullKey(shopId: string, name: string): string {
  return `${PREFIX}${shopId}.${name}`;
}

export async function read<T>(shopId: string, name: string): Promise<T | null> {
  const key = fullKey(shopId, name);
  if (memo.has(key)) return memo.get(key) as T;

  const blob = await AsyncStorage.getItem(key).catch(() => null);
  if (!blob) return null;

  const value = await open<T>(blob);
  if (value === null) {
    // Kalit almashgan yoki yozuv buzilgan. Saqlab o'tirishning ma'nosi
    // yo'q — o'chiramiz, chaqiruvchi serverdan qayta yuklaydi.
    await AsyncStorage.removeItem(key).catch(() => {});
    return null;
  }

  memo.set(key, value);
  return value;
}

export async function write(shopId: string, name: string, value: unknown): Promise<void> {
  const key = fullKey(shopId, name);
  const blob = await seal(value);

  if (blob.length > OGOHLANTIRISH_HAJMI) {
    console.warn(
      `[cache] "${name}" juda katta: ${Math.round(blob.length / 1024)} KB. ` +
      'Sahifalash yoki tozalash kerak bo\'lishi mumkin.');
  }

  await AsyncStorage.setItem(key, blob);
  memo.set(key, value);
}

export async function remove(shopId: string, name: string): Promise<void> {
  const key = fullKey(shopId, name);
  memo.delete(key);
  await AsyncStorage.removeItem(key).catch(() => {});
}

/**
 * Bitta do'konning butun cache'ini o'chiradi.
 * Chiqishda (`logout`) chaqiriladi.
 */
export async function clearShop(shopId: string): Promise<void> {
  const barcha = await AsyncStorage.getAllKeys().catch(() => [] as readonly string[]);
  const meniki = barcha.filter((k) => k.startsWith(`${PREFIX}${shopId}.`));

  for (const k of meniki) memo.delete(k);
  if (meniki.length > 0) await AsyncStorage.multiRemove(meniki).catch(() => {});
}

/**
 * Hamma do'konning cache'i + shifrlash kaliti.
 *
 * Chiqishda shu chaqiriladi: kalit yo'q bo'lgach, agar biror yozuv
 * qandaydir sabab qolib ketsa ham uni hech kim ocha olmaydi.
 */
export async function clearAll(): Promise<void> {
  const barcha = await AsyncStorage.getAllKeys().catch(() => [] as readonly string[]);
  const meniki = barcha.filter((k) => k.startsWith(PREFIX));

  memo.clear();
  if (meniki.length > 0) await AsyncStorage.multiRemove(meniki).catch(() => {});
  await destroyKey();
}
