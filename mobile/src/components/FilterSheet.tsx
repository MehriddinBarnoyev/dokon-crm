/**
 * MAHSULOT FILTRLARI
 * ===================
 * Kategoriya, o'lchov birligi va saralash. Har bir variant yonida nechta
 * mahsulot borligi yoziladi — do'konchi bo'sh filtrni bosib, bo'sh ro'yxatga
 * tushib qolmasin.
 */
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Button } from './ui';
import { Icon } from './Icon';
import { colors, font, radius, shadow, spacing } from '../theme';
import type { Unit } from '../api/types';

export type SortKey = 'nom' | 'arzon' | 'qimmat' | 'kam_qoldiq' | 'kop_qoldiq' | 'yangi';
export type StatusKey = 'hammasi' | 'bor' | 'tugayapti' | 'tugagan';

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
  counts: { hammasi: number; bor: number; tugayapti: number; tugagan: number };
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
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [s.chip, active && s.chipOn, pressed && { opacity: 0.7 }]}
    >
      <Text style={[font.small, { color: active ? '#fff' : colors.text }]}>
        {label}
        {count !== undefined ? (
          <Text style={{ color: active ? 'rgba(255,255,255,0.7)' : colors.textFaint }}>
            {'  '}{count}
          </Text>
        ) : null}
      </Text>
    </Pressable>
  );
}

function Guruh({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={{ gap: spacing.sm }}>
      <Text style={[font.small, { color: colors.textMuted }]}>{title}</Text>
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

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={s.backdrop} onPress={onClose}>
        <Pressable style={s.sheet} onPress={() => {}}>
          <View style={s.head}>
            <Text style={[font.h3, { color: colors.text, flex: 1 }]}>Filtrlar</Text>
            <Pressable onPress={onClose} hitSlop={10}>
              <Icon name="yopish" size={22} color={colors.textMuted} />
            </Pressable>
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
      </Pressable>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop: {
    flex: 1, backgroundColor: 'rgba(11,18,32,0.45)', justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl,
    padding: spacing.xl, paddingBottom: spacing.xxl,
    gap: spacing.lg, maxHeight: '85%', ...shadow,
  },
  head: { flexDirection: 'row', alignItems: 'center' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: {
    paddingHorizontal: spacing.md, paddingVertical: 9,
    borderRadius: radius.pill, backgroundColor: colors.surfaceAlt,
  },
  chipOn: { backgroundColor: colors.primary },
});
