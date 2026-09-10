/**
 * TOVAR OLISH (OMBORGA KIRIM)
 * ============================
 * Do'konga mol kelganda yoziladigan ekran.
 *
 * NEGA BU CHIQIM EMAS. Mol sotib olish — xarajat emas, pulning TOVARGA
 * aylanishi. Xarajatga u faqat sotilganda aylanadi, ya'ni tan narx bo'lib.
 * Chiqim deb yozilsa o'sha pul foydadan ikki marta ayirilardi: olingan
 * kuni chiqim bo'lib, sotilgan kuni tan narx bo'lib.
 *
 * Ilgari bu ekran yo'q edi va do'konchida boshqa yo'l qolmagani uchun mol
 * "Chiqim" ga yozilardi. Server tomoni esa allaqachon to'g'ri edi:
 * `purchase` amali qoldiqni oshiradi, tan narxni yangilaydi va
 * `expenses` ga umuman tegmaydi. Bu ekran o'sha amalga yo'l ochadi.
 *
 * AYLANTIRISH REJIMI. `expense_id` parametri bilan ochilsa, bu ekran
 * eski chiqimni kirimga AYLANTIRADI: chiqim o'chadi, o'rniga kirim
 * yoziladi — ikkalasi serverda bitta tranzaksiyada. Shu sabab alohida
 * ekran yasalmadi: kiritiladigan ma'lumot aynan bir xil, farqi faqat
 * qaysi mutatsiya yuborilishida.
 *
 * SAVDO EKRANIDAN FARQI — narx maydoni TAN NARX (nechaga oldingiz), sotuv
 * narxi emas. Ikkalasi adashib almashsa foyda butunlay noto'g'ri chiqadi,
 * shuning uchun maydon "Tan narx" deb ochiq belgilangan va mahsulotning
 * hozirgi sotuv narxi yonida eslatib turiladi.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  FlatList, KeyboardAvoidingView, Platform, Pressable,
  StyleSheet, Text, TextInput, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import type { Product } from '../../src/api/types';
import * as productStore from '../../src/data/products';
import { search as fuzzySearch } from '../../src/lib/search';
import * as outbox from '../../src/lib/outbox';
import { Button, Empty, Field } from '../../src/components/ui';
import { Icon } from '../../src/components/Icon';
import { useToast } from '../../src/components/Toast';
import { useConfirm } from '../../src/components/Confirm';
import { ShtrixSkaner } from '../../src/components/ShtrixSkaner';
import { haptic } from '../../src/lib/haptics';
import {
  colors, elevation, font, money, qty as fq, radius, spacing,
} from '../../src/theme';

interface Qator {
  product: Product;
  /** Matn sifatida — "1.5" yozishga imkon beradi. */
  qty: string;
  /** TAN NARX (bir birligi nechaga olindi). */
  cost: string;
}

/** Qator summasi: miqdor × tan narx. */
function qatorJami(q: Qator): number {
  return (Number(q.qty) || 0) * (Number(q.cost) || 0);
}

