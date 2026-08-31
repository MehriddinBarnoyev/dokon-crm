import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  FlatList, Pressable, StyleSheet, Text, TextInput, View, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { Image } from 'expo-image';
import { api } from '../../src/api/client';
import type { Product } from '../../src/api/types';
import { Badge, Empty, Loading } from '../../src/components/ui';
import {
  BOSH_FILTR, FilterSheet, faolFiltrlar,
  type FilterOptions, type Filters,
} from '../../src/components/FilterSheet';
import { colors, font, money, qty, radius, shadow, spacing } from '../../src/theme';
import { Icon } from '../../src/components/Icon';

export default function ProductsScreen() {
  const router = useRouter();
  const [items, setItems] = useState<Product[] | null>(null);
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState<Filters>(BOSH_FILTR);
  const [options, setOptions] = useState<FilterOptions | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (q: string, f: Filters) => {
    const params = new URLSearchParams({ limit: '300', status: f.status, sort: f.sort });
    if (q.trim()) params.set('search', q.trim());
    if (f.category) params.set('category', f.category);
    if (f.unit) params.set('unit', f.unit);
    setItems(await api<Product[]>(`/products?${params}`));
  }, []);

  useFocusEffect(useCallback(() => {
    load(search, filters).catch(() => {});
    api<FilterOptions>('/products/meta/filters').then(setOptions).catch(() => {});
  }, [load]));

  // Qidiruv yoki filtr o'zgarganda qayta yuklaymiz.
  // Kechikish — har harfda so'rov ketmasligi uchun.
  useEffect(() => {
    const id = setTimeout(() => { load(search, filters).catch(() => {}); }, 300);
    return () => clearTimeout(id);
  }, [search, filters, load]);

  // Filtrlash serverda bajariladi — bu yerda qayta filtrlamaymiz,
  // aks holda ikki joyda ikki xil qoida paydo bo'lardi.
  const shown = items;

  // Server aniq moslik topmasa, taxminiy variantlarni qaytaradi —
  // buni do'konchiga aytib qo'yamiz, u xato mahsulotni tanlab qo'ymasin.
  const taxminiy = Boolean(search.trim() && items?.length && items[0].taxminiy);

  const totals = useMemo(() => {
    if (!items) return null;
    return {
      count: items.length,
      value: items.reduce((s, p) => s + Number(p.stock) * Number(p.cost_price), 0),
    };
  }, [items]);

  const faol = faolFiltrlar(filters);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      <View style={s.head}>
        <View style={s.headRow}>
          <Text style={[font.h2, { color: colors.text, flex: 1 }]}>Ombor</Text>
          <Pressable onPress={() => router.push('/product/new')} style={s.plusBtn}>
            <Icon name="qoshish" size={22} color="#fff" />
          </Pressable>
        </View>

        {totals && (
          <Text style={[font.small, { color: colors.textMuted }]}>
            {totals.count} ta mahsulot · {money(totals.value)} so'mlik tovar
          </Text>
        )}

        <TextInput
          style={s.search}
          placeholder="Mahsulot qidirish…"
          placeholderTextColor={colors.textFaint}
          value={search}
          onChangeText={setSearch}
        />

        <View style={s.filters}>
          <Pressable
            onPress={() => setSheetOpen(true)}
            style={({ pressed }) => [
              s.filterBtn, faol > 0 && s.filterBtnOn, pressed && { opacity: 0.7 },
            ]}
          >
            <Icon name="sozlash" size={16} color={faol > 0 ? '#fff' : colors.text} />
            <Text style={[font.small, { color: faol > 0 ? '#fff' : colors.text }]}>
              Filtr{faol > 0 ? ` · ${faol}` : ''}
            </Text>
          </Pressable>

          {/* Yoqilgan filtrlar ko'rinib turadi — bosib o'chirish mumkin */}
          {filters.unit && (
            <Pressable onPress={() => setFilters({ ...filters, unit: null })} style={s.tag}>
              <Text style={[font.tiny, { color: colors.primary }]}>{filters.unit}  ✕</Text>
            </Pressable>
          )}
          {filters.category && (
            <Pressable onPress={() => setFilters({ ...filters, category: null })} style={s.tag}>
              <Text style={[font.tiny, { color: colors.primary }]}>{filters.category}  ✕</Text>
            </Pressable>
          )}
          {filters.status !== 'hammasi' && (
            <Pressable onPress={() => setFilters({ ...filters, status: 'hammasi' })} style={s.tag}>
              <Text style={[font.tiny, { color: colors.primary }]}>{filters.status}  ✕</Text>
            </Pressable>
          )}
        </View>
      </View>

      {!shown ? <Loading /> : (
        <FlatList
          data={shown}
          keyExtractor={(p) => p.id}
          contentContainerStyle={s.list}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={async () => {
                setRefreshing(true);
                await load(search, filters).catch(() => {});
                setRefreshing(false);
              }}
            />
          }
          ListHeaderComponent={
            taxminiy ? (
              <View style={s.hint}>
                <Icon name="qidiruv" size={15} color={colors.warning} />
                <Text style={[font.small, { color: colors.warning, flex: 1 }]}>
                  "{search.trim()}" aynan topilmadi — shunga o'xshashlari
                </Text>
              </View>
            ) : null
          }
          ListEmptyComponent={
            <Empty
              icon="mahsulot"
              title={search ? 'Topilmadi' : "Ombor bo'sh"}
              hint={search ? 'Boshqa nom bilan qidirib ko\'ring'
                : "Yuqoridagi + tugmasi bilan mahsulot qo'shing"}
            />
          }
          renderItem={({ item }) => <Row product={item} onPress={() => router.push(`/product/${item.id}`)} />}
        />
      )}

      <FilterSheet
        visible={sheetOpen}
        value={filters}
        options={options}
        onChange={setFilters}
        onClose={() => setSheetOpen(false)}
      />
    </SafeAreaView>
  );
}

