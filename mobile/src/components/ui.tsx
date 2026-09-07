import React, { useState } from 'react';
import {
  ActivityIndicator, StyleSheet, Text, TextInput,
  View, type TextInputProps, type ViewStyle, type StyleProp,
} from 'react-native';
import { colors, elevation, font, radius, spacing, HIT } from '../theme';
import { Icon, type IconName } from './Icon';
import { PressScale } from './Press';
import { haptic } from '../lib/haptics';

/* --------------------------------- Karta -------------------------------- */

/**
 * `tone` — kartaning vazifasi:
 *   plain  — oddiy karta (oq, yengil soya)
 *   raised — sahifaning asosiy kartasi (kuchliroq soya)
 *   flat   — ro'yxat ichidagi element (soyasiz, faqat chiziq)
 */
export function Card({ children, style, onPress, tone = 'plain', accent }: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  onPress?: () => void;
  tone?: 'plain' | 'raised' | 'flat';
  /** Chap chekkadagi rangli chiziq — kartaning holatini bir qarashda bildiradi. */
  accent?: string;
}) {
  const box: StyleProp<ViewStyle> = [
    s.card,
    tone === 'raised' ? elevation[2] : tone === 'plain' ? elevation[1] : null,
    accent ? { borderLeftWidth: 3, borderLeftColor: accent } : null,
    style,
  ];

  if (!onPress) return <View style={box}>{children}</View>;
  return <PressScale style={box} onPress={onPress} scale={0.985}>{children}</PressScale>;
}

/* --------------------------------- Tugma -------------------------------- */

type BtnVariant = 'primary' | 'secondary' | 'danger' | 'ghost' | 'soft';
type BtnSize = 'sm' | 'md' | 'lg';

const SIZES: Record<BtnSize, { h: number; px: number; text: object; icon: number }> = {
  sm: { h: 38, px: spacing.md, text: font.smallBold, icon: 16 },
  md: { h: 48, px: spacing.lg, text: font.bodyBold,  icon: 18 },
  lg: { h: 54, px: spacing.xl, text: font.h3,        icon: 20 },
};

export function Button({
  title, onPress, variant = 'primary', size = 'md',
  loading, disabled, style, icon, iconRight, full = true,
}: {
  title: string; onPress?: () => void; variant?: BtnVariant; size?: BtnSize;
  loading?: boolean; disabled?: boolean; style?: StyleProp<ViewStyle>;
  icon?: IconName; iconRight?: IconName;
  /** false — tugma kengligi matnga qarab (qatorda yonma-yon turadi). */
  full?: boolean;
}) {
  const off = disabled || loading;
  const palette: Record<BtnVariant, { bg: string; fg: string; border?: string }> = {
    primary:   { bg: colors.primary,     fg: colors.onPrimary },
    secondary: { bg: colors.surfaceAlt,  fg: colors.text },
    soft:      { bg: colors.primarySoft, fg: colors.primary },
    danger:    { bg: colors.dangerSoft,  fg: colors.danger, border: colors.dangerLine },
    ghost:     { bg: 'transparent',      fg: colors.primary, border: colors.border },
  };
  const p = palette[variant];
  const z = SIZES[size];

  return (
    <PressScale
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ disabled: Boolean(off), busy: Boolean(loading) }}
      disabled={off}
      // Yuklanayotganda rang saqlanadi — aks holda oq spinner
      // xiralashgan fonda ko'rinmay qoladi.
      dim={!loading}
      onPress={onPress}
      scale={0.96}
      feedback={variant === 'primary'}
      style={[
        s.btn,
        { height: z.h, paddingHorizontal: z.px, backgroundColor: p.bg },
        full ? null : { alignSelf: 'flex-start' },
        p.border ? { borderWidth: 1, borderColor: p.border } : null,
        variant === 'primary' && !disabled ? elevation[1] : null,
        style,
      ]}
    >
      {loading
        ? <ActivityIndicator color={p.fg} size="small" />
        : (
          <View style={s.btnInner}>
            {icon ? <Icon name={icon} size={z.icon} color={p.fg} /> : null}
            <Text style={[z.text, { color: p.fg }]} numberOfLines={1}>{title}</Text>
            {iconRight ? <Icon name={iconRight} size={z.icon} color={p.fg} /> : null}
          </View>
        )}
    </PressScale>
  );
}

/**
 * Faqat ikonkali tugma. Ko'rinishi kichik bo'lsa ham bosish maydoni
 * har doim 44px — barmoq uchun eng kichik nishon.
 */
