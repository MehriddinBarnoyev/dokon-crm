/**
 * KESHLANGAN RO'YXAT — "avval ko'rsat, keyin yangila".
 *
 * MUAMMO. Savdolar, qarzlar va chiqimlar ekrani har ochilganda bo'sh
 * skeletonda turib serverdan javob kutardi. Sekin internetda bu 2-3
 * soniya, internet umuman yo'q bo'lsa esa ekran BO'SH qolardi —
 * do'konchi kechagi savdosini ham ko'ra olmasdi.
 *
 * YECHIM. Ma'lumot shifrlangan keshga yoziladi. Ekran ochilganda avval
 * O'SHA ko'rsatiladi (darhol, so'rovsiz), keyin fon so'rovi kelib uni
 * almashtiradi. So'rov yiqilsa — keshdagi holat qoladi, xato emas.
 *
 * Bu bosh sahifada (`app/(tabs)/index.tsx`) allaqachon qo'lda yozilgan
 * mantiq — shu yerda umumlashtirilgan.
 *
 * KESH KALITI. `nom` ichida ro'yxat TURI ham bo'lishi kerak: qarzlar
 * ekranida "faqat qarzdorlar" va "hammasi" boshqa-boshqa ro'yxat,
 * chiqimlarda esa har bir davr alohida. Bir kalitga yozilsa, filtr
 * almashganda noto'g'ri ro'yxat ko'rinardi.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '../api/auth';
import * as cache from './cache';

export interface KeshHolat<T> {
  /** Keshdagi yoki serverdan kelgan ma'lumot. `null` — hali hech narsa yo'q. */
  data: T | null;
  /** Faqat kesh ham, server ham bermaganda to'ladi. */
  xato: string | null;
  /** Serverdan qayta o'qish. `useFocusEffect` va `RefreshControl` chaqiradi. */
  yangila: () => Promise<void>;
}

export function useKeshlangan<T>(nom: string, olib: () => Promise<T>): KeshHolat<T> {
  const { shop } = useAuth();
  const shopId = shop?.id ?? null;

  const [data, setData] = useState<T | null>(null);
  const [xato, setXato] = useState<string | null>(null);

  /**
   * Har bir `nom`/do'kon o'zgarishi yangi "avlod". Eski avlodga tegishli
   * javob kech kelib qolsa (so'rov ketayotganda foydalanuvchi filtrni
   * almashtirdi) — u e'tiborsiz qoldiriladi, aks holda ekranda boshqa
   * ro'yxatning ma'lumoti paydo bo'lardi.
   */
  const avlod = useRef(0);

  useEffect(() => {
    avlod.current += 1;
    const meniki = avlod.current;

    setData(null);
    setXato(null);
    if (!shopId) return;

    cache.read<T>(shopId, nom)
      .then((eski) => {
        if (avlod.current !== meniki || eski === null) return;
        // `?? eski` — server bizdan oldin ulgurgan bo'lsa uni bosmaymiz.
        setData((hozir) => hozir ?? eski);
      })
      .catch(() => {});
  }, [shopId, nom]);

  const yangila = useCallback(async () => {
    const meniki = avlod.current;
    try {
      const yangi = await olib();
      if (avlod.current !== meniki) return;
      setData(yangi);
      setXato(null);
      if (shopId) await cache.write(shopId, nom, yangi).catch(() => {});
    } catch (e: any) {
      if (avlod.current !== meniki) return;
      // Internet yo'q. Keshda bir narsa bo'lsa — xato o'rniga o'sha.
      const eski = shopId ? await cache.read<T>(shopId, nom).catch(() => null) : null;
      if (avlod.current !== meniki) return;
      if (eski !== null) { setData((hozir) => hozir ?? eski); setXato(null); }
      else setXato(e?.message ?? 'Xatolik');
    }
  }, [olib, shopId, nom]);

  return { data, xato, yangila };
}
