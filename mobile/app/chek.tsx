/**
 * CHEK EKRANI.
 *
 * Savdo saqlangandan keyin shu ekran ochiladi — do'konchi xaridorga
 * ko'rsatadi, kerak bo'lsa PDF qilib beradi yoki chop etadi.
 *
 * NEGA ALOHIDA EKRAN. Chekni savdo ekranining ichida ko'rsatish mumkin
 * edi, lekin unda savat va to'lov holati ekranda qolib, "savdo tugadimi
 * yo'qmi" degan chalkashlik tug'ilardi. Alohida ekran esa bitta narsani
 * aytadi: savdo yozildi, mana cheki.
 *
 * "Yopish" ataylab eng katta tugma: kassada navbat turadi va chek har
 * doim ham kerak emas — bir bosishda ishga qaytish kerak.
 */
import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { Button, Empty } from '../src/components/ui';
import { ModalHeader } from '../src/components/ScreenHeader';
import { useToast } from '../src/components/Toast';
import { haptic } from '../src/lib/haptics';
import * as chek from '../src/lib/chek';
import { colors, font, money, qty as fq, radius, spacing } from '../src/theme';

/** "09.09.2026 15:24" */
function sanaVaqt(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()}`
    + ` ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export default function ChekScreen() {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState<'pdf' | 'chop' | null>(null);

  const c = chek.ol();

  if (!c) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
        <ModalHeader title="Chek" onClose={() => router.back()} />
        <Empty icon="savdo" title="Chek topilmadi" hint="Savdolar ro'yxatidan tanlang" />
      </SafeAreaView>
    );
  }

  /** PDF yasab, ulashish oynasini ochadi (Telegram, WhatsApp, fayl...). */
  async function ulash() {
    if (!c) return;
    setBusy('pdf');
    try {
      const { uri } = await Print.printToFileAsync({
        html: chek.chekHtml(c),
        ...chek.pdfOlchami(c),
      });

      // Ulashish yo'q bo'lsa (kamdan-kam, lekin bo'ladi) — jim qolmaymiz.
      if (!(await Sharing.isAvailableAsync())) {
        toast.xato('Bu qurilmada ulashish mavjud emas');
        return;
      }
      await Sharing.shareAsync(uri, {
        mimeType: 'application/pdf',
        dialogTitle: `Chek № ${c.raqam}`,
        UTI: 'com.adobe.pdf',
      });
    } catch (e: any) {
      toast.xato(`Chek yasab bo'lmadi: ${e.message}`);
    } finally {
      setBusy(null);
    }
  }

  /** Tizim chop etish oynasi: printer yoki "PDF ga saqlash". */
  async function chopEt() {
    if (!c) return;
    setBusy('chop');
    try {
      await Print.printAsync({ html: chek.chekHtml(c), ...chek.pdfOlchami(c) });
    } catch (e: any) {
      // Foydalanuvchi oynani yopgani ham xato bo'lib keladi — uni ko'rsatmaymiz.
      if (!/dismiss|cancel/i.test(e?.message ?? '')) {
        toast.xato(`Chop etib bo'lmadi: ${e.message}`);
      }
    } finally {
      setBusy(null);
    }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
      <ModalHeader title="Chek" onClose={() => router.back()} />

      <ScrollView contentContainerStyle={s.scroll}>
        {/* Qog'oz chekka o'xshab tursin — do'konchi nimani ko'rsatayotganini
            bir qarashda tushunadi. */}
        <View style={s.qogoz}>
          <Text style={s.dokon}>{c.dokon}</Text>
          <Text style={s.raqam}>CHEK № {c.raqam}</Text>

          <View style={s.chiziq} />

          <Qator chap="Sana" ong={sanaVaqt(c.sana)} />
          {c.sotuvchi ? <Qator chap="Sotuvchi" ong={c.sotuvchi} /> : null}
          {c.mijoz ? <Qator chap="Mijoz" ong={c.mijoz} /> : null}

          <View style={s.chiziq} />

          {c.qatorlar.map((q, i) => (
            <View key={`${q.nom}-${i}`} style={s.mahsulot}>
              <Text style={s.nom}>{q.nom}</Text>
              <View style={s.qator}>
                <Text style={s.matn}>
                  {fq(q.miqdor)} {q.birlik} × {money(q.narx)}
                </Text>
                <Text style={s.matn}>{money(q.summa)}</Text>
              </View>
            </View>
          ))}

          <View style={s.chiziq} />

          <View style={s.qator}>
            <Text style={s.jamiMatn}>JAMI</Text>
            <Text style={s.jamiMatn}>{money(c.jami)} so'm</Text>
          </View>
          <Qator chap="To'lov" ong={chek.TOLOV_NOMI[c.usul]} />
          {c.tolangan !== c.jami
            ? <Qator chap="To'landi" ong={`${money(c.tolangan)} so'm`} /> : null}
          {c.qarz > 0 ? (
            <View style={s.qator}>
              <Text style={[s.jamiMatn, { color: colors.danger }]}>QARZ QOLDI</Text>
              <Text style={[s.jamiMatn, { color: colors.danger }]}>
                {money(c.qarz)} so'm
              </Text>
            </View>
          ) : null}

          <View style={s.chiziq} />
          <Text style={s.rahmat}>Xaridingiz uchun rahmat!</Text>

          {!c.yuborildi && (
            <Text style={s.navbat}>
              Savdo navbatda — ulanish tiklanganda yuboriladi
            </Text>
          )}
        </View>
      </ScrollView>

      <View style={s.tugmalar}>
        <View style={{ flexDirection: 'row', gap: spacing.sm }}>
          <Button
            title="Ulashish" icon="ulash" variant="soft"
            loading={busy === 'pdf'} disabled={busy !== null}
            onPress={() => { haptic.tap(); ulash(); }}
            style={{ flex: 1 }}
          />
          <Button
            title="Chop etish" icon="savdo" variant="soft"
            loading={busy === 'chop'} disabled={busy !== null}
            onPress={() => { haptic.tap(); chopEt(); }}
            style={{ flex: 1 }}
          />
        </View>
        <Button title="Yopish" size="lg" onPress={() => router.back()} />
      </View>
    </SafeAreaView>
  );
}

