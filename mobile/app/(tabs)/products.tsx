import { useCallback, useEffect, useMemo, useState } from 'react';
import { FlatList, StyleSheet, Text, TextInput, View, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { Image } from 'expo-image';
import type { Product } from '../../src/api/types';
import * as productStore from '../../src/data/products';
import { Badge, Chip, Empty } from '../../src/components/ui';
import { ScreenHeader } from '../../src/components/ScreenHeader';
import { SkeletonList } from '../../src/components/Skeleton';
import { PressScale } from '../../src/components/Press';
import {
  BOSH_FILTR, FilterSheet, faolFiltrlar,
  type FilterOptions, type Filters,
} from '../../src/components/FilterSheet';
import { colors, elevation, font, money, moneyShort, qty, radius, spacing } from '../../src/theme';
import { Icon } from '../../src/components/Icon';

export default function ProductsScreen() {
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState<Filters>(BOSH_FILTR);
  const [options, setOptions] = useState<FilterOptions | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  /**
   * Butun katalog MAHALLIY cache'dan. Qidiruv, filtr va saralash ham
   * shu yerda bajariladi.
   *
   * Ilgari bu ekran har filtr o'zgarishida va har harfda (300 ms
   * kechikish bilan) serverga so'rov yuborardi, ustiga fokusda
   * `/products/meta/filters` ni ham tortardi. Endi ekran ochilganda
   * so'rov umuman ketmaydi — cache eskirgan bo'lsagina fonda bitta
   * delta-sync bo'ladi.
   */
  const [barchasi, setBarchasi] = useState<Product[] | null>(null);

  const load = useCallback(async () => {
    const darhol = await productStore.loadAndRefresh(setBarchasi);
    setBarchasi(darhol);
  }, []);

  useFocusEffect(useCallback(() => { load().catch(() => {}); }, [load]));

  // Qidiruv/filtr — hisob-kitob qurilmada, debounce kerak emas.
  const { items: shown, taxminiy } = useMemo(
    () => (barchasi ? productStore.filtrla(barchasi, search, filters)
                    : { items: [] as Product[], taxminiy: false }),
    [barchasi, search, filters]);

  // Filtr variantlari ham cache'dan hisoblanadi.
  useEffect(() => {
    if (barchasi) setOptions(productStore.filterOptions(barchasi));
  }, [barchasi]);

  // `items` — ekranning qolgan qismi shunga tayanadi (null = yuklanmoqda).
  const items = barchasi ? shown : null;

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
      <ScreenHeader
        title="Ombor"
        subtitle={totals
          ? `${totals.count} ta mahsulot · ${moneyShort(totals.value)} so'mlik tovar`
          : undefined}
        action={{
          icon: 'qoshish', label: "Mahsulot qo'shish",
          onPress: () => router.push('/product/new'),
        }}
      />

      <View style={s.tools}>
        <View style={s.searchBox}>
          <Icon name="qidiruv" size={18} color={colors.textFaint} />
          <TextInput
            style={s.search}
            placeholder="Mahsulot qidirish…"
            placeholderTextColor={colors.textFaint}
            value={search}
            onChangeText={setSearch}
            returnKeyType="search"
            accessibilityLabel="Mahsulot qidirish"
          />
          {search.length > 0 ? (
            <PressScale
              accessibilityRole="button"
              accessibilityLabel="Qidiruvni tozalash"
              onPress={() => setSearch('')}
              scale={0.85}
              hitSlop={10}
            >
              <Icon name="yopish" size={17} color={colors.textFaint} />
            </PressScale>
          ) : null}
        </View>

        <View style={s.filters}>
          <Chip
            label="Filtr" active={faol > 0} count={faol}
            onPress={() => setSheetOpen(true)}
          />
          {/* Yoqilgan filtrlar ko'rinib turadi — bosib o'chirish mumkin */}
          {filters.unit && (
            <Chip label={`${filters.unit}  ✕`}
              onPress={() => setFilters({ ...filters, unit: null })} />
          )}
          {filters.category && (
            <Chip label={`${filters.category}  ✕`}
              onPress={() => setFilters({ ...filters, category: null })} />
          )}
          {filters.status !== 'hammasi' && (
            <Chip label={`${filters.status}  ✕`}
              onPress={() => setFilters({ ...filters, status: 'hammasi' })} />
          )}
        </View>
      </View>

      {!shown ? (
        <View style={{ paddingHorizontal: spacing.lg }}><SkeletonList /></View>
      ) : (
        <FlatList
          data={shown}
          keyExtractor={(p) => p.id}
          contentContainerStyle={s.list}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              tintColor={colors.primary}
              onRefresh={async () => {
                setRefreshing(true);
                // Qo'lda tortish — "hozir yangila" degani, shuning uchun
                // 60 soniyalik kutish chetlab o'tiladi.
                setBarchasi(await productStore.sync(true).catch(() => barchasi ?? []));
                setRefreshing(false);
              }}
            />
          }
          ListHeaderComponent={
            <>
              {taxminiy ? (
                <View style={s.hint}>
                  <Icon name="qidiruv" size={15} color={colors.warning} />
                  <Text style={[font.small, { color: colors.warning, flex: 1 }]}>
                    "{search.trim()}" aynan topilmadi — shunga o'xshashlari
                  </Text>
                </View>
              ) : null}

              {/* Tan narxsiz mahsulot hisobotni jimgina buzadi — foyda
                  sotuv narxidan tan narxni ayirib topiladi, tan narx 0
                  bo'lsa butun savdo foyda bo'lib chiqadi. Xato o'zini
                  ko'rsatmaydi, shuning uchun uni biz ko'rsatamiz. */}
              {options && options.counts.tannarxsiz > 0
                && filters.status !== 'tannarxsiz' && !search.trim() ? (
                <PressScale
                  accessibilityRole="button"
                  accessibilityLabel="Tan narxi yo'q mahsulotlarni ko'rsatish"
                  onPress={() => setFilters({ ...filters, status: 'tannarxsiz' })}
                  scale={0.99}
                  style={s.tannarxsiz}
                >
                  <Icon name="ogohlantirish" size={17} color={colors.danger} />
                  <View style={{ flex: 1 }}>
                    <Text style={[font.smallBold, { color: colors.danger }]}>
                      {options.counts.tannarxsiz} ta mahsulotda tan narx yo'q
                    </Text>
                    <Text style={[font.tiny, { color: colors.danger }]}>
                      Ularning har bir savdosi to'liq foyda bo'lib hisoblanmoqda
                    </Text>
                  </View>
                  <Icon name="oldinga" size={15} color={colors.danger} />
                </PressScale>
              ) : null}
            </>
          }
          ListEmptyComponent={
            <Empty
              icon="mahsulot"
              title={search ? 'Topilmadi' : "Ombor bo'sh"}
              hint={search ? "Boshqa nom bilan qidirib ko'ring"
                : 'Birinchi mahsulotni qo\'shing — savdo shundan boshlanadi'}
              action={search ? undefined : {
                title: "Mahsulot qo'shish", icon: 'qoshish',
                onPress: () => router.push('/product/new'),
              }}
            />
          }
          renderItem={({ item }) => (
            <Row product={item} onPress={() => router.push(`/product/${item.id}`)} />
          )}
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
  const tanNarxsiz = Number(p.cost_price) <= 0;

  return (
    <PressScale
      accessibilityRole="button"
      accessibilityLabel={`${p.name}, ${qty(p.stock)} ${p.unit}, ${money(p.sale_price)} so'm`}
      onPress={onPress}
      scale={0.985}
      style={[s.row, out ? { borderLeftWidth: 3, borderLeftColor: colors.danger } : null]}
    >
      {p.photo_url
        ? <Image source={{ uri: p.photo_url }} style={s.thumb} contentFit="cover" transition={180} />
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
        {tanNarxsiz && (
          <Text style={[font.tiny, { color: colors.danger }]}>
            tan narx yo'q — foyda hisoblanmaydi
          </Text>
        )}
      </View>

      <View style={{ alignItems: 'flex-end', gap: 5 }}>
        <Text style={[
          font.num,
          { color: out ? colors.danger : low ? colors.warning : colors.text },
        ]}>
          {qty(p.stock)} {p.unit}
        </Text>
        {out ? <Badge text="tugagan" tone="danger" dot />
          : low ? <Badge text="tugayapti" tone="warning" dot /> : null}
      </View>
    </PressScale>
  );
}

const s = StyleSheet.create({
  tools: { paddingHorizontal: spacing.lg, gap: spacing.md, paddingBottom: spacing.md },
  searchBox: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    height: 46,
    borderWidth: 1, borderColor: colors.border,
  },
  search: {
    flex: 1, height: '100%',
    fontSize: 16, fontFamily: 'Inter_500Medium', color: colors.text,
  },
  filters: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, alignItems: 'center' },
  tannarxsiz: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    backgroundColor: colors.dangerSoft,
    borderWidth: 1, borderColor: colors.dangerLine,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    marginBottom: spacing.sm,
  },
  list: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xxxl, gap: spacing.sm },
  hint: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    backgroundColor: colors.warningSoft,
    borderWidth: 1, borderColor: colors.warningLine,
    borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.xs,
  },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.lg, padding: spacing.md,
    borderWidth: 1, borderColor: colors.borderSoft,
    ...elevation[1],
  },
  thumb: { width: 48, height: 48, borderRadius: radius.md },
  thumbEmpty: {
    backgroundColor: colors.surfaceAlt,
    alignItems: 'center', justifyContent: 'center',
  },
});
