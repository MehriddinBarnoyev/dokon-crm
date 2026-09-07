import React, { useCallback, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { api } from '../../src/api/client';
import { Button, Card, Chip, IconButton, SectionTitle, Stat } from '../../src/components/ui';
import { ScreenHeader } from '../../src/components/ScreenHeader';
import { SkeletonCard, SkeletonRow } from '../../src/components/Skeleton';
import { AnimatedMoney } from '../../src/components/AnimatedNumber';
import { PressScale } from '../../src/components/Press';
import { useToast } from '../../src/components/Toast';
import {
  colors, font, money, palette, qty, radius, sana, spacing,
} from '../../src/theme';
import { Icon } from '../../src/components/Icon';

interface DailyRow {
  day: string; sales_total: number; cash_in: number;
  expense_total: number; net_profit: number; sales_count: number;
  /** Shu kuni sotilgan, lekin puli olinmagan summa */
  credit_total: number;
  /** `net_profit` ichidagi qarzda qolgan ulush */
  credit_profit: number;
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
  const router = useRouter();
  const toast = useToast();
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
      toast.xato(e.message);
    } finally {
      setThinking(false);
    }
  }

  const sum = (daily ?? []).reduce((acc, r) => ({
    sales: acc.sales + Number(r.sales_total),
    expense: acc.expense + Number(r.expense_total),
    profit: acc.profit + Number(r.net_profit),
    count: acc.count + Number(r.sales_count),
    qarzFoyda: acc.qarzFoyda + Number(r.credit_profit ?? 0),
  }), { sales: 0, expense: 0, profit: 0, count: 0, qarzFoyda: 0 });

  const foydali = sum.profit >= 0;

  /**
   * FOYDA IKKI XIL O'QILADI — ikkalasi ham to'g'ri, savoli boshqa:
   *
   *   "Do'kon foyda qilyaptimi?"     → sum.profit (qarzga sotilgani ham kiradi)
   *   "Cho'ntagimda qancha qoldi?"   → shundan qarzda qolgani ayirilgani
   *
   * Birinchisi biznes sog'lom-yo'qligini ko'rsatadi, ikkinchisi bugun tovar
   * olishga puling bor-yo'qligini. Do'konlar aynan ikkinchisini ko'rmagani
   * uchun "foydam bor edi, pulim yo'q" degan holatga tushadi.
   */
  const naqdFoyda = sum.profit - sum.qarzFoyda;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      {/* Hisobot pastki paneldan olib tashlangan (u yerda faqat kunlik amallar
          turadi) — shuning uchun bu yerda o'z "orqaga"si bo'lishi kerak. */}
      <ScreenHeader
        title="Hisobot"
        subtitle={`so'nggi ${days} kun`}
        left={
          <IconButton
            name="orqaga" label="Orqaga" tone="soft" size={22}
            onPress={() => (router.canGoBack() ? router.back() : router.replace('/(tabs)'))}
          />
        }
      />

      <ScrollView
        contentContainerStyle={s.scroll}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing} tintColor={colors.primary}
            onRefresh={async () => {
              setRefreshing(true); await load(days).catch(() => {}); setRefreshing(false);
            }}
          />
        }
      >
        <View style={{ flexDirection: 'row', gap: spacing.sm }}>
          {DAVRLAR.map((d) => (
            <Chip
              key={d.days} label={d.label}
              active={days === d.days} onPress={() => setDays(d.days)}
            />
          ))}
        </View>

        {!daily ? (
          <View style={{ gap: spacing.md }}>
            <SkeletonCard lines={4} />
            <SkeletonCard lines={2} />
            <SkeletonRow /><SkeletonRow />
          </View>
        ) : (
          <>
            {/* Davr natijasi */}
            <Animated.View entering={FadeInDown.duration(280)}>
              <Card tone="raised">
                <Text style={[font.label, { color: colors.textMuted }]}>
                  {days} KUNLIK SOF FOYDA
                </Text>
                <View style={s.moneyRow}>
                  <AnimatedMoney
                    value={sum.profit}
                    style={[font.display, { color: foydali ? colors.success : colors.danger }]}
                  />
                  <Text style={[font.h3, { color: colors.textMuted, paddingBottom: 4 }]}>
                    so'm
                  </Text>
                </View>

                <View style={s.grid}>
                  <Cell><Stat label="Savdo" value={money(sum.sales)} /></Cell>
                  <Cell>
                    {/* Chiqim yagona boshqariladigan raqam — bosilsa
                        ro'yxati ochiladi. */}
                    <PressScale
                      accessibilityRole="button"
                      accessibilityLabel={`Chiqim ${money(sum.expense)} so'm, ro'yxatni ochish`}
                      onPress={() => router.push('/expenses')}
                      scale={0.96}
                    >
                      <Stat label="Chiqim ›" value={money(sum.expense)} tone={colors.danger} />
                    </PressScale>
                  </Cell>
                  <Cell><Stat label="Savdolar soni" value={String(sum.count)} /></Cell>
                  <Cell>
                    <Stat
                      label="O'rtacha chek"
                      value={sum.count ? money(sum.sales / sum.count) : '0'}
                    />
                  </Cell>
                </View>

                {sum.qarzFoyda > 0 && (
                  <View style={s.foydaBolim}>
                    <View style={s.foydaQator}>
                      <Text style={[font.small, { color: colors.textMuted, flex: 1 }]}>
                        Qo'lga tushgan foyda
                      </Text>
                      <Text style={[font.num, {
                        color: naqdFoyda >= 0 ? colors.success : colors.danger,
                      }]}>
                        {money(naqdFoyda)}
                      </Text>
                    </View>
                    <View style={s.foydaQator}>
                      <Text style={[font.small, { color: colors.textMuted, flex: 1 }]}>
                        Qarzda turgan foyda
                      </Text>
                      <Text style={[font.num, { color: colors.warning }]}>
                        {money(sum.qarzFoyda)}
                      </Text>
                    </View>
                    <Text style={[font.tiny, { color: colors.textFaint }]}>
                      Yuqoridagi katta raqam — ikkalasining yig'indisi. Foyda mol
                      sotilgan kuni yoziladi, puli keyin kelsa ham.
                    </Text>
                  </View>
                )}
              </Card>
            </Animated.View>

            {/* Ombor holati */}
            {inv && (
              <Animated.View entering={FadeInDown.duration(280).delay(60)}>
                <Card>
                  <View style={s.cardHead}>
                    <Icon name="ombor-qiymat" size={17} color={colors.textMuted} />
                    <Text style={[font.h3, { color: colors.text }]}>Ombor holati</Text>
                  </View>
                  <View style={s.grid}>
                    <Cell>
                      <Stat label="Tovar qiymati (tan narx)" value={money(inv.cost_value)} />
                    </Cell>
                    <Cell>
                      <Stat label="Sotilsa tushadi" value={money(inv.retail_value)}
                        tone={colors.success} />
                    </Cell>
                    <Cell>
                      <Stat label="Tugagan" value={String(inv.out_of_stock)}
                        tone={Number(inv.out_of_stock) > 0 ? colors.danger : undefined} />
                    </Cell>
                    <Cell>
                      <Stat label="Tugayotgan" value={String(inv.low_stock)}
                        tone={Number(inv.low_stock) > 0 ? colors.warning : undefined} />
                    </Cell>
                  </View>
                </Card>
              </Animated.View>
            )}

            {/* AI tahlili */}
            <Animated.View entering={FadeInDown.duration(280).delay(120)}>
              <View style={s.aiCard}>
                <LinearGradient
                  colors={[palette.violet[50], colors.surface]}
                  start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
                  style={s.aiBg}
                />
                <View style={{ gap: spacing.md }}>
                  <View style={s.cardHead}>
                    <View style={s.aiIcon}>
                      <Icon name="ai" size={18} color={colors.accent} />
                    </View>
                    <Text style={[font.h3, { color: colors.text, flex: 1 }]}>AI maslahati</Text>
                  </View>

                  {insight ? (
                    <Animated.Text
                      entering={FadeIn.duration(240)}
                      style={[font.body, { color: colors.text, lineHeight: 23 }]}
                    >
                      {insight}
                    </Animated.Text>
                  ) : (
                    <Text style={[font.small, { color: colors.textMuted }]}>
                      Raqamlaringizni tahlil qilib, nimaga e'tibor berish kerakligini aytadi.
                    </Text>
                  )}

                  <Button
                    title={insight ? 'Qaytadan tahlil qilish' : 'Tahlil qilish'}
                    variant={insight ? 'secondary' : 'primary'}
                    icon={insight ? 'yangilash' : 'yulduz'}
                    loading={thinking}
                    onPress={askAi}
                  />
                </View>
              </View>
            </Animated.View>

            {/* Eng ko'p sotilganlar */}
            {top && top.length > 0 && (
              <>
                <SectionTitle>Eng ko'p sotilganlar</SectionTitle>
                <Card style={{ gap: spacing.md }}>
                  {top.map((p, i) => (
                    <View key={`${p.name}-${i}`} style={s.topRow}>
                      <View style={[s.rank, i < 3 ? s.rankTop : null]}>
                        <Text style={[font.tiny, { color: i < 3 ? colors.onPrimary : colors.textMuted }]}>
                          {i + 1}
                        </Text>
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={[font.body, { color: colors.text }]} numberOfLines={1}>
                          {p.name}
                        </Text>
                        <Text style={[font.tiny, { color: colors.textMuted }]}>
                          {qty(p.total_qty)} {p.unit} · {p.sale_count} marta
                        </Text>
                      </View>
                      <View style={{ alignItems: 'flex-end' }}>
                        <Text style={[font.num, { color: colors.text }]}>
                          {money(p.revenue)}
                        </Text>
                        {/* Zarar ham bo'lishi mumkin — ishora qo'lda qo'yilsa
                            "+-19 500" kabi bema'ni yozuv chiqadi */}
                        <Text style={[font.tiny, {
                          color: Number(p.profit) >= 0 ? colors.success : colors.danger,
                        }]}>
                          {Number(p.profit) >= 0 ? '+' : ''}{money(p.profit)}
                        </Text>
                      </View>
                    </View>
                  ))}
                </Card>
              </>
            )}

            {/* Kunlar bo'yicha */}
            <SectionTitle>Kunlar bo'yicha</SectionTitle>
            <Card style={{ paddingVertical: spacing.sm }}>
              <View style={s.dayHead}>
                <Text style={[font.tiny, { color: colors.textFaint, width: 74 }]}>Kun</Text>
                <Text style={[font.tiny, { color: colors.textFaint, flex: 1 }]}>Savdo</Text>
                <Text style={[font.tiny, { color: colors.textFaint, width: 76, textAlign: 'right' }]}>
                  Chiqim
                </Text>
                <Text style={[font.tiny, { color: colors.textFaint, width: 82, textAlign: 'right' }]}>
                  Foyda
                </Text>
              </View>

              {daily.slice(0, 15).map((r, i) => (
                // Kunni bosish — o'sha kunning to'liq manzarasi
                <PressScale
                  key={r.day}
                  accessibilityRole="button"
                  accessibilityLabel={`${r.day}, foyda ${money(r.net_profit)} so'm`}
                  onPress={() => router.push(`/day/${r.day.slice(0, 10)}`)}
                  scale={0.99}
                  style={[
                    s.dayRow,
                    i > 0 ? { borderTopWidth: 1, borderTopColor: colors.borderSoft } : null,
                  ]}
                >
                  <Text style={[font.small, { color: colors.textMuted, width: 74 }]}>
                    {sana(new Date(r.day))}
                  </Text>
                  <Text style={[font.num, { color: colors.text, flex: 1, fontSize: 13 }]}>
                    {money(r.sales_total)}
                  </Text>
                  <Text style={[font.num, {
                    color: colors.danger, width: 76, textAlign: 'right', fontSize: 13,
                  }]}>
                    −{money(r.expense_total)}
                  </Text>
                  <Text style={[font.num, {
                    color: Number(r.net_profit) >= 0 ? colors.success : colors.danger,
                    width: 82, textAlign: 'right',
                  }]}>
                    {money(r.net_profit)}
                  </Text>
                </PressScale>
              ))}
            </Card>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

/**
 * Panjaradagi bitta katak. Telefon ekrani tor — to'rtta ko'rsatkich bir
 * qatorga tiqilsa yorliqlar kesiladi, shuning uchun 2×2 bo'lib joylashadi.
 */
function Cell({ children }: { children: React.ReactNode }) {
  return <View style={s.cell}>{children}</View>;
}

const s = StyleSheet.create({
  scroll: {
    paddingHorizontal: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxxl,
  },
  moneyRow: {
    flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm, marginTop: spacing.xs,
  },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  foydaBolim: {
    marginTop: spacing.lg, paddingTop: spacing.md, gap: 6,
    borderTopWidth: 1, borderTopColor: colors.borderSoft,
  },
  foydaQator: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  grid: {
    flexDirection: 'row', flexWrap: 'wrap',
    columnGap: spacing.md, rowGap: spacing.lg,
    marginTop: spacing.lg, paddingTop: spacing.md,
    borderTopWidth: 1, borderTopColor: colors.borderSoft,
  },
  cell: { width: '47%' },
  aiCard: {
    borderRadius: radius.lg, padding: spacing.lg,
    borderWidth: 1, borderColor: colors.accentLine,
    backgroundColor: colors.surface,
    overflow: 'hidden',
  },
  aiBg: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 },
  aiIcon: {
    width: 32, height: 32, borderRadius: radius.sm,
    backgroundColor: colors.surface,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: colors.accentLine,
  },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  rank: {
    width: 24, height: 24, borderRadius: 12,
    backgroundColor: colors.surfaceAlt,
    alignItems: 'center', justifyContent: 'center',
  },
  rankTop: { backgroundColor: colors.primary },
  dayHead: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    paddingBottom: spacing.sm,
  },
  dayRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    paddingVertical: spacing.md,
  },
});
