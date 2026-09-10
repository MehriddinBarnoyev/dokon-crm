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
import { Badge, Card, IconButton, SectionTitle } from '../../src/components/ui';
import { ScreenHeader } from '../../src/components/ScreenHeader';
import { SkeletonCard, SkeletonList } from '../../src/components/Skeleton';
import { PressScale } from '../../src/components/Press';
import { AnimatedMoney } from '../../src/components/AnimatedNumber';
import {
  colors, font, kunKaliti, money, qty, radius, sanaToliq, soat as soatFmt, spacing,
} from '../../src/theme';

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
    /** Sotilgan molning tan narxi — foyda zanjiridagi bo'g'in. */
    cost_total: number;
    /** Savdodan olingan naqd (qarzga ketmagani). */
    sales_cash: number;
    /** Eski qarzlarning bugungi to'lovi. */
    debt_paid: number;
    /** Qo'lda yozilgan qarz — mol chiqmagan. */
    debt_given: number;
    net_profit: number; sales_count: number;
    /** Shu kuni sotilgan, lekin puli olinmagan summa */
    credit_total: number;
    /** `net_profit` ichidagi hali qo'lga tushmagan ulush */
    credit_profit: number;
    /**
     * Tovarga sarflangan pul (omborga kirim). Foydadan AYIRILMAYDI —
     * mol olish xarajat emas, pulning tovarga aylanishi; xarajatga u
     * sotilganda, tan narx bo'lib aylanadi. Bu yerda faqat "kassadan
     * shuncha chiqdi" degan ma'lumot.
     *
     * Ixtiyoriy: eski serverda bu maydon yo'q.
     */
    purchase_total?: number;
  };
  sales: DaySale[];
  expenses: DayExpense[];
  debts: DayDebt[];
}

const soat = (iso: string) => soatFmt(new Date(iso));

