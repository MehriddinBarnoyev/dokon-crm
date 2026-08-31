/**
 * Yangi mahsulot qo'shish.
 *
 * Tezlik uchun qilingan narsalar:
 *   • Shtrix-kod skanerlanadi — 13 ta raqamni qo'lda terish shart emas.
 *     Skanerlangan kod bazada bo'lsa, yangi mahsulot yaratmay o'shanisi ochiladi.
 *   • Sotuv narxi tan narxdan avtomatik taklif qilinadi (do'konning odatdagi
 *     ustamasi bo'yicha). Do'konchi ustidan yozsa — taklif to'xtaydi.
 *   • Ogohlantirish chegarasi birlikka qarab o'zi to'ladi.
 *   • Kategoriya tayyor chiplardan tanlanadi.
 *   • "Saqlab, yana qo'shish" — partiya kelganda ro'yxatga chiqib-kirish yo'q.
 *
 * Rasm ixtiyoriy: AI nom/birlik/kategoriyani to'ldiradi, ammo narxni
 * taxmin qilmaydi — u bozor narxini bilmaydi.
 */
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, Alert, KeyboardAvoidingView, Platform, Pressable,
  ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import { Image } from 'expo-image';
import { api, uploadPhoto } from '../../src/api/client';
import type { Product, ProductDefaults, Unit, VisionResponse } from '../../src/api/types';
import { Badge, Button, Field } from '../../src/components/ui';
import { useConfirm } from '../../src/components/Confirm';
import { colors, font, money, radius, shadow, spacing } from '../../src/theme';
import { Icon } from '../../src/components/Icon';

const UNITS: Unit[] = ['dona', 'kg', 'gram', 'litr', 'metr', 'quti', 'pachka'];

/**
 * Ogohlantirish chegarasi uchun boshlang'ich qiymat.
 * Donalab sotiladigan narsa tezroq tugaydi, kilolik mahsulot esa zaxirada
 * kamroq turadi — shuning uchun birlik bo'yicha ajratilgan.
 */
const MIN_STOCK_DEFAULT: Record<Unit, number> = {
  dona: 5, quti: 3, pachka: 5, kg: 3, litr: 3, metr: 5, gram: 500,
};

/** Skaner qabul qiladigan kodlar — do'konda uchraydiganlari. */
const BARCODE_TYPES = [
  'ean13', 'ean8', 'upc_a', 'upc_e', 'code128', 'code39', 'code93', 'itf14', 'codabar',
] as const;

type CamMode = 'off' | 'photo' | 'barcode';

