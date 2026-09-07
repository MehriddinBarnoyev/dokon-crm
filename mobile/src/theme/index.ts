/**
 * DIZAYN TIZIMI
 * =============
 * Bitta manba: rang, oraliq, shrift, soya, harakat.
 * Ekranlarda "sehrli raqam" bo'lmasin — hammasi shu yerdan chiqadi.
 *
 * Ranglar ikki qatlamda:
 *   1) `palette` — xom shkala (blue.600, neutral.200). Yangi komponent yozganda.
 *   2) `colors`  — ma'noli nomlar (bg, surface, text, primary). Kundalik ish uchun.
 * Ekranlar `colors` bilan ishlaydi; `palette` faqat oraliq soya kerak bo'lganda.
 */
import { Platform, type TextStyle } from 'react-native';

/* ------------------------------- Palitra -------------------------------- */

/**
 * Brend ko'ki. Eski #1E5EFF shu shkalaning 500-pog'onasiga yaqin —
 * ilova tanish bo'lib qoladi, lekin asosiy rang 600 ga chuqurlashtirildi:
 * oq karta ustida kontrast yuqori, "neon" hissi yo'qoladi.
 */
const blue = {
  50:  '#F0F4FF',
  100: '#DFE8FF',
  200: '#C2D2FF',
  300: '#97B0FF',
  400: '#6685FF',
  500: '#3D62FB',
  600: '#1B4FE0',
  700: '#1440B8',
  800: '#153793',
  900: '#163174',
} as const;

/** Salqin neytral shkala. 3 ta emas, 10 ta pog'ona — ierarxiya shundan chiqadi. */
const neutral = {
  0:   '#FFFFFF',
  25:  '#FBFCFD',
  50:  '#F6F8FA',
  100: '#EDF0F4',
  200: '#E1E6EC',
  300: '#CBD3DD',
  400: '#9AA5B4',
  500: '#6B7684',
  600: '#4E5866',
  700: '#3A424E',
  800: '#262C36',
  900: '#151A21',
} as const;

const green  = { 50: '#E9F7F1', 100: '#CDEDE0', 600: '#0B8F5F', 700: '#076C48' } as const;
const red    = { 50: '#FEECEB', 100: '#FCD9D6', 600: '#D92D20', 700: '#B42318' } as const;
const amber  = { 50: '#FEF4E6', 100: '#FCE7C4', 600: '#B54708', 700: '#93370D' } as const;
const violet = { 50: '#F3EDFF', 100: '#E5D8FF', 600: '#6C3CE0', 700: '#5A2FBE' } as const;

export const palette = { blue, neutral, green, red, amber, violet } as const;

/* --------------------------- Ma'noli ranglar ---------------------------- */

export const colors = {
  /* Fon va yuzalar */
  bg:         neutral[50],
  bgDeep:     neutral[100],
  surface:    neutral[0],
  surfaceAlt: neutral[100],
  surfaceSunken: neutral[50],

  /* Matn */
  text:       neutral[900],
  textStrong: neutral[900],
  textMuted:  neutral[500],
  textFaint:  neutral[400],
  onPrimary:  '#FFFFFF',

  /* Chegaralar */
  border:      neutral[200],
  borderSoft:  neutral[100],
  borderStrong:neutral[300],

  /* Brend */
  primary:      blue[600],
  primaryHover: blue[700],
  primarySoft:  blue[50],
  primaryLine:  blue[100],

  /* Holatlar */
  success:     green[600],
  successSoft: green[50],
  successLine: green[100],
  danger:      red[600],
  dangerSoft:  red[50],
  dangerLine:  red[100],
  warning:     amber[600],
  warningSoft: amber[50],
  warningLine: amber[100],
  accent:      violet[600],
  accentSoft:  violet[50],
  accentLine:  violet[100],

  /* Qoplamalar */
  scrim:   'rgba(21, 26, 33, 0.45)',
  shimmer: neutral[200],
} as const;

/* -------------------------------- O'lcham -------------------------------- */

export const spacing = {
  xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, xxxl: 48,
} as const;

export const radius = {
  xs: 6, sm: 10, md: 14, lg: 18, xl: 24, xxl: 28, pill: 999,
} as const;

/** Barmoq uchun eng kichik nishon. Bundan kichik tugma bo'lmasin. */
export const HIT = 44;

/* -------------------------------- Soyalar -------------------------------- */

