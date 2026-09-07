/**
 * CHIQIMLAR ro'yxati.
 *
 * Savdolar ekrani bilan bir xil naqsh: kunlar bo'yicha guruhlangan
 * SectionList, har kunga yakun. Farqi — yuqorida davr tanlash va
 * kategoriya bo'yicha taqsimot bor, chunki chiqimda "qayerga ketyapti"
 * degan savol "qancha" degandan muhimroq.
 */
import { useCallback, useMemo, useState } from 'react';
import { RefreshControl, ScrollView, SectionList, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { api } from '../../src/api/client';
import type { Expense } from '../../src/api/types';
import { Chip, Empty, IconButton } from '../../src/components/ui';
import { ScreenHeader } from '../../src/components/ScreenHeader';
import { SkeletonList } from '../../src/components/Skeleton';
import { PressScale } from '../../src/components/Press';
import { Icon } from '../../src/components/Icon';
import {
  colors, elevation, font, kunKaliti, money, radius, sanaToliq, soat, spacing,
} from '../../src/theme';

const DAVRLAR = [
  { kun: 7, label: '7 kun' },
  { kun: 30, label: '30 kun' },
  { kun: 90, label: '90 kun' },
] as const;

/** "2026-08-31" → "Bugun" / "Kecha" / "31-avgust, dushanba" */
function kunNomi(iso: string): string {
  const bugun = kunKaliti(new Date());
  const kecha = kunKaliti(new Date(Date.now() - 864e5));
  if (iso === bugun) return 'Bugun';
  if (iso === kecha) return 'Kecha';
  // Soat 12 — yozgi/qishki vaqt siljishida kun almashib ketmasin
  return sanaToliq(new Date(`${iso}T12:00:00`));
}

export default function ExpensesScreen() {
  const router = useRouter();
  const [items, setItems] = useState<Expense[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [kun, setKun] = useState<number>(30);
  const [kategoriya, setKategoriya] = useState<string | null>(null);

  const load = useCallback(async (kunlar: number) => {
    const from = kunKaliti(new Date(Date.now() - (kunlar - 1) * 864e5));
    setItems(await api<Expense[]>(`/expenses?from=${from}&limit=500`));
  }, []);

  useFocusEffect(useCallback(() => { load(kun).catch(() => {}); }, [load, kun]));

  /** Kategoriya taqsimoti — filtrdan OLDIN, ya'ni chip'lar doim to'liq. */
  const kategoriyalar = useMemo(() => {
    if (!items) return [];
    const map = new Map<string, number>();
    for (const e of items) map.set(e.category, (map.get(e.category) ?? 0) + Number(e.amount));
    return [...map.entries()]
      .map(([name, total]) => ({ name, total }))
      .sort((a, b) => b.total - a.total);
  }, [items]);

  const korinadigan = useMemo(
    () => (items ?? []).filter((e) => !kategoriya || e.category === kategoriya),
    [items, kategoriya]);

  const sections = useMemo(() => {
    const map = new Map<string, Expense[]>();
    for (const e of korinadigan) {
      const k = kunKaliti(new Date(e.created_at));
      const ro = map.get(k);
      if (ro) ro.push(e); else map.set(k, [e]);
    }
    return [...map.entries()].map(([k, list]) => ({
      title: k,
      jami: list.reduce((x, r) => x + Number(r.amount), 0),
      data: list,
    }));
  }, [korinadigan]);

  const jami = korinadigan.reduce((x, r) => x + Number(r.amount), 0);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      <ScreenHeader
        title="Chiqimlar"
        subtitle={items ? `${korinadigan.length} ta · ${money(jami)} so'm` : undefined}
        left={
          <IconButton
            name="orqaga" label="Orqaga" tone="soft" size={22}
            onPress={() => (router.canGoBack() ? router.back() : router.replace('/(tabs)'))}
          />
        }
        action={{
          icon: 'qoshish', label: 'Yangi chiqim',
          onPress: () => router.push('/expense/new'),
        }}
      />

      <View style={s.filtrlar}>
        <ScrollView
          horizontal showsHorizontalScrollIndicator={false}
          contentContainerStyle={s.chipQator}
        >
          {DAVRLAR.map((d) => (
            <Chip
              key={d.kun} label={d.label} active={kun === d.kun}
              onPress={() => { setKun(d.kun); setItems(null); }}
            />
          ))}
        </ScrollView>

        {kategoriyalar.length > 1 && (
          <ScrollView
            horizontal showsHorizontalScrollIndicator={false}
            contentContainerStyle={s.chipQator}
          >
            <Chip
              label="Hammasi" active={kategoriya === null}
              onPress={() => setKategoriya(null)}
            />
            {kategoriyalar.map((k) => (
              <Chip
                key={k.name}
                label={`${k.name} · ${money(k.total)}`}
                active={kategoriya === k.name}
                onPress={() => setKategoriya(kategoriya === k.name ? null : k.name)}
              />
            ))}
          </ScrollView>
        )}
      </View>

      {!items ? (
        <View style={{ paddingHorizontal: spacing.lg }}><SkeletonList /></View>
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(x) => x.id}
          contentContainerStyle={s.list}
          showsVerticalScrollIndicator={false}
          stickySectionHeadersEnabled={false}
          renderSectionHeader={({ section }) => (
            <View style={s.kunSarlavha}>
              <Text style={[font.bodyBold, { color: colors.text, flex: 1 }]}>
                {kunNomi(section.title)}
              </Text>
              <Text style={[font.num, { color: colors.danger }]}>
                −{money(section.jami)}
              </Text>
            </View>
          )}
          refreshControl={
            <RefreshControl
              refreshing={refreshing} tintColor={colors.primary}
              onRefresh={async () => {
                setRefreshing(true); await load(kun).catch(() => {}); setRefreshing(false);
              }}
            />
          }
          ListEmptyComponent={
            <Empty
              icon="chiqim-grafik"
              title={kategoriya ? `"${kategoriya}" bo'yicha chiqim yo'q` : "Bu davrda chiqim yo'q"}
              hint={kategoriya
                ? 'Boshqa kategoriyani tanlang'
                : "Ijara, transport, oylik — do'kondan chiqqan har qanday pul"}
              action={kategoriya ? undefined : {
                title: 'Chiqim qo\'shish', icon: 'qoshish',
                onPress: () => router.push('/expense/new'),
              }}
            />
          }
          renderItem={({ item }) => (
            <PressScale
              accessibilityRole="button"
              accessibilityLabel={`${item.category}, ${money(item.amount)} so'm`}
              accessibilityHint="Tahrirlash uchun bosing"
              onPress={() => router.push(`/expense/${item.id}`)}
              scale={0.985}
              style={s.card}
            >
              <View style={s.ikonka}>
                <Icon name="chiqim-grafik" size={17} color={colors.danger} />
              </View>

              <View style={{ flex: 1, gap: 2 }}>
                <Text style={[font.bodyBold, { color: colors.text }]}>{item.category}</Text>
                <Text style={[font.tiny, { color: colors.textMuted }]}>
                  {soat(new Date(item.created_at))}
                  {item.note ? ` · ${item.note}` : ''}
                </Text>
              </View>

              <Text style={[font.num, { color: colors.danger }]}>
                −{money(item.amount)}
              </Text>
              <Icon name="oldinga" size={16} color={colors.textFaint} />
            </PressScale>
          )}
        />
      )}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  filtrlar: { gap: spacing.xs, paddingBottom: spacing.sm },
  chipQator: { paddingHorizontal: spacing.lg, gap: spacing.xs },
  list: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xxxl, gap: spacing.sm },
  kunSarlavha: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md, paddingVertical: spacing.md,
    marginTop: spacing.lg, marginBottom: spacing.xs,
  },
  card: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    backgroundColor: colors.surface, borderRadius: radius.lg,
    padding: spacing.md,
    borderWidth: 1, borderColor: colors.borderSoft,
    ...elevation[1],
  },
  ikonka: {
    width: 36, height: 36, borderRadius: radius.sm,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.dangerSoft,
  },
});
