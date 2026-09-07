/**
 * CHIQIMNI TAHRIRLASH va O'CHIRISH.
 *
 * Mahsulot tahrirlash ekranidagi naqsh: faqat haqiqatan o'zgargan
 * maydonlar PATCH bilan yuboriladi va tasdiq oynasida "eski → yangi"
 * ko'rinishida ko'rsatiladi. Pul yozuvida bu ayniqsa muhim — do'konchi
 * nimani o'zgartirayotganini aniq ko'rsin.
 *
 * O'chirish serverda YUMSHOQ (deleted_at) va faqat do'kon egasiga
 * ruxsat etilgan, shuning uchun sotuvchida tugma umuman ko'rinmaydi.
 */
import { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { api } from '../../src/api/client';
import * as outbox from '../../src/lib/outbox';
import { useAuth } from '../../src/api/auth';
import type { Expense, ExpenseCategory } from '../../src/api/types';
import { Button, Chip, Field, Loading, SectionTitle } from '../../src/components/ui';
import { ModalHeader } from '../../src/components/ScreenHeader';
import { useConfirm } from '../../src/components/Confirm';
import { useToast } from '../../src/components/Toast';
import { colors, dateLabel, font, money, spacing } from '../../src/theme';

const TAYYOR = ['transport', 'ijara', 'oylik', 'kommunal', 'soliq', 'ta\'mir'];

export default function EditExpenseScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();
  const { user } = useAuth();

  const [e, setE] = useState<Expense | null>(null);
  const [kategoriyalar, setKategoriyalar] = useState<string[]>(TAYYOR);
  const [category, setCategory] = useState('');
  const [ozim, setOzim] = useState('');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const row = await api<Expense>(`/expenses/${id}`);
    setE(row);
    setCategory(row.category);
    setAmount(String(Number(row.amount)));
    setNote(row.note ?? '');
  }, [id]);

  useEffect(() => {
    load().catch((err: any) => {
      toast.xato(err.message);
      router.back();
    });
    api<ExpenseCategory[]>('/expenses/meta/categories')
      .then((rows) => {
        const ishlatilgan = rows.map((r) => r.name);
        const qolgan = TAYYOR.filter((t) => !ishlatilgan.includes(t));
        setKategoriyalar([...ishlatilgan, ...qolgan]);
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const yakuniyKategoriya = (category === '__ozim' ? ozim.trim() : category);

  async function save() {
    if (!e) return;

    if (!yakuniyKategoriya) {
      toast.ogoh('Kategoriya nomini yozing');
      return;
    }
    const summa = Number(amount) || 0;
    if (summa <= 0) {
      toast.ogoh('Summani kiriting');
      return;
    }

    // Faqat haqiqatan o'zgargan maydonlar.
    const patch: Record<string, unknown> = {};
    const lines: string[] = [];

    if (yakuniyKategoriya !== e.category) {
      patch.category = yakuniyKategoriya;
      lines.push(`Kategoriya: ${e.category} → ${yakuniyKategoriya}`);
    }
    if (summa !== Number(e.amount)) {
      patch.amount = summa;
      lines.push(`Summa: ${money(e.amount)} → ${money(summa)} so'm`);
    }
    const yangiIzoh = note.trim() || null;
    if (yangiIzoh !== (e.note ?? null)) {
      patch.note = yangiIzoh;
      lines.push(`Izoh: ${e.note ?? 'yo\'q'} → ${yangiIzoh ?? 'yo\'q'}`);
    }

    if (lines.length === 0) {
      toast.info("Hech narsa o'zgartirilmadi");
      return;
    }

    const ok = await confirm({
      title: 'Chiqimni o\'zgartirish',
      icon: 'tahrir',
      amount: summa,
      amountLabel: 'Yangi summa',
      lines,
      warnings: summa !== Number(e.amount)
        ? ['Kunlik foyda va hisobotlar qayta hisoblanadi']
        : [],
      confirmText: 'Saqlash',
    });
    if (!ok) return;

    setSaving(true);
    try {
      const res = await outbox.enqueue('expense_update', { id, ...patch },
        `Chiqim tahriri — ${money(summa)} so'm`);
      if (res.error) throw new Error(res.error);

      if (res.yuborildi) toast.ok('Chiqim yangilandi');
      else toast.info("O'zgarish navbatga qo'yildi — ulanganda yuboriladi");
      router.back();
    } catch (err: any) {
      toast.xato(`Saqlab bo'lmadi: ${err.message}`);
      setSaving(false);
    }
  }

  async function remove() {
    if (!e) return;
    const ok = await confirm({
      title: 'Chiqimni o\'chirish',
      icon: 'ogohlantirish',
      amount: Number(e.amount),
      amountLabel: 'O\'chiriladigan chiqim',
      lines: [
        `Kategoriya: ${e.category}`,
        ...(e.note ? [`Izoh: ${e.note}`] : []),
        `Yozilgan: ${dateLabel(e.created_at)}`,
        'Kunlik foyda shu summaga ortadi',
      ],
      warnings: ['Bu amalni ortga qaytarib bo\'lmaydi'],
      confirmText: 'O\'chirish',
      destructive: true,
    });
    if (!ok) return;

    setSaving(true);
    try {
      const res = await outbox.enqueue('expense_delete', { id },
        `Chiqim o'chirish — ${money(e.amount)} so'm`);
      if (res.error) throw new Error(res.error);

      if (res.yuborildi) toast.ok('Chiqim o\'chirildi');
      else toast.info("O'chirish navbatga qo'yildi — ulanganda yuboriladi");
      router.back();
    } catch (err: any) {
      toast.xato(`O'chirib bo'lmadi: ${err.message}`);
      setSaving(false);
    }
  }

  if (!e) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
        <Loading />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      <ModalHeader title="Chiqimni tahrirlash" onClose={() => router.back()} />

      <ScrollView
        contentContainerStyle={s.scroll}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <Text style={[font.tiny, { color: colors.textMuted }]}>
          {dateLabel(e.created_at)}
          {e.user_name ? ` · ${e.user_name}` : ''}
          {e.source === 'ai' ? ' · AI yozgan' : ''}
        </Text>

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
          value={amount}
          onChangeText={setAmount}
          keyboardType="number-pad"
          suffix="so'm"
        />

        <Field
          label="Izoh"
          placeholder="masalan: bozorga borish"
          value={note}
          onChangeText={setNote}
        />

        <Button title="Saqlash" size="lg" onPress={save} loading={saving} />

        {/* O'chirish serverda faqat egaga ruxsat etilgan — sotuvchiga
            ishlamaydigan tugma ko'rsatishning ma'nosi yo'q. */}
        {user?.role === 'owner' && (
          <Button
            title="O'chirish" variant="danger" size="lg"
            onPress={remove} disabled={saving}
          />
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  scroll: { padding: spacing.lg, paddingTop: 0, gap: spacing.md },
  chiplar: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
});
