/**
 * USTUNLI GRAFIK
 * ==============
 * Eski variantda ustunlar shunchaki `View` edi: bosib bo'lmasdi, eng baland
 * kun ajralib turmasdi, raqamlar ustun tepasida siqilib qolardi.
 *
 * Endi: bitta kun tanlanadi va uning to'liq summasi tepada ko'rinadi —
 * grafik "rasm" emas, o'qish mumkin bo'lgan asbob.
 */
import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, { FadeIn, LinearTransition } from 'react-native-reanimated';
import { colors, font, money, moneyShort, palette, radius, spacing } from '../theme';
import { PressScale } from './Press';

export interface Bar {
  /** Ustun ostidagi qisqa yorliq: "Du", "Se" */
  label: string;
  value: number;
  /** Bosilganda qayerga o'tish (masalan o'sha kun sahifasi). */
  onPress?: () => void;
  /** Bugun — boshqacha ajratib ko'rsatiladi. */
  highlight?: boolean;
}

export function BarChart({ bars, height = 108, caption }: {
  bars: Bar[]; height?: number; caption?: string;
}) {
  // Boshida bugun (yoki oxirgi kun) tanlangan turadi.
  const [sel, setSel] = useState<number>(() => {
    const i = bars.findIndex((b) => b.highlight);
    return i >= 0 ? i : bars.length - 1;
  });

  const max = Math.max(1, ...bars.map((b) => b.value));
  const active = bars[Math.min(sel, bars.length - 1)];

  return (
    <View style={{ gap: spacing.md }}>
      <View style={s.top}>
        <View style={{ flex: 1 }}>
          <Text style={[font.tiny, { color: colors.textMuted }]}>
            {caption ?? active?.label}
          </Text>
          <Animated.Text
            key={sel}
            entering={FadeIn.duration(160)}
            style={[font.h2, { color: colors.text }]}
          >
            {money(active?.value ?? 0)} <Text style={[font.small, { color: colors.textFaint }]}>so'm</Text>
          </Animated.Text>
        </View>
        <View style={s.peak}>
          <Text style={[font.tiny, { color: colors.textMuted }]}>
            eng ko'p {moneyShort(max)}
          </Text>
        </View>
      </View>

      <View style={[s.plot, { height }]}>
        {/* Yordamchi chiziq — ustunlar qaysi darajada ekani ko'rinsin */}
        <View style={[s.guide, { bottom: height * 0.5 }]} />
        <View style={[s.guide, { bottom: height - 1 }]} />

        {bars.map((b, i) => {
          const on = i === sel;
          const h = Math.max(3, (b.value / max) * (height - 6));
          return (
            <PressScale
              key={`${b.label}-${i}`}
              accessibilityRole="button"
              accessibilityLabel={`${b.label}: ${money(b.value)} so'm`}
              onPress={() => { setSel(i); b.onPress?.(); }}
              scale={0.92}
              style={s.col}
            >
              <Animated.View layout={LinearTransition.duration(180)} style={{ width: '100%', alignItems: 'center' }}>
                <View style={[s.barWrap, { height }]}>
                  <LinearGradient
                    colors={on
                      ? [palette.blue[400], colors.primary]
                      : [palette.blue[100], palette.blue[200]]}
                    start={{ x: 0, y: 0 }} end={{ x: 0, y: 1 }}
                    style={[s.bar, { height: h }]}
                  />
                </View>
              </Animated.View>
              <Text style={[font.tiny, { color: on ? colors.primary : colors.textFaint }]}>
                {b.label}
              </Text>
            </PressScale>
          );
        })}
      </View>

    </View>
  );
}

const s = StyleSheet.create({
  top: { flexDirection: 'row', alignItems: 'flex-end' },
  plot: {
    flexDirection: 'row', alignItems: 'flex-end',
    justifyContent: 'space-between', gap: spacing.xs,
  },
  guide: {
    position: 'absolute', left: 0, right: 0, height: 1,
    backgroundColor: colors.borderSoft,
  },
  col: { flex: 1, alignItems: 'center', gap: 6 },
  barWrap: { width: '72%', justifyContent: 'flex-end' },
  bar: { width: '100%', borderRadius: radius.xs, minHeight: 3 },
  peak: {
    paddingHorizontal: spacing.sm, paddingVertical: 4,
    borderRadius: radius.pill, backgroundColor: colors.surfaceAlt,
  },
});
