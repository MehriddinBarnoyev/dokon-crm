/**
 * TOAST
 * =====
 * `Alert.alert` — tizim oynasi: ilovaning brendi yo'q, ekranni to'sadi va
 * foydalanuvchidan "OK" bosishni talab qiladi. Xato haqida xabar berish
 * uchun bu juda qimmat. Toast yuqoridan tushadi, o'zi ketadi, ish to'xtamaydi.
 *
 * Ishlatish:
 *   const toast = useToast();
 *   toast.ok('Savdo saqlandi');
 *   toast.xato(e.message);
 */
import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { FadeInUp, FadeOutUp } from 'react-native-reanimated';
import { colors, elevation, font, radius, spacing } from '../theme';
import { Icon, type IconName } from './Icon';
import { haptic } from '../lib/haptics';

type Kind = 'ok' | 'xato' | 'ogoh' | 'info';

interface Item { id: number; kind: Kind; text: string }

const LOOK: Record<Kind, { bg: string; fg: string; line: string; icon: IconName }> = {
  ok:   { bg: colors.successSoft, fg: colors.success, line: colors.successLine, icon: 'tasdiq' },
  xato: { bg: colors.dangerSoft,  fg: colors.danger,  line: colors.dangerLine,  icon: 'ogohlantirish' },
  ogoh: { bg: colors.warningSoft, fg: colors.warning, line: colors.warningLine, icon: 'ogohlantirish' },
  info: { bg: colors.surface,     fg: colors.text,    line: colors.border,      icon: 'ai' },
};

interface Api {
  ok: (text: string) => void;
  xato: (text: string) => void;
  ogoh: (text: string) => void;
  info: (text: string) => void;
}

const Ctx = createContext<Api | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<Item[]>([]);
  const insets = useSafeAreaInsets();
  const seq = useRef(0);

  const show = useCallback((kind: Kind, text: string) => {
    const id = ++seq.current;
    setItems((x) => [...x, { id, kind, text }]);
    if (kind === 'ok') haptic.ok();
    else if (kind === 'xato') haptic.xato();
    else if (kind === 'ogoh') haptic.ogoh();
    // Xato uzunroq turadi — o'qib ulgurish kerak.
    setTimeout(() => setItems((x) => x.filter((i) => i.id !== id)),
      kind === 'xato' ? 4200 : 2600);
  }, []);

  const api = useMemo<Api>(() => ({
    ok:   (t) => show('ok', t),
    xato: (t) => show('xato', t),
    ogoh: (t) => show('ogoh', t),
    info: (t) => show('info', t),
  }), [show]);

  return (
    <Ctx.Provider value={api}>
      {children}
      <View pointerEvents="none" style={[s.host, { top: insets.top + spacing.sm }]}>
        {items.map((i) => {
          const l = LOOK[i.kind];
          return (
            <Animated.View
              key={i.id}
              entering={FadeInUp.duration(220)}
              exiting={FadeOutUp.duration(180)}
              style={[s.toast, { backgroundColor: l.bg, borderColor: l.line }]}
            >
              <Icon name={l.icon} size={18} color={l.fg} />
              <Text style={[font.smallBold, { color: l.fg, flex: 1 }]} numberOfLines={3}>
                {i.text}
              </Text>
            </Animated.View>
          );
        })}
      </View>
    </Ctx.Provider>
  );
}

export function useToast(): Api {
  const v = useContext(Ctx);
  if (!v) throw new Error('useToast — ToastProvider ichida chaqirilishi kerak');
  return v;
}

const s = StyleSheet.create({
  host: {
    position: 'absolute', left: spacing.md, right: spacing.md,
    gap: spacing.sm, zIndex: 100,
  },
  toast: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    paddingHorizontal: spacing.md, paddingVertical: spacing.md,
    borderRadius: radius.md, borderWidth: 1,
    ...elevation[3],
  },
});
