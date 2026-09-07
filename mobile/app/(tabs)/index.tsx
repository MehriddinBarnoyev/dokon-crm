import { useCallback, useEffect, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { api } from '../../src/api/client';
import * as cache from '../../src/lib/cache';
import { useAuth } from '../../src/api/auth';
import type { Dashboard } from '../../src/api/types';
import { AiCommandBar } from '../../src/components/AiCommandBar';
import { OutboxBanner } from '../../src/components/OutboxBanner';
import { BarChart, type Bar } from '../../src/components/BarChart';
import { AnimatedMoney } from '../../src/components/AnimatedNumber';
import { ScreenHeader } from '../../src/components/ScreenHeader';
import { SkeletonCard, SkeletonRow } from '../../src/components/Skeleton';
import { Badge, Button, Card, SectionTitle, Stat } from '../../src/components/ui';
import { PressScale } from '../../src/components/Press';
import { colors, font, haftaKuni, money, qty, radius, spacing } from '../../src/theme';
import { Icon } from '../../src/components/Icon';

export default function HomeScreen() {
  const { user, shop } = useAuth();
  const router = useRouter();
  const [data, setData] = useState<Dashboard | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * Dashboard cache'dan DARHOL ko'rsatiladi, so'ng serverdan yangilanadi.
   *
   * Nega: bu ilova ochilganda birinchi ko'rinadigan ekran. Ilgari u har
   * safar bo'sh skeleton bilan turib, so'rov kelguncha kutardi. Endi
   * do'konchi kechagi raqamni bo'lsa ham darrov ko'radi va u bir soniyada
   * bugungisiga almashadi. Internet yo'q bo'lsa — oxirgi ma'lum holat
   * qoladi, bo'sh ekran emas.
   */
  const load = useCallback(async () => {
    try {
      const yangi = await api<Dashboard>('/reports/dashboard');
      setData(yangi);
      setError(null);
      if (shop) await cache.write(shop.id, 'dashboard', yangi).catch(() => {});
    } catch (e: any) {
      // Cache'da bir narsa bo'lsa, xato o'rniga o'sha ko'rsatiladi.
      const eski = shop ? await cache.read<Dashboard>(shop.id, 'dashboard') : null;
      if (eski) { setData(eski); setError(null); }
      else setError(e.message);
    }
  }, [shop]);

  // Cache birinchi, so'rov ustidan.
  useEffect(() => {
    if (!shop) return;
    cache.read<Dashboard>(shop.id, 'dashboard')
      .then((eski) => { if (eski) setData((hozir) => hozir ?? eski); })
      .catch(() => {});
  }, [shop]);

  // Har safar ekranga qaytganda yangilanadi — savdo yozgach darrov ko'rinsin
  useFocusEffect(useCallback(() => { load(); }, [load]));

  async function onRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  const t = data?.today;

  const bars: Bar[] = (data?.week ?? []).map((d, i, arr) => ({
    label: haftaKuni(new Date(d.day)),
    value: Number(d.sales_total),
    highlight: i === arr.length - 1,
    onPress: () => {},
  }));

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      <ScreenHeader
        eyebrow={`Assalomu alaykum, ${user?.name ?? ''}`}
        title={shop?.name ?? "Do'kon"}
        action={{
          icon: 'sozlamalar',
          label: 'Sozlamalar',
          onPress: () => router.push('/settings'),
        }}
      />

      <ScrollView
        contentContainerStyle={s.scroll}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary}
          />
        }
      >
        {/* Yuborilmagan o'zgarishlar bo'lsa — eng tepada. */}
        <OutboxBanner />

        {/* AI buyruq paneli */}
        <AiCommandBar onDone={load} />

        {error && (
          <Card style={{ backgroundColor: colors.dangerSoft, borderColor: colors.dangerLine }}>
            <View style={s.rowGap}>
              <Icon name="ogohlantirish" size={18} color={colors.danger} />
              <Text style={[font.small, { color: colors.danger, flex: 1 }]}>{error}</Text>
            </View>
          </Card>
        )}

        {!data && !error ? (
          <View style={{ gap: spacing.md }}>
            <SkeletonCard />
            <SkeletonCard lines={2} />
            <SkeletonRow />
            <SkeletonRow />
          </View>
        ) : null}

        {t && (
          <>
            {/* Bugungi asosiy raqam */}
            <Animated.View entering={FadeInDown.duration(280)}>
              <Card tone="raised">
                <View style={s.rowGap}>
                  <View style={s.liveDot} />
                  <Text style={[font.label, { color: colors.textMuted }]}>BUGUNGI TUSHUM</Text>
                </View>

                <View style={s.moneyRow}>
                  <AnimatedMoney
                    value={Number(t.cash_in)}
                    style={[font.display, { color: colors.text }]}
                  />
                  <Text style={[font.h3, { color: colors.textMuted, paddingBottom: 4 }]}>so'm</Text>
                </View>

                <View style={s.statRow}>
                  <Stat label="Savdo" value={money(t.sales_total)} />
                  {/* Chiqim — yagona bosiladigan ko'rsatkich: qolgan ikkitasi
                      hisoblab chiqarilgan, chiqim esa boshqariladigan ro'yxat. */}
                  <PressScale
                    accessibilityRole="button"
                    accessibilityLabel={`Chiqim ${money(t.expense_total)} so'm, ro'yxatni ochish`}
                    onPress={() => router.push('/expenses')}
                    scale={0.96}
                    style={{ flex: 1 }}
                  >
                    <Stat label="Chiqim ›" value={money(t.expense_total)} tone={colors.danger} />
                  </PressScale>
                  <Stat
                    label="Sof foyda"
                    value={money(t.net_profit)}
                    tone={Number(t.net_profit) >= 0 ? colors.success : colors.danger}
                  />
                </View>

                {/* Foyda bor, lekin pul hali kelmagan — do'kondagi eng ko'p
                    uchraydigan tuzoq. "Sof foyda" raqamining ostida shuni
                    ochiq aytamiz, aks holda kassadagi pul bilan hisobdagi
                    foyda nega bir xil emasligi tushunarsiz bo'lib qoladi. */}
                {Number(t.credit_profit) > 0 && (
                  <View style={s.qarzIzoh}>
                    <Icon name="qarzlar" size={14} color={colors.warning} />
                    <Text style={[font.tiny, { color: colors.warning, flex: 1 }]}>
                      Foydaning {money(t.credit_profit)} so'mi hali qo'lga tushmagan
                      {' — '}bugun {money(t.credit_total)} so'm qarzga berildi
                    </Text>
                  </View>
                )}

                <View style={s.actions}>
                  <Button
                    title="Yangi savdo" icon="qoshish" style={{ flex: 3 }}
                    onPress={() => router.push('/sale/new')}
                  />
                  <Button
                    title="Mahsulot" icon="mahsulot" variant="soft" style={{ flex: 2 }}
                    onPress={() => router.push('/product/new')}
                  />
                </View>

                <Text style={[font.tiny, { color: colors.textFaint, marginTop: spacing.sm }]}>
                  Bugun {t.sales_count} ta savdo yozildi
                </Text>
              </Card>
            </Animated.View>

            {/* Haftalik ustunlar */}
            {bars.length > 0 && (
              <Animated.View entering={FadeInDown.duration(280).delay(60)}>
                <Card>
                  <View style={[s.rowGap, { marginBottom: spacing.md }]}>
                    <Icon name="hisobot" size={16} color={colors.textMuted} />
                    <Text style={[font.h3, { color: colors.text, flex: 1 }]}>So'nggi 7 kun</Text>
                    <PressScale
                      accessibilityRole="button"
                      accessibilityLabel="To'liq hisobot"
                      onPress={() => router.push('/(tabs)/reports')}
                      scale={0.94}
                    >
                      <Text style={[font.smallBold, { color: colors.primary }]}>Hisobot →</Text>
                    </PressScale>
                  </View>
                  <BarChart bars={bars} />
                </Card>
              </Animated.View>
            )}

            {/* Qarzlar */}
            <Animated.View entering={FadeInDown.duration(280).delay(120)}>
              <Card
                onPress={() => router.push('/(tabs)/debts')}
                accent={Number(data.debts.overdue_count) > 0 ? colors.danger : undefined}
              >
                <View style={s.rowBetween}>
                  <View style={{ gap: 2 }}>
                    <Text style={[font.small, { color: colors.textMuted }]}>Umumiy qarz</Text>
                    <Text style={[font.numBig, { color: colors.text }]}>
                      {money(data.debts.total_owed)}{' '}
                      <Text style={[font.h3, { color: colors.textMuted }]}>so'm</Text>
                    </Text>
                    <Text style={[font.tiny, { color: colors.textMuted }]}>
                      {data.debts.debtor_count} ta qarzdor
                    </Text>
                  </View>
                  <View style={{ alignItems: 'flex-end', gap: spacing.sm }}>
                    {Number(data.debts.overdue_count) > 0 && (
                      <Badge
                        dot tone="danger"
                        text={`${data.debts.overdue_count} ta muddati o'tgan`}
                      />
                    )}
                    <Icon name="oldinga" size={18} color={colors.textFaint} />
                  </View>
                </View>
              </Card>
            </Animated.View>

            {/* Tugayotgan mahsulotlar */}
            {data.low_stock.length > 0 && (
              <Animated.View entering={FadeInDown.duration(280).delay(180)}>
                <SectionTitle
                  right={<Badge text={`${data.low_stock.length} ta`} tone="warning" dot />}
                >
                  Tugayapti
                </SectionTitle>
                <Card style={{ paddingVertical: spacing.xs }}>
                  {data.low_stock.map((p, i) => {
                    const out = Number(p.stock) <= 0;
                    return (
                      <PressScale
                        key={p.id}
                        accessibilityRole="button"
                        accessibilityLabel={`${p.name}, ${qty(p.stock)} ${p.unit}`}
                        onPress={() => router.push(`/product/${p.id}`)}
                        scale={0.99}
                        style={[
                          s.lowRow,
                          i > 0 ? { borderTopWidth: 1, borderTopColor: colors.borderSoft } : null,
                        ]}
                      >
                        <View style={[
                          s.lowDot,
                          { backgroundColor: out ? colors.danger : colors.warning },
                        ]} />
                        <Text
                          style={[font.body, { color: colors.text, flex: 1 }]}
                          numberOfLines={1}
                        >
                          {p.name}
                        </Text>
                        <Text style={[
                          font.num,
                          { color: out ? colors.danger : colors.warning },
                        ]}>
                          {qty(p.stock)} {p.unit}
                        </Text>
                      </PressScale>
                    );
                  })}
                </Card>
              </Animated.View>
            )}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  scroll: {
    paddingHorizontal: spacing.lg, gap: spacing.md,
    paddingBottom: spacing.xxxl,
  },
  rowGap: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  // Yashil nuqta: raqam "jonli", hozirgi holatni ko'rsatyapti degani
  liveDot: {
    width: 7, height: 7, borderRadius: 4,
    backgroundColor: colors.success,
  },
  moneyRow: {
    flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm,
    marginTop: spacing.xs,
  },
  statRow: {
    flexDirection: 'row',
    gap: spacing.md,
    marginTop: spacing.lg,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.borderSoft,
  },
  qarzIzoh: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    marginTop: spacing.md,
    backgroundColor: colors.warningSoft,
    borderWidth: 1, borderColor: colors.warningLine,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
  },
  actions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.lg },
  rowBetween: {
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between', gap: spacing.md,
  },
  lowRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    paddingVertical: spacing.md,
  },
  lowDot: { width: 8, height: 8, borderRadius: 4 },
});
