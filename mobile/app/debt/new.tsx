/**
 * QARZ QO'SHISH.
 *
 * Nega alohida ekran? Qarz ilgari faqat ikki yo'l bilan yozilardi: savdo
 * paytida (qarzga sotildi) yoki mijozning o'z sahifasidan. Ikkalasi ham
 * bitta-yarimta qarz uchun. Do'konchi esa eski QOG'OZ DAFTARINI ilovaga
 * ko'chirishi kerak — o'nlab yozuv, har biri boshqa odam, boshqa sana.
 * Mijozni qidirib topib, sahifasiga kirib, keyin qarz yozish — bu ish
 * uchun juda uzun yo'l.
 *
 * Shuning uchun bu ekranda forma yopilmaydi: "Yana" bosilsa mijoz va summa
 * tozalanadi, sana va muddat sozlamalari joyida qoladi (daftarda yozuvlar
 * ko'pincha yaqin sanalarda). Yuqorida nechta ko'chirilgani sanab boriladi.
 *
 * SANA. Daftardagi qarz bugun berilmagan, shuning uchun "qarz berilgan sana"
 * kiritiladi. Bu faqat tarix tartibi va muddat uchun — musbat qarz kunlik
 * tushum yoki foydaga umuman qo'shilmaydi.
 *
 * BIRINCHI QADAM — TANLOV. Ekran darhol formani ochmaydi, avval "mol
 * berdimmi yoki pulmi?" deb so'raydi. Nega? Bu sahifa faqat QARZLAR
 * ro'yxatiga yozadi: ombordan mahsulot kamaymaydi va foyda hisoblanmaydi.
 * Mol qarzga berilganda esa ikkalasi ham bo'lishi shart. Do'konchi buni
 * bilmasdan shu sahifadan yozsa, kunlik hisob jimgina noto'g'ri chiqadi —
 * savdo ko'rinmaydi, ombor haqiqatdan ko'p ko'rsatadi.
 *
 * Shuning uchun "Mol berdim" tanlansa Savdo ekraniga o'tkazamiz: u yerda
 * to'lov turi "qarz" bo'ladi va qarz o'zi avtomatik ochiladi.
 *
 * OFFLINE. Yozuv navbat (outbox) orqali ketadi: internet yo'q bo'lsa ham
 * daftarni ko'chirishda davom etish mumkin.
 */
import { useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { api } from '../../src/api/client';
import * as outbox from '../../src/lib/outbox';
import type { Debtor } from '../../src/api/types';
import { Button, Chip, Field, SectionTitle } from '../../src/components/ui';
import { ModalHeader } from '../../src/components/ScreenHeader';
import { CustomerPicker, type PickedCustomer } from '../../src/components/CustomerPicker';
import { PressScale } from '../../src/components/Press';
import { Icon } from '../../src/components/Icon';
import { useConfirm } from '../../src/components/Confirm';
import { useToast } from '../../src/components/Toast';
import { useKeyboardHeight } from '../../src/lib/keyboard';
import { sanaOqi, qoshKun } from '../../src/lib/sana';
import {
  colors, font, kunKaliti, money, radius, sanaMatni, spacing,
} from '../../src/theme';

/** Shu summadan yuqorisi tasdiq so'raydi — nol adashib qo'shilishi oson. */
const TASDIQ_CHEGARASI = 1_000_000;

/* -------------------------------- Ekran --------------------------------- */

type Muddat = 'yoq' | '7' | '14' | '30' | 'sana';

const MUDDATLAR: Array<{ key: Muddat; label: string }> = [
  { key: 'yoq',  label: 'Muddatsiz' },
  { key: '7',    label: '1 hafta' },
  { key: '14',   label: '2 hafta' },
  { key: '30',   label: '1 oy' },
  { key: 'sana', label: 'Sana…' },
];

export default function NewDebtScreen() {
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();
  const insets = useSafeAreaInsets();
  const kb = useKeyboardHeight();
  const amountRef = useRef<TextInput>(null);

  /** Tanlov qilinmaguncha forma ko'rsatilmaydi. */
  const [pulQarz, setPulQarz] = useState(false);
  const [customer, setCustomer] = useState<PickedCustomer | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');

  const [eskiSana, setEskiSana] = useState(false);   // "bugun emas" rejimi
  const [sanaMatn, setSanaMatn] = useState('');
  const [muddat, setMuddat] = useState<Muddat>('yoq');
  const [muddatMatn, setMuddatMatn] = useState('');

  const [saving, setSaving] = useState(false);
  const [soni, setSoni] = useState(0);               // nechta ko'chirildi

  /**
   * Mijozlarning hozirgi qarzi. Daftar ko'chirilayotganda eng oson xato —
   * bir qarzni ikki marta yozib yuborish. Tanlangan mijozning balansi
   * ko'rinib tursa, buni darhol payqash mumkin.
   */
  const [balans, setBalans] = useState<Record<string, number>>({});

  useEffect(() => {
    api<Debtor[]>('/debts?only_owing=1')
      .then((rows) => setBalans(
        Object.fromEntries(rows.map((r) => [r.customer_id, Number(r.balance)]))))
      .catch(() => {});
  }, []);

  const bugun = kunKaliti(new Date());
  const berilganSana = eskiSana ? sanaOqi(sanaMatn) : bugun;

  const muddatSanasi = (() => {
    if (muddat === 'yoq') return null;
    if (muddat === 'sana') return sanaOqi(muddatMatn);
    return qoshKun(berilganSana ?? bugun, Number(muddat));
  })();

  function tozala(hammasi: boolean) {
    setCustomer(null);
    setAmount('');
    setNote('');
    if (hammasi) {
      setEskiSana(false); setSanaMatn('');
      setMuddat('yoq'); setMuddatMatn('');
    }
  }

  async function save(andNext: boolean) {
    const summa = Number(amount) || 0;

    if (!customer) {
      toast.ogoh('Mijozni tanlang');
      setPickerOpen(true);
      return;
    }
    if (summa <= 0) {
      toast.ogoh('Summani kiriting');
      amountRef.current?.focus();
      return;
    }
    if (eskiSana && !berilganSana) {
      toast.ogoh("Sanani tushunmadim. Masalan: 15.08 yoki 15.08.2026");
      return;
    }
    if (berilganSana && berilganSana > bugun) {
      toast.ogoh("Qarz berilgan sana kelajakda bo'lishi mumkin emas");
      return;
    }
    if (muddat === 'sana' && !muddatSanasi) {
      toast.ogoh("To'lash muddatini tushunmadim. Masalan: 01.10");
      return;
    }

    const hozirgi = customer.id ? (balans[customer.id] ?? 0) : 0;

    if (summa >= TASDIQ_CHEGARASI) {
      const ok = await confirm({
        title: 'Qarzni tasdiqlang',
        icon: 'qarz',
        amount: summa,
        amountLabel: 'Qarz summasi',
        lines: [
          `Mijoz: ${customer.name}`,
          ...(hozirgi > 0 ? [`Hozirgi qarzi: ${money(hozirgi)} so'm`] : []),
          `Amaldan keyin: ${money(hozirgi + summa)} so'm`,
          ...(berilganSana !== bugun ? [`Berilgan sana: ${sanaMatni(berilganSana)}`] : []),
          ...(muddatSanasi ? [`To'lash muddati: ${sanaMatni(muddatSanasi)}`] : []),
        ],
        confirmText: 'Yozish',
      });
      if (!ok) return;
    }

    setSaving(true);
    try {
      const res = await outbox.enqueue('debt', {
        customer_id: customer.id,
        customer_name: customer.name,
        customer_phone: null,
        amount: summa,
        due_date: muddatSanasi,
        // Bugun bo'lsa yubormaymiz — server o'zi hozirgi vaqtni qo'yadi.
        created_at: berilganSana === bugun ? null : berilganSana,
        note: note.trim() || null,
      }, `Qarz — ${customer.name}, ${money(summa)} so'm`);

      if (res.error) throw new Error(res.error);

      if (customer.id) {
        setBalans((b) => ({ ...b, [customer.id!]: (b[customer.id!] ?? 0) + summa }));
      }
      setSoni((n) => n + 1);

      if (res.yuborildi) toast.ok(`${customer.name}: ${money(summa)} so'm qarz yozildi`);
      else toast.info("Navbatga qo'yildi — ulanish bo'lishi bilan yuboriladi");

      if (andNext) {
        tozala(false);
        setPickerOpen(true);   // keyingi yozuv — darhol mijoz tanlashdan
      } else {
        router.back();
      }
    } catch (e: any) {
      toast.xato(`Saqlab bo'lmadi: ${e.message}`);
    } finally {
      setSaving(false);
    }
  }

  const hozirgiQarz = customer?.id ? (balans[customer.id] ?? 0) : 0;

  if (!pulQarz) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
        <ModalHeader title="Qarz qo'shish" onClose={() => router.back()} />
        <View style={s.tanlov}>
          <Text style={[font.small, { color: colors.textMuted }]}>
            Qarz nimadan paydo bo'ldi?
          </Text>

          <PressScale
            accessibilityRole="button"
            accessibilityLabel="Mol berdim — savdo ekraniga o'tish"
            onPress={() => router.replace('/sale/new')}
            scale={0.99}
            style={s.yol}
          >
            <View style={[s.yolIkon, { backgroundColor: colors.primarySoft }]}>
              <Icon name="savat" size={20} color={colors.primary} />
            </View>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={[font.bodyBold, { color: colors.text }]}>Mol berdim</Text>
              <Text style={[font.tiny, { color: colors.textMuted }]}>
                Mahsulot qarzga berildi. Savdo ekranidan yoziladi: ombordan
                kamayadi, foyda kunlik hisobga tushadi, qarz o'zi ochiladi.
              </Text>
            </View>
            <Icon name="oldinga" size={16} color={colors.textMuted} />
          </PressScale>

          <PressScale
            accessibilityRole="button"
            accessibilityLabel="Pul qarz berdim yoki eski daftar"
            onPress={() => setPulQarz(true)}
            scale={0.99}
            style={s.yol}
          >
            <View style={[s.yolIkon, { backgroundColor: colors.warningSoft }]}>
              <Icon name="pul" size={20} color={colors.warning} />
            </View>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={[font.bodyBold, { color: colors.text }]}>
                Pul qarz berdim yoki eski daftar
              </Text>
              <Text style={[font.tiny, { color: colors.textMuted }]}>
                Mol chiqmagan. Faqat qarzlar ro'yxatiga yoziladi — kunlik
                tushum va foydaga kirmaydi.
              </Text>
            </View>
            <Icon name="oldinga" size={16} color={colors.textMuted} />
          </PressScale>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      <View style={{ flex: 1 }}>
        <ModalHeader
          title="Qarz qo'shish"
          onClose={() => router.back()}
          right={soni > 0 ? (
            <Text style={[font.small, { color: colors.success }]}>{soni} ta</Text>
          ) : undefined}
        />

        <ScrollView
          contentContainerStyle={s.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {soni === 0 && (
            <View style={s.izoh}>
              <Icon name="qarz" size={18} color={colors.primary} />
              <Text style={[font.small, { color: colors.textMuted, flex: 1 }]}>
                Eski daftardagi qarzlarni shu yerdan ko'chiring. Qarz bugungi
                tushum va foydaga qo'shilmaydi — faqat qarzlar ro'yxatiga tushadi.
              </Text>
            </View>
          )}

          <SectionTitle>Kim qarzdor?</SectionTitle>
          <PressScale
            accessibilityRole="button"
            accessibilityLabel="Mijozni tanlash"
            onPress={() => setPickerOpen(true)}
            scale={0.99}
            style={s.mijoz}
          >
            <View style={s.avatar}>
              <Icon
                name={customer ? 'foydalanuvchi' : 'qidiruv'}
                size={18}
                color={colors.primary}
              />
            </View>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={[font.bodyBold, { color: customer ? colors.text : colors.textFaint }]}>
                {customer ? customer.name : 'Mijozni tanlang yoki yangi qo\'shing'}
              </Text>
              {customer && hozirgiQarz > 0 && (
                <Text style={[font.tiny, { color: colors.danger }]}>
                  Hozirgi qarzi: {money(hozirgiQarz)} so'm
                </Text>
              )}
            </View>
            <Icon name="oldinga" size={16} color={colors.textMuted} />
          </PressScale>

          <Field
            label="Qarz summasi"
            placeholder="0"
            value={amount}
            onChangeText={setAmount}
            keyboardType="number-pad"
            suffix="so'm"
            inputRef={amountRef}
          />
          {Number(amount) > 0 && (
            <Text style={[font.tiny, { color: colors.textMuted, marginTop: -spacing.xs }]}>
              {money(Number(amount))} so'm
            </Text>
          )}

          <SectionTitle>Qachon berilgan?</SectionTitle>
          <View style={s.chiplar}>
            <Chip label="Bugun" active={!eskiSana} onPress={() => setEskiSana(false)} />
            <Chip label="Boshqa sana…" active={eskiSana} onPress={() => setEskiSana(true)} />
          </View>
          {eskiSana && (
            <>
              <Field
                label="Sana"
                hint="Kun.oy — masalan 15.08 yoki 1508. Yil yozilmasa joriy yil."
                placeholder="15.08"
                value={sanaMatn}
                onChangeText={setSanaMatn}
                keyboardType="numeric"
                autoFocus
              />
              {sanaMatn.trim() !== '' && (
                <Text style={[font.tiny, {
                  color: berilganSana ? colors.textMuted : colors.danger,
                  marginTop: -spacing.xs,
                }]}>
                  {berilganSana ? sanaMatni(berilganSana) : "Sanani tushunmadim"}
                </Text>
              )}
            </>
          )}

          <SectionTitle>Qachon to'laydi?</SectionTitle>
          <View style={s.chiplar}>
            {MUDDATLAR.map((m) => (
              <Chip
                key={m.key} label={m.label} active={muddat === m.key}
                onPress={() => setMuddat(m.key)}
              />
            ))}
          </View>
          {muddat === 'sana' ? (
            <Field
              label="To'lash muddati"
              placeholder="01.10"
              value={muddatMatn}
              onChangeText={setMuddatMatn}
              keyboardType="numeric"
            />
          ) : null}
          {muddatSanasi && (
            <Text style={[font.tiny, { color: colors.textMuted, marginTop: -spacing.xs }]}>
              Muddat: {sanaMatni(muddatSanasi)}
            </Text>
          )}

          <Field
            label="Izoh"
            hint="Ixtiyoriy — masalan: daftardan ko'chirildi"
            placeholder="masalan: eski daftar, 3-bet"
            value={note}
            onChangeText={setNote}
          />
        </ScrollView>

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

      <CustomerPicker
        visible={pickerOpen}
        value={customer}
        onPick={(c) => { setCustomer(c); if (c) setTimeout(() => amountRef.current?.focus(), 250); }}
        onClose={() => setPickerOpen(false)}
      />
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  scroll: { padding: spacing.lg, paddingTop: 0, gap: spacing.md },
  tanlov: { padding: spacing.lg, paddingTop: 0, gap: spacing.md },
  yol: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    backgroundColor: colors.surface, borderRadius: radius.lg,
    borderWidth: 1, borderColor: colors.borderSoft,
    padding: spacing.md,
  },
  yolIkon: {
    width: 40, height: 40, borderRadius: radius.md,
    alignItems: 'center', justifyContent: 'center',
  },
  izoh: {
    flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm,
    backgroundColor: colors.primarySoft, borderRadius: radius.md,
    padding: spacing.md,
  },
  mijoz: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    backgroundColor: colors.surface, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border,
    padding: spacing.md, minHeight: 60,
  },
  avatar: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: colors.primarySoft,
    alignItems: 'center', justifyContent: 'center',
  },
  chiplar: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  bar: {
    flexDirection: 'row', gap: spacing.sm,
    paddingHorizontal: spacing.lg, paddingTop: spacing.md,
    backgroundColor: colors.surface,
    borderTopWidth: 1, borderTopColor: colors.borderSoft,
  },
});
