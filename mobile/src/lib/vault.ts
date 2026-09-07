/**
 * SHIFRLASH — cache uchun.
 *
 * Nima himoyalanadi? AsyncStorage allaqachon ilova sandbox'ida turadi:
 * boshqa ilova uni o'qiy olmaydi. Shifrlash bundan tashqarigi holatlarni
 * yopadi — qurilma zaxira nusxasi (iCloud / Google backup), root yoki
 * jailbreak qilingan telefonda faylni oddiy o'qish, va o'g'irlangan
 * qurilmadan diskni ko'chirish. Bu cheklangan, lekin haqiqiy foyda.
 *
 * KALIT qurilmaning apparat omboriga yoziladi: iOS'da Keychain,
 * Android'da Keystore (`expo-secure-store`). Ya'ni kalit AsyncStorage
 * bilan bir joyda yotmaydi — aks holda shifrlashning ma'nosi qolmasdi.
 *
 * ALGORITM: AES-256-GCM. GCM tanlangani — u shifrlash bilan birga
 * BUTUNLIKNI ham tekshiradi. Fayl buzilgan yoki o'zgartirilgan bo'lsa
 * deshifrlash xato beradi, ya'ni ilova buzilgan ma'lumotni haqiqat deb
 * qabul qilmaydi.
 *
 * `@noble/ciphers` sof TypeScript — native modul emas. Shu sabab
 * Expo Go'da ham ishlaydi, `react-native-quick-crypto` esa ishlamasdi.
 */
import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';
import { gcm } from '@noble/ciphers/aes.js';

const KEY_NAME = 'dokon.cachekey';
const NONCE_LEN = 12;   // GCM uchun standart

/** Kalit har o'qishda Keychain'dan so'ralmasin — bir marta olinadi. */
let memoryKey: Uint8Array | null = null;

/**
 * Kalitni oladi, bo'lmasa yaratadi.
 *
 * Kalit yo'qolishi NORMAL holat: zaxiradan tiklangan qurilma, Keystore
 * tozalangani, ilova qayta o'rnatilgani. Bunday holatda yangi kalit
 * yaratiladi va eski cache o'qib bo'lmas bo'lib qoladi — chaqiruvchi
 * uni tashlab, serverdan qayta yuklaydi.
 */
async function getKey(): Promise<Uint8Array> {
  if (memoryKey) return memoryKey;

  const saqlangan = await SecureStore.getItemAsync(KEY_NAME).catch(() => null);
  if (saqlangan) {
    const key = fromBase64(saqlangan);
    if (key.length === 32) {
      memoryKey = key;
      return key;
    }
    // Uzunligi noto'g'ri — buzilgan yozuv, qaytadan yaratamiz.
  }

  const yangi = Crypto.getRandomBytes(32);
  await SecureStore.setItemAsync(KEY_NAME, toBase64(yangi), {
    // Ekran qulfi qo'yilmagan telefonda ham ishlashi kerak — do'konchi
    // qulfsiz telefondan foydalanishi juda ehtimol.
    keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK,
  });
  memoryKey = yangi;
  return yangi;
}

/**
 * Kalitni butunlay o'chiradi. Chiqishda chaqiriladi — cache'dagi
 * ma'lumot shundan keyin hech kim tomonidan ochilmaydi.
 */
export async function destroyKey(): Promise<void> {
  memoryKey = null;
  await SecureStore.deleteItemAsync(KEY_NAME).catch(() => {});
}

/** Obyekt → base64 shifrmatn. Nonce natijaning boshiga qo'shiladi. */
export async function seal(value: unknown): Promise<string> {
  const key = await getKey();
  const nonce = Crypto.getRandomBytes(NONCE_LEN);
  const plain = new TextEncoder().encode(JSON.stringify(value));
  const cipher = gcm(key, nonce).encrypt(plain);

  const out = new Uint8Array(nonce.length + cipher.length);
  out.set(nonce, 0);
  out.set(cipher, nonce.length);
  return toBase64(out);
}

/**
 * Teskarisi. Kalit almashgan, yozuv buzilgan yoki formati boshqa
 * bo'lsa `null` qaytaradi — ilova qulamaydi, cache shunchaki
 * "yo'q" deb hisoblanadi.
 */
export async function open<T>(blob: string): Promise<T | null> {
  try {
    const key = await getKey();
    const raw = fromBase64(blob);
    if (raw.length <= NONCE_LEN) return null;

    const nonce = raw.subarray(0, NONCE_LEN);
    const cipher = raw.subarray(NONCE_LEN);
    const plain = gcm(key, nonce).decrypt(cipher);
    return JSON.parse(new TextDecoder().decode(plain)) as T;
  } catch {
    return null;
  }
}

/* ---------------------------- base64 yordamchi ---------------------------- */
/* Hermes'da `Buffer` yo'q, `atob`/`btoa` esa faqat matn bilan ishlaydi —
   shuning uchun baytlarni qo'lda o'giramiz. */

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function toBase64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = bytes[i + 1];
    const b2 = bytes[i + 2];

    out += B64[b0 >> 2];
    out += B64[((b0 & 3) << 4) | ((b1 ?? 0) >> 4)];
    out += b1 === undefined ? '=' : B64[((b1 & 15) << 2) | ((b2 ?? 0) >> 6)];
    out += b2 === undefined ? '=' : B64[b2 & 63];
  }
  return out;
}

function fromBase64(text: string): Uint8Array {
  const clean = text.replace(/[^A-Za-z0-9+/]/g, '');
  const len = Math.floor((clean.length * 3) / 4);
  const out = new Uint8Array(len);

  let p = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const c0 = B64.indexOf(clean[i]);
    const c1 = B64.indexOf(clean[i + 1]);
    const c2 = B64.indexOf(clean[i + 2]);
    const c3 = B64.indexOf(clean[i + 3]);

    if (p < len) out[p++] = (c0 << 2) | (c1 >> 4);
    if (p < len && c2 >= 0) out[p++] = ((c1 & 15) << 4) | (c2 >> 2);
    if (p < len && c3 >= 0) out[p++] = ((c2 & 3) << 6) | c3;
  }
  return out;
}