function sarlavha(iso: string): string {
  const bugun = new Date();
  const kecha = new Date(bugun); kecha.setDate(bugun.getDate() - 1);

  // `toISOString()` — UTC. Toshkent (+5) da yarim tundan keyin u kechagi
  // kunni qaytaradi va "Bugun" o'rniga sana chiqib qolardi.
  if (iso === kunKaliti(bugun)) return 'Bugun';
  if (iso === kunKaliti(kecha)) return 'Kecha';
  // Soat 12 — yozgi/qishki vaqt siljishida kun almashib ketmasin
  return sanaToliq(new Date(`${iso}T12:00:00`));
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
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
        <ScreenHeader
          title="Kun"
          left={<IconButton name="orqaga" label="Orqaga" onPress={() => router.back()} tone="soft" size={22} />}
        />
        <View style={{ paddingHorizontal: spacing.lg, gap: spacing.md }}>
          <SkeletonCard lines={4} />
          <SkeletonList rows={4} />
        </View>
      </SafeAreaView>
    );
  }

  const s = data.summary;
  const foyda = Number(s.net_profit);
  // Eski serverda bu maydon yo'q — `?? 0`.
  const tovarga = Number(s.purchase_total ?? 0);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScreenHeader
        title={sarlavha(data.day)}
        subtitle={data.day}
        left={
          <IconButton
            name="orqaga" label="Orqaga" tone="soft" size={22}
            onPress={() => router.back()}
          />
        }
      />

      <ScrollView
        contentContainerStyle={st.scroll}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing} tintColor={colors.primary}
            onRefresh={async () => {
              setRefreshing(true); await load().catch(() => {}); setRefreshing(false);
            }}
          />
        }
      >
        {/* Kun yakuni */}
        <Card tone="raised">
          <Text style={[font.label, { color: colors.textMuted }]}>KUNLIK TUSHUM</Text>
          <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 6, marginTop: 2 }}>
            <AnimatedMoney value={Number(s.cash_in)} style={[font.display, { color: colors.text }]} />
            <Text style={[font.h3, { color: colors.textMuted, paddingBottom: 4 }]}>so'm</Text>
          </View>

          {/*
            TUSHUM ≠ SAVDO. Eng ko'p savol tug'diradigan joy shu edi:
            yuqorida bitta raqam, pastda "Savdo" boshqa raqam turardi va
            farq qayerdan kelgani aytilmasdi.

              Savdo − qarzga sotilgani = savdodan olingan naqd
              + eski qarzlarning to'lovi = kunlik tushum

            Eski server bu bo'laklarni bermaydi — u holda ko'rsatmaymiz.
          */}
          {s.sales_cash != null && (
            <View style={st.tushumIzoh}>
              <Qator label="Savdodan naqd" value={money(s.sales_cash)} />
              {Number(s.debt_paid) > 0 && (
                <Qator label="Qarz to'lovlari" value={`+ ${money(s.debt_paid)}`}
                  tone={colors.success} />
              )}
            </View>
          )}

          {/* HISOB ZANJIRI. Ilgari bu yerda Savdo, Chiqim va Sof foyda
              alohida turardi va ular bir-biriga bog'lanmasdi: sotilgan mol
              o'zi necha pulga olingani hech qayerda yo'q edi. */}
          {s.cost_total != null ? (
            <View style={st.zanjir}>
              <Qator label="Savdo" value={money(s.sales_total)} />
              <Qator label="Sotilgan mol tan narxi" value={`− ${money(s.cost_total)}`} />
              <View style={st.zanjirChiziq} />
              <Qator
                label="Yalpi foyda" kalin
                value={money(Number(s.sales_total) - Number(s.cost_total))}
                tone={Number(s.sales_total) - Number(s.cost_total) >= 0
                  ? colors.success : colors.danger}
              />
              <Qator label="Chiqim" value={`− ${money(s.expense_total)}`} tone={colors.danger} />
              <View style={st.zanjirChiziq} />
              <Qator label="Sof foyda" value={money(foyda)} kalin
                tone={foyda >= 0 ? colors.success : colors.danger} />

              {/* TOVARGA SARFLANGAN PUL — zanjirdan TASHQARIDA, ataylab.
                  U foydadan ayirilmaydi: mol olish xarajat emas, pulning
                  tovarga aylanishi; foydaga u sotilganda "tan narx"
                  bo'lib qatnashadi (yuqoridagi ikkinchi qator).
                  Lekin pul kassadan chiqqan, shuning uchun ko'rsatiladi. */}
              {tovarga > 0 && (
                <>
                  <View style={st.zanjirChiziq} />
                  <Qator label="Tovarga sarflandi" value={money(tovarga)}
                    tone={colors.primary} />
                  <Text style={[font.tiny, { color: colors.textFaint }]}>
                    Foydadan ayirilmagan — sotilganda tan narx bo'lib hisobga olinadi
                  </Text>
                </>
              )}
            </View>
          ) : (
            <View style={st.grid}>
              <Katak label="Savdo" value={money(s.sales_total)} />
              <Katak label="Chiqim" value={money(s.expense_total)} tone={colors.danger} />
              <Katak label="Sof foyda" value={money(foyda)}
                tone={foyda >= 0 ? colors.success : colors.danger} />
              <Katak label="Savdolar soni" value={String(s.sales_count)} />
            </View>
          )}

          {/*
            QARZ BLOKI. Ilgari kun davomida qancha qarz berilgani faqat
            pastdagi sariq izohda, faqat `credit_profit > 0` bo'lganda va
            faqat savdodan chiqqan qismi ko'rinardi. Qo'lda yozilgan qarz
            (`debt_given`) esa umuman ko'rsatilmasdi — server uni berib
            tursa ham.
          */}
          {(Number(s.credit_total) > 0 || Number(s.debt_given) > 0
            || Number(s.debt_paid) > 0) && (
            <View style={st.zanjir}>
              <Text style={[font.label, { color: colors.textMuted, marginBottom: 2 }]}>
                QARZ HARAKATI
              </Text>
              {Number(s.credit_total) > 0 && (
                <Qator label="Qarzga sotildi" value={money(s.credit_total)}
                  tone={colors.warning} />
              )}
              {Number(s.debt_given) > 0 && (
                <Qator label="Qo'lda qarz berildi" value={money(s.debt_given)}
                  tone={colors.warning} />
              )}
              {Number(s.debt_paid) > 0 && (
                <Qator label="Qarz to'landi" value={`− ${money(s.debt_paid)}`}
                  tone={colors.success} />
              )}
            </View>
          )}

          {/* Foyda savdo bo'lgan kuni yoziladi — puli keyin kelsa ham. Shuning
              uchun uning qancha qismi hali odamlarda turganini aytib qo'yamiz. */}
          {Number(s.credit_profit) > 0 && (
            <View style={st.qarzIzoh}>
              <Text style={[font.tiny, { color: colors.warning, flex: 1 }]}>
                Shu foydaning {money(s.credit_profit)} so'mi hali qo'lga tushmagan
                {' — '}kun davomida {money(s.credit_total)} so'm qarzga berilgan
              </Text>
            </View>
          )}
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
                    {/* Rang usulga emas, PUL tushganiga qarab: yarmi
                        qarzda qolgan savdo yashil ko'rinmasin. */}
                    <Badge text={sale.payment_method}
                      tone={qarz > 0 ? 'warning' : 'success'} />
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
              {/* Qatorlar bosiladi — chiqim tez-tez xato yoziladi (nol
                  ortiqcha, kategoriya adashgan), tuzatish shu yerdan
                  bir bosishda ochilsin. */}
              {data.expenses.map((e) => (
                <PressScale
                  key={e.id}
                  accessibilityRole="button"
                  accessibilityLabel={`${e.category}, ${money(e.amount)} so'm, tahrirlash`}
                  onPress={() => router.push(`/expense/${e.id}`)}
                  scale={0.99}
                  style={st.row}
                >
                  <Text style={[font.tiny, { color: colors.textFaint, width: 44 }]}>
                    {soat(e.created_at)}
                  </Text>
                  <Text style={[font.body, { color: colors.text, flex: 1 }]}>
                    {e.category}{e.note ? ` · ${e.note}` : ''}
                  </Text>
                  <Text style={[font.bodyBold, { color: colors.danger }]}>
                    −{money(e.amount)}
                  </Text>
                </PressScale>
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
                    <Text style={[font.num, {
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

/** Hisob zanjirining bitta qatori. */
function Qator({ label, value, tone, kalin }: {
  label: string; value: string; tone?: string; kalin?: boolean;
}) {
  return (
    <View style={st.zanjirQator}>
      <Text style={[
        kalin ? font.bodyBold : font.small,
        { color: kalin ? colors.text : colors.textMuted, flex: 1 },
      ]}>
        {label}
      </Text>
      <Text style={[font.num, { color: tone ?? colors.text, fontSize: kalin ? 17 : 15 }]}>
        {value}
      </Text>
    </View>
  );
}

function Katak({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <View style={{ width: '47%', gap: 3 }}>
      <Text style={[font.tiny, { color: colors.textMuted }]}>{label}</Text>
      <Text style={[font.num, { color: tone ?? colors.text }]}>{value}</Text>
    </View>
  );
}

const st = StyleSheet.create({
  zanjir: {
    marginTop: spacing.md, paddingTop: spacing.md,
    borderTopWidth: 1, borderTopColor: colors.borderSoft,
    gap: spacing.xs,
  },
  zanjirQator: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  tushumIzoh: { marginTop: spacing.sm, gap: 2 },
  zanjirChiziq: {
    height: 1, backgroundColor: colors.borderSoft, marginVertical: spacing.xs,
  },
  scroll: {
    paddingHorizontal: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxxl,
  },
  grid: {
    flexDirection: 'row', flexWrap: 'wrap',
    gap: spacing.md, rowGap: spacing.lg,
    marginTop: spacing.lg, paddingTop: spacing.md,
    borderTopWidth: 1, borderTopColor: colors.borderSoft,
  },
  qarzIzoh: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    marginTop: spacing.md,
    backgroundColor: colors.warningSoft,
    borderWidth: 1, borderColor: colors.warningLine,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
  },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
});
