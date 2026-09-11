/**
 * TEZ MAHSULOT QO'SHISH
 * ======================
 * Savdo yoki kirim yozilayotganda katalogda yo'q mahsulot chiqsa,
 * ekrandan CHIQMASDAN qo'shish uchun.
 *
 * MUAMMO. Ilgari do'konchi savatni tashlab Omborga o'tishi, to'liq
 * mahsulot formasini to'ldirishi, so'ng savdoga qaytib butun savatni
 * QAYTADAN yig'ishi kerak edi — savat oddiy `useState` da turardi va
 * ekran yopilishi bilan yo'qolardi. Kassada navbat turganda bu juda
 * qimmat: bir mahsulot uchun butun savdo boshdan boshlanardi.
 *
 * YECHIM `CustomerPicker` dagi bilan bir xil: ro'yxatda yo'q nom
 * yozilsa, shu yerning o'zida qo'shiladi va darhol savatga tushadi.
 *
 * FAQAT ZARURINI SO'RAYMIZ. To'liq formada kategoriya, min. qoldiq,
 * rasm, shtrix-kod ham bor — kassada ularning hech biri kerak emas va
 * har biri navbatni uzaytiradi. Qolganini keyin Ombordan to'ldirish
 * mumkin.
 *
 * TAN NARX ATAYLAB SO'RALADI. Usiz foyda butunlay noto'g'ri chiqadi:
 * ilova bunday mahsulotning har savdosini to'liq foyda deb hisoblaydi.
 * Ombor ekrani buni alohida qizil ogohlantirish bilan ko'rsatadi —
 * demak muammo ilovada allaqachon tan olingan, uni shu yerda,
 * boshidayoq oldini olamiz. Majburiy emas: "hozir bilmayman" ham
 * haqiqiy holat, uni to'sib qo'yish savdoni to'xtatardi.
 *
 * OFLAYN ISHLAYDI. `id` ni MIJOZ beradi va mahsulot navbat orqali
 * yuboriladi. Shuning uchun internetsiz ham mahsulot darhol savatga
 * tushadi va savdo unga ishora qila oladi — navbat tartibli, mahsulot
 * savdodan oldin yuboriladi.
 */
