import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, ApiError, setToken, getToken, setUnauthorizedHandler } from './client';
import * as productStore from '../data/products';
import * as customerStore from '../data/customers';
import * as cache from '../lib/cache';
import * as outbox from '../lib/outbox';
import type { Shop, User } from './types';

interface AuthState {
  user: User | null;
  shop: Shop | null;
  loading: boolean;
  login(phone: string, password: string): Promise<void>;
  register(shopName: string, name: string, phone: string, password: string): Promise<void>;
  logout(): Promise<void>;
}

interface Session {
  user: User;
  shop: Shop;
}

/**
 * Seans nusxasi cache'ning "do'konsiz" bo'limida turadi. `dokon.v1.` prefiksi
 * tufayli `cache.clearAll()` (chiqish) uni ham tozalaydi.
 */
const SEANS_BOLIM = 'session';
const SEANS_NOMI = 'me';

/**
 * Server uyqudan uyg'onishi uchun kengroq vaqt.
 *
 * Render bepul tarifda 15 daqiqa harakatsizlikdan keyin servisni to'xtatadi;
 * keyingi birinchi so'rov ~25-30 soniya ketadi. Odatdagi 20 soniyalik
 * chegara aynan shu paytda uzilib, seansni "yaroqsiz" ko'rsatardi.
 */
const UYQU_TIMEOUT = 45000;

/**
 * `/auth/me` — tarmoq xatosida qayta urinadi.
 *
 * Server javob bergan xatolar (401, 500 ...) qayta urinishga arzimaydi,
 * shuning uchun darhol otiladi. status 0 — ulanmadi yoki vaqt tugadi.
 */
async function seansniSora(): Promise<Session> {
  let oxirgi: unknown;
  for (let urinish = 0; urinish < 3; urinish++) {
    try {
      // `qaytaUrin: false` — qayta urinish MANA SHU siklda. `client.ts`
      // dagi avtomatik qayta urinish ham qo'shilsa, har urinish 45+70
      // soniyaga cho'zilib, jami besh daqiqadan oshib ketardi.
      return await api<Session>('/auth/me', {
        timeoutMs: UYQU_TIMEOUT, qaytaUrin: false,
      });
    } catch (e) {
      oxirgi = e;
      if (e instanceof ApiError && e.status !== 0) throw e;
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  throw oxirgi;
}

const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [shop, setShop] = useState<Shop | null>(null);
  const [loading, setLoading] = useState(true);

  /** Seansni ilovaga yoyadi va keyingi ochilish uchun saqlaydi. */
  const seansniQoy = useCallback(async (s: Session, saqla = true) => {
    setUser(s.user);
    setShop(s.shop);
    productStore.setShop(s.shop.id);
    customerStore.setShop(s.shop.id);
    outbox.setShop(s.shop.id);
    if (saqla) await cache.write(SEANS_BOLIM, SEANS_NOMI, s).catch(() => {});
  }, []);

  // Server seansni rad etsa (hisob o'chirilgan, do'kon o'zgargan) —
  // darhol kirish ekraniga qaytamiz
  useEffect(() => {
    setUnauthorizedHandler(() => {
      setUser(null); setShop(null);
      productStore.setShop(null);
      customerStore.setShop(null);
      outbox.setShop(null);
      // Saqlangan nusxa ham ketsin — aks holda keyingi ochilishda
      // yaroqsiz seans qayta tiklanardi.
      cache.remove(SEANS_BOLIM, SEANS_NOMI).catch(() => {});
    });
    return () => setUnauthorizedHandler(null);
  }, []);

  // Ilova ochilganda saqlangan token bilan seansni tiklaymiz.
  //
  // MUHIM: token FAQAT server 401 qaytarganda o'chiriladi (buni `client.ts`
  // qiladi). Tarmoq yo'qligi, server uyquda bo'lishi yoki vaqt tugashi —
  // bularning hech biri "seans tugadi" degani emas. Ilgari har qanday xato
  // tokenni o'chirar, natijada har yangilanishdan keyin qaytadan kirishga
  // to'g'ri kelardi.
  useEffect(() => {
    (async () => {
      try {
        if (!(await getToken())) return;

        // 1) Avval saqlangan nusxa: ilova darhol ochiladi va internetsiz
        //    ham ishlaydi.
        const saqlangan = await cache.read<Session>(SEANS_BOLIM, SEANS_NOMI).catch(() => null);
        if (saqlangan) {
          await seansniQoy(saqlangan, false);
          setLoading(false);
        }

        // 2) Keyin serverdan yangilaymiz.
        try {
          await seansniQoy(await seansniSora());
        } catch (e) {
          // Nusxa bor edi — tarmoq tiklanganda o'zi yangilanadi.
          // Nusxa bo'lmasa ko'rsatadigan narsa yo'q, lekin token joyida
          // qoladi: keyingi ochilishda yana urinamiz.
          if (!saqlangan) throw e;
        }

        // Oldingi seansda yuborilmay qolgan o'zgarishlar bo'lsa —
        // ilova ochilishi bilan yuboriladi.
        outbox.flush().catch(() => {});
      } catch {
        // Seansni tiklab bo'lmadi.
      } finally {
        setLoading(false);
      }
    })();
  }, [seansniQoy]);

  const value = useMemo<AuthState>(() => ({
    user, shop, loading,

    async login(phone, password) {
      const res = await api<{ token: string; user: User }>('/auth/login', {
        method: 'POST', body: { phone, password }, timeoutMs: UYQU_TIMEOUT,
      });
      await setToken(res.token);
      await seansniQoy(await seansniSora());
    },

    async register(shopName, name, phone, password) {
      const res = await api<{ token: string; user: User }>('/auth/register', {
        method: 'POST', body: { shop_name: shopName, name, phone, password },
        timeoutMs: UYQU_TIMEOUT,
      });
      await setToken(res.token);
      await seansniQoy(await seansniSora());
    },

    async logout() {
      // Chiqish cache'ni butunlay o'chiradi — navbatda kutayotgan
      // savdo bo'lsa u ham yo'qoladi. Shuning uchun avval yuborishga
      // urinamiz. (Sozlamalar ekrani buni oldindan ogohlantiradi.)
      await outbox.flush().catch(() => {});
      await setToken(null);
      // Cache VA shifrlash kaliti o'chadi. Kalitsiz qolgan yozuvni
      // hech kim ocha olmaydi — chiqish rostdan ham chiqish bo'lsin.
      await cache.clearAll().catch(() => {});
      productStore.setShop(null);
      customerStore.setShop(null);
      outbox.setShop(null);
      setUser(null); setShop(null);
    },
  }), [user, shop, loading, seansniQoy]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useAuth faqat AuthProvider ichida ishlaydi');
  return ctx;
}
