/**
 * Server bilan aloqa.
 *
 * BASE_URL: telefon "localhost" ni o'zining ichida qidiradi, shuning uchun
 * kompyuteringizning LAN IP manzili kerak. app.json → extra.apiUrl orqali
 * yoki EXPO_PUBLIC_API_URL muhit o'zgaruvchisi bilan beriladi.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import Constants from 'expo-constants';

const TOKEN_KEY = 'dokon.token';

function resolveBaseUrl(): string {
  const fromEnv = process.env.EXPO_PUBLIC_API_URL;
  if (fromEnv) return fromEnv.replace(/\/$/, '');

  const fromConfig = (Constants.expoConfig?.extra as any)?.apiUrl;
  if (fromConfig) return String(fromConfig).replace(/\/$/, '');

  // Server HTTPS da bo'lsa EXPO_PUBLIC_API_SCHEME=https qo'ying.
  // Sukut bo'yicha http — mahalliy ishlab chiqishda shu qulay.
  const scheme = process.env.EXPO_PUBLIC_API_SCHEME ?? 'http';
  const port = process.env.EXPO_PUBLIC_API_PORT ?? '3000';

  // Oxirgi chora: Metro serverning IP manzilidan foydalanamiz —
  // odatda u kompyuterning LAN IP si, server ham shu yerda turadi.
  const host = Constants.expoConfig?.hostUri?.split(':')[0];
  if (host) return `${scheme}://${host}:${port}`;

  return `${scheme}://localhost:${port}`;
}

export const BASE_URL = resolveBaseUrl();

/**
 * TOKEN qurilmaning apparat omboriga yoziladi (iOS Keychain / Android
 * Keystore) — `vault` dagi shifrlash kaliti bilan bir joyda. AsyncStorage
 * oddiy fayl edi: qurilma zaxira nusxasiga ham tushardi.
 *
 * `keychainAccessible: AFTER_FIRST_UNLOCK` — do'konchining telefonida ekran
 * qulfi bo'lmasligi mumkin, shunda ham token o'qilsin.
 */
const TOKEN_OPTS = { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK } as const;

let memoryToken: string | null = null;
let tokenOqildi = false;

export async function getToken(): Promise<string | null> {
  if (memoryToken) return memoryToken;
  if (tokenOqildi) return null;

  memoryToken = await SecureStore.getItemAsync(TOKEN_KEY).catch(() => null);

  // 1.4.0 gacha token AsyncStorage'da saqlanardi. Bir martalik ko'chirish —
  // busiz eski versiyadan yangilangan har bir foydalanuvchi qaytadan
  // kirishga majbur bo'lardi.
  if (!memoryToken) {
    const eski = await AsyncStorage.getItem(TOKEN_KEY).catch(() => null);
    if (eski) {
      memoryToken = eski;
      const kochdi = await SecureStore.setItemAsync(TOKEN_KEY, eski, TOKEN_OPTS)
        .then(() => true).catch(() => false);
      // Ko'chira olmasak eskisini QOLDIRAMIZ — aks holda token butunlay
      // yo'qolib, foydalanuvchi seansidan ayrilardi.
      if (kochdi) await AsyncStorage.removeItem(TOKEN_KEY).catch(() => {});
    }
  }

  tokenOqildi = true;
  return memoryToken;
}

export async function setToken(token: string | null) {
  memoryToken = token;
  tokenOqildi = true;

  if (token) {
    // SecureStore ishlamaydigan qurilma uchraydi (Keystore buzilgan holatlar) —
    // seanssiz qoldirgandan ko'ra AsyncStorage'ga yozgan afzal.
    await SecureStore.setItemAsync(TOKEN_KEY, token, TOKEN_OPTS)
      .catch(() => AsyncStorage.setItem(TOKEN_KEY, token).catch(() => {}));
  } else {
    await SecureStore.deleteItemAsync(TOKEN_KEY).catch(() => {});
    await AsyncStorage.removeItem(TOKEN_KEY).catch(() => {});
  }
}

/**
 * Seans yaroqsiz bo'lganda chaqiriladi (401). AuthProvider shu orqali
 * foydalanuvchini kirish ekraniga qaytaradi.
 *
 * Nega kerak? Token 90 kun yashaydi, lekin hisob o'chirilishi yoki do'kon
 * o'zgarishi mumkin. Bunday holatda ilova xato ko'rsatib turgandan ko'ra,
 * darhol qayta kirishni so'ragani to'g'ri.
 */
let onUnauthorized: (() => void) | null = null;

export function setUnauthorizedHandler(fn: (() => void) | null) {
  onUnauthorized = fn;
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly fields?: Array<{ field: string; message: string }>,
  ) {
    super(message);
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  /** AI so'rovlari sekinroq — ularga kengroq vaqt beramiz. */
  timeoutMs?: number;
}

export async function api<T = any>(path: string, opts: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, timeoutMs = 20000 } = opts;
  const token = await getToken();

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(`${BASE_URL}${path}`, {
      method,
      headers: {
        // Content-Type faqat tana bo'lganda: aks holda Fastify bo'sh
        // JSON tanasini xato deb rad etadi (DELETE so'rovlarida chiqadi).
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });

    const text = await res.text();
    const data = text ? JSON.parse(text) : null;

    if (!res.ok) {
      if (res.status === 401 && token) {
        // Token bor edi, lekin server rad etdi → seans yaroqsiz
        await setToken(null);
        onUnauthorized?.();
      }
      throw new ApiError(
        data?.error ?? `Xatolik (${res.status})`,
        res.status,
        data?.fields,
      );
    }
    return data as T;
  } catch (e: any) {
    if (e instanceof ApiError) throw e;
    if (e?.name === 'AbortError') {
      throw new ApiError('Server javob bermadi. Internetni tekshiring.', 0);
    }
    // HTTPS da eng ko'p uchraydigan sabab — qurilma sertifikatga ishonmasligi.
    const hint = BASE_URL.startsWith('https')
      ? " Sertifikat qurilmada ishonchli deb belgilanganini tekshiring."
      : '';
    throw new ApiError(
      `Serverga ulanib bo'lmadi (${BASE_URL}). Server ishlab turganini tekshiring.${hint}`, 0);
  } finally {
    clearTimeout(timer);
  }
}

/** Rasmni yuklab, URL qaytaradi. */
export async function uploadPhoto(uri: string): Promise<string> {
  const token = await getToken();
  const form = new FormData();
  const name = uri.split('/').pop() ?? 'photo.jpg';
  form.append('file', { uri, name, type: 'image/jpeg' } as any);

  const res = await fetch(`${BASE_URL}/upload`, {
    method: 'POST',
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: form,
  });
  if (!res.ok) throw new ApiError('Rasmni yuklab bo\'lmadi', res.status);
  const data = await res.json();
  return `${BASE_URL}${data.url}`;
}
