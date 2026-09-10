import { useCallback, useEffect, useRef, useState } from 'react';
import { Linking, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { api } from '../../src/api/client';
import { sanaOqi } from '../../src/lib/sana';
import type { CustomerDebt, DebtEntry, Sahifa, Xarid } from '../../src/api/types';
import { Badge, Button, Card, Field, IconButton } from '../../src/components/ui';
import { ScreenHeader } from '../../src/components/ScreenHeader';
import { SkeletonCard, SkeletonList } from '../../src/components/Skeleton';
import { AnimatedMoney } from '../../src/components/AnimatedNumber';
import { PressScale } from '../../src/components/Press';
import { useConfirm } from '../../src/components/Confirm';
import { useToast } from '../../src/components/Toast';
import {
  colors, dateLabel, font, money, qty, radius, sanaMatni, spacing,
} from '../../src/theme';
import { Icon } from '../../src/components/Icon';

/**
 * Ro'yxat bo'lakma-bo'lak tortiladi. Bir joyda uchta narsani birga
 * yuritish kerak: qatorlar, keyingi sahifa kursori va "hozir yuklanyapti"
 * holati — shuning uchun ular bitta obyekt.
 */
interface Royxat<T> {
  items: T[];
  /** `null` — ro'yxat tugagan, "Yana" ko'rsatilmaydi. */
  next: string | null;
  yuklanmoqda: boolean;
}

const BOSH: Royxat<any> = { items: [], next: null, yuklanmoqda: false };

/**
 * Javobdan ro'yxat yasaydi.
 *
 * 1.9.0 gacha server sahifa emas, oddiy massiv qaytarardi. Do'kondagi
 * telefon serverdan oldin yangilanishi mumkin — o'shanda `.items` bo'lmasdi
 * va ekran ochilmay qolardi. Shuning uchun ikkala shakl ham tushuniladi:
 * massiv kelsa, u tugagan yagona sahifa deb qabul qilinadi.
 */
function royxat<T>(x: Sahifa<T> | T[] | null | undefined): Royxat<T> {
  if (Array.isArray(x)) return { items: x, next: null, yuklanmoqda: false };
  return { items: x?.items ?? [], next: x?.next ?? null, yuklanmoqda: false };
}

/**
 * Tarixda ko'rsatiladigan izoh.
 *
 * Izohsiz to'lovga server "Qarz to'lovi" deb yozib qo'yadi — bu qatordagi
 * sarlavhaning aynan o'zi. Takror ko'rsatishning ma'nosi yo'q.
 */
function izohMatni(h: DebtEntry): string | null {
  const t = h.note?.trim();
  if (!t || t === "Qarz to'lovi") return null;
  return t;
}

export default function DebtDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const confirm = useConfirm();
  const toast = useToast();

  const [d, setD] = useState<CustomerDebt | null>(null);
  const [tarix, setTarix] = useState<Royxat<DebtEntry>>(BOSH);

  /**
   * Xaridlar bo'limi YOPIQ holda ochiladi va faqat bosilganda tortiladi.
   *
   * Sabab: bu sahifaga kelishning asosiy maqsadi — "qancha qarzi bor" va
   * "to'lov yozish". Mahsulotlar ro'yxati esa javobning eng og'ir qismi
   * edi (har savdo o'z qatorlari bilan). Endi u kerak bo'lgandagina, o'nta
   * xariddan boshlab keladi.
   */
  const [xaridOchiq, setXaridOchiq] = useState(false);
  const [xaridlar, setXaridlar] = useState<Royxat<Xarid>>(BOSH);

  const [mode, setMode] = useState<null | 'payment' | 'debt'>(null);
  const [amount, setAmount] = useState('');
  const [due, setDue] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  /**
   * Ekranning birinchi va yagona majburiy so'rovi: balans, xaridlar
   * yig'indisi va tarixning birinchi sahifasi.
   */
  const load = useCallback(async () => {
    const yangi = await api<CustomerDebt>(`/debts/customer/${id}`);
    setD(yangi);
    setTarix(royxat(yangi.history));
    // Eski server xaridlarni shu javobga qo'shib yuborgan bo'lsa —
    // alohida so'rov kerak emas, borini ishlatamiz.
    if (Array.isArray(yangi.purchases)) setXaridlar(royxat(yangi.purchases));
  }, [id]);

  useFocusEffect(useCallback(() => { load().catch(() => {}); }, [load]));

  // Boshqa mijozga o'tilsa xaridlar bo'limi qaytadan yopiladi — aks holda
  // oldingi mijozning ro'yxati bir lahza ko'rinib qolardi.
  useEffect(() => { setXaridOchiq(false); setXaridlar(BOSH); }, [id]);

  /**
   * Ikki marta bosilganda ikkita bir xil so'rov ketmasin. `yuklanmoqda`
   * holatining o'zi yetmaydi: `setState` keyingi render'da kuchga kiradi,
   * tez bosishda esa ikkala chaqiruv ham eski qiymatni ko'radi.
   */
  const ketyapti = useRef<Set<string>>(new Set());

  const yana = useCallback(async (
    nima: 'tarix' | 'xarid',
    kursor: string | null,
  ) => {
    const yol = nima === 'tarix'
      ? `/debts/customer/${id}/history`
      : `/debts/customer/${id}/purchases`;
    const belgi = `${nima}:${kursor ?? 'bosh'}`;
    if (ketyapti.current.has(belgi)) return;
    ketyapti.current.add(belgi);

    const qoy = nima === 'tarix' ? setTarix : setXaridlar;
    qoy((r: Royxat<any>) => ({ ...r, yuklanmoqda: true }));
    try {
      const s = await api<Sahifa<any>>(kursor ? `${yol}?before=${encodeURIComponent(kursor)}` : yol);
      qoy((r: Royxat<any>) => ({
        // Kursorsiz chaqiruv — bo'lim birinchi ochilishi: ro'yxat
        // almashtiriladi, qo'shilmaydi.
        items: kursor ? [...r.items, ...s.items] : s.items,
        next: s.next,
        yuklanmoqda: false,
      }));
    } catch (e: any) {
      qoy((r: Royxat<any>) => ({ ...r, yuklanmoqda: false }));
      toast.xato(e.message);
    } finally {
      ketyapti.current.delete(belgi);
    }
  }, [id, toast]);

  function xaridBolimi() {
    if (xaridOchiq) { setXaridOchiq(false); return; }
    setXaridOchiq(true);
    if (xaridlar.items.length === 0) yana('xarid', null);
  }

  async function submit() {
    const v = Number(amount);
    if (!Number.isFinite(v) || v <= 0) {
      toast.ogoh("Summani to'g'ri kiriting");
      return;
    }
    const tolov = mode === 'payment';

    // Muddat ixtiyoriy, lekin yozilgan bo'lsa tushunarli bo'lishi shart —
    // aks holda jimgina "muddatsiz" bo'lib ketardi.
    const muddat = due.trim() ? sanaOqi(due) : null;
    if (!tolov && due.trim() && !muddat) {
      toast.ogoh("Muddatni tushunmadim. Masalan: 15.09 yoki 1509");
      return;
    }

    const izoh = note.trim() || null;
    const yangiBalans = Number(d!.balance) + (tolov ? -v : v);

    const ok = await confirm({
      title: tolov ? "Qarz to'lovini qabul qilish" : 'Qarz berish',
      icon: tolov ? 'pul' : 'qarz',
      amount: v,
      amountLabel: tolov ? "To'lov summasi" : 'Qarz summasi',
      lines: [
        `Mijoz: ${d!.name}`,
        `Hozirgi qarzi: ${money(d!.balance)} so'm`,
        `Amaldan keyin: ${money(yangiBalans)} so'm`,
        ...(!tolov && muddat ? [`To'lash muddati: ${sanaMatni(muddat)}`] : []),
        ...(izoh ? [`Izoh: ${izoh}`] : []),
      ],
      warnings: tolov && v > Number(d!.balance)
        ? [`To'lov qarzdan ${money(v - Number(d!.balance))} so'm ko'p —`
           + ' balans oldindan to\'lovga o\'tadi']
        : [],
      confirmText: 'Saqlash',
    });
    if (!ok) return;

    setBusy(true);
    try {
      if (mode === 'payment') {
        await api('/debts/payment', {
          method: 'POST',
          body: { customer_id: id, customer_name: d!.name, amount: v, note: izoh },
        });
      } else {
        await api('/debts', {
          method: 'POST',
          body: {
            customer_id: id, customer_name: d!.name, customer_phone: null,
            amount: v, due_date: muddat, created_at: null, note: izoh,
          },
        });
      }
      setMode(null); setAmount(''); setDue(''); setNote('');
      // Faqat yengil so'rov qaytadan ketadi. Qarz yozuvi savdo yaratmaydi,
      // shuning uchun ochilgan xaridlar ro'yxatiga tegilmaydi.
      await load();
      toast.ok(tolov
        ? `${money(v)} so'm to'lov qabul qilindi`
        : `${d!.name}ga ${money(v)} so'm qarz yozildi`);
    } catch (e: any) {
      toast.xato(e.message);
    } finally {
      setBusy(false);
    }
  }

  if (!d) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
        <ScreenHeader
          title="Mijoz"
          left={<IconButton name="orqaga" label="Orqaga" onPress={() => router.back()} tone="soft" size={22} />}
        />
        <View style={{ paddingHorizontal: spacing.lg, gap: spacing.md }}>
          <SkeletonCard lines={2} />
          <SkeletonList rows={4} />
        </View>
      </SafeAreaView>
    );
  }

  const overdue = d.nearest_due && new Date(d.nearest_due) < new Date() && Number(d.balance) > 0;
  // `jami` yo'q bo'lsa (juda eski server) tortilgan xaridlar soniga tayanamiz.
  const xaridSoni = Number(d.jami?.xaridlar_soni ?? xaridlar.items.length);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScreenHeader
        title={d.name}
        subtitle={d.phone ?? undefined}
        left={
          <IconButton
            name="orqaga" label="Orqaga" tone="soft" size={22}
            onPress={() => router.back()}
          />
        }
        action={d.phone ? {
          icon: 'telefon', label: `${d.name} ga qo'ng'iroq qilish`,
          onPress: () => Linking.openURL(`tel:${d.phone}`),
        } : undefined}
      />

      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>
        <Card tone="raised" style={{ alignItems: 'center', gap: spacing.xs }}>
          <View style={s.avatar}>
            <Text style={[font.h1, { color: colors.primary }]}>
              {d.name.charAt(0).toUpperCase()}
            </Text>
          </View>
          <Text style={[font.label, { color: colors.textMuted, marginTop: spacing.sm }]}>
            JORIY QARZ
          </Text>
          <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 6 }}>
            <AnimatedMoney
              value={Number(d.balance)}
              style={[font.display, {
                color: Number(d.balance) > 0 ? colors.danger : colors.success,
              }]}
            />
            <Text style={[font.h3, { color: colors.textMuted, paddingBottom: 4 }]}>so'm</Text>
          </View>
          {d.nearest_due ? (
            <Badge
              dot
              text={`Muddat: ${sanaMatni(d.nearest_due)}`}
              tone={overdue ? 'danger' : 'neutral'}
            />
          ) : null}
        </Card>

        {mode ? (
          <Card style={{ gap: spacing.md }}>
            <Text style={[font.h3, { color: colors.text }]}>
              {mode === 'payment' ? "Qarz to'lovi" : 'Yangi qarz'}
            </Text>
            <Field
              label="Summa"
              value={amount}
              onChangeText={setAmount}
              keyboardType="number-pad"
              placeholder="50000"
              autoFocus
            />
            {mode === 'debt' && (
              <Field
                label="To'lash muddati"
                value={due}
                onChangeText={setDue}
                placeholder="15.09"
                keyboardType="numeric"
                hint="Ixtiyoriy — kun.oy, masalan 15.09 yoki 1509"
              />
            )}
            {/* Izoh HAR IKKALA amalda ham bor. To'lovda ayniqsa muhim:
                "kim keltirdi", "yarmini berdi", "kartaga o'tkazdi" — bularsiz
                bir necha oydan keyin tarixdagi raqamning nima ekani
                bilinmay qoladi. */}
            <Field
              label="Izoh"
              value={note}
              onChangeText={setNote}
              placeholder={mode === 'payment' ? "masalan: kartaga o'tkazdi" : 'masalan: naqd qarz'}
              hint="Ixtiyoriy — qarz tarixida ko'rinadi"
            />
            <View style={{ flexDirection: 'row', gap: spacing.sm }}>
              <Button title="Bekor" variant="secondary" style={{ flex: 1 }}
                onPress={() => { setMode(null); setNote(''); setDue(''); }} />
              <Button title="Saqlash" style={{ flex: 1 }} loading={busy} onPress={submit} />
            </View>
          </Card>
        ) : (
          <View style={{ flexDirection: 'row', gap: spacing.sm }}>
            <Button title="To'lov oldim" icon="pul" style={{ flex: 1 }}
              onPress={() => setMode('payment')} />
            <Button title="Qarz berish" icon="qarz" variant="secondary" style={{ flex: 1 }}
              onPress={() => setMode('debt')} />
          </View>
        )}

        {/* -------------------------- Xaridlari -------------------------- */}
        {xaridSoni > 0 && (
          <>
            <PressScale
              accessibilityRole="button"
              accessibilityState={{ expanded: xaridOchiq }}
              accessibilityLabel={
                `Xaridlari, ${xaridSoni} ta, jami ${money(d.jami?.jami_xarid)} so'm`
              }
              onPress={xaridBolimi}
              scale={0.99}
              style={s.bolim}
            >
              <Text style={[font.h3, { color: colors.text, flex: 1 }]}>Xaridlari</Text>
              <Badge
                text={`${xaridSoni} ta · ${money(d.jami?.jami_xarid)}`}
                tone="primary"
              />
              <Icon name={xaridOchiq ? 'yuqoriga' : 'pastga'} size={18} color={colors.textFaint} />
            </PressScale>

            {xaridOchiq && (
              xaridlar.items.length === 0 && xaridlar.yuklanmoqda
                ? <SkeletonList rows={3} />
                : (
                  <View style={{ gap: spacing.sm }}>
                    {xaridlar.items.map((p) => (
                      <Card key={p.id} style={{ gap: spacing.sm }}>
                        <View style={s.xaridBosh}>
                          <Text style={[font.num, { color: colors.text, flex: 1 }]}>
                            {money(p.total)} so'm
                          </Text>
                          {/* Rang usulga emas, PUL tushganiga qarab —
                              aralash to'lovda yarmi qarzda qolishi mumkin. */}
                          <Badge
                            text={p.payment_method}
                            tone={Number(p.paid) < Number(p.total) ? 'warning' : 'success'}
                          />
                        </View>

                        {/* Mahsulotlar: nima, qancha, qaysi narxda.
                            Ilgari bu yerda faqat "2 dona non, 1 litr sut"
                            degan bitta qator bo'lardi — narx ko'rinmagani
                            uchun "menga qimmatga sotding" degan bahsni
                            hech narsa bilan yopib bo'lmasdi. */}
                        {(p.items ?? []).map((it, i) => {
                          // Eski server `unit_price` yubormaydi — bunday
                          // holatda uni summadan qayta hisoblaymiz, aks
                          // holda qatorda "× 0" turib qolardi.
                          const narx = Number(
                            it.unit_price ?? (Number(it.qty) ? Number(it.subtotal) / Number(it.qty) : 0),
                          );
                          return (
                          <View key={`${p.id}-${i}`} style={s.qator}>
                            <Text
                              style={[font.small, { color: colors.text, flex: 1 }]}
                              numberOfLines={1}
                            >
                              {it.name}
                            </Text>
                            <Text style={[font.tiny, { color: colors.textMuted }]}>
                              {qty(it.qty)} {it.unit} × {money(narx)}
                            </Text>
                            <Text style={[font.numSmall, { color: colors.text }]}>
                              {money(it.subtotal)}
                            </Text>
                          </View>
                          );
                        })}
                        {(p.items ?? []).length === 0 ? (
                          <Text style={[font.small, { color: colors.textFaint }]}>
                            Mahsulotlar yozilmagan
                          </Text>
                        ) : null}

                        <Text style={[font.tiny, { color: colors.textFaint }]}>
                          {dateLabel(p.created_at)}
                          {Number(p.paid) < Number(p.total)
                            ? ` · ${money(Number(p.total) - Number(p.paid))} so'm qarzga qoldi`
                            : ''}
                        </Text>
                      </Card>
                    ))}

                    {xaridlar.next ? (
                      <Button
                        title="Oldingi xaridlar"
                        variant="ghost"
                        size="sm"
                        iconRight="pastga"
                        loading={xaridlar.yuklanmoqda}
                        onPress={() => yana('xarid', xaridlar.next)}
                      />
                    ) : null}
                  </View>
                )
            )}
          </>
        )}

        {/* ------------------------- Qarz tarixi ------------------------- */}
        <Text style={[font.h3, { color: colors.text, marginTop: spacing.md }]}>
          Qarz tarixi
        </Text>
        <Card style={{ gap: spacing.md }}>
          {tarix.items.length === 0 ? (
            <Text style={[font.small, { color: colors.textMuted }]}>Hali yozuv yo'q</Text>
          ) : tarix.items.map((h) => {
            const isPayment = Number(h.amount) < 0;
            return (
              <View key={h.id} style={s.row}>
                <View style={[s.dot, {
                  backgroundColor: isPayment ? colors.successSoft : colors.dangerSoft,
                }]}>
                  <Icon name={isPayment ? 'kirim' : 'chiqim'} size={13}
                    color={isPayment ? colors.success : colors.danger} />
                </View>
                <View style={{ flex: 1, gap: 1 }}>
                  <Text style={[font.small, { color: colors.text }]}>
                    {isPayment ? "To'lov" : h.sale_id ? 'Savdodan qarz' : 'Qarz berildi'}
                  </Text>
                  {izohMatni(h) ? (
                    <Text style={[font.small, { color: colors.textMuted }]}>{izohMatni(h)}</Text>
                  ) : null}
                  <Text style={[font.tiny, { color: colors.textFaint }]}>
                    {[
                      dateLabel(h.created_at),
                      h.due_date ? `muddat ${sanaMatni(h.due_date)}` : null,
                      h.user_name,
                    ].filter(Boolean).join(' · ')}
                  </Text>
                </View>
                <Text style={[font.num, {
                  color: isPayment ? colors.success : colors.danger,
                }]}>
                  {isPayment ? '−' : '+'}{money(Math.abs(Number(h.amount)))}
                </Text>
              </View>
            );
          })}

          {tarix.next ? (
            <Button
              title="Oldingi yozuvlar"
              variant="ghost"
              size="sm"
              iconRight="pastga"
              loading={tarix.yuklanmoqda}
              onPress={() => yana('tarix', tarix.next)}
            />
          ) : null}
        </Card>
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  scroll: {
    paddingHorizontal: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxxl,
  },
  avatar: {
    width: 64, height: 64, borderRadius: radius.pill,
    backgroundColor: colors.primarySoft,
    alignItems: 'center', justifyContent: 'center',
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  bolim: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    marginTop: spacing.md,
  },
  xaridBosh: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  qator: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    paddingLeft: spacing.sm,
    borderLeftWidth: 2, borderLeftColor: colors.borderSoft,
  },
  dot: {
    width: 28, height: 28, borderRadius: 14,
    alignItems: 'center', justifyContent: 'center',
  },
});
