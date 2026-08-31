/**
 * Yangi mahsulot qo'shish.
 * Rasmga olish → AI nom/birlik/kategoriyani to'ldiradi → narxni do'konchi kiritadi.
 * AI narxni taxmin qilmaydi: u bozor narxini bilmaydi.
 */
import { useRef, useState } from 'react';
import {
  ActivityIndicator, Alert, KeyboardAvoidingView, Platform, Pressable,
  ScrollView, StyleSheet, Text, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import { Image } from 'expo-image';
import { api, uploadPhoto } from '../../src/api/client';
import type { Unit, VisionResponse } from '../../src/api/types';
import { Badge, Button, Field } from '../../src/components/ui';
import { useConfirm } from '../../src/components/Confirm';
import { colors, font, money, radius, shadow, spacing } from '../../src/theme';
import { Icon } from '../../src/components/Icon';

const UNITS: Unit[] = ['dona', 'kg', 'gram', 'litr', 'metr', 'quti', 'pachka'];

export default function NewProductScreen() {
  const router = useRouter();
  const confirm = useConfirm();
  const cameraRef = useRef<CameraView>(null);
  const [permission, requestPermission] = useCameraPermissions();

  const [cameraOpen, setCameraOpen] = useState(false);
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [recognizing, setRecognizing] = useState(false);
  const [vision, setVision] = useState<VisionResponse | null>(null);
  const [saving, setSaving] = useState(false);

  const [name, setName] = useState('');
  const [unit, setUnit] = useState<Unit>('dona');
  const [category, setCategory] = useState('');
  const [costPrice, setCostPrice] = useState('');
  const [salePrice, setSalePrice] = useState('');
  const [stock, setStock] = useState('');
  const [minStock, setMinStock] = useState('');
  const [barcode, setBarcode] = useState('');

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
    setCameraOpen(false);
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

  async function openCamera() {
    if (!permission?.granted) {
      const r = await requestPermission();
      if (!r.granted) {
        Alert.alert('Ruxsat kerak', 'Kameraga ruxsat bermasangiz rasmga ololmaymiz.');
        return;
      }
    }
    setCameraOpen(true);
  }

  async function save() {
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
      confirmText: 'Qo\'shish',
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
      router.back();
    } catch (e: any) {
      Alert.alert('Saqlab bo\'lmadi', e.message);
    } finally {
      setSaving(false);
    }
  }

  /* ------------------------------ Kamera ------------------------------ */
  if (cameraOpen) {
    return (
      <View style={{ flex: 1, backgroundColor: '#000' }}>
        <CameraView ref={cameraRef} style={{ flex: 1 }} facing="back" mode="picture" />
        <SafeAreaView style={s.camControls} edges={['bottom']}>
          <Pressable onPress={() => setCameraOpen(false)} style={s.camCancel}>
            <Text style={{ color: '#fff', fontSize: 16 }}>Bekor</Text>
          </Pressable>
          <Pressable onPress={snap} style={s.shutter}>
            <View style={s.shutterInner} />
          </Pressable>
          <View style={{ width: 70 }} />
        </SafeAreaView>
      </View>
    );
  }

  /* ------------------------------- Forma ------------------------------- */
  const margin = (Number(salePrice) || 0) - (Number(costPrice) || 0);

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

        <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">
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
              <Button title="Rasmga olish" icon="kamera" onPress={openCamera} style={{ flex: 1 }} />
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
            value={name} onChangeText={setName} />

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
              onChangeText={setSalePrice} keyboardType="number-pad" style={{ flex: 1 }}
              hint={margin > 0 ? `Foyda: ${money(margin)} so'm` : undefined} />
          </View>

          <View style={{ flexDirection: 'row', gap: spacing.sm }}>
            <Field label="Boshlang'ich qoldiq" placeholder="0" value={stock}
              onChangeText={(v) => setStock(v.replace(',', '.'))}
              keyboardType="decimal-pad" style={{ flex: 1 }} />
            <Field label="Ogohlantirish chegarasi" placeholder="0" value={minStock}
              onChangeText={(v) => setMinStock(v.replace(',', '.'))}
              keyboardType="decimal-pad" style={{ flex: 1 }}
              hint="Shundan kam qolsa xabar beradi" />
          </View>

          <Field label="Kategoriya" placeholder="oziq-ovqat"
            value={category} onChangeText={setCategory} />
          <Field label="Shtrix-kod" placeholder="ixtiyoriy"
            value={barcode} onChangeText={setBarcode} keyboardType="number-pad" />

          <Button title="Saqlash" onPress={save} loading={saving}
            style={{ marginTop: spacing.md }} />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', padding: spacing.lg, gap: spacing.md },
  scroll: { padding: spacing.lg, paddingTop: 0, gap: spacing.md, paddingBottom: spacing.xxl },
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
