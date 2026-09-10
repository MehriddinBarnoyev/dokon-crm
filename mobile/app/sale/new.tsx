import { useEffect, useMemo, useState } from 'react';
import {
  FlatList, KeyboardAvoidingView, Platform, Pressable,
  StyleSheet, Text, TextInput, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { api } from '../../src/api/client';
import { useAuth } from '../../src/api/auth';
import type { PaymentMethod, Product } from '../../src/api/types';
import { Button, Empty } from '../../src/components/ui';
import { ModalHeader } from '../../src/components/ScreenHeader';
import { useConfirm } from '../../src/components/Confirm';
import { useToast } from '../../src/components/Toast';
import { CustomerPicker, type PickedCustomer } from '../../src/components/CustomerPicker';
import { ShtrixSkaner } from '../../src/components/ShtrixSkaner';
import { search as fuzzySearch } from '../../src/lib/search';
import * as productStore from '../../src/data/products';
import * as outbox from '../../src/lib/outbox';
import * as chek from '../../src/lib/chek';
import { haptic } from '../../src/lib/haptics';
import { colors, elevation, family, font, money, qty as fq, radius, spacing } from '../../src/theme';
import { Icon } from '../../src/components/Icon';

interface CartLine {
  product: Product;
  qty: string;      // matn sifatida — "1.5" yozishga imkon beradi
  price: string;
  /**
   * Do'konchi JAMI maydoniga yozgan aniq summa.
   *
   * Nega alohida saqlanadi? "32 minglik pishiriq bering" deyilganda miqdor
   * 32 000 ÷ 35 000 = 0.914285… bo'ladi, u esa uch xonagacha qisqaradi
   * (bazadagi `numeric(14,3)`). Qisqargan miqdorni qayta ko'paytirsak
   * 0.914 × 35 000 = 31 990 — kassada 10 so'm kamomat. Ko'proq xona ham
   * yordam bermaydi: bo'linma davriy kasr.
   *
   * Shuning uchun qatorning jamisi ko'paytmadan emas, shu raqamdan olinadi.
   * Miqdor yoki narx qo'lda o'zgartirilsa — tozalanadi, ya'ni yana odatdagi
   * ko'paytmaga qaytadi.
   */
  jami?: number;
}

/**
 * Pul maydoni: fokusda xom raqam, aks holda "50 000" ko'rinishida.
 * Savatdagi JAMI maydoni bilan bir xil qoida — yozayotganda qayta
 * formatlansa kursor sakrab ketardi.
 */
function PulInput({ label, value, onChange, aksessLabel }: {
  label: string;
  value: number;
  onChange(v: number): void;
  aksessLabel: string;
}) {
  const [matn, setMatn] = useState<string | null>(null);
  return (
    <View style={s.pulQator}>
      <Text style={[font.body, { color: colors.textMuted, flex: 1 }]}>{label}</Text>
      <TextInput
        value={matn ?? money(value)}
        onChangeText={(v) => {
          const toza = v.replace(/[^0-9]/g, '');
          setMatn(toza);
          onChange(Number(toza) || 0);
        }}
        onFocus={() => setMatn(value > 0 ? String(Math.round(value)) : '')}
        onBlur={() => setMatn(null)}
        keyboardType="number-pad"
        selectTextOnFocus
        accessibilityLabel={aksessLabel}
        style={s.pulInput}
      />
    </View>
  );
}

/** Qator summasi: do'konchi yozgani bo'lsa — o'sha, aks holda ko'paytma. */
function qatorJami(l: CartLine): number {
  return l.jami ?? (Number(l.qty) || 0) * (Number(l.price) || 0);
}

/**
 * SAVAT QATORI — ixcham va kassir uchun tez.
 *
 * Avval har qator ~200px joy egallardi (ikkita katta maydon + sarlavhalar),
 * to'rtta mahsulot ekranni to'ldirib qo'yardi. Endi ~84px:
 *
 *   Piyoz                                [ 25 000 ]  ✕
 *   [−] 5 [+] kg  ×  [ 5 000 ] so'm
 *
 * Miqdorni ko'pincha bittalab o'zgartiriladi — shuning uchun [−] [+]
 * tugmalari bor, klaviatura ochish shart emas. Aniq son (5.5 kg) kerak
 * bo'lsa raqamning ustiga bosib yozilaveradi.
 *
 * O'ngdagi JAMI ham yoziladigan maydon. Do'konda ko'pincha savdo teskari
 * boshlanadi: mijoz "12 minglik sabzi bering" deydi. Shunda jamiga 12000
 * yozilsa, miqdor o'zi hisoblanadi (12000 ÷ 5000 = 2.4 kg) — kassir
 * kalkulyator qidirmaydi.
 */
function CartRow({ line, onQty, onPrice, onJami, onRemove }: {
  line: CartLine;
  onQty(v: string): void;
  onPrice(v: string): void;
  /** Jami maydoniga summa yozildi — miqdor shundan hisoblanadi. */
  onJami(summa: number): void;
  onRemove(): void;
}) {
  const q = Number(line.qty) || 0;
  const narx = Number(line.price) || 0;
  const yetmaydi = q > Number(line.product.stock);
  const jami = qatorJami(line);

  // Jami tahrirlanayotganda kiritilgan matn shu yerda turadi. null — tahrir
  // yopiq, ya'ni hisoblangan summa ko'rsatiladi. Aks holda "12000" yozayotib
  // qayta formatlanib ("12 000") kursor sakrab ketardi.
  const [jamiMatn, setJamiMatn] = useState<string | null>(null);

  // Kasr qoldig'i saqlanadi: 5.5 − 1 → 4.5. toFixed suzuvchi nuqta
  // xatolarini kesadi (0.30000000000000004 kabi).
  const qadam = (d: number) => onQty(String(Number((q + d).toFixed(3))));

  /** Jamiga yozilgan summadan miqdorni chiqaramiz: 12 000 ÷ 5 000 = 2.4 kg */
  function jamidanMiqdor(matn: string) {
    const toza = matn.replace(/[^\d.,]/g, '').replace(',', '.');
    setJamiMatn(toza);
    const summa = Number(toza);
    // Narx nol bo'lsa bo'lish ma'nosiz — miqdorga tegmaymiz.
    if (narx <= 0 || !Number.isFinite(summa)) return;
    onJami(summa);
  }

  return (
    <View style={s.line}>
      <View style={s.lineTop}>
        <Text style={[font.bodyBold, { color: colors.text, flex: 1 }]} numberOfLines={1}>
          {line.product.name}
        </Text>
        <TextInput
          value={jamiMatn ?? money(jami)}
          onChangeText={jamidanMiqdor}
          onFocus={() => setJamiMatn(String(Math.round(jami)))}
          onBlur={() => setJamiMatn(null)}
          keyboardType="number-pad"
          selectTextOnFocus
          accessibilityLabel="Jami summa"
          style={s.jamiInput}
        />
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
  const { user, shop } = useAuth();
  const confirm = useConfirm();
  const toast = useToast();
  const [products, setProducts] = useState<Product[]>([]);
  const [search, setSearch] = useState('');
  const [cart, setCart] = useState<CartLine[]>([]);
  const [payment, setPayment] = useState<PaymentMethod>('naqd');
  /**
   * ARALASH TO'LOV — hozir tushgan pulning taqsimoti.
   *
   * Do'konda savdo ko'pincha bitta usulga sig'maydi: "50 mingini naqd
   * beraman, qolganini kartadan" yoki "yarmini hozir to'layman, yarmi
   * qarz". Ilgari bunday savdoni yozishning yo'li yo'q edi — do'konchi
   * yo hammasini qarzga yozardi, yo bitta savdoni ikkiga bo'lardi
   * (ombor to'g'ri chiqardi, lekin chek va mijoz tarixi buzilardi).
   *
   * Server buni allaqachon biladi: `sales.paid` — hozir tushgan pul,
   * `total - paid` esa AVTOMATIK qarzga yoziladi. Bu yerda faqat shu
   * raqamni yig'ib beramiz, yangi marshrut kerak emas.
   */
  const [naqd, setNaqd] = useState(0);
  const [karta, setKarta] = useState(0);
  // Mijoz endi HAR QANDAY to'lov turida tanlanishi mumkin — naqd sotganda ham.
  // Shunda keyin "bu mijoz nima olgan edi?" degan savolga javob bo'ladi.
  const [customer, setCustomer] = useState<PickedCustomer | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [skanerOchiq, setSkanerOchiq] = useState(false);
  const [busy, setBusy] = useState(false);

  /**
   * Katalog MAHALLIY cache'dan keladi — butunligicha, `?limit=300` siz.
   * Cache darhol ko'rsatiladi, yangilanishi orqadan tushadi.
   *
   * Ilgari bu yerda ikkita so'rov bor edi: ochilganda 300 ta mahsulot va
   * har harfda `?search=`. Ikkalasi ham endi kerak emas — qidiruv butunlay
   * qurilmada bajariladi va tarmoqsiz ham ishlayveradi.
   */
  useEffect(() => {
    let tirik = true;
    productStore.loadAndRefresh((yangi) => { if (tirik) setProducts(yangi); })
      .then((darhol) => { if (tirik) setProducts(darhol); })
      .catch(() => {});
    return () => { tirik = false; };
  }, []);

  // Avval aniq moslik; hech narsa topilmasa — o'xshashlari (taxminiy=true)
  const { items: filtered, taxminiy } = useMemo(() => {
    const inCart = new Set(cart.map((c) => c.product.id));
    const available = products.filter((p) => !inCart.has(p.id));
    const mahalliy = fuzzySearch(available, search, (p) => p.name, { limit: 40 });

    return { items: mahalliy.items, taxminiy: mahalliy.taxminiy };
  }, [products, search, cart]);

  const total = cart.reduce((s, l) => s + qatorJami(l), 0);

  /* ---------------------- To'lov hisob-kitobi ---------------------- */

  const aralash = payment === 'aralash';
  /**
   * Ortiqcha kiritilgani QAYTIM, ortiqcha to'lov emas: 80 mingga 100 ming
   * berilsa, savdoga 80 ming yoziladi. Aks holda mijozda manfiy qarz
   * (avans) paydo bo'lardi — buni ilova hech qayerda ko'rsatmaydi.
   */
  const kiritilgan = naqd + karta;
  const tolangan = aralash ? Math.min(kiritilgan, total)
    : payment === 'qarz' ? 0 : total;
  const qarz = Math.max(total - tolangan, 0);
  const ortiqcha = aralash ? Math.max(kiritilgan - total, 0) : 0;
  /** Qarz qoladigan har qanday savdoda mijoz shart — serverda ham shunday. */
  const mijozShart = qarz > 0;

  /**
   * Bazaga yoziladigan usul. Aralash tanlangani bilan amalda bitta usul
   * ishlatilgan bo'lishi mumkin (masalan faqat naqd) — u holda savdo
   * 'aralash' emas, o'sha usul bilan yoziladi: hisobot va chek toza qoladi.
   */
  const usul: PaymentMethod = !aralash ? payment
    : tolangan <= 0 ? 'qarz'
    : qarz <= 0 && karta <= 0 ? 'naqd'
    : qarz <= 0 && naqd <= 0 ? 'karta'
    : 'aralash';

  /**
   * NAQD/KARTA taqsimoti bazada alohida ustun EMAS — hisobotlar naqd
   * bilan kartani ajratmaydi, ikkalasi ham "tushgan pul". Shuning uchun
   * taqsimot savdo izohiga yoziladi: savdo sahifasida ham, chekda ham
   * ko'rinadi va keyin "kartadan qancha o'tgan edi?" degan savolga
   * javob bo'ladi.
   */
  const izoh = usul === 'aralash'
    ? [naqd > 0 ? `naqd ${money(naqd)}` : null,
       karta > 0 ? `karta ${money(karta)}` : null,
       qarz > 0 ? `qarz ${money(qarz)}` : null].filter(Boolean).join(' + ')
    : null;

  function add(p: Product) {
    // Yangi qator ENG TEPAGA qo'shiladi: kassir hozir qo'shgan mahsulotining
    // miqdorini darhol o'zgartiradi, uni ro'yxat oxiridan qidirishi shart emas.
    setCart((c) => [{ product: p, qty: '1', price: String(p.sale_price) }, ...c]);
    setSearch('');
  }

  /**
   * Shtrix-kod o'qildi.
   *
   * Savatda allaqachon bo'lsa MIQDOR OSHADI — bu kassadagi eng ko'p
   * uchraydigan holat: bir xil mahsulotning uchtasi ketma-ket o'tkaziladi.
   * Har safar yangi qator ochilsa, savat bir xil nomlar bilan to'lib
   * ketardi va do'konchi ularni qo'lda qo'shishga majbur bo'lardi.
   *
   * Miqdor faqat BUTUN qatorlarda oshiriladi: do'konchi "0.5 kg" yozib
   * qo'ygan bo'lsa, skan uni 1.5 kg ga aylantirib yubormasligi kerak.
   */
  function skanQabul(code: string) {
    setSkanerOchiq(false);
    if (!code) return;

    // Mahsulotning bir nechta kodi bo'lishi mumkin — `barcodes` ichida
    // asosiysi ham bor. `barcode` ga qaytish eski keshdagi (hali yangi
    // sync o'tmagan) yozuvlar uchun.
    const topildi = products.find((p) =>
      p.barcodes?.includes(code) || (p.barcode ?? '').trim() === code);
    if (!topildi) {
      haptic.xato();
      toast.xato(`Shtrix-kod topilmadi: ${code}`);
      // Kodni qidiruvga qo'yamiz — do'konchi nomi bilan qidirib, keyin
      // mahsulotga shu kodni biriktirib qo'yishi mumkin.
      setSearch(code);
      return;
    }

    const bor = cart.find((l) => l.product.id === topildi.id);
    if (!bor) {
      add(topildi);
      haptic.ok();
      return;
    }

    const hozir = Number(bor.qty);
    if (Number.isInteger(hozir) && hozir > 0) {
      update(topildi.id, { qty: String(hozir + 1), jami: undefined });
      haptic.ok();
    } else {
      // Kasrli miqdor: qo'shib yuborish "0.5 kg" ni "1.5 kg" qilardi.
      // Jim turgandan ko'ra aytgan to'g'ri — do'konchi skan ishlamadi deb
      // qayta-qayta urinardi.
      toast.info(`${topildi.name} savatda (${bor.qty}). Miqdorni qo'lda o'zgartiring.`);
    }
  }

  function update(id: string, patch: Partial<CartLine>) {
    setCart((c) => c.map((l) => (l.product.id === id ? { ...l, ...patch } : l)));
  }

  /**
   * Jami maydoniga summa yozildi: miqdor shundan hisoblanadi va summaning
   * O'ZI ham saqlanadi — bo'linma yaxlitlangach ko'paytma yana o'sha
   * raqamni bermasligi mumkin ({@link CartLine.jami}).
   */
  function jamidan(id: string, summa: number) {
    setCart((c) => c.map((l) => {
      if (l.product.id !== id) return l;
      const narx = Number(l.price) || 0;
      if (narx <= 0) return l;
      return { ...l, qty: String(Number((summa / narx).toFixed(3))), jami: summa };
    }));
  }

  async function submit() {
    if (cart.length === 0) return;
    // Qarz qoladigan har qanday savdo — to'liq qarz ham, aralashning
    // to'lanmagan qismi ham — mijozsiz yozilmaydi.
    if (mijozShart && !customer) {
      toast.ogoh(qarz === total
        ? 'Qarzga sotish uchun mijozni tanlang'
        : `${money(qarz)} so'm qarz qoladi — mijozni tanlang`);
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
          + ` = ${money(qatorJami(l))} so'm`),
        `To'lov: ${usul}${customer ? ` · ${customer.name}` : ''}`,
        // Aralashda raqamlar bo'lakma-bo'lak ko'rsatiladi: do'konchi
        // saqlashdan oldin qaysi pul qayerga yozilishini ko'rsin.
        ...(usul === 'aralash'
          ? [naqd > 0 ? `Naqd: ${money(naqd)} so'm` : null,
             karta > 0 ? `Karta: ${money(karta)} so'm` : null].filter(Boolean) as string[]
          : []),
        qarz > 0
          ? `${money(qarz)} so'm qarzga yoziladi`
          : 'Ombordan mahsulot ayiriladi, kunlik kirimga qo\'shiladi',
      ],
      warnings: [
        ...yetmaydi.map((l) =>
          `"${l.product.name}" omborda ${fq(l.product.stock)} ${l.product.unit} qolgan`
          + ` — qoldiq minusga tushadi`),
        ...(ortiqcha > 0
          ? [`${money(ortiqcha)} so'm ortiqcha kiritildi — savdoga`
             + ` ${money(total)} so'm yoziladi, qolgani qaytim`]
          : []),
      ],
      confirmText: 'Saqlash',
    });
    if (!ok) return;

    setBusy(true);
    try {
      // Navbat orqali: do'konda internet uzilib turadi, savdo esa
      // kutib turolmaydi. Internet yo'q bo'lsa yozuv qurilmada saqlanadi
      // va ulanish tiklanganda avtomatik yuboriladi.
      const res = await outbox.enqueue('sale', {
        items: cart.map((l) => ({
          product_id: l.product.id,
          name: l.product.name,
          unit: l.product.unit,
          qty: Number(l.qty) || 0,
          unit_price: Number(l.price) || 0,
          // Yozilgan summa server tomonda ham asosiy raqam bo'ladi —
          // u yerda ham yaxlitlash farqi doirasida qabul qilinadi.
          subtotal: l.jami ?? null,
        })),
        customer_id: customer?.id ?? null,
        customer_name: customer?.name ?? null,
        payment_method: usul,
        // Aralashda aniq summa yuboriladi; boshqa hollarda `null` —
        // server o'zi hal qiladi (qarz => 0, qolgani => to'liq).
        paid: aralash ? tolangan : payment === 'qarz' ? 0 : null,
        note: izoh,
      }, `Savdo — ${money(total)} so'm`);

      if (res.error) throw new Error(res.error);

      // Qoldiqlar o'zgardi — keyingi ekran cache'dagi eski raqamni
      // ko'rsatmasin.
      productStore.invalidate();

      if (res.yuborildi) {
        toast.ok(`${money(total)} so'mlik savdo yozildi`);
        // Serverning ogohlantirishi bo'lsa (qoldiq minusga tushdi) —
        // jimgina yutib yubormaymiz.
        for (const w of res.warnings) toast.ogoh(w);
      } else {
        toast.info("Savdo navbatga qo'yildi — ulanish bo'lishi bilan yuboriladi");
      }

      /*
       * Chek SAVATDAN yig'iladi, serverdan qayta so'ralmaydi: savdo
       * navbatga tushgan bo'lishi mumkin, chek esa xaridor ketguncha
       * kerak. Raqam — server bergan savdo id'sidan, u yo'q bo'lsa
       * mutatsiya uuid'sidan.
       */
      chek.saqla({
        raqam: chek.chekRaqami(res.serverId ?? res.mutatsiyaId),
        dokon: shop?.name ?? "Do'kon",
        sana: new Date().toISOString(),
        sotuvchi: user?.name ?? null,
        mijoz: customer?.name ?? null,
        qatorlar: cart.map((l) => ({
          nom: l.product.name,
          miqdor: Number(l.qty) || 0,
          birlik: l.product.unit,
          narx: Number(l.price) || 0,
          summa: qatorJami(l),
        })),
        jami: total,
        tolangan,
        qarz,
        usul,
        naqd: usul === 'aralash' ? naqd : undefined,
        karta: usul === 'aralash' ? karta : undefined,
        yuborildi: res.yuborildi,
      });

      // `replace` — orqaga bosganda savat qayta ochilmasin, savdo tugadi.
      router.replace('/chek');
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
        <ModalHeader title="Yangi savdo" onClose={() => router.back()} />

        <FlatList
          data={cart}
          keyExtractor={(l) => l.product.id}
          contentContainerStyle={s.list}
          ListHeaderComponent={
            <View style={{ gap: spacing.sm, marginBottom: spacing.md }}>
              <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                <TextInput
                  style={[s.search, { flex: 1 }]}
                  placeholder="Mahsulot qidirish…"
                  placeholderTextColor={colors.textFaint}
                  value={search}
                  onChangeText={setSearch}
                />
                {/* Nomni yozgandan ko'ra kodni o'qigan tez — navbat turganda muhim. */}
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
              onQty={(v) => update(item.product.id, { qty: v, jami: undefined })}
              onPrice={(v) => update(item.product.id, { price: v, jami: undefined })}
              onJami={(summa) => jamidan(item.product.id, summa)}
              onRemove={() =>
                setCart((c) => c.filter((x) => x.product.id !== item.product.id))}
            />
          )}
        />

        {cart.length > 0 && (
          <View style={s.footer}>
            <View style={{ flexDirection: 'row', gap: spacing.sm }}>
              {(['naqd', 'karta', 'qarz', 'aralash'] as PaymentMethod[]).map((m) => (
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

            {/* Aralash — hozir tushgan pulni bo'lib yozish */}
            {aralash && (
              <View style={s.aralashPanel}>
                <PulInput
                  label="Naqd" value={naqd} onChange={setNaqd}
                  aksessLabel="Naqd to'langan summa"
                />
                <PulInput
                  label="Karta" value={karta} onChange={setKarta}
                  aksessLabel="Karta orqali to'langan summa"
                />

                {/* Eng ko'p so'raladigan ikki holat bir bosishda */}
                <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                  <Pressable
                    onPress={() => { setNaqd(Math.round(total / 2)); setKarta(0); }}
                    style={s.tezTugma}
                    accessibilityRole="button"
                    accessibilityLabel="Yarmini naqd qilish"
                  >
                    <Text style={[font.small, { color: colors.primary }]}>Yarmi naqd</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => setNaqd(Math.max(total - karta, 0))}
                    style={s.tezTugma}
                    accessibilityRole="button"
                    accessibilityLabel="Qolgan summani naqdga yozish"
                  >
                    <Text style={[font.small, { color: colors.primary }]}>Qolgani naqd</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => { setNaqd(0); setKarta(0); }}
                    style={s.tezTugma}
                    accessibilityRole="button"
                    accessibilityLabel="Summalarni tozalash"
                  >
                    <Text style={[font.small, { color: colors.textMuted }]}>Tozalash</Text>
                  </Pressable>
                </View>

                <View style={s.qoldiqQator}>
                  <Text style={[font.small, { color: colors.textMuted }]}>
                    {ortiqcha > 0 ? 'Qaytim' : 'Qarzga qoladi'}
                  </Text>
                  <Text style={[font.num, {
                    color: ortiqcha > 0 ? colors.success
                      : qarz > 0 ? colors.danger : colors.success,
                  }]}>
                    {money(ortiqcha > 0 ? ortiqcha : qarz)} so'm
                  </Text>
                </View>
              </View>
            )}

            {/* Mijoz — qarz qolsa majburiy, boshqa hollarda ixtiyoriy */}
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
                {mijozShart && !customer && (
                  <Text style={[font.tiny, { color: colors.danger }]}>
                    {qarz === total ? 'Qarzga sotish uchun shart'
                      : `${money(qarz)} so'm qarz qoladi — mijoz shart`}
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
              <Text style={[font.numBig, { color: colors.text }]}>
                {money(total)} <Text style={[font.h3, { color: colors.textMuted }]}>so'm</Text>
              </Text>
            </View>

            <Button
              title="Savdoni saqlash"
              size="lg"
              icon="tasdiq"
              onPress={submit}
              loading={busy}
              disabled={total <= 0}
            />
          </View>
        )}
      </KeyboardAvoidingView>

      <ShtrixSkaner
        visible={skanerOchiq}
        onScan={skanQabul}
        onClose={() => setSkanerOchiq(false)}
        hint="Mahsulot shtrix-kodini ramka ichiga tuting"
      />

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
  list: {
    paddingHorizontal: spacing.lg, paddingTop: spacing.md,
    paddingBottom: spacing.xl, gap: spacing.sm,
  },
  search: {
    backgroundColor: colors.surface, borderRadius: radius.md,
    paddingHorizontal: spacing.md, height: 48, fontSize: 16,
    fontFamily: 'Inter_500Medium',
    color: colors.text, borderWidth: 1, borderColor: colors.border,
  },
  skanTugma: {
    width: 48, height: 48, borderRadius: radius.md,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1, borderColor: colors.border,
  },
  suggestions: {
    backgroundColor: colors.surface, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.borderSoft,
    overflow: 'hidden', ...elevation[2],
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
    borderWidth: 1, borderColor: colors.borderSoft,
    gap: 6, ...elevation[1],
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
  stepTxt: {
    fontSize: 20, fontFamily: 'Inter_600SemiBold',
    color: colors.text, lineHeight: 22,
  },
  qtyInput: {
    minWidth: 42, height: 36, paddingHorizontal: 2, paddingVertical: 0,
    textAlign: 'center', textAlignVertical: 'center',
    includeFontPadding: false,
    fontSize: 16, fontFamily: 'Inter_600SemiBold', color: colors.text,
  },
  /**
   * Jami maydoni — bu YOZILADIGAN input, oddiy matn emas.
   *
   * `...font.bodyBold` bilan birga `lineHeight: 21` ham kirib kelardi; Android'da
   * TextInput lineHeight + o'zining standart vertikal padding'i + `includeFontPadding`
   * bilan 34px'ga sig'may, raqamning tepasi va pasti qirqilib ko'rinardi ("10000"
   * o'rniga "IUUUU"). Shuning uchun shrift bu yerda qo'lda beriladi — lineHeight'siz,
   * qolgan ikkita input (miqdor va narx) bilan bir xil qoidada.
   */
  jamiInput: {
    minWidth: 104, height: 38,
    borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border,
    backgroundColor: colors.surfaceAlt,
    paddingHorizontal: spacing.sm, paddingVertical: 0,
    textAlign: 'right', textAlignVertical: 'center',
    includeFontPadding: false,
    fontFamily: family.semibold, fontSize: 15, letterSpacing: -0.1,
    fontVariant: ['tabular-nums'],
    color: colors.text,
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
  aralashPanel: {
    gap: spacing.sm,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  pulQator: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  pulInput: {
    minWidth: 120, textAlign: 'right',
    backgroundColor: colors.surface,
    borderRadius: radius.sm,
    borderWidth: 1, borderColor: colors.border,
    paddingHorizontal: spacing.sm, paddingVertical: 8,
    fontSize: 16, fontFamily: 'Inter_600SemiBold', color: colors.text,
  },
  tezTugma: {
    flex: 1, alignItems: 'center', paddingVertical: 8,
    backgroundColor: colors.surface, borderRadius: radius.sm,
    borderWidth: 1, borderColor: colors.border,
  },
  qoldiqQator: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.sm,
  },
  totalRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
});
