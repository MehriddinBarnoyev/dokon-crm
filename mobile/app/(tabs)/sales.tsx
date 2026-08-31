import { useCallback, useMemo, useState } from 'react';
import { Alert, Pressable, RefreshControl, SectionList, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { api } from '../../src/api/client';
import type { Sale } from '../../src/api/types';
import { Badge, Empty, Loading } from '../../src/components/ui';
import { useConfirm } from '../../src/components/Confirm';
import { colors, dateLabel, font, money, qty, radius, shadow, spacing } from '../../src/theme';
import { Icon } from '../../src/components/Icon';

/** "2026-08-31" → "Bugun" / "Kecha" / "31-avgust, dushanba" */
function kunNomi(iso: string): string {
  const bugun = new Date().toLocaleDateString('en-CA');
  const kecha = new Date(Date.now() - 864e5).toLocaleDateString('en-CA');
  if (iso === bugun) return 'Bugun';
  if (iso === kecha) return 'Kecha';
  return new Date(`${iso}T12:00:00`).toLocaleDateString('uz-UZ', {
    day: 'numeric', month: 'long', weekday: 'long',
  });
}

export default function SalesScreen() {
  const router = useRouter();
  const confirm = useConfirm();
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
      const kun = new Date(sale.created_at).toLocaleDateString('en-CA');
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
    } catch (e: any) {
      Alert.alert('Xato', e.message);
    }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      <View style={s.head}>
        <Text style={[font.h2, { color: colors.text, flex: 1 }]}>Savdolar</Text>
        <Pressable onPress={() => router.push('/sale/new')} style={s.plusBtn}>
          <Icon name="qoshish" size={22} color="#fff" />
        </Pressable>
      </View>

      {!items ? <Loading /> : (
        <SectionList
          sections={sections}
          keyExtractor={(x) => x.id}
          contentContainerStyle={s.list}
          stickySectionHeadersEnabled={false}
          renderSectionHeader={({ section }) => (
            <Pressable
              onPress={() => router.push(`/day/${section.title}`)}
              style={({ pressed }) => [s.kunSarlavha, pressed && { opacity: 0.7 }]}
            >
              <View style={{ flex: 1 }}>
                <Text style={[font.bodyBold, { color: colors.text }]}>
                  {kunNomi(section.title)}
                </Text>
                <Text style={[font.tiny, { color: colors.textMuted }]}>
                  {section.data.length} ta savdo · foyda {money(section.foyda)}
                </Text>
              </View>
              <Text style={[font.h3, { color: colors.text }]}>{money(section.jami)}</Text>
            </Pressable>
          )}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={async () => {
              setRefreshing(true); await load().catch(() => {}); setRefreshing(false);
            }} />
          }
          ListEmptyComponent={
            <Empty icon="savdo" title="Hali savdo yo'q"
              hint="Bosh sahifadagi AI paneliga yozing yoki + tugmasini bosing" />
          }
          renderItem={({ item }) => {
            const expanded = open === item.id;
            const owed = Number(item.total) - Number(item.paid);
            return (
              <Pressable
                onPress={() => setOpen(expanded ? null : item.id)}
                onLongPress={() => askCancel(item)}
                style={({ pressed }) => [s.card, pressed && { opacity: 0.8 }]}
              >
                <View style={s.rowTop}>
                  <View style={{ flex: 1 }}>
                    <Text style={[font.bodyBold, { color: colors.text }]}>
                      {money(item.total)} so'm
                    </Text>
                    <Text style={[font.tiny, { color: colors.textMuted }]}>
                      {dateLabel(item.created_at)}
                      {item.customer_name ? ` · ${item.customer_name}` : ''}
                    </Text>
                  </View>

                  <View style={{ alignItems: 'flex-end', gap: 4 }}>
                    <Badge
                      text={item.payment_method}
                      tone={item.payment_method === 'qarz' ? 'warning' : 'success'}
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
                  <View style={s.details}>
                    {item.items.map((it, i) => (
                      <View key={i} style={s.detailRow}>
                        <Text style={[font.small, { color: colors.textMuted, flex: 1 }]}>
                          {qty(it.qty)} {it.unit} × {it.name}
                        </Text>
                        <Text style={[font.small, { color: colors.text }]}>
                          {money(it.subtotal)}
                        </Text>
                      </View>
                    ))}
                    <Text style={[font.tiny, { color: colors.textFaint, marginTop: spacing.xs }]}>
                      Bekor qilish uchun bosib turing
                    </Text>
                  </View>
                )}
              </Pressable>
            );
          }}
        />
      )}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  head: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    padding: spacing.lg,
  },
  plusBtn: {
    width: 40, height: 40, borderRadius: radius.md,
    backgroundColor: colors.primary,
    alignItems: 'center', justifyContent: 'center',
  },
  list: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.sm },
  kunSarlavha: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    marginTop: spacing.md, marginBottom: spacing.xs,
  },
  card: {
    backgroundColor: colors.surface, borderRadius: radius.lg,
    padding: spacing.md, gap: spacing.xs, ...shadow,
  },
  rowTop: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  details: {
    marginTop: spacing.sm, paddingTop: spacing.sm,
    borderTopWidth: 1, borderTopColor: colors.border, gap: 3,
  },
  detailRow: { flexDirection: 'row', gap: spacing.md },
});
