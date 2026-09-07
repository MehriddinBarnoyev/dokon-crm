/**
 * Mahsulotni tahrirlash.
 *
 * Xato kiritilgan nom, narx, birlik yoki kategoriyani to'g'rilash uchun.
 * Tasdiqlash oynasida FAQAT o'zgargan maydonlar ko'rsatiladi — do'konchi
 * nimani o'zgartirayotganini bir qarashda ko'radi.
 *
 * Ikki narsa ataylab bu yerda emas:
 *   • Qoldiq — u ombor jurnaliga yozilishi kerak, shuning uchun mahsulot
 *     sahifasidagi "Qoldiqni to'g'rilash" orqali boradi.
 *   • O'chirish — o'rniga arxivlash. Eski savdolar mahsulotga bog'liq,
 *     butunlay o'chirilsa hisobot buziladi.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  KeyboardAvoidingView, Platform, Pressable,
  ScrollView, StyleSheet, Text, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { api } from '../../../src/api/client';
import * as productStore from '../../../src/data/products';
import type { Product, ProductDefaults, Unit } from '../../../src/api/types';
import { Button, Field, Loading } from '../../../src/components/ui';
import { ModalHeader } from '../../../src/components/ScreenHeader';
import { useConfirm } from '../../../src/components/Confirm';
import { useToast } from '../../../src/components/Toast';
import { colors, font, money, qty, radius, spacing } from '../../../src/theme';
import { Icon } from '../../../src/components/Icon';

const UNITS: Unit[] = ['dona', 'kg', 'gram', 'litr', 'metr', 'quti', 'pachka'];

const BARCODE_TYPES = [
  'ean13', 'ean8', 'upc_a', 'upc_e', 'code128', 'code39', 'code93', 'itf14', 'codabar',
] as const;

/** Bo'sh matn bilan null ni bir xil ko'ramiz: ikkalasi ham "yo'q" degani. */
const same = (a: string, b: string | null) => a.trim() === (b ?? '').trim();