export function IconButton({
  name, onPress, label, tone = 'plain', size = 20, style,
}: {
  name: IconName; onPress?: () => void;
  /** Skrinrider shuni o'qiydi. Ikonkaning o'zi hech narsa demaydi. */
  label: string;
  tone?: 'plain' | 'primary' | 'soft' | 'danger';
  size?: number; style?: StyleProp<ViewStyle>;
}) {
  const tones = {
    plain:   { bg: 'transparent',      fg: colors.textMuted },
    primary: { bg: colors.primary,     fg: colors.onPrimary },
    soft:    { bg: colors.primarySoft, fg: colors.primary },
    danger:  { bg: colors.dangerSoft,  fg: colors.danger },
  } as const;
  const t = tones[tone];

  return (
    <PressScale
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      scale={0.9}
      style={[
        s.iconBtn,
        { backgroundColor: t.bg },
        tone === 'primary' ? elevation[1] : null,
        style,
      ]}
    >
      <Icon name={name} size={size} color={t.fg} />
    </PressScale>
  );
}

/* --------------------------------- Input -------------------------------- */

/**
 * `style` — tashqi o'ram uchun (masalan `flex: 1`).
 * Maydonning o'ziga uslub kerak bo'lsa `inputStyle` ishlatiladi.
 */
export function Field({
  label, hint, error, style, inputStyle, inputRef, suffix, ...props
}: Omit<TextInputProps, 'style'> & {
  label?: string; hint?: string; error?: string;
  style?: StyleProp<ViewStyle>; inputStyle?: TextInputProps['style'];
  /** O'ng chekkadagi doimiy matn: "so'm", "dona". */
  suffix?: string;
  /** Fokusni tashqaridan boshqarish uchun (masalan, saqlab bo'lgach nomga qaytish). */
  inputRef?: React.Ref<TextInput>;
}) {
  const [focused, setFocused] = useState(false);

  return (
    <View style={[{ gap: 6 }, style]}>
      {label ? <Text style={[font.label, { color: colors.textMuted }]}>{label}</Text> : null}

      <View style={[
        s.inputBox,
        focused ? s.inputBoxOn : null,
        error ? { borderColor: colors.danger, backgroundColor: colors.dangerSoft } : null,
      ]}>
        <TextInput
          ref={inputRef}
          placeholderTextColor={colors.textFaint}
          {...props}
          onFocus={(e) => { setFocused(true); props.onFocus?.(e); }}
          onBlur={(e) => { setFocused(false); props.onBlur?.(e); }}
          style={[s.input, inputStyle]}
        />
        {suffix ? (
          <Text style={[font.small, { color: colors.textFaint, paddingRight: spacing.md }]}>
            {suffix}
          </Text>
        ) : null}
      </View>

      {error
        ? <Text style={[font.tiny, { color: colors.danger }]}>{error}</Text>
        : hint ? <Text style={[font.tiny, { color: colors.textFaint }]}>{hint}</Text> : null}
    </View>
  );
}

/* ---------------------------------- Teg --------------------------------- */

export type Tone = 'neutral' | 'success' | 'danger' | 'warning' | 'primary' | 'accent';

const TONES: Record<Tone, { bg: string; fg: string; line: string }> = {
  neutral: { bg: colors.surfaceAlt,  fg: colors.textMuted, line: colors.border },
  success: { bg: colors.successSoft, fg: colors.success,   line: colors.successLine },
  danger:  { bg: colors.dangerSoft,  fg: colors.danger,    line: colors.dangerLine },
  warning: { bg: colors.warningSoft, fg: colors.warning,   line: colors.warningLine },
  primary: { bg: colors.primarySoft, fg: colors.primary,   line: colors.primaryLine },
  accent:  { bg: colors.accentSoft,  fg: colors.accent,    line: colors.accentLine },
};

export function Badge({ text, tone = 'neutral', dot }: {
  text: string; tone?: Tone;
  /** Chapda kichik nuqta — holat tegi ekanini bildiradi. */
  dot?: boolean;
}) {
  const t = TONES[tone];
  return (
    <View style={[s.badge, { backgroundColor: t.bg, borderColor: t.line }]}>
      {dot ? <View style={[s.dot, { backgroundColor: t.fg }]} /> : null}
      <Text style={[font.tiny, { color: t.fg }]}>{text}</Text>
    </View>
  );
}

