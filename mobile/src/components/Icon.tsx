/**
 * IKONKALAR
 * ==========
 * Barcha ikonkalar shu yerdan chiqadi. Ekranlarda `<Icon name="savdo" />` deb
 * MA'NOSI bo'yicha chaqiriladi — "receipt-outline" kabi to'plam nomlari emas.
 *
 * Nega shunday? Ikonka to'plamini almashtirmoqchi bo'lsak yoki bitta ikonka
 * yoqmasa, faqat shu jadvalni o'zgartiramiz; 12 ta ekranga tegmaymiz.
 */
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import type { ComponentProps } from 'react';
import { colors } from '../theme';

type IoniconName = ComponentProps<typeof Ionicons>['name'];
type MaterialName = ComponentProps<typeof MaterialCommunityIcons>['name'];

type Spec =
  | { set: 'ion'; glyph: IoniconName }
  | { set: 'mat'; glyph: MaterialName };

const ion = (glyph: IoniconName): Spec => ({ set: 'ion', glyph });
const mat = (glyph: MaterialName): Spec => ({ set: 'mat', glyph });

const ICONS = {
  /* --- Bo'limlar (tab paneli) --- */
  'bosh-sahifa':      ion('home-outline'),
  'bosh-sahifa-faol': ion('home'),
  ombor:              mat('warehouse'),
  'ombor-faol':       mat('warehouse'),
  savdo:              ion('receipt-outline'),
  'savdo-faol':       ion('receipt'),
  qarzlar:            mat('handshake-outline'),
  'qarzlar-faol':     mat('handshake'),
  hisobot:            ion('stats-chart-outline'),
  'hisobot-faol':     ion('stats-chart'),

  /* --- Amallar --- */
  dokon:      ion('storefront-outline'),
  qoshish:    ion('add'),
  yopish:     ion('close'),
  yuborish:   ion('arrow-up'),
  orqaga:     ion('chevron-back'),
  oldinga:    ion('chevron-forward'),
  kamera:     ion('camera-outline'),
  shtrix:     ion('barcode-outline'),
  tahrir:     ion('create-outline'),
  galereya:   ion('images-outline'),
  telefon:    ion('call-outline'),
  qidiruv:    ion('search-outline'),
  sozlash:    ion('construct-outline'),

  /* --- Tushunchalar --- */
  ai:            mat('robot-outline'),
  ogohlantirish: ion('warning-outline'),
  mahsulot:      ion('cube-outline'),
  savat:         ion('cart-outline'),
  bosh:          ion('file-tray-outline'),
  kirim:         ion('arrow-down'),
  chiqim:        ion('arrow-up'),
  tuzatish:      ion('sync-outline'),
  pul:           mat('cash'),
  'kirim-qutisi': ion('download-outline'),
  'chiqim-grafik': ion('trending-down-outline'),
  qarz:          mat('handshake-outline'),
} as const;

export type IconName = keyof typeof ICONS;

export function Icon({
  name,
  size = 20,
  color = colors.text,
}: {
  name: IconName;
  size?: number;
  color?: string;
}) {
  const spec = ICONS[name];
  return spec.set === 'ion'
    ? <Ionicons name={spec.glyph} size={size} color={color} />
    : <MaterialCommunityIcons name={spec.glyph} size={size} color={color} />;
}