function Qator({ chap, ong }: { chap: string; ong: string }) {
  return (
    <View style={s.qator}>
      <Text style={s.matnKul}>{chap}</Text>
      <Text style={s.matn}>{ong}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  scroll: { padding: spacing.lg, paddingBottom: spacing.xl },
  qogoz: {
    backgroundColor: '#fff',
    borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border,
    padding: spacing.lg,
    alignSelf: 'center',
    // 80 mm li kassa qog'ozi nisbati — chek chekka o'xshasin
    width: '100%', maxWidth: 340,
  },
  dokon: { ...font.h3, color: '#000', textAlign: 'center' },
  raqam: { ...font.mono, color: colors.textMuted, textAlign: 'center', marginTop: 2 },
  chiziq: {
    borderTopWidth: 1, borderStyle: 'dashed',
    borderColor: colors.border, marginVertical: spacing.md,
  },
  qator: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm },
  mahsulot: { marginBottom: spacing.sm },
  nom: { ...font.smallBold, color: '#000' },
  matn: { ...font.mono, color: '#000' },
  matnKul: { ...font.mono, color: colors.textMuted },
  jamiMatn: { ...font.numBig, color: '#000', fontSize: 17 },
  rahmat: { ...font.small, color: colors.textMuted, textAlign: 'center' },
  navbat: {
    ...font.tiny, color: colors.warning, textAlign: 'center', marginTop: spacing.sm,
  },
  tugmalar: {
    padding: spacing.lg, gap: spacing.sm,
    borderTopWidth: 1, borderTopColor: colors.borderSoft,
    backgroundColor: colors.surface,
  },
});