export default function EditProductScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const confirm = useConfirm();
  const toast = useToast();
  const [permission, requestPermission] = useCameraPermissions();

  const [p, setP] = useState<Product | null>(null);
  const [saving, setSaving] = useState(false);
  const [scanning, setScanning] = useState(false);
  const scanLock = useRef(false);

  const [name, setName] = useState('');
  const [unit, setUnit] = useState<Unit>('dona');
  const [costPrice, setCostPrice] = useState('');
  const [salePrice, setSalePrice] = useState('');
  const [minStock, setMinStock] = useState('');
  const [category, setCategory] = useState('');
  const [barcode, setBarcode] = useState('');

  const [categories, setCategories] = useState<string[]>([]);

  const load = useCallback(async () => {
    const res = await api<Product>(`/products/${id}`);
    setP(res);
    setName(res.name);
    setUnit(res.unit);
    // Nol — "kiritilmagan" degani. Maydonni "0" bilan to'ldirsak do'konchi
    // avval uni o'chirishi kerak bo'ladi; bo'sh qoldirgani qulayroq.
    setCostPrice(Number(res.cost_price) > 0 ? String(Number(res.cost_price)) : '');
    setSalePrice(Number(res.sale_price) > 0 ? String(Number(res.sale_price)) : '');
    setMinStock(String(Number(res.min_stock)));
    setCategory(res.category ?? '');
    setBarcode(res.barcode ?? '');
  }, [id]);

  useEffect(() => {
    load().catch((e: any) => {
      toast.xato(`Ochib bo'lmadi: ${e.message}`);
      router.back();
    });
    api<ProductDefaults>('/products/meta/defaults')
      .then((d) => setCategories(d.categories))
      .catch(() => { /* chipsiz ham tahrirlash ishlaydi */ });
  }, [load]);

  /* ------------------------------ Shtrix-kod ------------------------------ */

  async function openScanner() {
    if (!permission?.granted) {
      const r = await requestPermission();
      if (!r.granted) {
        toast.ogoh("Kameraga ruxsat bermasangiz skanerlab bo'lmaydi");
        return;
      }
    }
    scanLock.current = false;
    setScanning(true);
  }

  /** Bu kod boshqa mahsulotda ishlatilgan bo'lsa, saqlashdan oldin ogohlantiramiz. */
  async function barcodeConflict(): Promise<string | null> {
    const code = barcode.trim();
    if (!code || same(code, p?.barcode ?? null)) return null;
    try {
      const res = await api<{ product: Product | null }>(
        `/products/meta/barcode/${encodeURIComponent(code)}`);
      if (res.product && res.product.id !== id) {
        return `Bu shtrix-kod "${res.product.name}" da ham turibdi`;
      }
    } catch { /* tekshirib bo'lmasa saqlashga to'sqinlik qilmaymiz */ }
    return null;
  }

  /* ------------------------------- Saqlash ------------------------------- */

  async function save() {
    if (!p) return;
    if (!name.trim()) {
      toast.ogoh('Mahsulot nomini kiriting');
      return;
    }

    // Faqat haqiqatan o'zgargan maydonlarni yuboramiz.
    const patch: Record<string, unknown> = {};
    const lines: string[] = [];

    if (name.trim() !== p.name) {
      patch.name = name.trim();
      lines.push(`Nomi: ${p.name} → ${name.trim()}`);
    }
    if (unit !== p.unit) {
      patch.unit = unit;
      lines.push(`Birligi: ${p.unit} → ${unit}`);
    }
    const cost = Number(costPrice) || 0;
    if (cost !== Number(p.cost_price)) {
      patch.cost_price = cost;
      lines.push(`Tan narxi: ${money(p.cost_price)} → ${money(cost)} so'm`);
    }
    const sale = Number(salePrice) || 0;
    if (sale !== Number(p.sale_price)) {
      patch.sale_price = sale;
      lines.push(`Sotuv narxi: ${money(p.sale_price)} → ${money(sale)} so'm`);
    }
    const min = Number(minStock) || 0;
    if (min !== Number(p.min_stock)) {
      patch.min_stock = min;
      lines.push(`Chegara: ${qty(p.min_stock)} → ${qty(min)} ${unit}`);
    }
    if (!same(category, p.category)) {
      patch.category = category.trim() || null;
      lines.push(`Kategoriya: ${p.category ?? 'yo\'q'} → ${category.trim() || 'yo\'q'}`);
    }
    if (!same(barcode, p.barcode)) {
      patch.barcode = barcode.trim() || null;
      lines.push(`Shtrix-kod: ${p.barcode ?? 'yo\'q'} → ${barcode.trim() || 'yo\'q'}`);
    }

    if (lines.length === 0) {
      toast.info("Hech narsa o'zgartirilmadi");
      return;
    }

    const margin = sale - cost;
    const conflict = await barcodeConflict();

    const ok = await confirm({
      title: 'O\'zgarishlarni saqlash',
      icon: 'mahsulot',
      lines,
      warnings: [
        ...(conflict ? [conflict] : []),
        ...(sale <= 0 ? ['Sotuv narxi nol'] : []),
        ...(margin < 0 ? ['Sotuv narxi tan narxdan past — zarar bo\'ladi'] : []),
        ...(unit !== p.unit
          ? [`Qoldiq o'girilmaydi: ${qty(p.stock)} soni ${unit} bo'lib qoladi`]
          : []),
        ...(patch.cost_price !== undefined
          ? ['Yangi tan narx faqat keyingi savdolarga ta\'sir qiladi']
          : []),
      ],
      confirmText: 'Saqlash',
    });
    if (!ok) return;

    setSaving(true);
    try {
      await api(`/products/${id}`, { method: 'PATCH', body: patch });
      productStore.invalidate();
      router.back();
    } catch (e: any) {
      toast.xato(`Saqlab bo'lmadi: ${e.message}`);
    } finally {
      setSaving(false);
    }
  }

  /* ------------------------------ Arxivlash ------------------------------ */

  async function archive() {
    if (!p) return;
    const ok = await confirm({
      title: 'Mahsulotni arxivlash',
      icon: 'ogohlantirish',
      amount: Number(p.stock) * Number(p.cost_price),
      amountLabel: 'Ombordan chiqadigan qiymat',
      lines: [
        p.name,
        `Qoldiq: ${qty(p.stock)} ${p.unit}`,
        'Ro\'yxatdan va qidiruvdan yo\'qoladi',
        'Eski savdolar va hisobotlar joyida qoladi',
      ],
      warnings: Number(p.stock) > 0
        ? ['Ombordagi qoldiq nol emas — rostdan arxivlaysizmi?']
        : [],
      confirmText: 'Arxivlash',
      destructive: true,
    });
    if (!ok) return;

    setSaving(true);
    try {
      await api(`/products/${id}`, { method: 'PATCH', body: { is_active: false } });
      productStore.invalidate();
      // Orqada mahsulot sahifasi turibdi — u endi arxivlangan narsani
      // ko'rsatadi, shuning uchun to'g'ridan-to'g'ri ro'yxatga qaytamiz.
      router.dismissTo('/(tabs)/products');
    } catch (e: any) {
      toast.xato(`Arxivlab bo'lmadi: ${e.message}`);
      setSaving(false);
    }
  }

  /* -------------------------------- Skaner -------------------------------- */
  if (scanning) {
    return (
      <View style={{ flex: 1, backgroundColor: '#000' }}>
        <CameraView
          style={{ flex: 1 }}
          facing="back"
          barcodeScannerSettings={{ barcodeTypes: [...BARCODE_TYPES] }}
          onBarcodeScanned={(r) => {
            if (scanLock.current) return;
            scanLock.current = true;
            setBarcode(r.data.trim());
            setScanning(false);
          }}
        />
        <View style={s.scanOverlay} pointerEvents="none">
          <View style={s.scanFrame} />
          <Text style={s.scanHint}>Shtrix-kodni ramka ichiga tuting</Text>
        </View>
        <SafeAreaView style={s.camControls} edges={['bottom']}>
          <Pressable onPress={() => setScanning(false)} style={{ width: 70 }}>
            <Text style={{ color: '#fff', fontSize: 16 }}>Bekor</Text>
          </Pressable>
        </SafeAreaView>
      </View>
    );
  }

  if (!p) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}><Loading /></SafeAreaView>
    );
  }

  /* -------------------------------- Forma -------------------------------- */
  const margin = (Number(salePrice) || 0) - (Number(costPrice) || 0);
  // Bazadagi holat bo'yicha, kiritilayotgan matn bo'yicha emas — do'konchi
  // yozishni boshlashi bilan ogohlantirish yo'qolib qolmasin.
  const tanNarxYoq = Number(p.cost_price) <= 0;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ModalHeader title="Tahrirlash" onClose={() => router.back()} />

        <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">
          <Field label="Nomi" value={name} onChangeText={setName} />

          <View>
            <Text style={[font.small, { color: colors.textMuted, marginBottom: spacing.xs }]}>
              O'lchov birligi
            </Text>
            <View style={s.chips}>
              {UNITS.map((u) => (
                <Pressable key={u} onPress={() => setUnit(u)}
                  style={[s.chip, unit === u && s.chipOn]}>
                  <Text style={[font.small, { color: unit === u ? '#fff' : colors.textMuted }]}>
                    {u}
                  </Text>
                </Pressable>
              ))}
            </View>
            {unit !== p.unit && (
              <Text style={[font.tiny, { color: colors.warning, marginTop: spacing.xs }]}>
                Qoldiq o'girilmaydi: {qty(p.stock)} soni {unit} bo'lib qoladi
              </Text>
            )}
          </View>

          {/* Tan narx keyin ham kiritilishi mumkin — mahsulot allaqachon
              omborda, uni qayta yaratish shart emas. Lekin kiritilmaguncha
              shu mahsulotning har bir savdosi to'liq foyda bo'lib yoziladi,
              shuning uchun buni aytib turamiz. */}
          {tanNarxYoq && (
            <View style={s.tanNarxOgoh}>
              <Icon name="ogohlantirish" size={17} color={colors.danger} />
              <Text style={[font.small, { color: colors.danger, flex: 1 }]}>
                Tan narx kiritilmagan — savdolari to'liq foyda bo'lib hisoblanmoqda.
                Quyiga yozib qo'ysangiz keyingi savdolar to'g'ri hisoblanadi.
              </Text>
            </View>
          )}

          <View style={{ flexDirection: 'row', gap: spacing.sm }}>
            <Field label="Tan narxi" value={costPrice} onChangeText={setCostPrice}
              keyboardType="number-pad" style={{ flex: 1 }}
              placeholder="0" suffix="so'm"
              hint="qanchaga olib kelindi" />
            <Field label="Sotuv narxi" value={salePrice} onChangeText={setSalePrice}
              keyboardType="number-pad" style={{ flex: 1 }}
              placeholder="0" suffix="so'm"
              hint={margin > 0 ? `foyda ${money(margin)} so'm` : 'qanchaga sotiladi'} />
          </View>

          <Field label="Ogohlantirish chegarasi" value={minStock}
            onChangeText={(v) => setMinStock(v.replace(',', '.'))}
            keyboardType="decimal-pad" hint="Shundan kam qolsa xabar beradi" />

          <View>
            <Field label="Kategoriya" placeholder="yo'q"
              value={category} onChangeText={setCategory} />
            {categories.length > 0 && (
              <View style={[s.chips, { marginTop: spacing.sm }]}>
                {categories.map((c) => (
                  <Pressable key={c} onPress={() => setCategory(c === category ? '' : c)}
                    style={[s.chip, category === c && s.chipOn]}>
                    <Text style={[font.small, {
                      color: category === c ? '#fff' : colors.textMuted,
                    }]}>{c}</Text>
                  </Pressable>
                ))}
              </View>
            )}
          </View>

          <View style={{ flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-end' }}>
            <Field label="Shtrix-kod" placeholder="yo'q" style={{ flex: 1 }}
              value={barcode} onChangeText={setBarcode} keyboardType="number-pad" />
            <Pressable onPress={openScanner} style={s.scanBtn}>
              <Icon name="shtrix" size={22} color={colors.primary} />
            </Pressable>
          </View>

          {/* Qoldiq bu yerda o'zgartirilmaydi — sababi bilan tushuntiramiz. */}
          <View style={s.note}>
            <Icon name="tuzatish" size={16} color={colors.textMuted} />
            <Text style={[font.tiny, { color: colors.textMuted, flex: 1 }]}>
              Qoldiq ({qty(p.stock)} {p.unit}) bu yerda o'zgarmaydi — u ombor
              jurnaliga yozilishi kerak. Mahsulot sahifasidagi "Qoldiqni
              to'g'rilash" tugmasidan foydalaning.
            </Text>
          </View>

          <Button title="Saqlash" onPress={save} loading={saving}
            style={{ marginTop: spacing.md }} />
          <Button title="Arxivlash" variant="danger" icon="ogohlantirish"
            onPress={archive} disabled={saving} />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', padding: spacing.lg, gap: spacing.md },
  scroll: { padding: spacing.lg, paddingTop: 0, gap: spacing.md, paddingBottom: spacing.xxl },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: {
    paddingHorizontal: spacing.md, paddingVertical: 8,
    borderRadius: radius.pill, backgroundColor: colors.surfaceAlt,
  },
  chipOn: { backgroundColor: colors.primary },
  scanBtn: {
    width: 52, height: 52, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border,
    alignItems: 'center', justifyContent: 'center',
  },
  note: {
    flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start',
    backgroundColor: colors.surfaceAlt, borderRadius: radius.md, padding: spacing.md,
  },
  tanNarxOgoh: {
    flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start',
    backgroundColor: colors.dangerSoft,
    borderWidth: 1, borderColor: colors.dangerLine,
    borderRadius: radius.md, padding: spacing.md,
  },
  scanOverlay: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    alignItems: 'center', justifyContent: 'center', gap: spacing.lg,
  },
  scanFrame: {
    width: '78%', height: 170, borderRadius: radius.lg,
    borderWidth: 2, borderColor: 'rgba(255,255,255,0.9)',
  },
  scanHint: { color: '#fff', fontSize: 15 },
  camControls: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    paddingHorizontal: spacing.xl, paddingVertical: spacing.xl,
  },
});
