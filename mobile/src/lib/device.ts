/**
 * QURILMA MA'LUMOTLARI — xavfsizlik uchun serverga yuboriladi.
 *
 * `deviceId` — o'zimiz generatsiya qilgan, doimiy ID. iOS/Android
 * ilova o'rnatilgan vaqtni ochiq API orqali bermaydi, shuning uchun
 * "bu ID birinchi marta qachon ko'ringan" o'rnatilgan vaqtga eng yaqin
 * proksi bo'ladi (server tomonda yoziladi — `server/src/lib/auth.ts`).
 * Ilova o'chirilib qayta o'rnatilsa — SecureStore ham tozalanadi va
 * yangi ID yaratiladi, ya'ni bu haqiqatan ham yangi o'rnatishga teng.
 */
import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';
import * as Device from 'expo-device';
import * as Application from 'expo-application';
import { Platform } from 'react-native';

const DEVICE_ID_KEY = 'dokon.device_id';

let keshlanganId: string | null = null;

async function qurilmaId(): Promise<string> {
  if (keshlanganId) return keshlanganId;

  let id = await SecureStore.getItemAsync(DEVICE_ID_KEY).catch(() => null);
  if (!id) {
    id = Crypto.randomUUID();
    await SecureStore.setItemAsync(DEVICE_ID_KEY, id).catch(() => {});
  }
  keshlanganId = id;
  return id;
}

/** `client.ts` uchun — so'rov headerlariga qo'shiladi. */
export async function qurilmaHeaderlari(): Promise<Record<string, string>> {
  const id = await qurilmaId();
  const headerlar: Record<string, string> = {
    'X-Device-Id': id,
    'X-Device-Platform': Platform.OS,
  };
  if (Device.modelName) headerlar['X-Device-Model'] = Device.modelName;
  if (Device.osVersion) headerlar['X-Device-Os-Version'] = Device.osVersion;
  if (Application.nativeApplicationVersion) {
    headerlar['X-App-Version'] = Application.nativeApplicationVersion;
  }
  return headerlar;
}