function Row({ product: p, onPress }: { product: Product; onPress: () => void }) {
  const out = Number(p.stock) <= 0;
  const low = !out && Number(p.stock) <= Number(p.min_stock);

  return (
    <Pressable onPress={onPress} style={({ pressed }) => [s.row, pressed && { opacity: 0.7 }]}>
      {p.photo_url
        ? <Image source={{ uri: p.photo_url }} style={s.thumb} contentFit="cover" />
        : (
          <View style={[s.thumb, s.thumbEmpty]}>
            <Icon name="mahsulot" size={22} color={colors.textFaint} />
          </View>
        )}

      <View style={{ flex: 1, gap: 2 }}>
        <Text style={[font.bodyBold, { color: colors.text }]} numberOfLines={1}>{p.name}</Text>
        <Text style={[font.small, { color: colors.textMuted }]}>
          {money(p.sale_price)} so'm / {p.unit}
        </Text>
      </View>

      <View style={{ alignItems: 'flex-end', gap: 4 }}>
        <Text style={[
          font.bodyBold,
          { color: out ? colors.danger : low ? colors.warning : colors.text },
        ]}>
          {qty(p.stock)} {p.unit}
        </Text>
        {out ? <Badge text="tugagan" tone="danger" />
          : low ? <Badge text="tugayapti" tone="warning" /> : null}
      </View>
    </Pressable>
  );
}

const s = StyleSheet.create({
  head: { padding: spacing.lg, gap: spacing.md, backgroundColor: colors.bg },
  headRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  plusBtn: {
    width: 40, height: 40, borderRadius: radius.md,
    backgroundColor: colors.primary,
    alignItems: 'center', justifyContent: 'center',
  },
  search: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    height: 44, fontSize: 16, color: colors.text,
    borderWidth: 1, borderColor: colors.border,
  },
  filters: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, alignItems: 'center' },
  filterBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: spacing.md, paddingVertical: 8,
    borderRadius: radius.pill, backgroundColor: colors.surfaceAlt,
  },
  filterBtnOn: { backgroundColor: colors.primary },
  tag: {
    paddingHorizontal: spacing.md, paddingVertical: 7,
    borderRadius: radius.pill, backgroundColor: colors.primarySoft,
  },
  list: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.sm },
  hint: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    backgroundColor: colors.warningSoft,
    borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.xs,
  },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.lg, padding: spacing.md,
    ...shadow,
  },
  thumb: { width: 46, height: 46, borderRadius: radius.md },
  thumbEmpty: {
    backgroundColor: colors.surfaceAlt,
    alignItems: 'center', justifyContent: 'center',
  },
});
