import { useCallback, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { Image } from 'expo-image';
import { api } from '../../src/api/client';
import type { Product, Unit } from '../../src/api/types';
import { Badge, Button, Card, Field, Loading } from '../../src/components/ui';
import { useConfirm } from '../../src/components/Confirm';
import { colors, dateLabel, font, money, qty, radius, spacing } from '../../src/theme';
import { Icon } from '../../src/components/Icon';

interface Move {
  type: 'kirim' | 'chiqim' | 'tuzatish';
  qty: number; stock_after: number;
  ref_type: string | null; note: string | null; created_at: string;
}
type Detail = Product & { moves: Move[]; min_stock: number };

export default function ProductDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const confirm = useConfirm();
  const [p, setP] = useState<Detail | null>(null);
  const [adjusting, setAdjusting] = useState(false);
  const [newStock, setNewStock] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setP(await api<Detail>(`/products/${id}`));
  }, [id]);

  useFocusEffect(useCallback(() => { load().catch(() => {}); }, [load]));

  async function saveAdjust() {
    const v = Number(newStock);
    if (!Number.isFinite(v) || v < 0) {
      Alert.alert('Xato', 'To\'g\'ri son kiriting.');
      return;
    }
    const farq = v - Number(p!.stock);
    const ok = await confirm({
      title: "Qoldiqni to'g'rilash",
      icon: 'tuzatish',
      // Qoldiq o'zgarishi — ombordagi pul qiymatiga ta'sir qiladi
      amount: Math.abs(farq) * Number(p!.cost_price),
      amountLabel: farq >= 0 ? "Ombor qiymati oshadi" : 'Ombor qiymati kamayadi',
      lines: [
        `${p!.name}`,
        `${qty(p!.stock)} → ${qty(v)} ${p!.unit}`
        + ` (${farq >= 0 ? '+' : ''}${qty(farq)})`,
        'Bu amal ombor jurnaliga "tuzatish" deb yoziladi',
      ],
      confirmText: "To'g'rilash",
      destructive: farq < 0,
    });
    if (!ok) return;

    setBusy(true);
    try {
      await api(`/products/${id}/adjust`, {
        method: 'POST', body: { new_stock: v, note: 'Inventarizatsiya' },
      });
      setAdjusting(false);
      setNewStock('');
      await load();
    } catch (e: any) {
      Alert.alert('Xato', e.message);
    } finally {
      setBusy(false);
    }
  }

  if (!p) return <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}><Loading /></SafeAreaView>;

  const out = Number(p.stock) <= 0;
  const low = !out && Number(p.stock) <= Number(p.min_stock);
  const margin = Number(p.sale_price) - Number(p.cost_price);
  const marginPct = Number(p.cost_price) > 0
    ? Math.round((margin / Number(p.cost_price)) * 100) : 0;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
      <View style={s.head}>
        <Pressable onPress={() => router.back()} hitSlop={10}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Icon name="orqaga" size={20} color={colors.primary} />
            <Text style={[font.body, { color: colors.primary }]}>Orqaga</Text>
          </View>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={s.scroll}>
        {p.photo_url ? (
          <Image source={{ uri: p.photo_url }} style={s.photo} contentFit="cover" />
        ) : null}

        <View style={{ gap: spacing.xs }}>
          <Text style={[font.h1, { color: colors.text }]}>{p.name}</Text>
          {p.category ? (
            <Text style={[font.small, { color: colors.textMuted }]}>{p.category}</Text>
          ) : null}
        </View>

        <Card>
          <View style={s.rowBetween}>
            <View>
              <Text style={[font.small, { color: colors.textMuted }]}>Ombordagi qoldiq</Text>
              <Text style={[font.h1, {
                color: out ? colors.danger : low ? colors.warning : colors.text,
              }]}>
                {qty(p.stock)} <Text style={font.h3}>{p.unit}</Text>
              </Text>
            </View>
            {out ? <Badge text="tugagan" tone="danger" />
              : low ? <Badge text="tugayapti" tone="warning" /> : null}
          </View>

          {adjusting ? (
            <View style={{ gap: spacing.sm, marginTop: spacing.md }}>
              <Field
                label="Haqiqiy qoldiq"
                value={newStock}
                onChangeText={(v) => setNewStock(v.replace(',', '.'))}
                keyboardType="decimal-pad"
                placeholder={qty(p.stock)}
                autoFocus
              />
              <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                <Button title="Bekor" variant="secondary" style={{ flex: 1 }}
                  onPress={() => setAdjusting(false)} />
                <Button title="Saqlash" style={{ flex: 1 }} loading={busy}
                  onPress={saveAdjust} />
              </View>
            </View>
          ) : (
            <Button title="Qoldiqni to'g'rilash" variant="secondary"
              style={{ marginTop: spacing.md }}
              onPress={() => { setNewStock(qty(p.stock)); setAdjusting(true); }} />
          )}
        </Card>

        <Card>
          <View style={s.priceGrid}>
            <View style={{ flex: 1 }}>
              <Text style={[font.tiny, { color: colors.textMuted }]}>Tan narxi</Text>
              <Text style={[font.h3, { color: colors.text }]}>{money(p.cost_price)}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[font.tiny, { color: colors.textMuted }]}>Sotuv narxi</Text>
              <Text style={[font.h3, { color: colors.text }]}>{money(p.sale_price)}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[font.tiny, { color: colors.textMuted }]}>Foyda</Text>
              <Text style={[font.h3, {
                color: margin > 0 ? colors.success : colors.danger,
              }]}>
                {money(margin)}
              </Text>
              <Text style={[font.tiny, { color: colors.textFaint }]}>{marginPct}%</Text>
            </View>
          </View>

          <Text style={[font.tiny, { color: colors.textFaint, marginTop: spacing.md }]}>
            Ombordagi qiymati: {money(Number(p.stock) * Number(p.cost_price))} so'm
          </Text>
        </Card>

        <Text style={[font.h3, { color: colors.text, marginTop: spacing.md }]}>
          Harakatlar tarixi
        </Text>
        <Card style={{ gap: spacing.md }}>
          {p.moves.length === 0 ? (
            <Text style={[font.small, { color: colors.textMuted }]}>Hali harakat yo'q</Text>
          ) : p.moves.map((m, i) => (
            <View key={i} style={s.moveRow}>
              <View style={[s.moveDot, {
                backgroundColor: m.type === 'kirim' ? colors.successSoft
                  : m.type === 'chiqim' ? colors.dangerSoft : colors.warningSoft,
              }]}>
                <Icon
                  name={m.type === 'kirim' ? 'kirim'
                    : m.type === 'chiqim' ? 'chiqim' : 'tuzatish'}
                  size={13}
                  color={m.type === 'kirim' ? colors.success
                    : m.type === 'chiqim' ? colors.danger : colors.warning}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[font.small, { color: colors.text }]}>
                  {m.type === 'kirim' ? 'Kirim' : m.type === 'chiqim' ? 'Chiqim' : 'Tuzatish'}
                  {m.note ? ` · ${m.note}` : ''}
                </Text>
                <Text style={[font.tiny, { color: colors.textFaint }]}>
                  {dateLabel(m.created_at)}
                </Text>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={[font.bodyBold, {
                  color: m.type === 'kirim' ? colors.success
                    : m.type === 'chiqim' ? colors.danger : colors.warning,
                }]}>
                  {m.type === 'kirim' ? '+' : m.type === 'chiqim' ? '−' : ''}{qty(m.qty)}
                </Text>
                <Text style={[font.tiny, { color: colors.textFaint }]}>
                  → {qty(m.stock_after)}
                </Text>
              </View>
            </View>
          ))}
        </Card>
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  head: { padding: spacing.lg, paddingBottom: spacing.sm },
  scroll: { padding: spacing.lg, paddingTop: 0, gap: spacing.md, paddingBottom: spacing.xxl },
  photo: { width: '100%', height: 190, borderRadius: radius.lg },
  rowBetween: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
  },
  priceGrid: { flexDirection: 'row', gap: spacing.md },
  moveRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  moveDot: {
    width: 28, height: 28, borderRadius: 14,
    alignItems: 'center', justifyContent: 'center',
  },
});
