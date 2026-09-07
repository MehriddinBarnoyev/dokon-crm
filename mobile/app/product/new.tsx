/**
 * Yangi mahsulot qo'shish.
 *
 * ASOSIY QOIDA: do'konchidan faqat UCHTA narsa so'raladi —
 * nomi, sotuv narxi va qoldiq. Qolgani ixtiyoriy va yig'ib qo'yilgan.
 *
 * Ilgari forma o'ntala maydonni bir varaqda ko'rsatardi va saqlashdan oldin
 * yana tasdiqlash oynasi chiqardi. Bir partiyada 30 ta mahsulot kiritayotgan
 * odam uchun bu juda qimmat. Endi:
 *
 *   • Ekran ochilishi bilan kursor "Nomi" da — darrov yozish mumkin.
 *   • Tan narxi, kategoriya, chegara, shtrix-kod, rasm — "Qo'shimcha" ichida.
 *   • Saqlash tugmasi pastda doim ko'rinib turadi, varaqlash shart emas.
 *   • Tasdiqlash oynasi faqat XAVF bo'lganda chiqadi (narx yo'q, zarar, yoki
 *     katta boshlang'ich qoldiq). Oddiy holatda bir bosishda saqlanadi —
 *     mahsulotni keyin tahrirlash oson, savdodan farqli o'laroq.
 *   • Nom yozilayotganda bazadagi o'xshashi ko'rsatiladi — takror qo'shilmasin.
 *
 * Tezlashtiruvchi yo'llar saqlanib qoldi:
 *   • Shtrix-kod skaneri — kod bazada bo'lsa mavjud mahsulot ochiladi.
 *   • Rasm → AI nom/birlik/kategoriyani to'ldiradi (narxni emas — u bozor
 *     narxini bilmaydi).
 *   • Sotuv narxi tan narxdan avtomatik taklif qilinadi.
 *   • "Saqlab, yana" — ro'yxatga chiqib-kirmasdan keyingisini kiritish.
 */
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, Pressable,
  ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import { Image } from 'expo-image';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { api, uploadPhoto } from '../../src/api/client';
import * as productStore from '../../src/data/products';
import type { Product, ProductDefaults, Unit, VisionResponse } from '../../src/api/types';
import { Badge, Button, Field, IconButton } from '../../src/components/ui';
import { ModalHeader } from '../../src/components/ScreenHeader';
import { PressScale } from '../../src/components/Press';
import { useKeyboardHeight } from '../../src/lib/keyboard';
import { useConfirm } from '../../src/components/Confirm';
import { useToast } from '../../src/components/Toast';
import { colors, elevation, font, money, qty, radius, spacing } from '../../src/theme';
import { Icon } from '../../src/components/Icon';

const UNITS: Unit[] = ['dona', 'kg', 'gram', 'litr', 'metr', 'quti', 'pachka'];

/** Do'konda eng ko'p uchraydiganlari — qolgani "boshqa" ostida turadi. */
const KOP_ISHLATILADI: Unit[] = ['dona', 'kg', 'litr', 'quti'];

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

/**
 * Shundan katta boshlang'ich qoldiq tasdiqlashni talab qiladi.
 * Bir million so'mlik tovarni adashib kiritish — jiddiy xato, uni
 * hisobotdan qidirib topish qiyin.
 */
const TASDIQ_CHEGARASI = 1_000_000;

type CamMode = 'off' | 'photo' | 'barcode';

