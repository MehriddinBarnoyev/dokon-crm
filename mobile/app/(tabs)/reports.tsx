import { useCallback, useState } from 'react';
import {
  Alert, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { api } from '../../src/api/client';
import { useAuth } from '../../src/api/auth';
import { Button, Card, Loading, SectionTitle } from '../../src/components/ui';
import { colors, font, money, qty, radius, spacing } from '../../src/theme';
import { Icon } from '../../src/components/Icon';

interface DailyRow {
  day: string; sales_total: number; cash_in: number;
  expense_total: number; net_profit: number; sales_count: number;
}
interface TopRow {
  name: string; unit: string; total_qty: number;
  revenue: number; profit: number; sale_count: number;
}
interface InvValue {
  product_count: number; cost_value: number; retail_value: number;
  out_of_stock: number; low_stock: number;
}

const DAVRLAR = [
  { label: '7 kun', days: 7 },
  { label: '30 kun', days: 30 },
  { label: '90 kun', days: 90 },
] as const;

export default function ReportsScreen() {
  const { logout } = useAuth();
  const router = useRouter();
  const [days, setDays] = useState(30);
  const [daily, setDaily] = useState<DailyRow[] | null>(null);
  const [top, setTop] = useState<TopRow[] | null>(null);
  const [inv, setInv] = useState<InvValue | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const [insight, setInsight] = useState<string | null>(null);
  const [thinking, setThinking] = useState(false);

  const load = useCallback(async (d: number) => {
    const [a, b, c] = await Promise.all([
      api<DailyRow[]>(`/reports/daily?days=${d}`),
      api<TopRow[]>(`/reports/top-products?days=${d}`),
      api<InvValue>('/reports/inventory-value'),
    ]);
    setDaily(a); setTop(b); setInv(c);
  }, []);

  useFocusEffect(useCallback(() => { load(days).catch(() => {}); }, [load, days]));

  async function askAi() {
    setThinking(true);
    setInsight(null);
    try {
      const res = await api<{ summary: string }>('/ai/insights', {
        method: 'POST', body: { days }, timeoutMs: 120000,
      });
      setInsight(res.summary);
    } catch (e: any) {
      Alert.alert('Tahlil qilib bo\'lmadi', e.message);
    } finally {
      setThinking(false);
    }
  }

  const sum = (daily ?? []).reduce((acc, r) => ({
    sales: acc.sales + Number(r.sales_total),
    expense: acc.expense + Number(r.expense_total),
    profit: acc.profit + Number(r.net_profit),
    count: acc.count + Number(r.sales_count),
  }), { sales: 0, expense: 0, profit: 0, count: 0 });

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      <ScrollView
        contentContainerStyle={s.scroll}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={async () => {
            setRefreshing(true); await load(days).catch(() => {}); setRefreshing(false);
          }} />
        }
      >
        <Text style={[font.h2, { color: colors.text }]}>Hisobot</Text>

        <View style={{ flexDirection: 'row', gap: spacing.sm }}>
          {DAVRLAR.map((d) => (
            <Pressable
              key={d.days}
              onPress={() => setDays(d.days)}
              style={[s.chip, days === d.days && s.chipOn]}
            >
              <Text style={[font.tiny, { color: days === d.days ? '#fff' : colors.textMuted }]}>
                {d.label}
              </Text>
            </Pressable>
          ))}
        </View>

        {!daily ? <Loading /> : (
          <>
            <Card>
              <Text style={[font.small, { color: colors.textMuted }]}>
                {days} kunlik natija
              </Text>
              <Text style={[font.h1, {
                color: sum.profit >= 0 ? colors.success : colors.danger, marginTop: 2,
              }]}>
                {money(sum.profit)} <Text style={font.h3}>so'm</Text>
              </Text>
              <Text style={[font.tiny, { color: colors.textFaint }]}>sof foyda</Text>

              <View style={s.grid}>
                <Cell label="Savdo" value={money(sum.sales)} />
                <Cell label="Chiqim" value={money(sum.expense)} tone={colors.danger} />
                <Cell label="Savdolar soni" value={String(sum.count)} />
                <Cell
                  label="O'rtacha chek"
                  value={sum.count ? money(sum.sales / sum.count) : '0'}
                />
              </View>
            </Card>

            {inv && (
              <Card>
                <Text style={[font.h3, { color: colors.text, marginBottom: spacing.md }]}>
                  Ombor holati
                </Text>
                <View style={s.grid}>
                  <Cell label="Tovar qiymati (tan narx)" value={money(inv.cost_value)} />
                  <Cell label="Sotilsa tushadi" value={money(inv.retail_value)}
                    tone={colors.success} />
                  <Cell label="Tugagan" value={String(inv.out_of_stock)}
                    tone={Number(inv.out_of_stock) > 0 ? colors.danger : undefined} />
                  <Cell label="Tugayotgan" value={String(inv.low_stock)}
                    tone={Number(inv.low_stock) > 0 ? colors.warning : undefined} />
                </View>
              </Card>
            )}

            {/* AI tahlili */}
            <Card style={{ gap: spacing.md }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                <Icon name="ai" size={21} color={colors.accent} />
                <Text style={[font.h3, { color: colors.text, flex: 1 }]}>AI maslahati</Text>
              </View>

              {insight ? (
                <Text style={[font.body, { color: colors.text, lineHeight: 22 }]}>
                  {insight}
                </Text>
              ) : (
                <Text style={[font.small, { color: colors.textMuted }]}>
                  Raqamlaringizni tahlil qilib, nimaga e'tibor berish kerakligini aytadi.
                </Text>
              )}

              <Button
                title={insight ? 'Qaytadan tahlil qilish' : 'Tahlil qilish'}
                variant={insight ? 'secondary' : 'primary'}
                loading={thinking}
                onPress={askAi}
              />
            </Card>

            {top && top.length > 0 && (
              <>
                <SectionTitle>Eng ko'p sotilganlar</SectionTitle>
                <Card style={{ gap: spacing.md }}>
                  {top.map((p, i) => (
                    <View key={`${p.name}-${i}`} style={s.topRow}>
                      <Text style={[font.tiny, s.rank]}>{i + 1}</Text>
                      <View style={{ flex: 1 }}>
                        <Text style={[font.body, { color: colors.text }]} numberOfLines={1}>
                          {p.name}
                        </Text>
                        <Text style={[font.tiny, { color: colors.textMuted }]}>
                          {qty(p.total_qty)} {p.unit} · {p.sale_count} marta
                        </Text>
                      </View>
                      <View style={{ alignItems: 'flex-end' }}>
                        <Text style={[font.bodyBold, { color: colors.text }]}>
                          {money(p.revenue)}
                        </Text>
                        <Text style={[font.tiny, { color: colors.success }]}>
                          +{money(p.profit)}
                        </Text>
                      </View>
                    </View>
                  ))}
                </Card>
              </>
            )}

            <SectionTitle>Kunlar bo'yicha</SectionTitle>
            <Card style={{ gap: spacing.sm }}>
              {daily.slice(0, 15).map((r) => (
                // Kunni bosish — o'sha kunning to'liq manzarasi
                <Pressable
                  key={r.day}
                  onPress={() => router.push(`/day/${r.day.slice(0, 10)}`)}
                  style={({ pressed }) => [s.dayRow, pressed && { opacity: 0.6 }]}
                >
                  <Text style={[font.small, { color: colors.textMuted, width: 78 }]}>
                    {new Date(r.day).toLocaleDateString('uz-UZ',
                      { day: '2-digit', month: 'short' })}
                  </Text>
                  <Text style={[font.small, { color: colors.text, flex: 1 }]}>
                    {money(r.sales_total)}
                  </Text>
                  <Text style={[font.small, { color: colors.danger, width: 80, textAlign: 'right' }]}>
                    −{money(r.expense_total)}
                  </Text>
                  <Text style={[
                    font.bodyBold,
                    {
                      color: Number(r.net_profit) >= 0 ? colors.success : colors.danger,
                      width: 84, textAlign: 'right',
                    },
                  ]}>
                    {money(r.net_profit)}
                  </Text>
                </Pressable>
              ))}
            </Card>

            <Button title="Chiqish" variant="danger" onPress={logout}
              style={{ marginTop: spacing.lg }} />
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function Cell({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <View style={{ width: '47%', gap: 2 }}>
      <Text style={[font.tiny, { color: colors.textMuted }]}>{label}</Text>
      <Text style={[font.bodyBold, { color: tone ?? colors.text }]}>{value}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  scroll: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxl },
  chip: {
    paddingHorizontal: spacing.md, paddingVertical: 7,
    borderRadius: radius.pill, backgroundColor: colors.surfaceAlt,
  },
  chipOn: { backgroundColor: colors.primary },
  grid: {
    flexDirection: 'row', flexWrap: 'wrap',
    gap: spacing.md, rowGap: spacing.md,
    marginTop: spacing.lg, paddingTop: spacing.md,
    borderTopWidth: 1, borderTopColor: colors.border,
  },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  rank: {
    width: 22, height: 22, borderRadius: 11,
    backgroundColor: colors.surfaceAlt, color: colors.textMuted,
    textAlign: 'center', lineHeight: 22,
  },
  dayRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
});
