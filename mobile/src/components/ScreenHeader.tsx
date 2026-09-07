/**
 * EKRAN SARLAVHASI
 * ================
 * Ilgari har ekran o'z sarlavhasini qo'lda yozardi — natijada `+` tugmasi
 * bir joyda 44px, boshqasida 40px bo'lib qolgandi. Endi bitta manba.
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors, font, spacing } from '../theme';
import { IconButton } from './ui';
import { type IconName } from './Icon';

export function ScreenHeader({ title, subtitle, eyebrow, action, left }: {
  title: string;
  /** Sarlavha ostidagi qatorda: "12 ta mahsulot · 4.2 mln so'mlik tovar" */
  subtitle?: string;
  /** Sarlavha ustidagi kichik qator: "Assalomu alaykum, Alisher" */
  eyebrow?: string;
  action?: { icon: IconName; label: string; onPress: () => void };
  left?: React.ReactNode;
}) {
  return (
    <View style={s.wrap}>
      {left}
      <View style={{ flex: 1, gap: 1 }}>
        {eyebrow ? (
          <Text style={[font.small, { color: colors.textMuted }]} numberOfLines={1}>
            {eyebrow}
          </Text>
        ) : null}
        <Text style={[font.h1, { color: colors.text }]} numberOfLines={1}>{title}</Text>
        {subtitle ? (
          <Text style={[font.small, { color: colors.textMuted }]} numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {action ? (
        <IconButton
          name={action.icon} label={action.label} onPress={action.onPress}
          tone="primary" size={22}
        />
      ) : null}
    </View>
  );
}

/**
 * Modal ekran sarlavhasi.
 * Modal — vaqtincha oyna, shuning uchun chapda "yopish" ✕ turadi, sarlavha
 * markazda. Oddiy ekranning sarlavhasidan ataylab farq qiladi: foydalanuvchi
 * qayerda turganini shakldan biladi.
 */
export function ModalHeader({ title, onClose, right }: {
  title: string;
  onClose: () => void;
  right?: React.ReactNode;
}) {
  return (
    <View style={s.modal}>
      <IconButton name="yopish" label="Yopish" onPress={onClose} size={22} />
      <Text style={[font.h3, { color: colors.text, flex: 1, textAlign: 'center' }]}>
        {title}
      </Text>
      <View style={{ minWidth: 44, alignItems: 'flex-end' }}>{right}</View>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.md,
  },
  modal: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1, borderBottomColor: colors.borderSoft,
    backgroundColor: colors.surface,
  },
});