export default function NewProductScreen() {
  const router = useRouter();
  const confirm = useConfirm();
  const cameraRef = useRef<CameraView>(null);
  const scrollRef = useRef<ScrollView>(null);
  const nameRef = useRef<TextInput>(null);
  const [permission, requestPermission] = useCameraPermissions();

  const [camMode, setCamMode] = useState<CamMode>('off');
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [recognizing, setRecognizing] = useState(false);
  const [vision, setVision] = useState<VisionResponse | null>(null);
  const [saving, setSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [unit, setUnit] = useState<Unit>('dona');
  const [category, setCategory] = useState('');
  const [costPrice, setCostPrice] = useState('');
  const [salePrice, setSalePrice] = useState('');
  const [stock, setStock] = useState('');
  const [minStock, setMinStock] = useState('');
  const [barcode, setBarcode] = useState('');

  /**
   * Do'konchi o'zi tekkan maydonni ustidan yozmaymiz. Avtomatik taklif
   * faqat bo'sh yoki taklif qilingan qiymat turgan joyda ishlaydi.
   */
  const [saleTouched, setSaleTouched] = useState(false);
  const [minTouched, setMinTouched] = useState(false);

  const [defaults, setDefaults] = useState<ProductDefaults>({ markup: 0.25, categories: [] });

  /** Bir kodni ikki marta o'qib yubormaslik uchun (kamera tez skanerlaydi). */
  const scanLock = useRef(false);

  useEffect(() => {
    api<ProductDefaults>('/products/meta/defaults')
      .then(setDefaults)
      .catch(() => { /* tayyor qiymatsiz ham forma ishlaydi */ });
  }, []);

  /* --------------------- Avtomatik to'ldiriladigan maydonlar -------------------- */

  /** Tan narxidan sotuv narxi taklifi. Do'konchi tegmagan bo'lsa yoziladi. */
  useEffect(() => {
    if (saleTouched) return;
    const cost = Number(costPrice);
    if (!cost || cost <= 0) { setSalePrice(''); return; }
    // Chiroyli raqamga yaxlitlaymiz — do'konda 12 437 so'm degan narx bo'lmaydi.
    // Yuqoriga: pastga yaxlitlash foydaning bir qismini yeb qo'yadi.
    // Qadam narxga qarab: 300 so'mlik mahsulotni 500 ga yaxlitlash bo'lmaydi.
    const step = cost >= 10000 ? 500 : cost >= 1000 ? 100 : 10;
    const suggested = Math.ceil((cost * (1 + defaults.markup)) / step) * step;
    setSalePrice(String(Math.max(suggested, cost)));
  }, [costPrice, defaults.markup, saleTouched]);

  /** Birlik almashsa chegara ham o'zgaradi — do'konchi tegmagan bo'lsa. */
  useEffect(() => {
    if (minTouched) return;
    setMinStock(String(MIN_STOCK_DEFAULT[unit]));
  }, [unit, minTouched]);

  /* ------------------------------ Shtrix-kod ------------------------------ */

  /**
   * Skanerlangan kod bazada bormi? Bo'lsa — yangi yaratish o'rniga mavjudini
   * ochishni taklif qilamiz. Bu takroriy mahsulotning oldini oladi.
   */
  async function afterScan(code: string) {
    setBarcode(code);
    try {
      const res = await api<{ product: Product | null }>(
        `/products/meta/barcode/${encodeURIComponent(code)}`);
      if (res.product) {
        const p = res.product;
        Alert.alert(
          'Bu mahsulot bazada bor',
          `${p.name}\n${money(p.sale_price)} so'm · qoldiq ${p.stock} ${p.unit}`,
          [
            { text: 'Baribir yangi qo\'shish', style: 'cancel' },
            { text: 'Ochish', onPress: () => router.replace(`/product/${p.id}`) },
          ],
        );
      }
    } catch {
      // Tekshiruv ishlamasa ham kod formaga yozildi — davom etaveradi.
    }
  }

  /* -------------------------------- Rasm -------------------------------- */

  /** Rasmni AI ga yuborib, maydonlarni to'ldiradi. */
  async function recognize(base64: string, uri: string) {
    setPhotoUri(uri);
    setRecognizing(true);
    try {
      const res = await api<VisionResponse>('/ai/vision', {
        method: 'POST', body: { image_base64: base64, ext: 'jpg' }, timeoutMs: 90000,
      });
      setVision(res);
      setName(res.nom);
      setUnit(res.birlik);
      setCategory(res.kategoriya);
      if (res.shtrix_kod) setBarcode(res.shtrix_kod);
    } catch (e: any) {
      Alert.alert('Tanib bo\'lmadi', `${e.message}\n\nMa'lumotlarni qo'lda kiriting.`);
    } finally {
      setRecognizing(false);
    }
  }

  async function snap() {
    const photo = await cameraRef.current?.takePictureAsync({ base64: true, quality: 0.6 });
    setCamMode('off');
    if (photo?.base64 && photo.uri) await recognize(photo.base64, photo.uri);
  }

  async function pickFromGallery() {
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'], quality: 0.6, base64: true,
    });
    if (!res.canceled && res.assets[0]?.base64) {
      await recognize(res.assets[0].base64, res.assets[0].uri);
    }
  }

  async function openCamera(mode: 'photo' | 'barcode') {
    if (!permission?.granted) {
      const r = await requestPermission();
      if (!r.granted) {
        Alert.alert('Ruxsat kerak', 'Kameraga ruxsat bermasangiz skanerlab bo\'lmaydi.');
        return;
      }
    }
    scanLock.current = false;
    setCamMode(mode);
  }

  /* ------------------------------- Saqlash ------------------------------- */

  /**
   * Formani keyingi mahsulotga tayyorlaydi.
   * Birlik, kategoriya va chegara qoladi: bir partiyadagi mahsulotlar
   * odatda bir xil bo'ladi, ularni qayta tanlash ortiqcha ish.
   */
  function resetForNext() {
    setName('');
    setCostPrice('');
    setSalePrice('');
    setStock('');
    setBarcode('');
    setPhotoUri(null);
    setVision(null);
    setSaleTouched(false);
    scrollRef.current?.scrollTo({ y: 0, animated: true });
    nameRef.current?.focus();
  }

  async function save(andNext: boolean) {
    if (!name.trim()) {
      Alert.alert('Nom kerak', 'Mahsulot nomini kiriting.');
      return;
    }
    const qoldiq = Number(stock) || 0;
    const tan = Number(costPrice) || 0;
    const ok = await confirm({
      title: 'Yangi mahsulot qo\'shish',
      icon: 'mahsulot',
      // Boshlang'ich qoldiq — bu ombordagi haqiqiy pul
      amount: qoldiq * tan,
      amountLabel: "Boshlang'ich qoldiq qiymati (tan narxda)",
      lines: [
        `${name.trim()} · ${unit}`,
        `Tan narxi: ${money(tan)} so'm`,
        `Sotuv narxi: ${money(Number(salePrice) || 0)} so'm`
        + (margin > 0 ? ` (foyda ${money(margin)})` : ''),
        `Boshlang'ich qoldiq: ${qoldiq} ${unit}`,
        ...(category.trim() ? [`Kategoriya: ${category.trim()}`] : []),
      ],
      warnings: [
        ...(Number(salePrice) <= 0 ? ['Sotuv narxi kiritilmagan'] : []),
        ...(margin < 0 ? ['Sotuv narxi tan narxdan past — zarar bo\'ladi'] : []),
      ],
      confirmText: andNext ? 'Qo\'shib, davom etish' : 'Qo\'shish',
    });
    if (!ok) return;

    setSaving(true);
    try {
      let photoUrl: string | null = null;
      if (photoUri) {
        try { photoUrl = await uploadPhoto(photoUri); }
        catch { /* rasm yuklanmasa ham mahsulot saqlansin */ }
      }

      await api('/products', {
        method: 'POST',
        body: {
          name: name.trim(),
          unit,
          cost_price: Number(costPrice) || 0,
          sale_price: Number(salePrice) || 0,
          stock: Number(stock) || 0,
          min_stock: Number(minStock) || 0,
          category: category.trim() || null,
          barcode: barcode.trim() || null,
          photo_url: photoUrl,
        },
      });

      if (andNext) {
        setLastSaved(name.trim());
        resetForNext();
      } else {
        router.back();
      }
    } catch (e: any) {
      Alert.alert('Saqlab bo\'lmadi', e.message);
    } finally {
      setSaving(false);
    }
  }

  /* ------------------------------ Kamera ------------------------------ */
  if (camMode !== 'off') {
    const scanning = camMode === 'barcode';
    return (
      <View style={{ flex: 1, backgroundColor: '#000' }}>
        <CameraView
          ref={cameraRef}
          style={{ flex: 1 }}
          facing="back"
          mode="picture"
          barcodeScannerSettings={scanning ? { barcodeTypes: [...BARCODE_TYPES] } : undefined}
          onBarcodeScanned={scanning ? (r) => {
            if (scanLock.current) return;
            scanLock.current = true;
            setCamMode('off');
            afterScan(r.data.trim());
          } : undefined}
        />

        {scanning && (
          <View style={s.scanOverlay} pointerEvents="none">
            <View style={s.scanFrame} />
            <Text style={s.scanHint}>Shtrix-kodni ramka ichiga tuting</Text>
          </View>
        )}

        <SafeAreaView style={s.camControls} edges={['bottom']}>
          <Pressable onPress={() => setCamMode('off')} style={s.camCancel}>
            <Text style={{ color: '#fff', fontSize: 16 }}>Bekor</Text>
          </Pressable>
          {scanning ? <View style={{ width: 72 }} /> : (
            <Pressable onPress={snap} style={s.shutter}>
              <View style={s.shutterInner} />
            </Pressable>
          )}
          <View style={{ width: 70 }} />
        </SafeAreaView>
      </View>
    );
  }

  /* ------------------------------- Forma ------------------------------- */
  const margin = (Number(salePrice) || 0) - (Number(costPrice) || 0);
  const markupPct = Math.round(defaults.markup * 100);

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
            Yangi mahsulot
          </Text>
          <View style={{ width: 44 }} />
        </View>

        <ScrollView ref={scrollRef} contentContainerStyle={s.scroll}
          keyboardShouldPersistTaps="handled">

          {/* Oldingi mahsulot saqlangani haqida qisqa xabar */}
          {lastSaved && (
            <View style={s.saved}>
              <Icon name="mahsulot" size={16} color={colors.success} />
              <Text style={[font.small, { color: colors.success, flex: 1 }]}>
                {lastSaved} qo'shildi
              </Text>
            </View>
          )}

          {/* Eng tez yo'l — skaner */}
          <Button title="Shtrix-kodni skanerlash" icon="shtrix"
            onPress={() => openCamera('barcode')} />

          {/* Rasm */}
          {photoUri ? (
            <View style={s.photoWrap}>
              <Image source={{ uri: photoUri }} style={s.photo} contentFit="cover" />
              {recognizing && (
                <View style={s.photoOverlay}>
                  <ActivityIndicator color="#fff" />
                  <Text style={{ color: '#fff', marginTop: spacing.sm }}>Tanilmoqda…</Text>
                </View>
              )}
              <Pressable onPress={() => { setPhotoUri(null); setVision(null); }}
                style={s.photoClear}>
                <Icon name="yopish" size={17} color="#fff" />
              </Pressable>
            </View>
          ) : (
            <View style={{ flexDirection: 'row', gap: spacing.sm }}>
              <Button title="Rasmga olish" icon="kamera" variant="secondary"
                onPress={() => openCamera('photo')} style={{ flex: 1 }} />
              <Button title="Galereya" icon="galereya" variant="secondary"
                onPress={pickFromGallery} style={{ flex: 1 }} />
            </View>
          )}

          {/* AI natijasi */}
          {vision && (
            <View style={s.aiBox}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                <Icon name="ai" size={17} color={colors.accent} />
                <Text style={[font.bodyBold, { color: colors.text, flex: 1 }]}>
                  AI to'ldirdi
                </Text>
                <Badge
                  text={`${Math.round(vision.ishonch * 100)}% ishonch`}
                  tone={vision.ishonch > 0.7 ? 'success' : 'warning'}
                />
              </View>
              {vision.izoh ? (
                <Text style={[font.small, { color: colors.textMuted }]}>{vision.izoh}</Text>
              ) : null}
              <Text style={[font.tiny, { color: colors.textFaint }]}>
                Narxlarni o'zingiz kiriting — AI bozor narxini bilmaydi.
              </Text>

              {vision.mavjud.length > 0 && (
                <View style={s.existing}>
                  <Text style={[font.tiny, { color: colors.warning }]}>
                    Bazada o'xshashi bor:
                  </Text>
                  {vision.mavjud.map((m) => (
                    <Text key={m.id} style={[font.small, { color: colors.text }]}>
                      • {m.name} — {money(m.sale_price)} so'm, qoldiq {m.stock} {m.unit}
                    </Text>
                  ))}
                </View>
              )}
            </View>
          )}

          <Field label="Nomi" placeholder="Masalan: Guruch Lazer 1kg"
            inputRef={nameRef} value={name} onChangeText={setName} />

          <View>
            <Text style={[font.small, { color: colors.textMuted, marginBottom: spacing.xs }]}>
              O'lchov birligi
            </Text>
            <View style={s.units}>
              {UNITS.map((u) => (
                <Pressable key={u} onPress={() => setUnit(u)}
                  style={[s.unitChip, unit === u && s.unitChipOn]}>
                  <Text style={[font.small, { color: unit === u ? '#fff' : colors.textMuted }]}>
                    {u}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>

          <View style={{ flexDirection: 'row', gap: spacing.sm }}>
            <Field label="Tan narxi" placeholder="0" value={costPrice}
              onChangeText={setCostPrice} keyboardType="number-pad" style={{ flex: 1 }} />
            <Field label="Sotuv narxi" placeholder="0" value={salePrice}
              onChangeText={(v) => { setSaleTouched(true); setSalePrice(v); }}
              keyboardType="number-pad" style={{ flex: 1 }}
              hint={!saleTouched && Number(salePrice) > 0
                ? `Taklif: +${markupPct}%`
                : margin > 0 ? `Foyda: ${money(margin)} so'm` : undefined} />
          </View>

          <View style={{ flexDirection: 'row', gap: spacing.sm }}>
            <Field label="Boshlang'ich qoldiq" placeholder="0" value={stock}
              onChangeText={(v) => setStock(v.replace(',', '.'))}
              keyboardType="decimal-pad" style={{ flex: 1 }} />
            <Field label="Ogohlantirish chegarasi" placeholder="0" value={minStock}
              onChangeText={(v) => { setMinTouched(true); setMinStock(v.replace(',', '.')); }}
              keyboardType="decimal-pad" style={{ flex: 1 }}
              hint="Shundan kam qolsa xabar beradi" />
          </View>

          <View>
            <Field label="Kategoriya" placeholder="oziq-ovqat"
              value={category} onChangeText={setCategory} />
            {defaults.categories.length > 0 && (
              <View style={[s.units, { marginTop: spacing.sm }]}>
                {defaults.categories.map((c) => (
                  <Pressable key={c} onPress={() => setCategory(c === category ? '' : c)}
                    style={[s.unitChip, category === c && s.unitChipOn]}>
                    <Text style={[font.small, {
                      color: category === c ? '#fff' : colors.textMuted,
                    }]}>{c}</Text>
                  </Pressable>
                ))}
              </View>
            )}
          </View>

          <View style={{ flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-end' }}>
            <Field label="Shtrix-kod" placeholder="ixtiyoriy" style={{ flex: 1 }}
              value={barcode} onChangeText={setBarcode} keyboardType="number-pad" />
            <Pressable onPress={() => openCamera('barcode')} style={s.scanBtn}>
              <Icon name="shtrix" size={22} color={colors.primary} />
            </Pressable>
          </View>

          <Button title="Saqlash" onPress={() => save(false)} loading={saving}
            style={{ marginTop: spacing.md }} />
          <Button title="Saqlab, yana qo'shish" variant="ghost" icon="qoshish"
            onPress={() => save(true)} disabled={saving} />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', padding: spacing.lg, gap: spacing.md },
  scroll: { padding: spacing.lg, paddingTop: 0, gap: spacing.md, paddingBottom: spacing.xxl },
  saved: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    backgroundColor: colors.successSoft, borderRadius: radius.sm,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
  },
  photoWrap: { height: 200, borderRadius: radius.lg, overflow: 'hidden', ...shadow },
  photo: { width: '100%', height: '100%' },
  photoOverlay: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center', justifyContent: 'center',
  },
  photoClear: {
    position: 'absolute', top: spacing.sm, right: spacing.sm,
    width: 30, height: 30, borderRadius: 15,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center', justifyContent: 'center',
  },
  aiBox: {
    backgroundColor: colors.accentSoft,
    borderRadius: radius.lg, padding: spacing.md, gap: spacing.xs,
  },
  existing: {
    marginTop: spacing.sm, padding: spacing.sm,
    backgroundColor: colors.warningSoft, borderRadius: radius.sm, gap: 2,
  },
  units: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  unitChip: {
    paddingHorizontal: spacing.md, paddingVertical: 8,
    borderRadius: radius.pill, backgroundColor: colors.surfaceAlt,
  },
  unitChipOn: { backgroundColor: colors.primary },
  scanBtn: {
    width: 52, height: 52, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border,
    alignItems: 'center', justifyContent: 'center',
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
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: spacing.xl, paddingVertical: spacing.xl,
  },
  camCancel: { width: 70 },
  shutter: {
    width: 72, height: 72, borderRadius: 36,
    borderWidth: 4, borderColor: '#fff',
    alignItems: 'center', justifyContent: 'center',
  },
  shutterInner: {
    width: 56, height: 56, borderRadius: 28, backgroundColor: '#fff',
  },
});
