import { useCallback, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { api } from '../../src/api/client';
import { useAuth } from '../../src/api/auth';
import type { Dashboard } from '../../src/api/types';
import { AiCommandBar } from '../../src/components/AiCommandBar';
import { Badge, Card, Loading, SectionTitle } from '../../src/components/ui';
import { colors, font, money, qty, radius, spacing } from '../../src/theme';
import { Icon } from '../../src/components/Icon';

export default function HomeScreen() {
  const { user, shop } = useAuth();
  const router = useRouter();
  const [data, setData] = useState<Dashboard | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await api<Dashboard>('/reports/dashboard'));
      setError(null);
    } catch (e: any) {
      setError(e.message);
    }
  }, []);

  // Har safar ekranga qaytganda yangilanadi — savdo yozgach darrov ko'rinsin
  useFocusEffect(useCallback(() => { load(); }, [load]));

  async function onRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  const t = data?.today;
  const maxDay = Math.max(1, ...(data?.week ?? []).map((d) => Number(d.sales_total)));

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      <ScrollView
        contentContainerStyle={s.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        {/* Sarlavha */}
        <View style={s.header}>
          <View style={{ flex: 1 }}>
            <Text style={[font.small, { color: colors.textMuted }]}>
              Assalomu alaykum, {user?.name}
            </Text>
            <Text style={[font.h2, { color: colors.text }]}>{shop?.name}</Text>
          </View>
          <Pressable onPress={() => router.push('/sale/new')} style={s.plusBtn}>
            <Icon name="qoshish" size={24} color="#fff" />
          </Pressable>
        </View>

        {/* AI buyruq paneli */}
        <AiCommandBar onDone={load} />

        {error && (
          <Card style={{ backgroundColor: colors.dangerSoft }}>
            <Text style={[font.small, { color: colors.danger }]}>{error}</Text>
          </Card>
        )}

        {!data && !error ? <Loading text="Yuklanmoqda…" /> : null}

        {t && (
          <>
            {/* Bugungi asosiy raqam */}
            <Card>
              <Text style={[font.small, { color: colors.textMuted }]}>Bugungi tushum</Text>
              <Text style={[font.h1, { color: colors.text, marginTop: 2 }]}>
                {money(t.cash_in)} <Text style={font.h3}>so'm</Text>
              </Text>

              <View style={s.statRow}>
                <Stat label="Savdo" value={money(t.sales_total)} tone="neutral" />
                <Stat label="Chiqim" value={money(t.expense_total)} tone="danger" />
                <Stat
                  label="Sof foyda"
                  value={money(t.net_profit)}
                  tone={Number(t.net_profit) >= 0 ? 'success' : 'danger'}
                />
              </View>

              <Text style={[font.tiny, { color: colors.textFaint, marginTop: spacing.sm }]}>
                {t.sales_count} ta savdo
              </Text>
            </Card>

            {/* Haftalik ustunlar */}
            {data.week.length > 0 && (
              <Card>
                <Text style={[font.h3, { color: colors.text, marginBottom: spacing.md }]}>
                  So'nggi 7 kun
                </Text>
                <View style={s.chart}>
                  {data.week.map((d) => {
                    const h = Math.max(4, (Number(d.sales_total) / maxDay) * 90);
                    const label = new Date(d.day)
                      .toLocaleDateString('uz-UZ', { weekday: 'short' });
                    return (
                      <View key={d.day} style={s.bar}>
                        <Text style={[font.tiny, { color: colors.textFaint }]}>
                          {Math.round(Number(d.sales_total) / 1000)}k
                        </Text>
                        <View style={[s.barFill, { height: h }]} />
                        <Text style={[font.tiny, { color: colors.textMuted }]}>{label}</Text>
                      </View>
                    );
                  })}
                </View>
              </Card>
            )}

            {/* Qarzlar */}
            <Card onPress={() => router.push('/(tabs)/debts')}>
              <View style={s.rowBetween}>
                <View>
                  <Text style={[font.small, { color: colors.textMuted }]}>Umumiy qarz</Text>
                  <Text style={[font.h2, { color: colors.text }]}>
                    {money(data.debts.total_owed)} so'm
                  </Text>
                  <Text style={[font.tiny, { color: colors.textMuted }]}>
                    {data.debts.debtor_count} ta qarzdor
                  </Text>
                </View>
                {Number(data.debts.overdue_count) > 0 && (
                  <Badge text={`${data.debts.overdue_count} ta muddati o'tgan`} tone="danger" />
                )}
              </View>
            </Card>

            {/* Tugayotgan mahsulotlar */}
            {data.low_stock.length > 0 && (
              <>
                <SectionTitle
                  right={<Badge text={`${data.low_stock.length}`} tone="warning" />}
                >
                  Tugayapti
                </SectionTitle>
                <Card style={{ gap: spacing.sm }}>
                  {data.low_stock.map((p) => (
                    <Pressable
                      key={p.id}
                      onPress={() => router.push(`/product/${p.id}`)}
                      style={s.rowBetween}
                    >
                      <Text style={[font.body, { color: colors.text, flex: 1 }]}>{p.name}</Text>
                      <Text style={[
                        font.bodyBold,
                        { color: Number(p.stock) <= 0 ? colors.danger : colors.warning },
                      ]}>
                        {qty(p.stock)} {p.unit}
                      </Text>
                    </Pressable>
                  ))}
                </Card>
              </>
            )}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function Stat({ label, value, tone }: {
  label: string; value: string; tone: 'neutral' | 'success' | 'danger';
}) {
  const c = tone === 'success' ? colors.success
    : tone === 'danger' ? colors.danger : colors.text;
  return (
    <View style={{ flex: 1 }}>
      <Text style={[font.tiny, { color: colors.textMuted }]}>{label}</Text>
      <Text style={[font.bodyBold, { color: c }]} numberOfLines={1}>{value}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  scroll: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxl },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  plusBtn: {
    width: 44, height: 44, borderRadius: radius.md,
    backgroundColor: colors.primary,
    alignItems: 'center', justifyContent: 'center',
  },
  statRow: {
    flexDirection: 'row',
    gap: spacing.md,
    marginTop: spacing.lg,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  rowBetween: {
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between', gap: spacing.md,
  },
  chart: {
    flexDirection: 'row', alignItems: 'flex-end',
    justifyContent: 'space-between', gap: spacing.xs, height: 130,
  },
  // justifyContent: ustunlar pastdan o'ssin
  bar: { flex: 1, alignItems: 'center', justifyContent: 'flex-end', gap: 4 },
  barFill: {
    width: '70%',
    backgroundColor: colors.primary,
    borderRadius: radius.sm,
    minHeight: 4,
  },
});
