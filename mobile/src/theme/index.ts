/**
 * Dizayn tizimi.
 * Bitta joyda: rang, oraliq, shrift. Ekranlarda "sehrli raqam" bo'lmasin.
 */
import { Platform } from 'react-native';

export const colors = {
  bg:        '#F5F6F8',
  surface:   '#FFFFFF',
  surfaceAlt:'#EEF1F5',

  text:      '#111827',
  textMuted: '#6B7280',
  textFaint: '#9CA3AF',

  border:    '#E5E7EB',

  primary:   '#1E5EFF',
  primarySoft:'#E8EFFF',

  success:   '#0E9F6E',
  successSoft:'#E3F6EF',
  danger:    '#E02424',
  dangerSoft:'#FDE8E8',
  warning:   '#C27803',
  warningSoft:'#FDF6E3',

  // Grafik va teglar uchun
  accent:    '#7E3AF2',
  accentSoft:'#F0E7FF',
} as const;

export const spacing = {
  xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32,
} as const;

export const radius = {
  sm: 8, md: 12, lg: 16, xl: 22, pill: 999,
} as const;

export const font = {
  h1: { fontSize: 28, fontWeight: '700' as const, letterSpacing: -0.5 },
  h2: { fontSize: 20, fontWeight: '700' as const, letterSpacing: -0.3 },
  h3: { fontSize: 17, fontWeight: '600' as const },
  body: { fontSize: 15, fontWeight: '400' as const },
  bodyBold: { fontSize: 15, fontWeight: '600' as const },
  small: { fontSize: 13, fontWeight: '400' as const },
  tiny: { fontSize: 11, fontWeight: '500' as const },
  mono: {
    fontSize: 15,
    fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }),
  },
} as const;

export const shadow = Platform.select({
  ios: {
    shadowColor: '#0B1220',
    shadowOpacity: 0.06,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
  },
  android: { elevation: 2 },
  default: {},
}) as object;

/** 12500 → "12 500". Do'konchi uchun eng o'qishli shakl. */
export function money(n: number | string | null | undefined): string {
  const v = Number(n ?? 0);
  if (!Number.isFinite(v)) return '0';
  return new Intl.NumberFormat('ru-RU').format(Math.round(v));
}

/** Miqdor: 2 → "2", 2.5 → "2.5" (keraksiz nollarsiz). */
export function qty(n: number | string | null | undefined): string {
  const v = Number(n ?? 0);
  if (!Number.isFinite(v)) return '0';
  return String(Math.round(v * 1000) / 1000);
}

export function dateLabel(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const isToday = d.toDateString() === today.toDateString();
  const yest = new Date(today); yest.setDate(today.getDate() - 1);
  const isYest = d.toDateString() === yest.toDateString();

  const time = d.toLocaleTimeString('uz-UZ', { hour: '2-digit', minute: '2-digit' });
  if (isToday) return `Bugun ${time}`;
  if (isYest) return `Kecha ${time}`;
  return d.toLocaleDateString('uz-UZ', { day: '2-digit', month: 'short' }) + ` ${time}`;
}