/** Tanlanadigan yorliq: filtr, davr, bo'lim. */
export function Chip({ label, active, onPress, count }: {
  label: string; active?: boolean; onPress?: () => void; count?: number;
}) {
  return (
    <PressScale
      accessibilityRole="button"
      accessibilityState={{ selected: Boolean(active) }}
      accessibilityLabel={label}
      onPress={() => { haptic.tap(); onPress?.(); }}
      scale={0.94}
      style={[s.chip, active ? s.chipOn : null]}
    >
      <Text style={[font.smallBold, { color: active ? colors.onPrimary : colors.textMuted }]}>
        {label}
      </Text>
      {typeof count === 'number' && count > 0 ? (
        <View style={[s.chipCount, active ? { backgroundColor: 'rgba(255,255,255,0.25)' } : null]}>
          <Text style={[font.tiny, { color: active ? colors.onPrimary : colors.primary }]}>
            {count}
          </Text>
        </View>
      ) : null}
    </PressScale>
  );
}

/* ------------------------------ Bo'sh holat ------------------------------ */

export function Empty({ icon = 'bosh', title, hint, action }: {
  icon?: IconName; title: string; hint?: string;
  action?: { title: string; onPress: () => void; icon?: IconName };
}) {
  return (
    <View style={s.empty}>
      <View style={s.emptyIcon}>
        <Icon name={icon} size={30} color={colors.primary} />
      </View>
      <Text style={[font.h3, { color: colors.text, textAlign: 'center' }]}>{title}</Text>
      {hint ? (
        <Text style={[font.small, { color: colors.textMuted, textAlign: 'center' }]}>{hint}</Text>
      ) : null}
      {action ? (
        <Button
          title={action.title} icon={action.icon} onPress={action.onPress}
          size="sm" variant="soft" full={false} style={{ marginTop: spacing.sm }}
        />
      ) : null}
    </View>
  );
}

export function Loading({ text }: { text?: string }) {
  return (
    <View style={s.empty}>
      <ActivityIndicator color={colors.primary} />
      {text ? <Text style={[font.small, { color: colors.textMuted }]}>{text}</Text> : null}
    </View>
  );
}

/** Ro'yxatlar orasidagi bo'lim sarlavhasi */
export function SectionTitle({ children, right }: {
  children: React.ReactNode; right?: React.ReactNode;
}) {
  return (
    <View style={s.sectionTitle}>
      <Text style={[font.h3, { color: colors.text }]}>{children}</Text>
      {right}
    </View>
  );
}

export function Divider({ inset = 0 }: { inset?: number }) {
  return <View style={{ height: 1, backgroundColor: colors.borderSoft, marginLeft: inset }} />;
}

/** Karta ichidagi bitta ko'rsatkich: kichik yorliq + qiymat. */
export function Stat({ label, value, tone, suffix }: {
  label: string; value: string; tone?: string; suffix?: string;
}) {
  return (
    <View style={{ flex: 1, gap: 3 }}>
      <Text style={[font.tiny, { color: colors.textMuted }]} numberOfLines={2}>{label}</Text>
      <Text style={[font.num, { color: tone ?? colors.text }]} numberOfLines={1}>
        {value}
        {suffix ? <Text style={[font.tiny, { color: colors.textFaint }]}> {suffix}</Text> : null}
      </Text>
    </View>
  );
}

/* -------------------------------- Uslublar ------------------------------- */

const s = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.borderSoft,
  },
  btn: {
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
  },
  btnInner: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  iconBtn: {
    minWidth: HIT, minHeight: HIT,
    borderRadius: radius.md,
    alignItems: 'center', justifyContent: 'center',
  },
  inputBox: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.md,
    height: 50,
  },
  // Fokusdagi maydon ko'zga tashlansin — qaysi joyga yozayotganim aniq bo'lsin
  inputBoxOn: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  input: {
    flex: 1,
    paddingHorizontal: spacing.md,
    height: '100%',
    fontSize: 16,
    fontFamily: 'Inter_500Medium',
    color: colors.text,
  },
  badge: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: radius.pill,
    borderWidth: 1,
    alignSelf: 'flex-start',
  },
  dot: { width: 5, height: 5, borderRadius: 3 },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: spacing.md, paddingVertical: 9,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1, borderColor: colors.borderSoft,
  },
  chipOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipCount: {
    minWidth: 18, paddingHorizontal: 4, borderRadius: 9,
    backgroundColor: colors.primarySoft, alignItems: 'center',
  },
  empty: {
    alignItems: 'center', justifyContent: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.xxl * 1.4,
    paddingHorizontal: spacing.xl,
  },
  emptyIcon: {
    width: 64, height: 64, borderRadius: radius.xl,
    backgroundColor: colors.primarySoft,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: spacing.xs,
  },
  sectionTitle: {
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.sm, marginTop: spacing.lg,
  },
});
