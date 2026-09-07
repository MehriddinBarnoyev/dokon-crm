/**
 * MAHSULOT FILTRLARI
 * ===================
 * Kategoriya, o'lchov birligi va saralash. Har bir variant yonida nechta
 * mahsulot borligi yoziladi — do'konchi bo'sh filtrni bosib, bo'sh ro'yxatga
 * tushib qolmasin.
 */
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { FadeIn, SlideInDown } from 'react-native-reanimated';
import { Button, IconButton } from './ui';
import { PressScale } from './Press';
import { haptic } from '../lib/haptics';
import { colors, elevation, font, radius, spacing } from '../theme';
import type { Unit } from '../api/types';

export type SortKey = 'nom' | 'arzon' | 'qimmat' | 'kam_qoldiq' | 'kop_qoldiq' | 'yangi';
export type StatusKey = 'hammasi' | 'bor' | 'tugayapti' | 'tugagan' | 'tannarxsiz';

export interface Filters {
  status: StatusKey;
  category: string | null;
  unit: Unit | null;
  sort: SortKey;
}

export const BOSH_FILTR: Filters = {
  status: 'hammasi', category: null, unit: null, sort: 'nom',
};

export interface FilterOptions {
  categories: Array<{ name: string; soni: number }>;
  units: Array<{ unit: Unit; soni: number }>;
  counts: {
    hammasi: number; bor: number; tugayapti: number; tugagan: number;
    /** Tan narxi kiritilmagan — foyda hisobini buzadiganlar */
    tannarxsiz: number;
  };
}

const SARALASH: Array<{ key: SortKey; label: string }> = [
  { key: 'nom', label: 'Nom bo\'yicha' },
  { key: 'arzon', label: 'Avval arzoni' },
  { key: 'qimmat', label: 'Avval qimmati' },
  { key: 'kam_qoldiq', label: 'Kam qolgani' },
  { key: 'kop_qoldiq', label: 'Ko\'p qolgani' },
  { key: 'yangi', label: 'Yangi qo\'shilgani' },
];

/** Nechta filtr yoqilgan — tugmadagi belgi uchun. */
export function faolFiltrlar(f: Filters): number {
  return (f.status !== 'hammasi' ? 1 : 0)
    + (f.category ? 1 : 0)
    + (f.unit ? 1 : 0)
    + (f.sort !== 'nom' ? 1 : 0);
}

function Chip({ label, count, active, onPress }: {
  label: string; count?: number; active: boolean; onPress: () => void;
}) {
  return (
    <PressScale
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      accessibilityLabel={label}
      onPress={() => { haptic.tap(); onPress(); }}
      scale={0.94}
      style={[s.chip, active && s.chipOn]}
    >
      <Text style={[font.smallBold, { color: active ? colors.onPrimary : colors.text }]}>
        {label}
        {count !== undefined ? (
          <Text style={{ color: active ? 'rgba(255,255,255,0.7)' : colors.textFaint }}>
            {'  '}{count}
          </Text>
        ) : null}
      </Text>
    </PressScale>
  );
}

function Guruh({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={{ gap: spacing.sm }}>
      <Text style={[font.label, { color: colors.textMuted }]}>{title.toUpperCase()}</Text>
      <View style={s.chips}>{children}</View>
    </View>
  );
}