export default function NewPurchaseScreen() {
  const router = useRouter();
  /** Chiqimdan aylantirilayotgan bo'lsa — o'sha chiqim haqidagi ma'lumot. */
  const { expense_id: chiqimId, expense_amount, expense_note } =
    useLocalSearchParams<{
      expense_id?: string; expense_amount?: string; expense_note?: string;
    }>();
  const aylantirish = Boolean(chiqimId);
  const chiqimSummasi = Number(expense_amount) || 0;
  const toast = useToast();
  const confirm = useConfirm();

  const [products, setProducts] = useState<Product[]>([]);
  const [search, setSearch] = useState('');
  const [qatorlar, setQatorlar] = useState<Qator[]>([]);
  const [supplier, setSupplier] = useState('');
  const [skanerOchiq, setSkanerOchiq] = useState(false);
  const [busy, setBusy] = useState(false);

  // Katalog MAHALLIY cache'dan — savdo ekranidagi bilan bir xil yo'l.
  // Mol kelganda internet bo'lmasligi mumkin, kirim esa kutib turolmaydi.
  useEffect(() => {
    let tirik = true;
    productStore.loadAndRefresh((yangi) => { if (tirik) setProducts(yangi); })
      .then((darhol) => { if (tirik) setProducts(darhol); })
      .catch(() => {});
    return () => { tirik = false; };
  }, []);

  const { items: topilgan, taxminiy } = useMemo(() => {
    if (!search.trim()) return { items: [] as Product[], taxminiy: false };
    // Savatga tushganlari taklifda ko'rinmasin — bir mahsulot ikki qator
    // bo'lib qolsa qoldiq ikki marta oshardi.
    const bor = new Set(qatorlar.map((q) => q.product.id));
    const qolgan = products.filter((p) => !bor.has(p.id));
    return fuzzySearch(qolgan, search, (p) => p.name, { limit: 12 });
  }, [products, search, qatorlar]);

  const jami = qatorlar.reduce((s, q) => s + qatorJami(q), 0);

  const qosh = useCallback((p: Product) => {
    haptic.tap();
    setQatorlar((c) => [
      // Tan narx mahsulotning oxirgi ma'lum narxidan boshlanadi — ko'pincha
      // o'zgarmaydi, o'zgarsa do'konchi ustiga yozib qo'yadi.
      { product: p, qty: '1', cost: String(Number(p.cost_price) || 0) },
      ...c,
    ]);
    setSearch('');
  }, []);

  function yangila(id: string, patch: Partial<Qator>) {
    setQatorlar((c) => c.map((q) => (q.product.id === id ? { ...q, ...patch } : q)));
  }

  /** Skanerdan kelgan kod: mahsulot topilsa darhol qo'shiladi. */
  function skanQabul(kod: string) {
    setSkanerOchiq(false);
    const topildi = products.find(
      (p) => p.barcode === kod || (p.barcodes ?? []).includes(kod));
    if (topildi) {
      if (qatorlar.some((q) => q.product.id === topildi.id)) {
        toast.info(`"${topildi.name}" allaqachon ro'yxatda`);
        return;
      }
      qosh(topildi);
      return;
    }
    // Topilmasa kodni qidiruvga qo'yamiz — do'konchi nomi bilan qidirib,
    // keyin mahsulotga kodni biriktirib qo'yishi mumkin.
    setSearch(kod);
    toast.ogoh('Bu kod hech qaysi mahsulotga biriktirilmagan');
  }

  async function saqla() {
    if (qatorlar.length === 0) return;

    const tannarxsiz = qatorlar.filter((q) => (Number(q.cost) || 0) <= 0);

    // Aylantirishda summa chiqimniki bilan mos kelishi kerak: farq
    // qolsa kitobdagi pul siljib ketadi va buni keyin topish qiyin.
    const farq = aylantirish ? Math.round(jami - chiqimSummasi) : 0;

    const ok = await confirm({
      title: aylantirish ? 'Chiqimni kirimga aylantirish' : 'Omborga kirim',
      icon: 'kirim',
      amount: jami,
      amountLabel: 'Tovarga sarflandi',
      lines: [
        ...qatorlar.map((q) =>
          `${q.qty} ${q.product.unit} ${q.product.name} × ${money(Number(q.cost) || 0)}`
          + ` = ${money(qatorJami(q))} so'm`),
        supplier.trim() ? `Yetkazib beruvchi: ${supplier.trim()}` : null,
        aylantirish
          ? `${money(chiqimSummasi)} so'mlik chiqim o'chadi, o'rniga shu kirim yoziladi`
          : null,
        'Ombor qoldig\'i oshadi, tan narx yangilanadi',
        // Eng muhim jumla: do'konchi bu pul qayerga ketganini so'raydi.
        'Bu CHIQIM emas — foydadan ayirilmaydi. Foydaga u sotilganda,'
          + ' tan narx bo\'lib ta\'sir qiladi.',
      ].filter(Boolean) as string[],
      warnings: [
        ...tannarxsiz.map((q) =>
          `"${q.product.name}" tan narxi 0 — bu mahsulotning har savdosi`
          + ' to\'liq foyda bo\'lib hisoblanadi'),
        ...(farq !== 0
          ? [`Kirim summasi chiqimdan ${money(Math.abs(farq))} so'm`
             + ` ${farq > 0 ? 'KO\'P' : 'KAM'} — chiqim ${money(chiqimSummasi)} so'm edi`]
          : []),
      ],
      confirmText: 'Saqlash',
    });
    if (!ok) return;

    setBusy(true);
    try {
      const res = await outbox.enqueue(
        aylantirish ? 'expense_to_purchase' : 'purchase', {
        ...(aylantirish ? { expense_id: chiqimId } : null),
        supplier: supplier.trim() || null,
        items: qatorlar.map((q) => ({
          product_id: q.product.id,
          name: q.product.name,
          unit: q.product.unit,
          qty: Number(q.qty) || 0,
          cost_price: Number(q.cost) || 0,
          sale_price: null,      // mavjud mahsulot — sotuv narxiga tegilmaydi
        })),
        note: aylantirish ? (expense_note || null) : null,
      }, `${aylantirish ? 'Chiqim → kirim' : 'Omborga kirim'} — ${money(jami)} so'm`);

      if (res.error) throw new Error(res.error);

      // Qoldiq va tan narx o'zgardi — keyingi ekran eski raqamni ko'rsatmasin.
      productStore.invalidate();

      if (res.yuborildi) {
        toast.ok(aylantirish
          ? 'Chiqim kirimga aylantirildi — foyda qayta hisoblandi'
          : `${money(jami)} so'mlik tovar omborga kiritildi`);
        for (const w of res.warnings) toast.ogoh(w);
      } else {
        toast.info("Kirim navbatga qo'yildi — ulanish bo'lishi bilan yuboriladi");
      }
      router.back();
    } catch (e: any) {
      toast.xato(`Saqlab bo'lmadi: ${e.message}`);
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
        <View style={s.bosh}>
          <Pressable onPress={() => router.back()} hitSlop={12}>
            <Icon name="yopish" size={24} color={colors.textMuted} />
          </Pressable>
          <Text style={[font.h3, { color: colors.text, flex: 1, textAlign: 'center' }]}>
            {aylantirish ? 'Kirimga aylantirish' : 'Tovar olish'}
          </Text>
          {/* Chapdagi tugma bilan bir xil kenglik — sarlavha markazda tursin */}
          <View style={{ width: 24 }} />
        </View>

        <FlatList
          data={qatorlar}
          keyExtractor={(q) => q.product.id}
          contentContainerStyle={s.royxat}
          // Klaviatura ochiq turganda taklif ustiga bosish DARHOL ishlasin:
          // busiz birinchi teginish faqat klaviaturani yopadi va do'konchi
          // "bosdim, qo'shilmadi" deb ikkinchi marta bosishga majbur bo'ladi.
          keyboardShouldPersistTaps="handled"
          ListHeaderComponent={
            <View style={{ gap: spacing.sm, marginBottom: spacing.md }}>
              {/* Aylantirilayotgan chiqim ko'z oldida tursin — do'konchi
                  qaysi yozuvni tuzatayotganini va summasi qanchaligini
                  eslab o'tirmasin. */}
              {aylantirish && (
                <View style={s.chiqimBanner}>
                  <Icon name="chiqim" size={16} color={colors.primary} />
                  <View style={{ flex: 1 }}>
                    <Text style={[font.smallBold, { color: colors.primary }]}>
                      Chiqim: {money(chiqimSummasi)} so'm
                    </Text>
                    <Text style={[font.tiny, { color: colors.primary }]}>
                      {expense_note
                        ? `"${expense_note}" — qaysi mahsulot ekanini belgilang`
                        : 'Qaysi mahsulot olinganini belgilang'}
                    </Text>
                  </View>
                </View>
              )}

              <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                <TextInput
                  style={[s.qidiruv, { flex: 1 }]}
                  placeholder="Mahsulot qidirish…"
                  placeholderTextColor={colors.textFaint}
                  value={search}
                  onChangeText={setSearch}
                  autoCorrect={false}
                  accessibilityLabel="Mahsulot qidirish"
                />
                <Pressable
                  onPress={() => { haptic.tap(); setSkanerOchiq(true); }}
                  style={s.skanTugma}
                  hitSlop={6}
                  accessibilityLabel="Shtrix-kodni o'qish"
                >
                  <Icon name="shtrix" size={22} color={colors.primary} />
                </Pressable>
              </View>

              {search.length > 0 && (
                <View style={s.takliflar}>
                  {taxminiy && topilgan.length > 0 && (
                    <Text style={[font.tiny, {
                      color: colors.warning,
                      paddingHorizontal: spacing.md, paddingTop: spacing.sm,
                    }]}>
                      Aynan topilmadi — shunga o'xshashlari
                    </Text>
                  )}
                  {topilgan.length === 0 ? (
                    <Text style={[font.small, {
                      color: colors.textMuted, padding: spacing.md,
                    }]}>
                      Topilmadi — yangi mahsulot bo'lsa avval "Mahsulot" dan qo'shing
                    </Text>
                  ) : topilgan.map((p) => (
                    <Pressable key={p.id} onPress={() => qosh(p)} style={s.taklif}>
                      <View style={{ flex: 1 }}>
                        <Text style={[font.body, { color: colors.text }]} numberOfLines={1}>
                          {p.name}
                        </Text>
                        <Text style={[font.tiny, { color: colors.textMuted }]}>
                          qoldiq {fq(p.stock)} {p.unit} · tan narx {money(p.cost_price)}
                        </Text>
                      </View>
                      <Icon name="qoshish" size={20} color={colors.primary} />
                    </Pressable>
                  ))}
                </View>
              )}
            </View>
          }
          ListEmptyComponent={
            <Empty
              icon="kirim"
              title="Hech narsa qo'shilmadi"
              hint="Yuqoridan mahsulot qidiring yoki shtrix-kodni o'qiting"
            />
          }
          renderItem={({ item }) => (
            <QatorRow
              qator={item}
              onQty={(v) => yangila(item.product.id, { qty: v })}
              onCost={(v) => yangila(item.product.id, { cost: v })}
              onRemove={() =>
                setQatorlar((c) => c.filter((x) => x.product.id !== item.product.id))}
            />
          )}
        />

        {qatorlar.length > 0 && (
          <View style={s.pastki}>
            <Field
              label="Yetkazib beruvchi (ixtiyoriy)"
              placeholder="Masalan: Asil bliss pishiriqlar"
              value={supplier}
              onChangeText={setSupplier}
            />

            {aylantirish && Math.round(jami) !== Math.round(chiqimSummasi) && (
              <Text style={[font.tiny, { color: colors.warning }]}>
                Chiqim {money(chiqimSummasi)} so'm edi — hozircha
                {' '}{money(Math.abs(jami - chiqimSummasi))} so'm
                {jami < chiqimSummasi ? ' kam' : ' ko\'p'}
              </Text>
            )}

            <View style={s.jamiQator}>
              <Text style={[font.h3, { color: colors.textMuted }]}>Tovarga sarflandi</Text>
              <Text style={[font.numBig, { color: colors.text }]}>
                {money(jami)}{' '}
                <Text style={[font.h3, { color: colors.textMuted }]}>so'm</Text>
              </Text>
            </View>

            <Button
              title="Omborga kiritish"
              size="lg"
              icon="kirim"
              onPress={saqla}
              loading={busy}
              disabled={jami <= 0}
            />
          </View>
        )}
      </KeyboardAvoidingView>

      <ShtrixSkaner
        visible={skanerOchiq}
        onScan={skanQabul}
        onClose={() => setSkanerOchiq(false)}
        hint="Kelgan tovarning shtrix-kodini ramka ichiga tuting"
      />
    </SafeAreaView>
  );
}

/** Bitta kirim qatori: miqdor va TAN NARX. */
function QatorRow({ qator, onQty, onCost, onRemove }: {
  qator: Qator;
  onQty(v: string): void;
  onCost(v: string): void;
  onRemove(): void;
}) {
  const p = qator.product;
  const sotuv = Number(p.sale_price) || 0;
  const tan = Number(qator.cost) || 0;
  // Tan narx sotuv narxidan baland bo'lsa har savdo ZARAR keltiradi.
  // Bu ko'pincha maydonlarni adashtirib yozishdan kelib chiqadi.
  const zarar = sotuv > 0 && tan > sotuv;

  return (
    <View style={s.qator}>
      <View style={s.qatorBosh}>
        <Text style={[font.bodyBold, { color: colors.text, flex: 1 }]} numberOfLines={1}>
          {p.name}
        </Text>
        <Text style={[font.num, { color: colors.text }]}>
          {money(qatorJami(qator))}
        </Text>
        <Pressable onPress={onRemove} hitSlop={12}>
          <Icon name="yopish" size={17} color={colors.textFaint} />
        </Pressable>
      </View>

      <View style={s.qatorPast}>
        <View style={{ flex: 1 }}>
          <Text style={[font.tiny, { color: colors.textMuted }]}>Miqdor</Text>
          <TextInput
            value={qator.qty}
            onChangeText={(v) => onQty(v.replace(',', '.'))}
            keyboardType="decimal-pad"
            selectTextOnFocus
            accessibilityLabel={`${p.name} miqdori`}
            style={s.kichikInput}
          />
        </View>
        <Text style={[font.small, { color: colors.textMuted, paddingTop: 14 }]}>
          {p.unit}
        </Text>
        <View style={{ flex: 1.3 }}>
          <Text style={[font.tiny, { color: colors.textMuted }]}>Tan narx</Text>
          <TextInput
            value={qator.cost}
            onChangeText={(v) => onCost(v.replace(/[^0-9.]/g, ''))}
            keyboardType="decimal-pad"
            selectTextOnFocus
            accessibilityLabel={`${p.name} tan narxi`}
            style={[s.kichikInput, zarar && { borderColor: colors.danger }]}
          />
        </View>
      </View>

      {zarar ? (
        <Text style={[font.tiny, { color: colors.danger }]}>
          Tan narx sotuv narxidan ({money(sotuv)}) baland — har savdo zarar bo'ladi
        </Text>
      ) : (
        <Text style={[font.tiny, { color: colors.textFaint }]}>
          Omborda {fq(p.stock)} {p.unit} bor · sotuv narxi {money(sotuv)}
        </Text>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  bosh: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
    backgroundColor: colors.surface,
    borderBottomWidth: 1, borderBottomColor: colors.borderSoft,
  },
  qidiruv: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border,
    paddingHorizontal: spacing.md, height: 46,
    fontSize: 16, fontFamily: 'Inter_500Medium', color: colors.text,
  },
  skanTugma: {
    width: 46, height: 46, borderRadius: radius.md,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1, borderColor: colors.border,
  },
  takliflar: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.borderSoft,
    overflow: 'hidden',
    ...elevation[2],
  },
  taklif: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    borderBottomWidth: 1, borderBottomColor: colors.borderSoft,
  },
  royxat: {
    paddingHorizontal: spacing.lg, paddingTop: spacing.md,
    paddingBottom: spacing.xl, gap: spacing.sm,
  },
  qator: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg, padding: spacing.md, gap: spacing.sm,
    borderWidth: 1, borderColor: colors.borderSoft,
    ...elevation[1],
  },
  qatorBosh: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  qatorPast: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm },
  kichikInput: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.sm,
    borderWidth: 1, borderColor: colors.border,
    paddingHorizontal: spacing.sm, paddingVertical: 8,
    fontSize: 16, fontFamily: 'Inter_600SemiBold', color: colors.text,
  },
  pastki: {
    gap: spacing.md,
    paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.lg,
    backgroundColor: colors.surface,
    borderTopWidth: 1, borderTopColor: colors.borderSoft,
  },
  chiqimBanner: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    backgroundColor: colors.primarySoft,
    borderWidth: 1, borderColor: colors.primaryLine,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
  },
  jamiQator: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
  },
});
