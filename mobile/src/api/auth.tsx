import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { api, setToken, getToken, setUnauthorizedHandler } from './client';
import type { Shop, User } from './types';

interface AuthState {
  user: User | null;
  shop: Shop | null;
  loading: boolean;
  login(phone: string, password: string): Promise<void>;
  register(shopName: string, name: string, phone: string, password: string): Promise<void>;
  logout(): Promise<void>;
}

const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [shop, setShop] = useState<Shop | null>(null);
  const [loading, setLoading] = useState(true);

  // Server seansni rad etsa (hisob o'chirilgan, do'kon o'zgargan) —
  // darhol kirish ekraniga qaytamiz
  useEffect(() => {
    setUnauthorizedHandler(() => { setUser(null); setShop(null); });
    return () => setUnauthorizedHandler(null);
  }, []);

  // Ilova ochilganda saqlangan token bilan seansni tiklaymiz
  useEffect(() => {
    (async () => {
      try {
        if (await getToken()) {
          const me = await api<{ user: User; shop: Shop }>('/auth/me');
          setUser(me.user);
          setShop(me.shop);
        }
      } catch {
        await setToken(null);   // token eskirgan
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const value = useMemo<AuthState>(() => ({
    user, shop, loading,

    async login(phone, password) {
      const res = await api<{ token: string; user: User }>('/auth/login', {
        method: 'POST', body: { phone, password },
      });
      await setToken(res.token);
      const me = await api<{ user: User; shop: Shop }>('/auth/me');
      setUser(me.user); setShop(me.shop);
    },

    async register(shopName, name, phone, password) {
      const res = await api<{ token: string; user: User }>('/auth/register', {
        method: 'POST', body: { shop_name: shopName, name, phone, password },
      });
      await setToken(res.token);
      const me = await api<{ user: User; shop: Shop }>('/auth/me');
      setUser(me.user); setShop(me.shop);
    },

    async logout() {
      await setToken(null);
      setUser(null); setShop(null);
    },
  }), [user, shop, loading]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useAuth faqat AuthProvider ichida ishlaydi');
  return ctx;
}
