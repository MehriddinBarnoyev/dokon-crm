/**
 * BITTA KUNNING TO'LIQ MANZARASI
 * Do'konchi "o'tgan seshanba nima bo'lgan edi?" deb qarashi uchun:
 * o'sha kunning savdolari, chiqimlari va qarz yozuvlari bir joyda.
 */
import { useCallback, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { api } from '../../src/api/client';
import type { PaymentMethod, SaleItem } from '../../src/api/types';
import { Badge, Card, Loading, SectionTitle } from '../../src/components/ui';
import { Icon } from '../../src/components/Icon';
import { colors, font, money, qty, radius, spacing } from '../../src/theme';

interface DaySale {
  id: string; total: number; paid: number; cost_total: number;
  payment_method: PaymentMethod; note: string | null; source: string;
  created_at: string; customer_name: string | null; seller_name: string | null;
  items: SaleItem[] | null;
}
interface DayExpense {
  id: string; category: string; amount: number; note: string | null; created_at: string;
}
interface DayDebt {
  id: string; amount: number; note: string | null;
  created_at: string; customer_name: string;
}
interface DayReport {
  day: string;
  summary: {
    sales_total: number; cash_in: number; expense_total: number;
    net_profit: number; sales_count: number;
  };
  sales: DaySale[];
  expenses: DayExpense[];
  debts: DayDebt[];
}

const soat = (iso: string) =>
  new Date(iso).toLocaleTimeString('uz-UZ', { hour: '2-digit', minute: '2-digit' });

function sarlavha(iso: string): string {
  const d = new Date(`${iso}T12:00:00`);
  const bugun = new Date();
  const kecha = new Date(bugun); kecha.setDate(bugun.getDate() - 1);
  const key = (x: Date) => x.toISOString().slice(0, 10);

  if (iso === key(bugun)) return 'Bugun';
  if (iso === key(kecha)) return 'Kecha';
  return d.toLocaleDateString('uz-UZ', {
    day: 'numeric', month: 'long', weekday: 'long',
  });
}

export default function DayScreen() {
  const { date } = useLocalSearchParams<{ date: string }>();
  const router = useRouter();
  const [data, setData] = useState<DayReport | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [ochiq, setOchiq] = useState<string | null>(null);

  const load = useCallback(async () => {
    setData(await api<DayReport>(`/reports/day/${date}`));
  }, [date]);

  useFocusEffect(useCallback(() => { load().catch(() => {}); }, [load]));

  if (!data) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}><Loading /></SafeAreaView>
    );
  }

  const s = data.summary;
  const foyda = Number(s.net_profit);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
      <View style={st.head}>
        <Pressable onPress={() => router.back()} hitSlop={10}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Icon name="orqaga" size={20} color={colors.primary} />
            <Text style={[font.body, { color: colors.primary }]}>Orqaga</Text>
          </View>
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={st.scroll}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={async () => {
            setRefreshing(true); await load().catch(() => {}); setRefreshing(false);
          }} />
        }
      >
        <Text style={[font.h1, { color: colors.text }]}>{sarlavha(data.day)}</Text>
        <Text style={[font.small, { color: colors.textMuted }]}>{data.day}</Text>

        {/* Kun yakuni */}
        <Card>
          <Text style={[font.small, { color: colors.textMuted }]}>Kunlik tushum</Text>
          <Text style={[font.h1, { color: colors.text, marginTop: 2 }]}>
            {money(s.cash_in)} <Text style={font.h3}>so'm</Text>
          </Text>

          <View style={st.grid}>
            <Katak label="Savdo" value={money(s.sales_total)} />
            <Katak label="Chiqim" value={money(s.expense_total)} tone={colors.danger} />
            <Katak label="Sof foyda" value={money(foyda)}
              tone={foyda >= 0 ? colors.success : colors.danger} />
            <Katak label="Savdolar soni" value={String(s.sales_count)} />
          </View>
        </Card>

        {/* Savdolar */}
        <SectionTitle right={<Badge text={`${data.sales.length}`} tone="primary" />}>
          Savdolar
        </SectionTitle>
        {data.sales.length === 0 ? (
          <Card><Text style={[font.small, { color: colors.textMuted }]}>
            Bu kuni savdo bo'lmagan
          </Text></Card>
        ) : (
          <Card style={{ gap: spacing.md }}>
            {data.sales.map((sale) => {
              const ochiqmi = ochiq === sale.id;
              const qarz = Number(sale.total) - Number(sale.paid);
              return (
                <Pressable
                  key={sale.id}
                  onPress={() => setOchiq(ochiqmi ? null : sale.id)}
                  style={st.row}
                >
                  <Text style={[font.tiny, { color: colors.textFaint, width: 44 }]}>
                    {soat(sale.created_at)}
                  </Text>
                  <View style={{ flex: 1 }}>
                    <Text style={[font.bodyBold, { color: colors.text }]}>
                      {money(sale.total)} so'm
                    </Text>
                    <Text style={[font.tiny, { color: colors.textMuted }]} numberOfLines={ochiqmi ? 0 : 1}>
                      {(sale.items ?? [])
                        .map((i) => `${qty(i.qty)} ${i.unit} ${i.name}`)
                        .join(', ') || '—'}
                    </Text>
                    {sale.customer_name ? (
                      <Text style={[font.tiny, { color: colors.textFaint }]}>
                        {sale.customer_name}
                      </Text>
                    ) : null}
                    {qarz > 0 ? (
                      <Text style={[font.tiny, { color: colors.warning }]}>
                        Qarz: {money(qarz)} so'm
                      </Text>
                    ) : null}
                  </View>
                  <View style={{ alignItems: 'flex-end', gap: 3 }}>
                    <Badge text={sale.payment_method}
                      tone={sale.payment_method === 'qarz' ? 'warning' : 'success'} />
                    {sale.source === 'ai' ? <Badge text="AI" tone="accent" /> : null}
                  </View>
                </Pressable>
              );
            })}
          </Card>
        )}

        {/* Chiqimlar */}
        {data.expenses.length > 0 && (
          <>
            <SectionTitle right={<Badge text={money(s.expense_total)} tone="danger" />}>
              Chiqimlar
            </SectionTitle>
            <Card style={{ gap: spacing.sm }}>
              {data.expenses.map((e) => (
                <View key={e.id} style={st.row}>
                  <Text style={[font.tiny, { color: colors.textFaint, width: 44 }]}>
                    {soat(e.created_at)}
                  </Text>
                  <Text style={[font.body, { color: colors.text, flex: 1 }]}>
                    {e.category}{e.note ? ` · ${e.note}` : ''}
                  </Text>
                  <Text style={[font.bodyBold, { color: colors.danger }]}>
                    −{money(e.amount)}
                  </Text>
                </View>
              ))}
            </Card>
          </>
        )}

        {/* Qarz harakatlari */}
        {data.debts.length > 0 && (
          <>
            <SectionTitle>Qarz harakatlari</SectionTitle>
            <Card style={{ gap: spacing.sm }}>
              {data.debts.map((d) => {
                const tolov = Number(d.amount) < 0;
                return (
                  <View key={d.id} style={st.row}>
                    <Text style={[font.tiny, { color: colors.textFaint, width: 44 }]}>
                      {soat(d.created_at)}
                    </Text>
                    <View style={{ flex: 1 }}>
                      <Text style={[font.body, { color: colors.text }]}>{d.customer_name}</Text>
                      <Text style={[font.tiny, { color: colors.textMuted }]}>
                        {tolov ? "To'lov qildi" : 'Qarz oldi'}
                      </Text>
                    </View>
                    <Text style={[font.bodyBold, {
                      color: tolov ? colors.success : colors.danger,
                    }]}>
                      {tolov ? '−' : '+'}{money(Math.abs(Number(d.amount)))}
                    </Text>
                  </View>
                );
              })}
            </Card>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function Katak({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <View style={{ width: '47%', gap: 2 }}>
      <Text style={[font.tiny, { color: colors.textMuted }]}>{label}</Text>
      <Text style={[font.bodyBold, { color: tone ?? colors.text }]}>{value}</Text>
    </View>
  );
}

const st = StyleSheet.create({
  head: { padding: spacing.lg, paddingBottom: spacing.sm },
  scroll: { padding: spacing.lg, paddingTop: 0, gap: spacing.md, paddingBottom: spacing.xxl },
  grid: {
    flexDirection: 'row', flexWrap: 'wrap',
    gap: spacing.md, rowGap: spacing.md,
    marginTop: spacing.lg, paddingTop: spacing.md,
    borderTopWidth: 1, borderTopColor: colors.border,
  },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
});
