import { useCallback, useMemo, useState } from 'react';
import { RefreshControl, SectionList, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import Animated, { FadeIn } from 'react-native-reanimated';
import { api } from '../../src/api/client';
import type { Sale } from '../../src/api/types';
import { Badge, Empty } from '../../src/components/ui';
import { ScreenHeader } from '../../src/components/ScreenHeader';
import { SkeletonList } from '../../src/components/Skeleton';
import { PressScale } from '../../src/components/Press';
import { useConfirm } from '../../src/components/Confirm';
import { useToast } from '../../src/components/Toast';
import {
  colors, dateLabel, elevation, font, kunKaliti, money, qty, radius,
  sanaToliq, spacing,
} from '../../src/theme';
import { Icon } from '../../src/components/Icon';

/** "2026-08-31" → "Bugun" / "Kecha" / "31-avgust, dushanba" */
function kunNomi(iso: string): string {
  const bugun = kunKaliti(new Date());
  const kecha = kunKaliti(new Date(Date.now() - 864e5));
  if (iso === bugun) return 'Bugun';
  if (iso === kecha) return 'Kecha';
  // Soat 12 — yozgi/qishki vaqt siljishida kun almashib ketmasin
  return sanaToliq(new Date(`${iso}T12:00:00`));
}

export default function SalesScreen() {
  const router = useRouter();
  const confirm = useConfirm();
  const toast = useToast();
  const [items, setItems] = useState<Sale[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(async () => {
    setItems(await api<Sale[]>('/sales?limit=100'));
  }, []);

  /**
   * Savdolarni KUNLAR bo'yicha guruhlaymiz va har bir kunga yakun chiqaramiz.
   * "Bugun qancha bo'ldi" — do'konchiga eng ko'p kerak bo'ladigan raqam.
   */
  const sections = useMemo(() => {
    if (!items) return [];
    const map = new Map<string, Sale[]>();
    for (const sale of items) {
      const kun = kunKaliti(new Date(sale.created_at));
      const ro = map.get(kun);
      if (ro) ro.push(sale); else map.set(kun, [sale]);
    }
    return [...map.entries()].map(([kun, list]) => ({
      title: kun,
      jami: list.reduce((x, r) => x + Number(r.total), 0),
      foyda: list.reduce((x, r) => x + (Number(r.total) - Number(r.cost_total)), 0),
      data: list,
    }));
  }, [items]);

  useFocusEffect(useCallback(() => { load().catch(() => {}); }, [load]));

  const jamiSavdo = (items ?? []).reduce((x, r) => x + Number(r.total), 0);

  async function askCancel(sale: Sale) {
    const qarz = Number(sale.total) - Number(sale.paid);
    const ok = await confirm({
      title: 'Savdoni bekor qilish',
      icon: 'savdo',
      amount: Number(sale.total),
      amountLabel: 'Bekor qilinadigan savdo',
      lines: [
        ...(sale.items ?? []).map((i) =>
          `${qty(i.qty)} ${i.unit} ${i.name} — ${money(i.subtotal)} so'm`),
        'Mahsulotlar omborga qaytariladi',
        `Kunlik kirimdan ${money(sale.paid)} so'm ayiriladi`,
        ...(qarz > 0 ? [`${money(qarz)} so'mlik qarz yozuvi ham o'chiriladi`] : []),
      ],
      warnings: ['Bu amalni ortga qaytarib bo\'lmaydi'],
      confirmText: 'Bekor qilish',
      destructive: true,
    });
    if (!ok) return;

    try {
      await api(`/sales/${sale.id}`, { method: 'DELETE' });
      await load();
      toast.ok('Savdo bekor qilindi, mahsulotlar omborga qaytdi');
    } catch (e: any) {
      toast.xato(e.message);
    }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      <ScreenHeader
        title="Savdolar"
        subtitle={items ? `oxirgi ${items.length} ta · ${money(jamiSavdo)} so'm` : undefined}
        action={{
          icon: 'qoshish', label: 'Yangi savdo',
          onPress: () => router.push('/sale/new'),
        }}
      />

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
            <PressScale
              accessibilityRole="button"
              accessibilityLabel={`${kunNomi(section.title)}, jami ${money(section.jami)} so'm`}
              onPress={() => router.push(`/day/${section.title}`)}
              scale={0.99}
              style={s.kunSarlavha}
            >
              <View style={{ flex: 1 }}>
                <Text style={[font.bodyBold, { color: colors.text }]}>
                  {kunNomi(section.title)}
                </Text>
                <Text style={[font.tiny, { color: colors.textMuted }]}>
                  {section.data.length} ta savdo · foyda {money(section.foyda)}
                </Text>
              </View>
              <Text style={[font.num, { color: colors.text }]}>{money(section.jami)}</Text>
              <Icon name="oldinga" size={16} color={colors.textFaint} />
            </PressScale>
          )}
          refreshControl={
            <RefreshControl
              refreshing={refreshing} tintColor={colors.primary}
              onRefresh={async () => {
                setRefreshing(true); await load().catch(() => {}); setRefreshing(false);
              }}
            />
          }
          ListEmptyComponent={
            <Empty
              icon="savdo" title="Hali savdo yo'q"
              hint="Bosh sahifadagi AI paneliga yozing yoki + tugmasini bosing"
              action={{
                title: 'Yangi savdo', icon: 'qoshish',
                onPress: () => router.push('/sale/new'),
              }}
            />
          }
          renderItem={({ item }) => {
            const expanded = open === item.id;
            const owed = Number(item.total) - Number(item.paid);
            return (
              <PressScale
                accessibilityRole="button"
                accessibilityLabel={`${money(item.total)} so'mlik savdo`}
                accessibilityHint="Tafsilotlar uchun bosing, bekor qilish uchun bosib turing"
                onPress={() => setOpen(expanded ? null : item.id)}
                onLongPress={() => askCancel(item)}
                scale={0.985}
                style={[s.card, owed > 0 ? { borderLeftWidth: 3, borderLeftColor: colors.warning } : null]}
              >
                <View style={s.rowTop}>
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={[font.num, { color: colors.text, fontSize: 17 }]}>
                      {money(item.total)} <Text style={[font.small, { color: colors.textMuted }]}>so'm</Text>
                    </Text>
                    <Text style={[font.tiny, { color: colors.textMuted }]}>
                      {dateLabel(item.created_at)}
                      {item.customer_name ? ` · ${item.customer_name}` : ''}
                    </Text>
                  </View>

                  <View style={{ alignItems: 'flex-end', gap: 5 }}>
                    <Badge
                      text={item.payment_method}
                      tone={item.payment_method === 'qarz' ? 'warning' : 'success'}
                      dot
                    />
                    {item.source === 'ai' ? <Badge text="AI" tone="accent" /> : null}
                  </View>
                </View>

                {owed > 0 && (
                  <Text style={[font.tiny, { color: colors.warning }]}>
                    Qarz qoldi: {money(owed)} so'm
                  </Text>
                )}

                {expanded && item.items && (
                  <Animated.View entering={FadeIn.duration(160)} style={s.details}>
                    {item.items.map((it, i) => (
                      <View key={i} style={s.detailRow}>
                        <Text style={[font.small, { color: colors.textMuted, flex: 1 }]}>
                          {qty(it.qty)} {it.unit} × {it.name}
                        </Text>
                        <Text style={[font.num, { color: colors.text, fontSize: 13 }]}>
                          {money(it.subtotal)}
                        </Text>
                      </View>
                    ))}
                    <View style={s.hintRow}>
                      <Icon name="ogohlantirish" size={13} color={colors.textFaint} />
                      <Text style={[font.tiny, { color: colors.textFaint }]}>
                        Bekor qilish uchun bosib turing
                      </Text>
                    </View>
                  </Animated.View>
                )}
              </PressScale>
            );
          }}
        />
      )}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  list: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xxxl, gap: spacing.sm },
  kunSarlavha: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md, paddingVertical: spacing.md,
    marginTop: spacing.lg, marginBottom: spacing.xs,
  },
  card: {
    backgroundColor: colors.surface, borderRadius: radius.lg,
    padding: spacing.md, gap: spacing.xs,
    borderWidth: 1, borderColor: colors.borderSoft,
    ...elevation[1],
  },
  rowTop: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  details: {
    marginTop: spacing.sm, paddingTop: spacing.sm,
    borderTopWidth: 1, borderTopColor: colors.borderSoft, gap: 4,
  },
  detailRow: { flexDirection: 'row', gap: spacing.md, alignItems: 'center' },
  hintRow: {
    flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: spacing.xs,
  },
});
