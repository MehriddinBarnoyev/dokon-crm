import { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { Image } from 'expo-image';
import { api } from '../../src/api/client';
import * as productStore from '../../src/data/products';
import type { Product } from '../../src/api/types';
import { Badge, Button, Card, Field, IconButton, Stat } from '../../src/components/ui';
import { ScreenHeader } from '../../src/components/ScreenHeader';
import { SkeletonCard, SkeletonList } from '../../src/components/Skeleton';
import { useConfirm } from '../../src/components/Confirm';
import { ShtrixSkaner } from '../../src/components/ShtrixSkaner';
import { useToast } from '../../src/components/Toast';
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
  const toast = useToast();
  const [p, setP] = useState<Detail | null>(null);
  const [adjusting, setAdjusting] = useState(false);
  const [newStock, setNewStock] = useState('');
  const [pricing, setPricing] = useState(false);
  const [newCost, setNewCost] = useState('');
  const [newSale, setNewSale] = useState('');
  const [busy, setBusy] = useState(false);
  const [skanerOchiq, setSkanerOchiq] = useState(false);

  const load = useCallback(async () => {
    setP(await api<Detail>(`/products/${id}`));
  }, [id]);

  useFocusEffect(useCallback(() => { load().catch(() => {}); }, [load]));

  /**
   * Skanerdan kelgan kodni mahsulotga biriktiradi.
   *
   * Server kodni boshqa mahsulot egallab turgan bo'lsa rad etadi — bitta
   * kod ikki xil javob bersa, kassada qaysi biri to'g'ri ekanini bilib
   * bo'lmaydi. Uning xabari ("... mahsulotiga biriktirilgan") shundoq
   * ko'rsatiladi: do'konchi qaysi mahsulot ekanini bilishi kerak.
   */
  async function kodQosh(code: string) {
    setSkanerOchiq(false);
    if (!code) return;

    if (p?.barcodes?.includes(code)) {
      toast.info('Bu kod allaqachon shu mahsulotda');
      return;
    }

    setBusy(true);
    try {
      const res = await api<{ barcodes: string[] }>(`/products/${id}/barcodes`, {
        method: 'POST', body: { code },
      });
      setP((hozir) => (hozir ? { ...hozir, barcodes: res.barcodes } : hozir));
      // Savdo ekrani mahsulotni MAHALLIY keshdan qidiradi — yangi kod
      // o'sha yerga tushmasa, skaner uni topa olmasdi.
      productStore.invalidate();
      toast.ok('Shtrix-kod qo\'shildi');
    } catch (e: any) {
      toast.xato(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function kodOchir(code: string) {
    const ok = await confirm({
      title: 'Shtrix-kodni olib tashlash',
      icon: 'shtrix',
      lines: [code, `${p!.name} endi bu kod bo'yicha topilmaydi`],
      confirmText: 'Olib tashlash',
      destructive: true,
    });
    if (!ok) return;

    setBusy(true);
    try {
      const res = await api<{ barcodes: string[] }>(
        `/products/${id}/barcodes/${encodeURIComponent(code)}`, { method: 'DELETE' });
      setP((hozir) => (hozir ? { ...hozir, barcodes: res.barcodes } : hozir));
      productStore.invalidate();
    } catch (e: any) {
      toast.xato(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function saveAdjust() {
    const v = Number(newStock);
    if (!Number.isFinite(v) || v < 0) {
      toast.ogoh("To'g'ri son kiriting");
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
      // Qoldiq o'zgardi — cache'dagi eski raqam yaroqsiz.
      productStore.invalidate();
      setAdjusting(false);
      setNewStock('');
      await load();
      toast.ok(`Qoldiq ${qty(v)} ${p!.unit} qilib to'g'rilandi`);
    } catch (e: any) {
      toast.xato(e.message);
    } finally {
      setBusy(false);
    }
  }

  function openPrices() {
    setAdjusting(false);
    // Tan narx yo'q bo'lsa maydonni "0" bilan emas, BO'SH ochamiz — do'konchi
    // nolni o'chirib o'tirmasin, darrov o'z raqamini yozsin.
    setNewCost(Number(p!.cost_price) > 0 ? String(Number(p!.cost_price)) : '');
    setNewSale(Number(p!.sale_price) > 0 ? String(Number(p!.sale_price)) : '');
    setPricing(true);
  }

  async function savePrices() {
    const cost = Number(newCost);
    const sale = Number(newSale);
    if (!Number.isFinite(cost) || cost < 0 || !Number.isFinite(sale) || sale < 0) {
      toast.ogoh("To'g'ri narx kiriting");
      return;
    }

    // Faqat haqiqatan o'zgargan narxni yuboramiz.
    const patch: Record<string, number> = {};
    const lines: string[] = [p!.name];
    if (cost !== Number(p!.cost_price)) {
      patch.cost_price = cost;
      lines.push(`Tan narxi: ${money(p!.cost_price)} \u2192 ${money(cost)} so'm`);
    }
    if (sale !== Number(p!.sale_price)) {
      patch.sale_price = sale;
      lines.push(`Sotuv narxi: ${money(p!.sale_price)} \u2192 ${money(sale)} so'm`);
    }
    if (Object.keys(patch).length === 0) {
      toast.info("Narx o'zgartirilmadi");
      return;
    }

    const yangiFoyda = sale - cost;
    // Tan narx o'zgarsa ombordagi qoldiqning pul qiymati ham o'zgaradi.
    const qiymatFarq = patch.cost_price !== undefined
      ? (cost - Number(p!.cost_price)) * Number(p!.stock)
      : 0;

    const ok = await confirm({
      title: "Narxni o'zgartirish",
      icon: 'pul',
      ...(qiymatFarq !== 0 ? {
        amount: Math.abs(qiymatFarq),
        amountLabel: qiymatFarq > 0 ? 'Ombor qiymati oshadi' : 'Ombor qiymati kamayadi',
      } : {}),
      lines,
      warnings: [
        ...(sale <= 0 ? ['Sotuv narxi nol'] : []),
        ...(yangiFoyda < 0 ? ["Sotuv narxi tan narxdan past \u2014 zarar bo'ladi"] : []),
        ...(patch.cost_price !== undefined
          ? ["Yangi tan narx faqat keyingi savdolarga ta'sir qiladi"]
          : []),
      ],
      confirmText: 'Saqlash',
      destructive: yangiFoyda < 0,
    });
    if (!ok) return;

    setBusy(true);
    try {
      await api(`/products/${id}`, { method: 'PATCH', body: patch });
      productStore.invalidate();
      setPricing(false);
      await load();
      toast.ok('Narx yangilandi');
    } catch (e: any) {
      toast.xato(e.message);
    } finally {
      setBusy(false);
    }
  }

  if (!p) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
        <ScreenHeader
          title="Mahsulot"
          left={<IconButton name="orqaga" label="Orqaga" onPress={() => router.back()} tone="soft" size={22} />}
        />
        <View style={{ paddingHorizontal: spacing.lg, gap: spacing.md }}>
          <SkeletonCard lines={3} />
          <SkeletonList rows={4} />
        </View>
      </SafeAreaView>
    );
  }

  const out = Number(p.stock) <= 0;
  const low = !out && Number(p.stock) <= Number(p.min_stock);
  const margin = Number(p.sale_price) - Number(p.cost_price);
  const marginPct = Number(p.cost_price) > 0
    ? Math.round((margin / Number(p.cost_price)) * 100) : 0;

  /**
   * Tan narxsiz mahsulot — hisobotdagi jimgina xato. Foyda sotuv narxidan
   * tan narxni ayirib topiladi; tan narx nol bo'lsa sotilgan summaning
   * HAMMASI foyda bo'lib yoziladi. Xato o'zini ko'rsatmaydi, shuning uchun
   * mahsulot sahifasining eng tepasida aytamiz va bir bosishda tuzatamiz.
   */
  const tanNarxYoq = Number(p.cost_price) <= 0;
  const omborQiymati = Number(p.stock) * Number(p.cost_price);

  // Tahrir paytida kiritilayotgan narxlar bo'yicha foyda — jonli ko'rinadi.
  const kiritCost = Number(newCost) || 0;
  const kiritSale = Number(newSale) || 0;
  const yangiFoyda = kiritSale - kiritCost;
  const yangiFoydaPct = kiritCost > 0 ? Math.round((yangiFoyda / kiritCost) * 100) : null;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScreenHeader
        title={p.name}
        // Kategoriya va birlik sarlavhada — pastdagi kartalarda takrorlanmasin
        subtitle={[p.category, p.unit].filter(Boolean).join(' \u00b7 ') || undefined}
        left={
          <IconButton
            name="orqaga" label="Orqaga" tone="soft" size={22}
            onPress={() => router.back()}
          />
        }
        action={{
          icon: 'tahrir', label: 'Tahrirlash',
          onPress: () => router.push(`/product/edit/${p.id}`),
        }}
      />

      <ScrollView
        contentContainerStyle={s.scroll}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* ---------- Tan narx yo'q: eng tepada, bir bosishda tuzatiladi ---------- */}
        {tanNarxYoq && !pricing && (
          <Card accent={colors.danger} style={{ gap: spacing.sm }}>
            <View style={s.rowGap}>
              <Icon name="ogohlantirish" size={18} color={colors.danger} />
              <Text style={[font.bodyBold, { color: colors.danger, flex: 1 }]}>
                Tan narx kiritilmagan
              </Text>
            </View>
            <Text style={[font.small, { color: colors.textMuted }]}>
              Shu holda mahsulot sotilganda butun summa foyda bo'lib yoziladi va
              hisobot noto'g'ri chiqadi. Ombordagi qiymati ham hisoblanmaydi.
            </Text>
            <Button
              title="Tan narxni kiritish" icon="pul" size="sm"
              onPress={openPrices}
            />
          </Card>
        )}

        {/* ---------- Qoldiq ---------- */}
        <Card style={{ gap: spacing.md }}>
          <View style={s.kartaBosh}>
            <Text style={[font.label, { color: colors.textMuted, flex: 1 }]}>
              OMBORDAGI QOLDIQ
            </Text>
            {!adjusting && (
              <Button
                title="To'g'rilash" icon="tuzatish" variant="soft" size="sm" full={false}
                onPress={() => {
                  setPricing(false);
                  setNewStock(qty(p.stock));
                  setAdjusting(true);
                }}
              />
            )}
          </View>

          {adjusting ? (
            <View style={{ gap: spacing.sm }}>
              <Field
                label="Haqiqiy qoldiq"
                value={newStock}
                onChangeText={(v) => setNewStock(v.replace(',', '.'))}
                keyboardType="decimal-pad"
                placeholder={qty(p.stock)}
                suffix={p.unit}
                autoFocus
                hint={`Hozir ${qty(p.stock)} ${p.unit} deb yozilgan`}
              />
              <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                <Button title="Bekor" variant="secondary" style={{ flex: 1 }}
                  onPress={() => setAdjusting(false)} />
                <Button title="Saqlash" style={{ flex: 1 }} loading={busy}
                  onPress={saveAdjust} />
              </View>
            </View>
          ) : (
            <View style={s.qoldiqQator}>
              {/* Rasm to'liq kenglikda emas, yonda: sahifa cho'zilib ketmasin */}
              {p.photo_url ? (
                <Image source={{ uri: p.photo_url }} style={s.photo}
                  contentFit="cover" transition={200} />
              ) : (
                <View style={[s.photo, s.photoBosh]}>
                  <Icon name="mahsulot" size={26} color={colors.textFaint} />
                </View>
              )}

              <View style={{ flex: 1, gap: 3 }}>
                <View style={s.rowGap}>
                  <Text style={[font.numBig, {
                    color: out ? colors.danger : low ? colors.warning : colors.text,
                  }]}>
                    {qty(p.stock)}{' '}
                    <Text style={[font.h3, { color: colors.textMuted }]}>{p.unit}</Text>
                  </Text>
                  {out ? <Badge text="tugagan" tone="danger" dot />
                    : low ? <Badge text="tugayapti" tone="warning" dot /> : null}
                </View>

                <Text style={[font.small, { color: colors.textMuted }]}>
                  {tanNarxYoq
                    ? 'Qiymati hisoblanmaydi — tan narx yo\u2019q'
                    : `${money(omborQiymati)} so'mlik tovar`}
                </Text>
              </View>
            </View>
          )}
        </Card>

        {/* ---------- Narxlar ---------- */}
        <Card style={{ gap: spacing.md }}>
          <View style={s.kartaBosh}>
            <Text style={[font.label, { color: colors.textMuted, flex: 1 }]}>NARXLAR</Text>
            {!pricing && (
              <Button
                title={tanNarxYoq ? 'Kiritish' : "O'zgartirish"}
                icon="pul" variant="soft" size="sm" full={false}
                onPress={openPrices}
              />
            )}
          </View>

          {pricing ? (
            <View style={{ gap: spacing.sm }}>
              <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                <Field
                  label="Tan narxi"
                  value={newCost}
                  onChangeText={(v) => setNewCost(v.replace(',', '.'))}
                  keyboardType="decimal-pad"
                  placeholder="0"
                  suffix="so'm"
                  style={{ flex: 1 }}
                  autoFocus
                />
                <Field
                  label="Sotuv narxi"
                  value={newSale}
                  onChangeText={(v) => setNewSale(v.replace(',', '.'))}
                  keyboardType="decimal-pad"
                  placeholder="0"
                  suffix="so'm"
                  style={{ flex: 1 }}
                />
              </View>

              {/* Foyda darhol ko'rinadi — do'konchi zararga sotib qo'ymasin */}
              <Text style={[font.small, {
                color: yangiFoyda > 0 ? colors.success
                  : yangiFoyda < 0 ? colors.danger : colors.textMuted,
              }]}>
                Foyda: {money(yangiFoyda)} so'm{yangiFoydaPct !== null ? ` \u00b7 ${yangiFoydaPct}%` : ''}
                {yangiFoyda < 0 ? " \u2014 zarar bo'ladi" : ''}
              </Text>

              <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                <Button title="Bekor" variant="secondary" style={{ flex: 1 }}
                  onPress={() => setPricing(false)} />
                <Button title="Saqlash" style={{ flex: 1 }} loading={busy}
                  onPress={savePrices} />
              </View>
            </View>
          ) : (
            <View style={s.priceGrid}>
              <Stat
                label="Tan narxi"
                value={tanNarxYoq ? '\u2014' : money(p.cost_price)}
                tone={tanNarxYoq ? colors.danger : undefined}
              />
              <Stat label="Sotuv narxi" value={money(p.sale_price)} />
              <Stat
                label={tanNarxYoq ? 'Foyda' : `Foyda \u00b7 ${marginPct}%`}
                value={tanNarxYoq ? '\u2014' : money(margin)}
                tone={tanNarxYoq ? colors.textFaint
                  : margin > 0 ? colors.success : colors.danger}
              />
            </View>
          )}
        </Card>

        {/* ---------- Ma'lumotlar ----------
            Avval bu maydonlar faqat qalam ikonkasi ortida turardi va u yerda
            nima borligi bilinmasdi. Endi ko'rinib turadi — tahrirga o'tish
            kerakmi-yo'qmi, do'konchi qarab hal qiladi. */}
        <Card style={{ gap: spacing.md }}>
          <View style={s.kartaBosh}>
            <Text style={[font.label, { color: colors.textMuted, flex: 1 }]}>
              MA'LUMOTLAR
            </Text>
            <Button
              title="Tahrirlash" icon="tahrir" variant="soft" size="sm" full={false}
              onPress={() => router.push(`/product/edit/${p.id}`)}
            />
          </View>

          <View style={{ gap: spacing.sm }}>
            <Qator label="O'lchov birligi" value={p.unit} />
            <Qator label="Kategoriya" value={p.category} />
            <Qator
              label="Ogohlantirish chegarasi"
              value={Number(p.min_stock) > 0
                ? `${qty(p.min_stock)} ${p.unit} dan kam qolsa`
                : null}
            />
          </View>
        </Card>

        {/* ---------- Shtrix-kodlar ----------
            Bitta mahsulotning bir nechta kodi bo'ladi: ayni "Fanta 1L"
            eski va yangi partiyada boshqa-boshqa kod bilan keladi.
            Ilgari faqat bittasi saqlanardi va qolganini skanerlaganda
            kassada "topilmadi" chiqardi. */}
        <Card style={{ gap: spacing.md }}>
          <View style={s.kartaBosh}>
            <Text style={[font.label, { color: colors.textMuted, flex: 1 }]}>
              SHTRIX-KODLAR
            </Text>
            <Button
              title="Skanerlash" icon="shtrix" variant="soft" size="sm" full={false}
              disabled={busy}
              onPress={() => setSkanerOchiq(true)}
            />
          </View>

          {(p.barcodes ?? []).length === 0 ? (
            <Text style={[font.small, { color: colors.textMuted }]}>
              Kod biriktirilmagan. Skanerlab qo'shsangiz, savdoda mahsulotni
              nomi bilan qidirish shart bo'lmaydi.
            </Text>
          ) : (
            <View style={{ gap: spacing.xs }}>
              {(p.barcodes ?? []).map((code) => (
                <View key={code} style={s.kodQator}>
                  <Icon name="shtrix" size={18} color={colors.textMuted} />
                  <Text style={[font.mono, { color: colors.text, flex: 1 }]}>
                    {code}
                  </Text>
                  <IconButton
                    name="yopish" label={`${code} kodini olib tashlash`}
                    tone="danger" size={18}
                    onPress={() => kodOchir(code)}
                  />
                </View>
              ))}
            </View>
          )}
        </Card>

        {/* ---------- Harakatlar tarixi ---------- */}
        <Card style={{ gap: spacing.md }}>
          <Text style={[font.label, { color: colors.textMuted }]}>HARAKATLAR TARIXI</Text>
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
                  {m.note ? ` \u00b7 ${m.note}` : ''}
                </Text>
                <Text style={[font.tiny, { color: colors.textFaint }]}>
                  {dateLabel(m.created_at)}
                </Text>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={[font.num, {
                  color: m.type === 'kirim' ? colors.success
                    : m.type === 'chiqim' ? colors.danger : colors.warning,
                }]}>
                  {m.type === 'kirim' ? '+' : m.type === 'chiqim' ? '\u2212' : ''}{qty(m.qty)}
                </Text>
                <Text style={[font.tiny, { color: colors.textFaint }]}>
                  → {qty(m.stock_after)}
                </Text>
              </View>
            </View>
          ))}
        </Card>
      </ScrollView>

      <ShtrixSkaner
        visible={skanerOchiq}
        onScan={kodQosh}
        onClose={() => setSkanerOchiq(false)}
        hint={`${p.name} uchun shtrix-kodni ramka ichiga tuting`}
      />
    </SafeAreaView>
  );
}

