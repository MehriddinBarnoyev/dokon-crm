import { useEffect, useMemo, useState } from 'react';
import {
  Alert, FlatList, KeyboardAvoidingView, Platform, Pressable,
  StyleSheet, Text, TextInput, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { api } from '../../src/api/client';
import type { PaymentMethod, Product } from '../../src/api/types';
import { Button, Empty } from '../../src/components/ui';
import { useConfirm } from '../../src/components/Confirm';
import { CustomerPicker, type PickedCustomer } from '../../src/components/CustomerPicker';
import { search as fuzzySearch } from '../../src/lib/search';
import { colors, font, money, qty as fq, radius, shadow, spacing } from '../../src/theme';
import { Icon } from '../../src/components/Icon';

interface CartLine {
  product: Product;
  qty: string;      // matn sifatida — "1.5" yozishga imkon beradi
  price: string;
}

/**
 * SAVAT QATORI — ixcham va kassir uchun tez.
 *
 * Avval har qator ~200px joy egallardi (ikkita katta maydon + sarlavhalar),
 * to'rtta mahsulot ekranni to'ldirib qo'yardi. Endi ~84px:
 *
 *   Piyoz                                   25 000  ✕
 *   [−] 5 [+] kg  ×  [ 5 000 ] so'm
 *
 * Miqdorni ko'pincha bittalab o'zgartiriladi — shuning uchun [−] [+]
 * tugmalari bor, klaviatura ochish shart emas. Aniq son (5.5 kg) kerak
 * bo'lsa raqamning ustiga bosib yozilaveradi.
 */
function CartRow({ line, onQty, onPrice, onRemove }: {
  line: CartLine;
  onQty(v: string): void;
  onPrice(v: string): void;
  onRemove(): void;
}) {
  const q = Number(line.qty) || 0;
  const narx = Number(line.price) || 0;
  const yetmaydi = q > Number(line.product.stock);

  // Kasr qoldig'i saqlanadi: 5.5 − 1 → 4.5. toFixed suzuvchi nuqta
  // xatolarini kesadi (0.30000000000000004 kabi).
  const qadam = (d: number) => onQty(String(Number((q + d).toFixed(3))));

  return (
    <View style={s.line}>
      <View style={s.lineTop}>
        <Text style={[font.bodyBold, { color: colors.text, flex: 1 }]} numberOfLines={1}>
          {line.product.name}
        </Text>
        <Text style={[font.bodyBold, { color: colors.text }]}>
          {money(q * narx)}
        </Text>
        <Pressable onPress={onRemove} hitSlop={12}>
          <Icon name="yopish" size={17} color={colors.textFaint} />
        </Pressable>
      </View>

      <View style={s.lineBottom}>
        <View style={s.stepper}>
          <Pressable
            onPress={() => qadam(-1)}
            disabled={q <= 1}
            style={({ pressed }) => [s.stepBtn, (q <= 1) && { opacity: 0.3 },
              pressed && { backgroundColor: colors.border }]}
          >
            <Text style={s.stepTxt}>−</Text>
          </Pressable>

          <TextInput
            value={line.qty}
            onChangeText={(v) => onQty(v.replace(',', '.'))}
            keyboardType="decimal-pad"
            selectTextOnFocus
            style={s.qtyInput}
          />

          <Pressable
            onPress={() => qadam(1)}
            style={({ pressed }) => [s.stepBtn, pressed && { backgroundColor: colors.border }]}
          >
            <Text style={s.stepTxt}>+</Text>
          </Pressable>
        </View>

        <Text style={[font.small, { color: colors.textMuted }]}>
          {line.product.unit}
        </Text>

        <Text style={[font.small, { color: colors.textFaint }]}>×</Text>
        <TextInput
          value={line.price}
          onChangeText={onPrice}
          keyboardType="number-pad"
          selectTextOnFocus
          style={s.priceInput}
        />
        <Text style={[font.tiny, { color: colors.textFaint }]}>so'm</Text>

        {yetmaydi && (
          <Text style={[font.tiny, { color: colors.danger, flex: 1 }]} numberOfLines={1}>
            omborda {fq(line.product.stock)}
          </Text>
        )}
      </View>
    </View>
  );
}

export default function NewSaleScreen() {
  const router = useRouter();
  const confirm = useConfirm();
  const [products, setProducts] = useState<Product[]>([]);
  const [search, setSearch] = useState('');
  /** Serverdan kelgan qo'shimcha natijalar (300 tadan tashqaridagilar). */
  const [serverHits, setServerHits] = useState<Product[]>([]);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [payment, setPayment] = useState<PaymentMethod>('naqd');
  // Mijoz endi HAR QANDAY to'lov turida tanlanishi mumkin — naqd sotganda ham.
  // Shunda keyin "bu mijoz nima olgan edi?" degan savolga javob bo'ladi.
  const [customer, setCustomer] = useState<PickedCustomer | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<Product[]>('/products?limit=300').then(setProducts).catch(() => {});
  }, []);

  /**
   * Serverdan qidiruv — telefonga yuklangan 300 tadan tashqaridagi mahsulotlar
   * uchun. Katalog kattalashganda mahalliy ro'yxat hammasini qamramaydi.
   *
   * Mahalliy qidiruv baribir birinchi ishlaydi (darhol, tarmoqsiz), server
   * natijasi esa ustiga qo'shiladi. Shunday qilib kassir har harfda kutmaydi,
   * lekin katalogning qolgani ham yo'qolmaydi.
   */
  useEffect(() => {
    const q = search.trim();
    if (q.length < 2) { setServerHits([]); return; }

    const id = setTimeout(() => {
      api<Product[]>(`/products?search=${encodeURIComponent(q)}&limit=20`)
        .then(setServerHits)
        .catch(() => setServerHits([]));   // tarmoq yo'q — mahalliy natija qoladi
    }, 250);
    return () => clearTimeout(id);
  }, [search]);

  // Avval aniq moslik; hech narsa topilmasa — o'xshashlari (taxminiy=true)
  const { items: filtered, taxminiy } = useMemo(() => {
    const inCart = new Set(cart.map((c) => c.product.id));
    const available = products.filter((p) => !inCart.has(p.id));
    const mahalliy = fuzzySearch(available, search, (p) => p.name, { limit: 40 });

    // Serverdan kelgan, mahalliyda yo'q mahsulotlarni oxiriga qo'shamiz.
    const bor = new Set(mahalliy.items.map((p) => p.id));
    const qoshimcha = serverHits.filter((p) => !bor.has(p.id) && !inCart.has(p.id));

    return {
      items: [...mahalliy.items, ...qoshimcha].slice(0, 40),
      // Serverda aniq moslik topilgan bo'lsa, mahalliy "taxminiy" ogohlantirishi
      // o'rinsiz bo'lib qoladi.
      taxminiy: mahalliy.taxminiy && !qoshimcha.some((p) => !p.taxminiy),
    };
  }, [products, search, cart, serverHits]);

  const total = cart.reduce(
    (s, l) => s + (Number(l.qty) || 0) * (Number(l.price) || 0), 0);

  function add(p: Product) {
    // Yangi qator ENG TEPAGA qo'shiladi: kassir hozir qo'shgan mahsulotining
    // miqdorini darhol o'zgartiradi, uni ro'yxat oxiridan qidirishi shart emas.
    setCart((c) => [{ product: p, qty: '1', price: String(p.sale_price) }, ...c]);
    setSearch('');
  }

  function update(id: string, patch: Partial<CartLine>) {
    setCart((c) => c.map((l) => (l.product.id === id ? { ...l, ...patch } : l)));
  }

  async function submit() {
    if (cart.length === 0) return;
    if (payment === 'qarz' && !customer) {
      Alert.alert('Mijoz kerak', 'Qarzga sotish uchun mijozni tanlang.');
      setPickerOpen(true);
      return;
    }

    // Pul bilan bog'liq amal — saqlashdan oldin nima yozilishini ko'rsatamiz
    const yetmaydi = cart.filter(
      (l) => (Number(l.qty) || 0) > Number(l.product.stock));

    const ok = await confirm({
      title: 'Savdoni saqlash',
      icon: 'savdo',
      amount: total,
      amountLabel: 'Jami savdo',
      lines: [
        ...cart.map((l) =>
          `${l.qty} ${l.product.unit} ${l.product.name} × ${money(Number(l.price) || 0)}`
          + ` = ${money((Number(l.qty) || 0) * (Number(l.price) || 0))} so'm`),
        `To'lov: ${payment}${customer ? ` · ${customer.name}` : ''}`,
        payment === 'qarz'
          ? `${money(total)} so'm qarzga yoziladi`
          : 'Ombordan mahsulot ayiriladi, kunlik kirimga qo\'shiladi',
      ],
      warnings: yetmaydi.map((l) =>
        `"${l.product.name}" omborda ${fq(l.product.stock)} ${l.product.unit} qolgan`
        + ` — qoldiq minusga tushadi`),
      confirmText: 'Saqlash',
    });
    if (!ok) return;

    setBusy(true);
    try {
      await api('/sales', {
        method: 'POST',
        body: {
          items: cart.map((l) => ({
            product_id: l.product.id,
            name: l.product.name,
            unit: l.product.unit,
            qty: Number(l.qty) || 0,
            unit_price: Number(l.price) || 0,
          })),
          customer_id: customer?.id ?? null,
          customer_name: customer?.name ?? null,
          payment_method: payment,
          paid: payment === 'qarz' ? 0 : null,
        },
      });
      router.back();
    } catch (e: any) {
      Alert.alert('Saqlab bo\'lmadi', e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={s.head}>
          <Pressable onPress={() => router.back()} hitSlop={10}>
            <Text style={[font.body, { color: colors.primary }]}>Bekor</Text>
          </Pressable>
          <Text style={[font.h3, { color: colors.text, flex: 1, textAlign: 'center' }]}>
            Yangi savdo
          </Text>
          <View style={{ width: 44 }} />
        </View>

        <FlatList
          data={cart}
          keyExtractor={(l) => l.product.id}
          contentContainerStyle={s.list}
          ListHeaderComponent={
            <View style={{ gap: spacing.sm, marginBottom: spacing.md }}>
              <TextInput
                style={s.search}
                placeholder="Mahsulot qidirish…"
                placeholderTextColor={colors.textFaint}
                value={search}
                onChangeText={setSearch}
              />
              {search.length > 0 && (
                <View style={s.suggestions}>
                  {taxminiy && filtered.length > 0 && (
                    <Text style={[font.tiny, {
                      color: colors.warning, paddingHorizontal: spacing.md,
                      paddingTop: spacing.sm,
                    }]}>
                      Aynan topilmadi — shunga o'xshashlari
                    </Text>
                  )}
                  {filtered.length === 0 ? (
                    <Text style={[font.small, { color: colors.textMuted, padding: spacing.md }]}>
                      Topilmadi
                    </Text>
                  ) : filtered.map((p) => (
                    <Pressable key={p.id} onPress={() => add(p)} style={s.suggestion}>
                      {p.photo_url
                        ? <Image source={{ uri: p.photo_url }} style={s.thumb} contentFit="cover" />
                        : <View style={[s.thumb, s.thumbBosh]}>
                            <Icon name="mahsulot" size={18} color={colors.textFaint} />
                          </View>}
                      <View style={{ flex: 1 }}>
                        <Text style={[font.body, { color: colors.text }]} numberOfLines={1}>
                          {p.name}
                        </Text>
                        <Text style={[font.tiny, {
                          color: Number(p.stock) <= 0 ? colors.danger : colors.textMuted,
                        }]}>
                          {money(p.sale_price)} so'm / {p.unit} · qoldiq {fq(p.stock)}
                        </Text>
                      </View>
                      <Icon name="qoshish" size={22} color={colors.primary} />
                    </Pressable>
                  ))}
                </View>
              )}
            </View>
          }
          ListEmptyComponent={
            search.length === 0
              ? <Empty icon="savat" title="Savat bo'sh" hint="Yuqoridan mahsulot qidiring" />
              : null
          }
          renderItem={({ item }) => (
            <CartRow
              line={item}
              onQty={(v) => update(item.product.id, { qty: v })}
              onPrice={(v) => update(item.product.id, { price: v })}
              onRemove={() =>
                setCart((c) => c.filter((x) => x.product.id !== item.product.id))}
            />
          )}
        />

        {cart.length > 0 && (
          <View style={s.footer}>
            <View style={{ flexDirection: 'row', gap: spacing.sm }}>
              {(['naqd', 'karta', 'qarz'] as PaymentMethod[]).map((m) => (
                <Pressable
                  key={m}
                  onPress={() => setPayment(m)}
                  style={[s.payChip, payment === m && s.payChipOn]}
                >
                  <Text style={[font.small, { color: payment === m ? '#fff' : colors.textMuted }]}>
                    {m}
                  </Text>
                </Pressable>
              ))}
            </View>

            {/* Mijoz — qarzda majburiy, boshqa hollarda ixtiyoriy */}
            <Pressable
              onPress={() => setPickerOpen(true)}
              style={({ pressed }) => [s.customerRow, pressed && { opacity: 0.7 }]}
            >
              <Icon name="qarzlar" size={18}
                color={customer ? colors.primary : colors.textFaint} />
              <View style={{ flex: 1 }}>
                <Text style={[font.body, {
                  color: customer ? colors.text : colors.textFaint,
                }]}>
                  {customer ? customer.name : 'Mijoz tanlash (ixtiyoriy)'}
                </Text>
                {customer && customer.id === null && (
                  <Text style={[font.tiny, { color: colors.primary }]}>
                    yangi mijoz — savdo bilan qo'shiladi
                  </Text>
                )}
                {payment === 'qarz' && !customer && (
                  <Text style={[font.tiny, { color: colors.danger }]}>
                    Qarzga sotish uchun shart
                  </Text>
                )}
              </View>
              {customer ? (
                <Pressable onPress={() => setCustomer(null)} hitSlop={10}>
                  <Icon name="yopish" size={17} color={colors.textMuted} />
                </Pressable>
              ) : null}
            </Pressable>

            <View style={s.totalRow}>
              <Text style={[font.h3, { color: colors.textMuted }]}>Jami</Text>
              <Text style={[font.h1, { color: colors.text }]}>{money(total)}</Text>
            </View>

            <Button
              title="Savdoni saqlash"
              onPress={submit}
              loading={busy}
              disabled={total <= 0}
            />
          </View>
        )}
      </KeyboardAvoidingView>

      <CustomerPicker
        visible={pickerOpen}
        value={customer}
        onPick={setCustomer}
        onClose={() => setPickerOpen(false)}
      />
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  head: {
    flexDirection: 'row', alignItems: 'center',
    padding: spacing.lg, gap: spacing.md,
  },
  list: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xl, gap: spacing.sm },
  search: {
    backgroundColor: colors.surface, borderRadius: radius.md,
    paddingHorizontal: spacing.md, height: 48, fontSize: 16,
    color: colors.text, borderWidth: 1, borderColor: colors.border,
  },
  suggestions: {
    backgroundColor: colors.surface, borderRadius: radius.md,
    overflow: 'hidden', ...shadow,
  },
  suggestion: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    padding: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border,
  },
  thumb: { width: 40, height: 40, borderRadius: radius.sm },
  thumbBosh: {
    backgroundColor: colors.surfaceAlt,
    alignItems: 'center', justifyContent: 'center',
  },
  line: {
    backgroundColor: colors.surface, borderRadius: radius.md,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    gap: 6, ...shadow,
  },
  lineTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  lineBottom: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },

  /* Miqdor: [−] 5 [+] — bitta yaxlit blok */
  stepper: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: colors.surfaceAlt, borderRadius: radius.sm,
  },
  stepBtn: {
    width: 34, height: 36,
    alignItems: 'center', justifyContent: 'center',
    borderRadius: radius.sm,
  },
  stepTxt: { fontSize: 20, fontWeight: '600', color: colors.text, lineHeight: 22 },
  qtyInput: {
    minWidth: 42, height: 36, paddingHorizontal: 2, paddingVertical: 0,
    textAlign: 'center', textAlignVertical: 'center',
    includeFontPadding: false,
    fontSize: 16, fontWeight: '600', color: colors.text,
  },
  priceInput: {
    minWidth: 78, height: 36, paddingHorizontal: spacing.sm, paddingVertical: 0,
    backgroundColor: colors.surfaceAlt, borderRadius: radius.sm,
    textAlign: 'center', textAlignVertical: 'center',
    includeFontPadding: false,
    fontSize: 15, color: colors.text,
  },
  footer: {
    backgroundColor: colors.surface,
    borderTopWidth: 1, borderTopColor: colors.border,
    padding: spacing.lg, gap: spacing.md,
  },
  customerRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: 12,
  },
  payChip: {
    flex: 1, paddingVertical: 10, borderRadius: radius.md,
    backgroundColor: colors.surfaceAlt, alignItems: 'center',
  },
  payChipOn: { backgroundColor: colors.primary },
  totalRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
});