/**
 * Uch pog'onali balandlik. Hamma kartaga bitta soya berish —
 * hamma narsani bir tekislikda qoldiradi, ierarxiya yo'qoladi.
 *   1 — ro'yxat elementi (fonga deyarli yopishgan)
 *   2 — asosiy karta
 *   3 — suzuvchi element: sheet, FAB, toast
 */
function lift(opacity: number, radiusPx: number, y: number, elevation: number) {
  return Platform.select({
    ios: {
      shadowColor: '#0B1220',
      shadowOpacity: opacity,
      shadowRadius: radiusPx,
      shadowOffset: { width: 0, height: y },
    },
    android: { elevation },
    default: {},
  }) as object;
}

export const elevation = {
  0: {} as object,
  1: lift(0.04, 6,  2, 1),
  2: lift(0.07, 14, 5, 4),
  3: lift(0.14, 28, 12, 12),
} as const;

/** Eski kod uchun. Yangi kodda `elevation[2]` ishlating. */
export const shadow = elevation[2];

/* ------------------------------- Tipografika ------------------------------ */

/**
 * Inter — raqamlar toza, x-balandligi baland, kichik o'lchamda ham o'qishli.
 * Shrift yuklanmasa tizim shriftiga tushadi (`fonts.ts` dagi zaxira).
 */
export const family = {
  regular:  'Inter_400Regular',
  medium:   'Inter_500Medium',
  semibold: 'Inter_600SemiBold',
  bold:     'Inter_700Bold',
} as const;

/**
 * Pul ustunlari bir chiziqda tursin: raqamlar bir xil kenglikda.
 * Aks holda ro'yxatda summalar chapga-o'ngga "sakraydi".
 */
const tnum: TextStyle = { fontVariant: ['tabular-nums'] };

export const font = {
  display:  { fontFamily: family.bold,     fontSize: 34, lineHeight: 40, letterSpacing: -1.0, ...tnum },
  h1:       { fontFamily: family.bold,     fontSize: 27, lineHeight: 33, letterSpacing: -0.7 },
  h2:       { fontFamily: family.semibold, fontSize: 20, lineHeight: 26, letterSpacing: -0.4 },
  h3:       { fontFamily: family.semibold, fontSize: 16, lineHeight: 22, letterSpacing: -0.2 },
  body:     { fontFamily: family.regular,  fontSize: 15, lineHeight: 21 },
  bodyBold: { fontFamily: family.semibold, fontSize: 15, lineHeight: 21, letterSpacing: -0.1 },
  small:    { fontFamily: family.regular,  fontSize: 13, lineHeight: 18 },
  smallBold:{ fontFamily: family.medium,   fontSize: 13, lineHeight: 18 },
  tiny:     { fontFamily: family.medium,   fontSize: 11, lineHeight: 15, letterSpacing: 0.1 },
  label:    { fontFamily: family.medium,   fontSize: 12, lineHeight: 16, letterSpacing: 0.2 },
  /** Summalar uchun — har doim bir xil kenglikdagi raqamlar. */
  num:      { fontFamily: family.semibold, fontSize: 15, lineHeight: 21, ...tnum },
  numBig:   { fontFamily: family.bold,     fontSize: 27, lineHeight: 33, letterSpacing: -0.7, ...tnum },
  /** Ro'yxat qatoridagi kichik summa — matndan ajralib tursin, lekin
      qatorning asosiy raqami bo'lib ko'rinmasin. */
  numSmall: { fontFamily: family.medium,   fontSize: 13, lineHeight: 18, ...tnum },
  mono: {
    fontSize: 15,
    fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }),
  },
} as const;

/* -------------------------------- Harakat -------------------------------- */

/**
 * Animatsiya "bezak" emas — nima o'zgarganini ko'rsatadi.
 * Qisqa va bir xil bo'lsin, aks holda ilova sekin tuyuladi.
 */
export const motion = {
  fast: 140,
  base: 220,
  slow: 380,
  /** Bosishda karta shu darajaga kichrayadi. */
  pressScale: 0.975,
} as const;

/* ------------------------------ Formatlash ------------------------------- */

/** 12500 → "12 500". Do'konchi uchun eng o'qishli shakl. */
export function money(n: number | string | null | undefined): string {
  const v = Number(n ?? 0);
  if (!Number.isFinite(v)) return '0';
  return new Intl.NumberFormat('ru-RU').format(Math.round(v));
}

