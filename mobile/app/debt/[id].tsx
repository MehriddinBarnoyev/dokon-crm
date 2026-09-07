import { useCallback, useState } from 'react';
import { Linking, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { api } from '../../src/api/client';
import type { DebtEntry } from '../../src/api/types';
import { Badge, Button, Card, Field, IconButton } from '../../src/components/ui';
import { ScreenHeader } from '../../src/components/ScreenHeader';
import { SkeletonCard, SkeletonList } from '../../src/components/Skeleton';
import { AnimatedMoney } from '../../src/components/AnimatedNumber';
import { useConfirm } from '../../src/components/Confirm';
import { useToast } from '../../src/components/Toast';
import {
  colors, dateLabel, font, money, radius, sanaMatni, spacing,
} from '../../src/theme';
import { Icon } from '../../src/components/Icon';

interface Purchase {
  id: string; total: number; paid: number;
  payment_method: string; created_at: string;
  items: Array<{ name: string; qty: number; unit: string; subtotal: number }> | null;
}

interface CustomerDebt {
  customer_id: string; name: string; phone: string | null;
  balance: number; nearest_due: string | null;
  history: DebtEntry[];
  purchases: Purchase[];
  jami: { xaridlar_soni: number; jami_xarid: number; oxirgi_xarid: string | null };
}

export default function DebtDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const confirm = useConfirm();
  const toast = useToast();
  const [d, setD] = useState<CustomerDebt | null>(null);
  const [mode, setMode] = useState<null | 'payment' | 'debt'>(null);
  const [amount, setAmount] = useState('');
  const [due, setDue] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setD(await api<CustomerDebt>(`/debts/customer/${id}`));
  }, [id]);

  useFocusEffect(useCallback(() => { load().catch(() => {}); }, [load]));

  async function submit() {
    const v = Number(amount);
    if (!Number.isFinite(v) || v <= 0) {
      toast.ogoh("Summani to'g'ri kiriting");
      return;
    }
    const tolov = mode === 'payment';
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
        ...(!tolov && due.trim() ? [`To'lash muddati: ${due.trim()}`] : []),
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
          body: { customer_id: id, customer_name: d!.name, amount: v, note: null },
        });
      } else {
        await api('/debts', {
          method: 'POST',
          body: {
            customer_id: id, customer_name: d!.name, customer_phone: null,
            amount: v, due_date: due.trim() || null, note: null,
          },
        });
      }
      setMode(null); setAmount(''); setDue('');
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
                placeholder="2026-09-15"
                hint="Ixtiyoriy, YYYY-MM-DD ko'rinishida"
              />
            )}
            <View style={{ flexDirection: 'row', gap: spacing.sm }}>
              <Button title="Bekor" variant="secondary" style={{ flex: 1 }}
                onPress={() => setMode(null)} />
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

        {/* Xaridlar — naqd sotib olganlari ham shu yerda */}
        {d.purchases && d.purchases.length > 0 && (
          <>
            <View style={s.bolim}>
              <Text style={[font.h3, { color: colors.text, flex: 1 }]}>Xaridlari</Text>
              <Badge
                text={`${d.jami.xaridlar_soni} ta · ${money(d.jami.jami_xarid)}`}
                tone="primary"
              />
            </View>
            <Card style={{ gap: spacing.md }}>
              {d.purchases.slice(0, 20).map((p) => (
                <View key={p.id} style={{ gap: 2 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                    <Text style={[font.num, { color: colors.text, flex: 1 }]}>
                      {money(p.total)} so'm
                    </Text>
                    <Badge text={p.payment_method}
                      tone={p.payment_method === 'qarz' ? 'warning' : 'success'} />
                  </View>
                  <Text style={[font.small, { color: colors.textMuted }]}>
                    {(p.items ?? [])
                      .map((i) => `${i.qty} ${i.unit} ${i.name}`)
                      .join(', ') || '—'}
                  </Text>
                  <Text style={[font.tiny, { color: colors.textFaint }]}>
                    {dateLabel(p.created_at)}
                  </Text>
                </View>
              ))}
            </Card>
          </>
        )}

        <Text style={[font.h3, { color: colors.text, marginTop: spacing.md }]}>
          Qarz tarixi
        </Text>
        <Card style={{ gap: spacing.md }}>
          {d.history.length === 0 ? (
            <Text style={[font.small, { color: colors.textMuted }]}>Hali yozuv yo'q</Text>
          ) : d.history.map((h) => {
            const isPayment = Number(h.amount) < 0;
            return (
              <View key={h.id} style={s.row}>
                <View style={[s.dot, {
                  backgroundColor: isPayment ? colors.successSoft : colors.dangerSoft,
                }]}>
                  <Icon name={isPayment ? 'kirim' : 'chiqim'} size={13}
                    color={isPayment ? colors.success : colors.danger} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[font.small, { color: colors.text }]}>
                    {isPayment ? "To'lov" : 'Qarz berildi'}
                    {h.note ? ` · ${h.note}` : ''}
                  </Text>
                  <Text style={[font.tiny, { color: colors.textFaint }]}>
                    {dateLabel(h.created_at)}
                    {h.due_date ? ` · muddat ${sanaMatni(h.due_date)}` : ''}
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
  dot: {
    width: 28, height: 28, borderRadius: 14,
    alignItems: 'center', justifyContent: 'center',
  },
});
