/**
 * YANGI CHIQIM.
 *
 * Chiqim savdodan ko'ra tez-tez va ketma-ket yoziladi (ertalab bozor,
 * transport, tushlik...), shuning uchun mahsulot qo'shish ekranidagi
 * "Saqlab, yana" naqshi bu yerda ham bor — forma yopilmaydi, faqat
 * summa va izoh tozalanadi.
 *
 * Kategoriya ro'yxati serverdan keladi va do'kon ilgari nima yozganiga
 * qarab saralanadi. Tayyor variantlar esa yangi do'kon uchun — bo'sh
 * ekranda nima yozishni bilmay qolmasin.
 */
import { useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { api } from '../../src/api/client';
import * as outbox from '../../src/lib/outbox';
import type { ExpenseCategory } from '../../src/api/types';
import { Button, Chip, Field, SectionTitle } from '../../src/components/ui';
import { ModalHeader } from '../../src/components/ScreenHeader';
import { useConfirm } from '../../src/components/Confirm';
import { useToast } from '../../src/components/Toast';
import { useKeyboardHeight } from '../../src/lib/keyboard';
import { colors, font, money, spacing } from '../../src/theme';

/** Yangi do'konda ro'yxat bo'sh bo'lmasin — eng keng tarqalgan chiqimlar. */
const TAYYOR = ['transport', 'ijara', 'oylik', 'kommunal', 'soliq', 'ta\'mir'];

/** Shu summadan yuqorisi tasdiq so'raydi — nol adashib qo'shilishi oson. */
const TASDIQ_CHEGARASI = 1_000_000;

export default function NewExpenseScreen() {
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();
  const insets = useSafeAreaInsets();
  const kb = useKeyboardHeight();
  const amountRef = useRef<TextInput>(null);

  const [kategoriyalar, setKategoriyalar] = useState<string[]>(TAYYOR);
  const [category, setCategory] = useState('transport');
  const [ozim, setOzim] = useState('');        // "Boshqa" tanlanganda
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api<ExpenseCategory[]>('/expenses/meta/categories')
      .then((rows) => {
        if (rows.length === 0) return;
        // Do'kon ishlatganlari birinchi, qolgan tayyor variantlar orqasidan.
        const ishlatilgan = rows.map((r) => r.name);
        const qolgan = TAYYOR.filter((t) => !ishlatilgan.includes(t));
        setKategoriyalar([...ishlatilgan, ...qolgan]);
        setCategory(ishlatilgan[0]);
      })
      .catch(() => {});
  }, []);

  /** Tanlangan kategoriya: chip yoki qo'lda yozilgani. */
  const yakuniyKategoriya = (category === '__ozim' ? ozim.trim() : category);

  async function save(andNext: boolean) {
    const summa = Number(amount) || 0;

    if (!yakuniyKategoriya) {
      toast.ogoh('Kategoriya nomini yozing');
      return;
    }
    if (summa <= 0) {
      toast.ogoh('Summani kiriting');
      amountRef.current?.focus();
      return;
    }

    if (summa >= TASDIQ_CHEGARASI) {
      const ok = await confirm({
        title: 'Chiqimni tasdiqlang',
        icon: 'chiqim-grafik',
        amount: summa,
        amountLabel: 'Chiqim',
        lines: [
          `Kategoriya: ${yakuniyKategoriya}`,
          ...(note.trim() ? [`Izoh: ${note.trim()}`] : []),
          'Kunlik foydadan ayiriladi',
        ],
        confirmText: 'Yozish',
      });
      if (!ok) return;
    }

    setSaving(true);
    try {
      // Navbat orqali: internet yo'q bo'lsa ham chiqim yo'qolmaydi,
      // qurilmada kutib turadi va ulanish tiklanganda yuboriladi.
      const res = await outbox.enqueue('expense', {
        category: yakuniyKategoriya,
        amount: summa,
        note: note.trim() || null,
      }, `Chiqim — ${money(summa)} so'm (${yakuniyKategoriya})`);

      if (res.error) throw new Error(res.error);

      if (res.yuborildi) toast.ok(`Chiqim yozildi: ${money(summa)} so'm`);
      else toast.info("Chiqim navbatga qo'yildi — ulanish bo'lishi bilan yuboriladi");

      if (andNext) {
        setAmount('');
        setNote('');
        amountRef.current?.focus();
      } else {
        router.back();
      }
    } catch (e: any) {
      toast.xato(`Saqlab bo'lmadi: ${e.message}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      <View style={{ flex: 1 }}>
        <ModalHeader title="Yangi chiqim" onClose={() => router.back()} />

        <ScrollView
          contentContainerStyle={s.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <SectionTitle>Nimaga ketdi?</SectionTitle>
          <View style={s.chiplar}>
            {kategoriyalar.map((k) => (
              <Chip
                key={k} label={k} active={category === k}
                onPress={() => setCategory(k)}
              />
            ))}
            <Chip
              label="Boshqa…" active={category === '__ozim'}
              onPress={() => setCategory('__ozim')}
            />
          </View>

          {category === '__ozim' && (
            <Field
              label="Kategoriya nomi"
              placeholder="masalan: qadoqlash"
              value={ozim}
              onChangeText={setOzim}
              autoFocus
            />
          )}

          <Field
            label="Summa"
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

          <Field
            label="Izoh"
            hint="Ixtiyoriy — keyin nima uchun ekanini eslash uchun"
            placeholder="masalan: bozorga borish"
            value={note}
            onChangeText={setNote}
          />
        </ScrollView>

        {/* Saqlash paneli — klaviatura chiqqanda uning ustiga ko'tariladi. */}
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
    padding: spacing.lg, paddingTop: 0, gap: spacing.md,
  },
  chiplar: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  bar: {
    flexDirection: 'row', gap: spacing.sm,
    paddingHorizontal: spacing.lg, paddingTop: spacing.md,
    backgroundColor: colors.surface,
    borderTopWidth: 1, borderTopColor: colors.borderSoft,
  },
});