export function FilterSheet({ visible, value, options, onChange, onClose }: {
  visible: boolean;
  value: Filters;
  options: FilterOptions | null;
  onChange: (f: Filters) => void;
  onClose: () => void;
}) {
  const set = (patch: Partial<Filters>) => onChange({ ...value, ...patch });
  const insets = useSafeAreaInsets();

  return (
    <Modal
      visible={visible} transparent animationType="none"
      statusBarTranslucent onRequestClose={onClose}
    >
      <Animated.View entering={FadeIn.duration(160)} style={{ flex: 1 }}>
      <Pressable style={s.backdrop} onPress={onClose}>
        <Animated.View entering={SlideInDown.duration(260).dampingRatio(0.9)}>
        <Pressable
          style={[s.sheet, { paddingBottom: spacing.xl + insets.bottom }]}
          onPress={() => {}}
        >
          <View style={s.grip} />
          <View style={s.head}>
            <Text style={[font.h2, { color: colors.text, flex: 1 }]}>Filtrlar</Text>
            <IconButton name="yopish" label="Yopish" onPress={onClose} size={22} />
          </View>

          <ScrollView contentContainerStyle={{ gap: spacing.lg }} bounces={false}>
            <Guruh title="Qoldiq holati">
              <Chip label="Hammasi" count={options?.counts.hammasi}
                active={value.status === 'hammasi'} onPress={() => set({ status: 'hammasi' })} />
              <Chip label="Bor" count={options?.counts.bor}
                active={value.status === 'bor'} onPress={() => set({ status: 'bor' })} />
              <Chip label="Tugayapti" count={options?.counts.tugayapti}
                active={value.status === 'tugayapti'} onPress={() => set({ status: 'tugayapti' })} />
              <Chip label="Tugagan" count={options?.counts.tugagan}
                active={value.status === 'tugagan'} onPress={() => set({ status: 'tugagan' })} />
            </Guruh>

            {/* Qoldiq holati emas, lekin ombordagi eng qimmatga tushadigan xato:
                tan narxsiz mahsulotning butun savdosi foyda bo'lib hisoblanadi.
                Shuning uchun uni filtr sifatida qo'ldan chiqarmaymiz. */}
            {options && options.counts.tannarxsiz > 0 && (
              <Guruh title="Hisobotdagi xato">
                <Chip
                  label="Tan narxi yo'q" count={options.counts.tannarxsiz}
                  active={value.status === 'tannarxsiz'}
                  onPress={() => set({
                    status: value.status === 'tannarxsiz' ? 'hammasi' : 'tannarxsiz',
                  })}
                />
              </Guruh>
            )}

            {options && options.units.length > 0 && (
              <Guruh title="O'lchov birligi">
                <Chip label="Hammasi" active={value.unit === null}
                  onPress={() => set({ unit: null })} />
                {options.units.map((u) => (
                  <Chip key={u.unit} label={u.unit} count={u.soni}
                    active={value.unit === u.unit}
                    onPress={() => set({ unit: value.unit === u.unit ? null : u.unit })} />
                ))}
              </Guruh>
            )}

            {options && options.categories.length > 0 && (
              <Guruh title="Kategoriya">
                <Chip label="Hammasi" active={value.category === null}
                  onPress={() => set({ category: null })} />
                {options.categories.map((c) => (
                  <Chip key={c.name} label={c.name} count={c.soni}
                    active={value.category === c.name}
                    onPress={() => set({ category: value.category === c.name ? null : c.name })} />
                ))}
              </Guruh>
            )}

            <Guruh title="Saralash">
              {SARALASH.map((o) => (
                <Chip key={o.key} label={o.label} active={value.sort === o.key}
                  onPress={() => set({ sort: o.key })} />
              ))}
            </Guruh>
          </ScrollView>

          <View style={{ flexDirection: 'row', gap: spacing.sm }}>
            <Button title="Tozalash" variant="secondary" style={{ flex: 1 }}
              onPress={() => onChange(BOSH_FILTR)} />
            <Button title="Ko'rsatish" style={{ flex: 2 }} onPress={onClose} />
          </View>
        </Pressable>
        </Animated.View>
      </Pressable>
      </Animated.View>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop: {
    flex: 1, backgroundColor: colors.scrim, justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.xxl, borderTopRightRadius: radius.xxl,
    padding: spacing.xl,
    gap: spacing.lg, maxHeight: '85%', ...elevation[3],
  },
  grip: {
    width: 40, height: 4, borderRadius: 2,
    backgroundColor: colors.border, alignSelf: 'center',
  },
  head: { flexDirection: 'row', alignItems: 'center' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: {
    paddingHorizontal: spacing.md, paddingVertical: 9,
    borderRadius: radius.pill, backgroundColor: colors.surfaceAlt,
    borderWidth: 1, borderColor: colors.borderSoft,
  },
  chipOn: { backgroundColor: colors.primary, borderColor: colors.primary },
});
