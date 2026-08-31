import React from 'react';
import {
  ActivityIndicator, Pressable, StyleSheet, Text, TextInput,
  View, type TextInputProps, type ViewStyle,
} from 'react-native';
import { colors, font, radius, shadow, spacing } from '../theme';
import { Icon, type IconName } from './Icon';

/* --------------------------------- Karta -------------------------------- */

export function Card({ children, style, onPress }: {
  children: React.ReactNode; style?: ViewStyle; onPress?: () => void;
}) {
  const content = <View style={[s.card, style]}>{children}</View>;
  if (!onPress) return content;
  return (
    <Pressable onPress={onPress} style={({ pressed }) => pressed && { opacity: 0.7 }}>
      {content}
    </Pressable>
  );
}

/* --------------------------------- Tugma -------------------------------- */

type BtnVariant = 'primary' | 'secondary' | 'danger' | 'ghost';

export function Button({ title, onPress, variant = 'primary', loading, disabled, style, icon }: {
  title: string; onPress?: () => void; variant?: BtnVariant;
  loading?: boolean; disabled?: boolean; style?: ViewStyle; icon?: IconName;
}) {
  const off = disabled || loading;
  const palette: Record<BtnVariant, { bg: string; fg: string; border?: string }> = {
    primary:   { bg: colors.primary,    fg: '#fff' },
    secondary: { bg: colors.surfaceAlt, fg: colors.text },
    danger:    { bg: colors.dangerSoft, fg: colors.danger },
    ghost:     { bg: 'transparent',     fg: colors.primary, border: colors.border },
  };
  const p = palette[variant];

  return (
    <Pressable
      onPress={off ? undefined : onPress}
      style={({ pressed }) => [
        s.btn,
        { backgroundColor: p.bg },
        p.border ? { borderWidth: 1, borderColor: p.border } : null,
        off && { opacity: 0.45 },
        pressed && !off && { opacity: 0.8 },
        style,
      ]}
    >
      {loading
        ? <ActivityIndicator color={p.fg} size="small" />
        : (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
            {icon ? <Icon name={icon} size={18} color={p.fg} /> : null}
            <Text style={[font.bodyBold, { color: p.fg }]}>{title}</Text>
          </View>
        )}
    </Pressable>
  );
}

/* --------------------------------- Input -------------------------------- */

/**
 * `style` — tashqi o'ram uchun (masalan `flex: 1`).
 * Maydonning o'ziga uslub kerak bo'lsa `inputStyle` ishlatiladi.
 */
export function Field({ label, hint, error, style, inputStyle, ...props }:
  Omit<TextInputProps, 'style'> & {
    label?: string; hint?: string; error?: string;
    style?: ViewStyle; inputStyle?: TextInputProps['style'];
  }) {
  return (
    <View style={[{ gap: spacing.xs }, style]}>
      {label ? <Text style={[font.small, { color: colors.textMuted }]}>{label}</Text> : null}
      <TextInput
        placeholderTextColor={colors.textFaint}
        {...props}
        style={[s.input, error ? { borderColor: colors.danger } : null, inputStyle]}
      />
      {error
        ? <Text style={[font.tiny, { color: colors.danger }]}>{error}</Text>
        : hint ? <Text style={[font.tiny, { color: colors.textFaint }]}>{hint}</Text> : null}
    </View>
  );
}

/* ---------------------------------- Teg --------------------------------- */

export function Badge({ text, tone = 'neutral' }: {
  text: string;
  tone?: 'neutral' | 'success' | 'danger' | 'warning' | 'primary' | 'accent';
}) {
  const tones = {
    neutral: { bg: colors.surfaceAlt,  fg: colors.textMuted },
    success: { bg: colors.successSoft, fg: colors.success },
    danger:  { bg: colors.dangerSoft,  fg: colors.danger },
    warning: { bg: colors.warningSoft, fg: colors.warning },
    primary: { bg: colors.primarySoft, fg: colors.primary },
    accent:  { bg: colors.accentSoft,  fg: colors.accent },
  } as const;
  const t = tones[tone];
  return (
    <View style={[s.badge, { backgroundColor: t.bg }]}>
      <Text style={[font.tiny, { color: t.fg }]}>{text}</Text>
    </View>
  );
}

/* ------------------------------ Bo'sh holat ------------------------------ */

export function Empty({ icon = 'bosh', title, hint }: {
  icon?: IconName; title: string; hint?: string;
}) {
  return (
    <View style={s.empty}>
      <Icon name={icon} size={40} color={colors.textFaint} />
      <Text style={[font.h3, { color: colors.text, textAlign: 'center' }]}>{title}</Text>
      {hint ? (
        <Text style={[font.small, { color: colors.textMuted, textAlign: 'center' }]}>{hint}</Text>
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

const s = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    ...shadow,
  },
  btn: {
    height: 50,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    paddingHorizontal: spacing.lg,
  },
  input: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    height: 48,
    fontSize: 16,
    color: colors.text,
  },
  badge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: radius.pill,
    alignSelf: 'flex-start',
  },
  empty: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.xxl * 1.5,
    paddingHorizontal: spacing.xl,
  },
  sectionTitle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
    marginTop: spacing.lg,
  },
});