export default function NewProductScreen() {
  const router = useRouter();
  const confirm = useConfirm();
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const kb = useKeyboardHeight();
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

  /** Qo'shimcha maydonlar ochiqmi. */
  const [more, setMore] = useState(false);
  /** Kamdan-kam kerak bo'ladigan birliklar ko'rsatilsinmi. */
  const [allUnits, setAllUnits] = useState(false);
  /** Nomga o'xshash mavjud mahsulotlar — takror qo'shishning oldini oladi. */
  const [oxshash, setOxshash] = useState<Product[]>([]);
  /** Ro'yxat yopiq turadi: ochilishi maydonlarni pastga surib yuboradi. */
  const [oxshashOchiq, setOxshashOchiq] = useState(false);

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

  /**
   * Nom yozilayotganda bazadan o'xshashini qidiramiz.
   *
   * Takroriy mahsulot — do'kondagi eng ko'p uchraydigan xato: "Coca-Cola 1.5"
   * va "Coca cola 1,5 l" ikki xil qator bo'lib qoladi, qoldiq ikkiga bo'linadi.
   * Buni keyin tuzatishdan ko'ra, yozayotganda aytib qo'ygan arzon.
   */
  /** Katalog cache'dan — o'xshashlarni qidirish uchun. */
  const [katalog, setKatalog] = useState<Product[]>([]);
  useEffect(() => {
    let tirik = true;
    productStore.loadAndRefresh((y) => { if (tirik) setKatalog(y); })
      .then((d) => { if (tirik) setKatalog(d); })
      .catch(() => {});
    return () => { tirik = false; };
  }, []);

  // Qidiruv mahalliy — har harfda so'rov ketmaydi, kechikish ham kerak emas.
  useEffect(() => {
    const q = name.trim();
    if (q.length < 3) { setOxshash([]); return; }
    setOxshash(productStore.qidir(katalog, q, 3));
    setOxshashOchiq(false);
  }, [name, katalog]);

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
        // Ikki xil yo'l bor — qaysi biri kerakligini do'konchi hal qiladi
        const ochish = await confirm({
          title: 'Bu shtrix-kod bazada bor',
          icon: 'shtrix',
          lines: [
            p.name,
            `${money(p.sale_price)} so'm · qoldiq ${qty(p.stock)} ${p.unit}`,
            "Mavjudini ochsangiz — qoldiq va narxni o'sha yerda tahrirlaysiz",
          ],
          confirmText: 'Mavjudini ochish',
        });
        if (ochish) router.replace(`/product/${p.id}`);
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
      // AI kategoriya/shtrix-kodni to'ldirdi — do'konchi ko'rib turishi kerak
      if (res.kategoriya || res.shtrix_kod) setMore(true);
    } catch (e: any) {
      toast.xato(`Tanib bo'lmadi: ${e.message}. Ma'lumotlarni qo'lda kiriting.`);
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
        toast.ogoh("Kameraga ruxsat bermasangiz skanerlab bo'lmaydi");
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
    setOxshash([]);
    setOxshashOchiq(false);
    setSaleTouched(false);
    scrollRef.current?.scrollTo({ y: 0, animated: true });
    nameRef.current?.focus();
  }

  async function save(andNext: boolean) {
    if (!name.trim()) {
      toast.ogoh('Mahsulot nomini kiriting');
      nameRef.current?.focus();
      return;
    }

    const qoldiq = Number(stock) || 0;
    const tan = Number(costPrice) || 0;
    const sotuv = Number(salePrice) || 0;
    const qiymat = qoldiq * tan;

    const ogohlar = [
      ...(sotuv <= 0 ? ['Sotuv narxi kiritilmagan'] : []),
      // Tan narxsiz mahsulot hisobotni jimgina buzadi: foyda = sotuv − tan
      // bo'lgani uchun butun savdo foyda bo'lib ko'rinadi. Xato darrov
      // bilinmaydi — shuning uchun saqlashdan oldin aytamiz.
      ...(tan <= 0
        ? ["Tan narx kiritilmagan — bu mahsulotning HAR BIR savdosi to'liq foyda"
           + " bo'lib hisoblanadi. Keyin mahsulot sahifasidan kiritsa bo'ladi."]
        : []),
      ...(sotuv > 0 && tan > 0 && sotuv < tan
        ? ["Sotuv narxi tan narxdan past — zarar bo'ladi"] : []),
    ];

    /**
     * Tasdiqlash HAR DOIM emas, faqat kerak bo'lganda.
     * Mahsulotni keyin tahrirlash mumkin — savdodan farqli o'laroq bu yerda
     * xato qaytarib bo'lmaydigan emas. Shuning uchun oddiy holatda so'ramaymiz.
     */
    const xavfli = ogohlar.length > 0 || qiymat >= TASDIQ_CHEGARASI;
    if (xavfli) {
      const ok = await confirm({
        title: "Yangi mahsulot qo'shish",
        icon: 'mahsulot',
        // Boshlang'ich qoldiq — bu ombordagi haqiqiy pul
        amount: qiymat,
        amountLabel: "Boshlang'ich qoldiq qiymati (tan narxda)",
        lines: [
          `${name.trim()} · ${unit}`,
          `Tan narxi: ${money(tan)} so'm`,
          `Sotuv narxi: ${money(sotuv)} so'm`
          + (sotuv - tan > 0 ? ` (foyda ${money(sotuv - tan)})` : ''),
          `Boshlang'ich qoldiq: ${qty(qoldiq)} ${unit}`,
          ...(category.trim() ? [`Kategoriya: ${category.trim()}`] : []),
        ],
        warnings: ogohlar,
        confirmText: andNext ? "Qo'shib, davom etish" : "Qo'shish",
      });
      if (!ok) return;
    }

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
          cost_price: tan,
          sale_price: sotuv,
          stock: qoldiq,
          min_stock: Number(minStock) || 0,
          category: category.trim() || null,
          barcode: barcode.trim() || null,
          photo_url: photoUrl,
        },
      });

      // Yangi mahsulot cache'da yo'q — keyingi sync uni darhol olib kelsin.
      // "Saqlab, yana" holatida bu ayniqsa muhim: keyingi mahsulotning
      // o'xshashlari ro'yxatida hozir qo'shilgani ham ko'rinishi kerak.
      productStore.invalidate();
      await productStore.sync(true).then(setKatalog).catch(() => {});

      if (andNext) {
        setLastSaved(name.trim());
        resetForNext();
      } else {
        toast.ok(`${name.trim()} omborga qo'shildi`);
        router.back();
      }
    } catch (e: any) {
      toast.xato(`Saqlab bo'lmadi: ${e.message}`);
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
  const korinadiganUnits = allUnits ? UNITS : KOP_ISHLATILADI;

  /** "Qo'shimcha" yopiq turganda ichida nima borligini bir qatorda aytamiz. */
  const qoshimchaTavsif = [
    category.trim() || null,
    barcode.trim() ? 'shtrix-kod' : null,
    photoUri ? 'rasm' : null,
  ].filter(Boolean).join(' · ');

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      <View style={{ flex: 1 }}>
        <ModalHeader
          title="Yangi mahsulot"
          onClose={() => router.back()}
          right={
            <IconButton
              name="shtrix" label="Shtrix-kodni skanerlash"
              tone="soft" size={22}
              onPress={() => openCamera('barcode')}
            />
          }
        />

        <ScrollView
          ref={scrollRef}
          contentContainerStyle={s.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Oldingi mahsulot saqlangani haqida qisqa xabar */}
          {lastSaved && (
            <Animated.View entering={FadeIn.duration(200)} style={s.saved}>
              <Icon name="tasdiq" size={16} color={colors.success} />
              <Text style={[font.smallBold, { color: colors.success, flex: 1 }]}>
                {lastSaved} qo'shildi
              </Text>
            </Animated.View>
          )}

          {/* ---------- Asosiy: nom ---------- */}
          <Field
            label="NOMI"
            placeholder="Masalan: Guruch Lazer 1kg"
            inputRef={nameRef}
            value={name}
            onChangeText={setName}
            autoFocus
            returnKeyType="next"
          />

          {/*
            Bazada shunga o'xshash bormi — takror qo'shishning oldini oladi.

            Ro'yxat YOPIQ holda, bitta qator bo'lib chiqadi: ochiq chiqsa
            yozayotgan odamning barmog'i ostidagi maydonlar pastga suriladi va
            u kerakmagan narsani bosib yuboradi.
          */}
          {oxshash.length > 0 && (
            <Animated.View entering={FadeIn.duration(160)} style={s.oxshash}>
              <PressScale
                accessibilityRole="button"
                accessibilityState={{ expanded: oxshashOchiq }}
                accessibilityLabel={`Bazada ${oxshash.length} ta o'xshash mahsulot bor`}
                onPress={() => setOxshashOchiq(!oxshashOchiq)}
                scale={0.99}
                style={s.oxshashHead}
              >
                <Icon name="ogohlantirish" size={15} color={colors.warning} />
                <Text style={[font.tiny, { color: colors.warning, flex: 1 }]}>
                  Bazada {oxshash.length} ta o'xshashi bor — takror qo'shmang
                </Text>
                <Text style={[font.tiny, { color: colors.warning }]}>
                  {oxshashOchiq ? 'yashirish' : "ko'rish"}
                </Text>
              </PressScale>

              {oxshashOchiq && oxshash.map((p) => (
                <PressScale
                  key={p.id}
                  accessibilityRole="button"
                  accessibilityLabel={`${p.name} ni ochish`}
                  // `push`: do'konchi ko'rib, orqaga qaytsa forma joyida turadi
                  onPress={() => router.push(`/product/${p.id}`)}
                  scale={0.98}
                  style={s.oxshashRow}
                >
                  <Text style={[font.small, { color: colors.text, flex: 1 }]} numberOfLines={1}>
                    {p.name}
                  </Text>
                  <Text style={[font.tiny, { color: colors.textMuted }]}>
                    {qty(p.stock)} {p.unit}
                  </Text>
                  <Icon name="oldinga" size={14} color={colors.textFaint} />
                </PressScale>
              ))}
            </Animated.View>
          )}

          {/* ---------- Asosiy: narx va qoldiq ----------
              TAN NARXI avval "Qo'shimcha" ichida yopiq turardi. Natijasi
              og'ir edi: do'konchi uni ko'rmay mahsulot qo'shar, tan narx 0
              bo'lib qolar, keyin har bir savdo "butunlay foyda" bo'lib
              hisoblanardi (foyda = sotuv − tan narx). Endi u sotuv narxidan
              OLDIN va ochiq turadi — sotuv narxi ham shundan taklif qilinadi. */}
          <View style={{ flexDirection: 'row', gap: spacing.sm }}>
            <Field
              label="TAN NARXI"
              placeholder="0"
              value={costPrice}
              onChangeText={setCostPrice}
              keyboardType="number-pad"
              suffix="so'm"
              style={{ flex: 1 }}
              hint={Number(costPrice) > 0 ? 'qanchaga olib kelindi' : 'ixtiyoriy — keyin ham kiritsa bo\u2019ladi'}
            />
            <Field
              label="SOTUV NARXI"
              placeholder="0"
              value={salePrice}
              onChangeText={(v) => { setSaleTouched(true); setSalePrice(v); }}
              keyboardType="number-pad"
              suffix="so'm"
              style={{ flex: 1 }}
              hint={!saleTouched && Number(salePrice) > 0
                ? `tan narxdan +${markupPct}%`
                : 'qanchaga sotiladi'}
            />
          </View>

          {/* Foyda faqat tan narx bor bo'lsa ko'rsatiladi — butun sotuv
              narxini "foyda" deb ko'rsatish do'konchini chalg'itadi. */}
          {Number(costPrice) > 0 && Number(salePrice) > 0 && (
            <View style={[s.foydaQator, margin <= 0 && s.foydaQatorZarar]}>
              <Icon
                name={margin > 0 ? 'hisobot' : 'ogohlantirish'}
                size={15}
                color={margin > 0 ? colors.success : colors.danger}
              />
              <Text style={[font.small, {
                color: margin > 0 ? colors.success : colors.danger, flex: 1,
              }]}>
                {margin > 0
                  ? `1 ${unit} dan foyda: ${money(margin)} so'm`
                  : `Sotuv narxi tan narxdan past — har ${unit} da ${money(-margin)} so'm zarar`}
              </Text>
            </View>
          )}

          <View style={{ gap: 6 }}>
            <Text style={[font.label, { color: colors.textMuted }]}>QOLDIQ</Text>
            <View style={{ flexDirection: 'row', gap: spacing.sm }}>
              <Field
                placeholder="0"
                value={stock}
                onChangeText={(v) => setStock(v.replace(',', '.'))}
                keyboardType="decimal-pad"
                style={{ flex: 1 }}
                suffix={unit}
              />
            </View>
            {/* Birlik — qoldiq bilan bir joyda: "necha dona" degan savol bitta */}
            <View style={s.units}>
              {korinadiganUnits.map((u) => (
                <PressScale
                  key={u}
                  accessibilityRole="button"
                  accessibilityState={{ selected: unit === u }}
                  accessibilityLabel={u}
                  onPress={() => setUnit(u)}
                  scale={0.94}
                  style={[s.unitChip, unit === u && s.unitChipOn]}
                >
                  <Text style={[font.smallBold, {
                    color: unit === u ? colors.onPrimary : colors.textMuted,
                  }]}>{u}</Text>
                </PressScale>
              ))}
              {!allUnits && (
                <PressScale
                  accessibilityRole="button"
                  accessibilityLabel="Boshqa o'lchov birliklari"
                  onPress={() => setAllUnits(true)}
                  scale={0.94}
                  style={s.unitChip}
                >
                  <Text style={[font.smallBold, { color: colors.primary }]}>boshqa…</Text>
                </PressScale>
              )}
            </View>
          </View>

          {/* ---------- Qo'shimcha ---------- */}
          <PressScale
            accessibilityRole="button"
            accessibilityState={{ expanded: more }}
            accessibilityLabel="Qo'shimcha maydonlar"
            onPress={() => setMore(!more)}
            scale={0.99}
            style={s.moreHead}
          >
            <Icon name={more ? 'yopish' : 'qoshish'} size={16} color={colors.primary} />
            <View style={{ flex: 1 }}>
              <Text style={[font.bodyBold, { color: colors.primary }]}>
                Qo'shimcha
              </Text>
              {!more && qoshimchaTavsif ? (
                <Text style={[font.tiny, { color: colors.textMuted }]} numberOfLines={1}>
                  {qoshimchaTavsif}
                </Text>
              ) : !more ? (
                <Text style={[font.tiny, { color: colors.textFaint }]}>
                  kategoriya, shtrix-kod, rasm
                </Text>
              ) : null}
            </View>
          </PressScale>

          {more && (
            <Animated.View entering={FadeInDown.duration(200)} style={{ gap: spacing.md }}>
              <View>
                <Field
                  label="KATEGORIYA"
                  placeholder="oziq-ovqat"
                  value={category}
                  onChangeText={setCategory}
                />
                {defaults.categories.length > 0 && (
                  <View style={[s.units, { marginTop: spacing.sm }]}>
                    {defaults.categories.map((c) => (
                      <PressScale
                        key={c}
                        accessibilityRole="button"
                        accessibilityState={{ selected: category === c }}
                        accessibilityLabel={c}
                        onPress={() => setCategory(c === category ? '' : c)}
                        scale={0.94}
                        style={[s.unitChip, category === c && s.unitChipOn]}
                      >
                        <Text style={[font.smallBold, {
                          color: category === c ? colors.onPrimary : colors.textMuted,
                        }]}>{c}</Text>
                      </PressScale>
                    ))}
                  </View>
                )}
              </View>

              <Field
                label="OGOHLANTIRISH CHEGARASI"
                placeholder="0"
                value={minStock}
                onChangeText={(v) => { setMinTouched(true); setMinStock(v.replace(',', '.')); }}
                keyboardType="decimal-pad"
                suffix={unit}
                hint="Shundan kam qolsa bosh sahifada ogohlantiradi"
              />

              <View style={{ flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-end' }}>
                <Field
                  label="SHTRIX-KOD" placeholder="ixtiyoriy" style={{ flex: 1 }}
                  value={barcode} onChangeText={setBarcode} keyboardType="number-pad"
                />
                <IconButton
                  name="shtrix" label="Shtrix-kodni skanerlash"
                  tone="soft" size={22}
                  style={{ minWidth: 50, minHeight: 50 }}
                  onPress={() => openCamera('barcode')}
                />
              </View>

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
                  <Pressable
                    onPress={() => { setPhotoUri(null); setVision(null); }}
                    style={s.photoClear}
                  >
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
                          • {m.name} — {money(m.sale_price)} so'm, qoldiq {qty(m.stock)} {m.unit}
                        </Text>
                      ))}
                    </View>
                  )}
                </View>
              )}
            </Animated.View>
          )}
        </ScrollView>

        {/* Saqlash paneli — doim ko'rinib turadi, varaqlash shart emas.
            Klaviatura chiqqanda uning ustiga ko'tariladi. */}
        <View style={[s.bar, {
          marginBottom: kb,
          paddingBottom: kb > 0 ? spacing.md : spacing.md + insets.bottom,
        }]}>
          <Button
            title="Saqlash" size="lg" style={{ flex: 3 }}
            onPress={() => save(false)} loading={saving}
          />
          <Button
            title="Yana" icon="qoshish" variant="soft" size="lg" style={{ flex: 1 }}
            onPress={() => save(true)} disabled={saving}
          />
        </View>
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  scroll: {
    paddingHorizontal: spacing.lg, paddingTop: spacing.lg,
    gap: spacing.md, paddingBottom: spacing.xl,
  },
  saved: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    backgroundColor: colors.successSoft, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.successLine,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
  },
  /* Tan narx va sotuv narxi kiritilgach — bittasidan chiqadigan foyda */
  foydaQator: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    backgroundColor: colors.successSoft, borderRadius: radius.sm,
    borderWidth: 1, borderColor: colors.successLine,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
  },
  foydaQatorZarar: {
    backgroundColor: colors.dangerSoft, borderColor: colors.dangerLine,
  },
  oxshash: {
    backgroundColor: colors.warningSoft, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.warningLine,
    padding: spacing.sm, gap: spacing.sm,
  },
  oxshashHead: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    paddingHorizontal: spacing.xs, paddingVertical: spacing.xs,
  },
  oxshashRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    backgroundColor: colors.surface, borderRadius: radius.sm,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
  },
  moreHead: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    backgroundColor: colors.primarySoft, borderRadius: radius.md,
    paddingHorizontal: spacing.md, paddingVertical: spacing.md,
  },
  bar: {
    flexDirection: 'row', gap: spacing.sm,
    paddingHorizontal: spacing.lg, paddingTop: spacing.md,
    backgroundColor: colors.surface,
    borderTopWidth: 1, borderTopColor: colors.border,
    ...elevation[3],
  },
  photoWrap: {
    height: 200, borderRadius: radius.lg, overflow: 'hidden',
    borderWidth: 1, borderColor: colors.borderSoft, ...elevation[1],
  },
  photo: { width: '100%', height: '100%' },
  photoOverlay: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center', justifyContent: 'center',
  },
  photoClear: {
    position: 'absolute', top: spacing.sm, right: spacing.sm,
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center', justifyContent: 'center',
  },
  aiBox: {
    backgroundColor: colors.accentSoft,
    borderRadius: radius.lg, padding: spacing.md, gap: spacing.xs,
    borderWidth: 1, borderColor: colors.accentLine,
  },
  existing: {
    marginTop: spacing.sm, padding: spacing.sm,
    backgroundColor: colors.warningSoft, borderRadius: radius.sm, gap: 2,
  },
  units: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  unitChip: {
    paddingHorizontal: spacing.md, paddingVertical: 9,
    borderRadius: radius.pill, backgroundColor: colors.surfaceAlt,
    borderWidth: 1, borderColor: colors.borderSoft,
  },
  unitChipOn: { backgroundColor: colors.primary, borderColor: colors.primary },
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
