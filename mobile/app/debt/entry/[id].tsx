/**
 * QARZ/TO'LOV YOZUVINI TAHRIRLASH VA O'CHIRISH.
 *
 * Nega kerak? Qarz qo'lda kiritilganda xato tez-tez uchraydi — boshqa
 * mijozga yozib yuborish, summani adashtirish. Ilgari buni tuzatishning
 * yagona yo'li TESKARI yozuv qo'shish edi ("−50 000" qo'shib xatoni
 * yopish), bu esa tarixni chalkashtiradi.
 *
 * Faqat QO'LDA kiritilgan yozuvlar bu yerga keladi: `debt/[id].tsx`
 * savdodan chiqqan qarzni bosiladigan qilib qo'ymaydi, server ham buni
 * qaytaradi (savdo bilan muvofiqlik buzilmasin uchun).
 *
 * MA'LUMOT SO'ROVSIZ KELADI — yozuv allaqachon mijoz sahifasida yuklangan,
 * shuning uchun bu yerga navigatsiya parametri sifatida uzatiladi.
 * Alohida GET kerak emas va ekran offlayn ham ochiladi.
 *
 * O'chirish serverda YUMSHOQ (deleted_at) va faqat do'kon egasiga
 * ruxsat etilgan — `expenses`dagi bilan bir xil naqsh.
 */
import { useState } from 'react';
import { ScrollView, StyleSheet, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as outbox from '../../../src/lib/outbox';
import { useAuth } from '../../../src/api/auth';
import { Button, Field } from '../../../src/components/ui';
import { ModalHeader } from '../../../src/components/ScreenHeader';
import { useConfirm } from '../../../src/components/Confirm';
import { useToast } from '../../../src/components/Toast';
import { sanaOqi } from '../../../src/lib/sana';
import { colors, dateLabel, font, money, sanaMatni, spacing } from '../../../src/theme';

/** "2026-10-01" → "01.10.2026" — tahrirlash maydonida daftar shaklida. */
function kunOyYil(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m ? `${m[3]}.${m[2]}.${m[1]}` : iso;
}

export default function DebtEntryEdit() {
  const params = useLocalSearchParams<{
    id: string; customerName: string; amount: string; isPayment: string;
    dueDate: string; note: string; createdAt: string;
  }>();
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();
  const { user } = useAuth();

  const tolovmi = params.isPayment === '1';
  const origAmount = Number(params.amount) || 0;
  const origDue = params.dueDate || null;
  const origNote = params.note || null;

  const [amount, setAmount] = useState(String(origAmount));
  const [dueText, setDueText] = useState(origDue ? kunOyYil(origDue) : '');
  const [note, setNote] = useState(origNote ?? '');
  const [saving, setSaving] = useState(false);

  async function save() {
    const yangiSumma = Number(amount) || 0;
    if (yangiSumma <= 0) {
      toast.ogoh('Summani kiriting');
      return;
    }
    const yangiDue = tolovmi ? null : (dueText.trim() ? sanaOqi(dueText) : null);
    if (!tolovmi && dueText.trim() && !yangiDue) {
      toast.ogoh("Muddatni tushunmadim. Masalan: 15.09 yoki 1509");
      return;
    }

    // Faqat haqiqatan o'zgargan maydonlar.
    const patch: Record<string, unknown> = {};
    const lines: string[] = [`Mijoz: ${params.customerName}`];

    if (yangiSumma !== origAmount) {
      patch.amount = yangiSumma;
      lines.push(`Summa: ${money(origAmount)} → ${money(yangiSumma)} so'm`);
    }
    if (!tolovmi && yangiDue !== origDue) {
      patch.due_date = yangiDue;
      lines.push(`Muddat: ${origDue ? sanaMatni(origDue) : "yo'q"} → ${yangiDue ? sanaMatni(yangiDue) : "yo'q"}`);
    }
    const yangiIzoh = note.trim() || null;
    if (yangiIzoh !== origNote) {
      patch.note = yangiIzoh;
      lines.push(`Izoh: ${origNote ?? "yo'q"} → ${yangiIzoh ?? "yo'q"}`);
    }

    if (Object.keys(patch).length === 0) {
      toast.info("Hech narsa o'zgartirilmadi");
      return;
    }

    const ok = await confirm({
      title: tolovmi ? "To'lovni o'zgartirish" : 'Qarzni o\'zgartirish',
      icon: 'tahrir',
      amount: yangiSumma,
      amountLabel: tolovmi ? "Yangi to'lov summasi" : 'Yangi qarz summasi',
      lines,
      warnings: ["Mijozning joriy qarzi qayta hisoblanadi"],
      confirmText: 'Saqlash',
    });
    if (!ok) return;

    setSaving(true);
    try {
      const res = await outbox.enqueue('debt_update', { id: params.id, ...patch },
        `${tolovmi ? "To'lov" : 'Qarz'} tahriri — ${params.customerName}`);
      if (res.error) throw new Error(res.error);

      if (res.yuborildi) toast.ok('Yozuv yangilandi');
      else toast.info("O'zgarish navbatga qo'yildi — ulanganda yuboriladi");
      router.back();
    } catch (e: any) {
      toast.xato(`Saqlab bo'lmadi: ${e.message}`);
      setSaving(false);
    }
  }

  async function remove() {
    const ok = await confirm({
      title: tolovmi ? "To'lovni o'chirish" : "Qarzni o'chirish",
      icon: 'ogohlantirish',
      amount: origAmount,
      amountLabel: "O'chiriladigan summa",
      lines: [
        `Mijoz: ${params.customerName}`,
        ...(origNote ? [`Izoh: ${origNote}`] : []),
        `Yozilgan: ${dateLabel(params.createdAt)}`,
      ],
      warnings: [
        "Bu amalni ortga qaytarib bo'lmaydi",
        "Mijozning joriy qarzi qayta hisoblanadi",
      ],
      confirmText: "O'chirish",
      destructive: true,
    });
    if (!ok) return;

    setSaving(true);
    try {
      const res = await outbox.enqueue('debt_delete', { id: params.id },
        `${tolovmi ? "To'lov" : 'Qarz'} o'chirish — ${params.customerName}`);
      if (res.error) throw new Error(res.error);

      if (res.yuborildi) toast.ok("Yozuv o'chirildi");
      else toast.info("O'chirish navbatga qo'yildi — ulanganda yuboriladi");
      router.back();
    } catch (e: any) {
      toast.xato(`O'chirib bo'lmadi: ${e.message}`);
      setSaving(false);
    }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      <ModalHeader
        title={tolovmi ? "To'lovni tahrirlash" : 'Qarzni tahrirlash'}
        onClose={() => router.back()}
      />

      <ScrollView
        contentContainerStyle={s.scroll}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <Text style={[font.tiny, { color: colors.textMuted }]}>
          {params.customerName} · {dateLabel(params.createdAt)}
        </Text>

        <Field
          label="Summa"
          value={amount}
          onChangeText={setAmount}
          keyboardType="number-pad"
          suffix="so'm"
          autoFocus
        />

        {!tolovmi && (
          <Field
            label="To'lash muddati"
            value={dueText}
            onChangeText={setDueText}
            keyboardType="numeric"
            placeholder="15.09"
            hint="Ixtiyoriy — kun.oy, masalan 15.09. Bo'sh qoldirsangiz muddatsiz bo'ladi."
          />
        )}

        <Field
          label="Izoh"
          value={note}
          onChangeText={setNote}
          placeholder={tolovmi ? "masalan: kartaga o'tkazdi" : 'masalan: naqd qarz'}
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
});
