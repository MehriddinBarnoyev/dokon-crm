/**
 * SKELET
 * ======
 * Yuklanayotganda bo'sh ekran + spinner ko'rsatish — ilova qotib qolgandek
 * tuyuladi. Skelet kontentning SHAKLINI oldindan chizadi: ko'z qayerga
 * qarashini biladi, kontent kelganda sakrash bo'lmaydi.
 */
import React, { useEffect } from 'react';
import { View, StyleSheet, type ViewStyle, type StyleProp } from 'react-native';
import Animated, {
  useAnimatedStyle, useSharedValue, withRepeat, withTiming, Easing,
} from 'react-native-reanimated';
import { colors, radius, spacing, elevation } from '../theme';

export function Skeleton({ w, h = 14, r = radius.xs, style }: {
  w?: number | `${number}%`; h?: number; r?: number; style?: StyleProp<ViewStyle>;
}) {
  const pulse = useSharedValue(0.55);

  useEffect(() => {
    pulse.value = withRepeat(
      withTiming(1, { duration: 850, easing: Easing.inOut(Easing.quad) }),
      -1, true,
    );
  }, [pulse]);

  const anim = useAnimatedStyle(() => ({ opacity: pulse.value }));

  return (
    <Animated.View
      style={[
        { width: w ?? '100%', height: h, borderRadius: r, backgroundColor: colors.shimmer },
        anim, style,
      ]}
    />
  );
}

/** Ro'yxat elementi shaklidagi skelet: rasm + ikki qator + o'ngda summa. */
export function SkeletonRow() {
  return (
    <View style={s.row}>
      <Skeleton w={46} h={46} r={radius.md} />
      <View style={{ flex: 1, gap: spacing.sm }}>
        <Skeleton w="70%" h={13} />
        <Skeleton w="45%" h={11} />
      </View>
      <Skeleton w={62} h={15} />
    </View>
  );
}

/** Karta shaklidagi skelet: sarlavha + katta raqam + uch ustun. */
export function SkeletonCard({ lines = 3 }: { lines?: number }) {
  return (
    <View style={s.card}>
      <Skeleton w="40%" h={11} />
      <Skeleton w="62%" h={30} r={radius.sm} style={{ marginTop: spacing.sm }} />
      <View style={s.cardCols}>
        {Array.from({ length: lines }).map((_, i) => (
          <View key={i} style={{ flex: 1, gap: 6 }}>
            <Skeleton w="70%" h={10} />
            <Skeleton w="90%" h={14} />
          </View>
        ))}
      </View>
    </View>
  );
}

/** Ekran yuklanayotgandagi standart ko'rinish. */
export function SkeletonList({ rows = 6 }: { rows?: number }) {
  return (
    <View style={{ gap: spacing.sm }}>
      {Array.from({ length: rows }).map((_, i) => <SkeletonRow key={i} />)}
    </View>
  );
}

const s = StyleSheet.create({
  row: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    backgroundColor: colors.surface, borderRadius: radius.lg,
    padding: spacing.md,
    borderWidth: 1, borderColor: colors.borderSoft,
  },
  card: {
    backgroundColor: colors.surface, borderRadius: radius.lg,
    padding: spacing.lg,
    borderWidth: 1, borderColor: colors.borderSoft,
    ...elevation[1],
  },
  cardCols: {
    flexDirection: 'row', gap: spacing.md,
    marginTop: spacing.lg, paddingTop: spacing.md,
    borderTopWidth: 1, borderTopColor: colors.borderSoft,
  },
});