import { useEffect, useState } from 'react';
import {
  Keyboard, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';
import * as Crypto from 'expo-crypto';
import type { Product, Unit } from '../api/types';
import * as productStore from '../data/products';
import * as outbox from '../lib/outbox';
import { Button } from './ui';
import { Icon } from './Icon';
import { useToast } from './Toast';
import { colors, font, money, radius, spacing } from '../theme';

const BIRLIKLAR: Unit[] = ['dona', 'kg', 'litr', 'gram', 'metr', 'quti', 'pachka'];

export function YangiMahsulot({ visible, nom, onQoshildi, onClose }: {
  visible: boolean;
  /** Qidiruvga yozilgan matn — nom shundan boshlanadi. */
  nom: string;
  /** Mahsulot yaratildi: chaqiruvchi uni darhol savatga soladi. */
  onQoshildi: (p: Product) => void;
  onClose: () => void;
}) {
  const toast = useToast();
  const [ism, setIsm] = useState('');
  const [sotuv, setSotuv] = useState('');
  const [tan, setTan] = useState('');
  const [birlik, setBirlik] = useState<Unit>('dona');
  const [saqlanyapti, setSaqlanyapti] = useState(false);
  /**
   * Klaviatura balandligi. Modal ichida Android oynani o'zi qisqartirmaydi
   * (edge-to-edge rejimida adjustResize ishlamaydi) — `CustomerPicker` da
   * ham shu muammo bor edi, yechimi ham o'sha.
   */
  const [kbBalandlik, setKbBalandlik] = useState(0);

  useEffect(() => {
    const ochildi = Keyboard.addListener('keyboardDidShow',
      (e) => setKbBalandlik(e.endCoordinates.height));
    const yopildi = Keyboard.addListener('keyboardDidHide',
      () => setKbBalandlik(0));
    return () => { ochildi.remove(); yopildi.remove(); };
  }, []);

  useEffect(() => {
    if (!visible) { setKbBalandlik(0); return; }
    setIsm(nom.trim());
    setSotuv('');
    setTan('');
    setBirlik('dona');
  }, [visible, nom]);

  const sotuvSumma = Number(sotuv) || 0;
  const tanSumma = Number(tan) || 0;
  const foyda = sotuvSumma - tanSumma;
  // Tan narx sotuvdan baland — deyarli har doim maydonlarni adashtirish.
  const teskari = tanSumma > 0 && sotuvSumma > 0 && tanSumma > sotuvSumma;

  async function saqla() {
    const ismToza = ism.trim();
    if (ismToza.length < 2) { toast.ogoh('Mahsulot nomini yozing'); return; }
    if (sotuvSumma <= 0) { toast.ogoh('Sotuv narxini kiriting'); return; }

    setSaqlanyapti(true);
    try {
      const id = Crypto.randomUUID();
      const p: Product = {
        id,
        name: ismToza,
        barcode: null,
        unit: birlik,
        cost_price: tanSumma,
        sale_price: sotuvSumma,
        // Qoldiq NOL. Savdo yozilgach u minusga tushadi va bu to'g'ri:
        // mol qayerdandir kelgan, lekin kirim yozilmagan. Minus qoldiq —
        // "buni Tovar olishdan yozish kerak" degan ko'rinadigan belgi.
        stock: 0,
        min_stock: 0,
        photo_url: null,
        category: null,
      };

      // Keshga DARHOL — qidiruv, savat va Ombor ekrani uni shu zahoti
      // ko'rsin, server javobini kutmasin.
      await productStore.upsert(p);

      const res = await outbox.enqueue('create_product', {
        id,
        name: ismToza,
        unit: birlik,
        cost_price: tanSumma,
        sale_price: sotuvSumma,
        stock: 0,
        category: null,
        barcode: null,
        photo_url: null,
      }, `Yangi mahsulot — ${ismToza}`);

      if (res.error) throw new Error(res.error);

      onQoshildi(p);
      if (!res.yuborildi) {
        toast.info("Mahsulot navbatga qo'yildi — savdoni davom ettiravering");
      }
      onClose();
    } catch (e: any) {
      toast.xato(`Qo'shib bo'lmadi: ${e.message}`);
    } finally {
      setSaqlanyapti(false);
    }
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={s.backdrop} onPress={onClose}>
        <Pressable
          style={[s.sheet, kbBalandlik > 0 && {
            paddingBottom: kbBalandlik + spacing.md,
            maxHeight: '100%',
          }]}
          onPress={() => {}}
        >
          <View style={s.head}>
            <Text style={[font.h3, { color: colors.text, flex: 1 }]}>Yangi mahsulot</Text>
            <Pressable onPress={onClose} hitSlop={10}>
              <Icon name="yopish" size={22} color={colors.textMuted} />
            </Pressable>
          </View>

          <ScrollView keyboardShouldPersistTaps="handled" style={{ flexShrink: 1 }}>
            <Text style={s.yorliq}>Nomi</Text>
            <TextInput
              style={s.input}
              value={ism}
              onChangeText={setIsm}
              placeholder="Masalan: kichkina dumaloq pechenye"
              placeholderTextColor={colors.textFaint}
              autoFocus
            />

            <Text style={s.yorliq}>Birlik</Text>
            <View style={s.birliklar}>
              {BIRLIKLAR.map((b) => (
                <Pressable
                  key={b}
                  onPress={() => setBirlik(b)}
                  style={[s.birlik, birlik === b && s.birlikOn]}
                  accessibilityRole="button"
                  accessibilityLabel={`Birlik: ${b}`}
                >
                  <Text style={[font.small, {
                    color: birlik === b ? '#fff' : colors.textMuted,
                  }]}>{b}</Text>
                </Pressable>
              ))}
            </View>

            <View style={{ flexDirection: 'row', gap: spacing.md }}>
              <View style={{ flex: 1 }}>
                <Text style={s.yorliq}>Sotuv narxi</Text>
                <TextInput
                  style={[s.input, teskari && { borderColor: colors.danger }]}
                  value={sotuv}
                  onChangeText={(v) => setSotuv(v.replace(/[^0-9.]/g, ''))}
                  keyboardType="number-pad"
                  placeholder="0"
                  placeholderTextColor={colors.textFaint}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.yorliq}>Tan narx</Text>
                <TextInput
                  style={[s.input, teskari && { borderColor: colors.danger }]}
                  value={tan}
                  onChangeText={(v) => setTan(v.replace(/[^0-9.]/g, ''))}
                  keyboardType="number-pad"
                  placeholder="0"
                  placeholderTextColor={colors.textFaint}
                />
              </View>
            </View>

            {teskari ? (
              <Text style={[font.tiny, { color: colors.danger, marginTop: spacing.xs }]}>
                Tan narx sotuvdan baland — maydonlar adashib ketmadimi?
              </Text>
            ) : tanSumma > 0 ? (
              <Text style={[font.tiny, { color: colors.success, marginTop: spacing.xs }]}>
                Har savdodan {money(foyda)} so'm foyda
              </Text>
            ) : (
              /* Tan narxsiz mahsulot hisobotni JIMGINA buzadi: foyda
                 sotuvdan tan narxni ayirib topiladi, tan narx 0 bo'lsa
                 butun savdo foyda bo'lib chiqadi. */
              <Text style={[font.tiny, { color: colors.warning, marginTop: spacing.xs }]}>
                Tan narxsiz — bu mahsulotning har savdosi to'liq foyda
                bo'lib hisoblanadi. Keyin Ombordan to'g'rilash mumkin.
              </Text>
            )}

            <Text style={[font.tiny, { color: colors.textFaint, marginTop: spacing.sm }]}>
              Qoldiq 0 bo'lib qo'shiladi. Mol qancha kelganini "Tovar olish"
              dan yozsangiz, qoldiq ham, tan narx ham o'z-o'zidan to'g'rilanadi.
            </Text>
          </ScrollView>

          <Button
            title="Qo'shish va savatga solish"
            size="lg"
            icon="qoshish"
            onPress={saqla}
            loading={saqlanyapti}
            disabled={ism.trim().length < 2 || sotuvSumma <= 0}
          />
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: '#0006', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl,
    padding: spacing.lg,
    gap: spacing.sm,
    maxHeight: '85%',
  },
  head: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.xs },
  yorliq: {
    ...font.tiny, color: colors.textMuted,
    marginTop: spacing.sm, marginBottom: 4,
  },
  input: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border,
    paddingHorizontal: spacing.md, paddingVertical: 12,
    fontSize: 16, fontFamily: 'Inter_500Medium', color: colors.text,
  },
  birliklar: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  birlik: {
    paddingHorizontal: spacing.md, paddingVertical: 8,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1, borderColor: colors.border,
  },
  birlikOn: { backgroundColor: colors.primary, borderColor: colors.primary },
});
