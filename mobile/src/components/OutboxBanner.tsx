/**
 * NAVBAT BANNERI.
 *
 * Yuborilmagan o'zgarish borligini do'konchidan yashirib bo'lmaydi:
 * u savdo yozdi, ilova "yozildi" dedi — lekin server hali ko'rmagan.
 * Shu holat ekranning tepasida ochiq turadi.
 *
 * Shu yerda AVTOMATIK QAYTA YUBORISH ham bor:
 *   • ilova fonga tushib qaytganda (odatda internet shunda tiklanadi),
 *   • va har 30 soniyada, navbat bo'sh bo'lmaguncha.
 *
 * Alohida tarmoq kutubxonasi (netinfo) qo'shilmadi: `ApiError.status === 0`
 * allaqachon "ulanib bo'lmadi" degani, ya'ni urinishning o'zi eng
 * ishonchli tekshiruv.
 */
import { useEffect, useRef, useState } from 'react';
import { AppState, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInDown, FadeOut } from 'react-native-reanimated';
import * as outbox from '../lib/outbox';
import { PressScale } from './Press';
import { Icon } from './Icon';
import { colors, font, radius, spacing } from '../theme';

/** Navbat bo'sh bo'lmaganda shu oraliqda qayta urinamiz. */
const URINISH_MS = 30_000;

export function OutboxBanner() {
  const [holat, setHolat] = useState({ kutayotgan: 0, radEtilgan: 0 });
  const [yuborilmoqda, setYuborilmoqda] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => outbox.kuzat(setHolat), []);

  // Ilova fonga tushib qaytganda — internet ko'pincha shunda tiklanadi.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') outbox.flush().catch(() => {});
    });
    return () => sub.remove();
  }, []);

  // Navbat bo'sh bo'lmaguncha davriy urinish.
  useEffect(() => {
    if (holat.kutayotgan === 0) {
      if (timer.current) { clearInterval(timer.current); timer.current = null; }
      return;
    }
    if (timer.current) return;
    timer.current = setInterval(() => { outbox.flush().catch(() => {}); }, URINISH_MS);
    return () => {
      if (timer.current) { clearInterval(timer.current); timer.current = null; }
    };
  }, [holat.kutayotgan]);

  if (holat.kutayotgan === 0 && holat.radEtilgan === 0) return null;

  const rad = holat.radEtilgan > 0 && holat.kutayotgan === 0;

  return (
    <Animated.View entering={FadeInDown.duration(200)} exiting={FadeOut.duration(160)}>
      <PressScale
        accessibilityRole="button"
        accessibilityLabel={rad
          ? `${holat.radEtilgan} ta o'zgarish rad etildi`
          : `${holat.kutayotgan} ta o'zgarish yuborilmagan, hozir yuborish`}
        onPress={async () => {
          if (rad) return;
          setYuborilmoqda(true);
          await outbox.flush().catch(() => {});
          setYuborilmoqda(false);
        }}
        scale={0.99}
        style={[s.banner, rad ? s.xato : s.kutish]}
      >
        <Icon
          name={rad ? 'ogohlantirish' : 'tuzatish'}
          size={15}
          color={rad ? colors.danger : colors.warning}
        />
        <Text
          style={[font.tiny, { color: rad ? colors.danger : colors.warning, flex: 1 }]}
          numberOfLines={2}
        >
          {rad
            ? `${holat.radEtilgan} ta o'zgarish qabul qilinmadi — sozlamalardan ko'ring`
            : yuborilmoqda
              ? 'Yuborilmoqda…'
              : `${holat.kutayotgan} ta o'zgarish yuborilmagan — internet kelganda o'zi yuboriladi`}
        </Text>
      </PressScale>
    </Animated.View>
  );
}

const s = StyleSheet.create({
  banner: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    marginHorizontal: spacing.lg, marginBottom: spacing.sm,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    borderRadius: radius.md, borderWidth: 1,
  },
  kutish: { backgroundColor: colors.warningSoft, borderColor: colors.warningLine },
  xato:   { backgroundColor: colors.dangerSoft,  borderColor: colors.dangerLine },
});