/**
 * Grafik va tor joylar uchun qisqa shakl: 1 250 000 → "1.25 mln".
 * To'liq summani ko'rsatish kerak bo'lsa `money()` ishlatiladi.
 */
export function moneyShort(n: number | string | null | undefined): string {
  const v = Number(n ?? 0);
  if (!Number.isFinite(v) || v === 0) return '0';
  const abs = Math.abs(v);
  if (abs >= 1e9) return `${(v / 1e9).toFixed(abs >= 1e10 ? 0 : 1)} mlrd`;
  if (abs >= 1e6) return `${(v / 1e6).toFixed(abs >= 1e7 ? 0 : 1)} mln`;
  if (abs >= 1e3) return `${Math.round(v / 1e3)}k`;
  return String(Math.round(v));
}

/** Miqdor: 2 → "2", 2.5 → "2.5" (keraksiz nollarsiz). */
export function qty(n: number | string | null | undefined): string {
  const v = Number(n ?? 0);
  if (!Number.isFinite(v)) return '0';
  return String(Math.round(v * 1000) / 1000);
}

/* ------------------------------ Sana va vaqt ----------------------------- */

/**
 * Sanani O'ZIMIZ yozamiz, `toLocaleDateString('uz-UZ', …)` bilan emas.
 *
 * Nega? Android'dagi Hermes'da to'liq ICU ma'lumotlari yo'q — "uz-UZ" topilmasa
 * jimgina inglizchaga tushadi va do'konchi grafikda "Thu, Fri, Sat" ni ko'radi.
 * Bu hech qanday xato bermaydi, shuning uchun sezmay qolish oson.
 */
const KUN_QISQA = ['Yak', 'Du', 'Se', 'Chor', 'Pay', 'Jum', 'Shan'] as const;
const KUN_TOLIQ = [
  'yakshanba', 'dushanba', 'seshanba', 'chorshanba',
  'payshanba', 'juma', 'shanba',
] as const;
const OY_QISQA = [
  'yan', 'fev', 'mar', 'apr', 'may', 'iyn',
  'iyl', 'avg', 'sen', 'okt', 'noy', 'dek',
] as const;
const OY_TOLIQ = [
  'yanvar', 'fevral', 'mart', 'aprel', 'may', 'iyun',
  'iyul', 'avgust', 'sentabr', 'oktabr', 'noyabr', 'dekabr',
] as const;

/** Dushanba → "Du" (grafik ostidagi yorliq uchun) */
export function haftaKuni(d: Date): string {
  return KUN_QISQA[d.getDay()];
}

/** Dushanba → "dushanba" */
export function haftaKuniToliq(d: Date): string {
  return KUN_TOLIQ[d.getDay()];
}

/** 2026-08-31 → "31-avg" */
export function sana(d: Date): string {
  return `${d.getDate()}-${OY_QISQA[d.getMonth()]}`;
}

/** 2026-08-31 → "31-avgust, dushanba" */
export function sanaToliq(d: Date): string {
  return `${d.getDate()}-${OY_TOLIQ[d.getMonth()]}, ${KUN_TOLIQ[d.getDay()]}`;
}

/** 14:05 — har doim ikki xonali, tizim sozlamasiga bog'liq emas. */
export function soat(d: Date): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** "2026-08-31" ko'rinishidagi kalit — kunlarga guruhlash uchun. */
export function kunKaliti(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    + `-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Serverdan kelgan sana matni → "5-sen".
 *
 * Server muddatni to'liq vaqt tamg'asi bilan qaytaradi
 * ("2026-09-04T19:00:00.000Z"), uni to'g'ridan-to'g'ri ekranga chiqarsak
 * do'konchi shu xom matnni ko'radi. Vaqt mahalliy mintaqada o'qiladi:
 * yozuv Toshkent yarim tunida saqlangani uchun kun to'g'ri chiqadi.
 */
export function sanaMatni(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? String(iso) : sana(d);
}

export function dateLabel(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const isToday = d.toDateString() === today.toDateString();
  const yest = new Date(today); yest.setDate(today.getDate() - 1);
  const isYest = d.toDateString() === yest.toDateString();

  const time = soat(d);
  if (isToday) return `Bugun ${time}`;
  if (isYest) return `Kecha ${time}`;
  return `${sana(d)} ${time}`;
}