/** Ma'lumotlar kartasidagi bitta qator. Qiymat yo'q bo'lsa "yo'q" deb turadi. */
function Qator({ label, value, mono }: {
  label: string; value: string | null; mono?: boolean;
}) {
  const bor = Boolean(value && String(value).trim());
  return (
    <View style={s.malumotQator}>
      <Text style={[font.small, { color: colors.textMuted, flex: 1 }]}>{label}</Text>
      <Text style={[
        mono && bor ? font.mono : font.smallBold,
        { color: bor ? colors.text : colors.textFaint },
      ]}>
        {bor ? value : "yo'q"}
      </Text>
    </View>
  );
}

const s = StyleSheet.create({
  scroll: {
    paddingHorizontal: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxxl,
  },
  /** Karta sarlavhasi: chapda nom, o'ngda kichik amal tugmasi. */
  kartaBosh: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  kodQator: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    paddingVertical: spacing.sm, paddingHorizontal: spacing.md,
  },
  rowGap: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  qoldiqQator: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  photo: { width: 64, height: 64, borderRadius: radius.md },
  photoBosh: {
    backgroundColor: colors.surfaceAlt,
    alignItems: 'center', justifyContent: 'center',
  },
  priceGrid: { flexDirection: 'row', gap: spacing.md },
  malumotQator: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  moveRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  moveDot: {
    width: 28, height: 28, borderRadius: 14,
    alignItems: 'center', justifyContent: 'center',
  },
});
