/**
 * AI BUYRUQ PANELI
 * =================
 * Do'konchi oddiy gap yozadi: "2 kilo piyoz sotildi".
 *
 * Oqim:
 *   yozish → /ai/command (AI matnni JSON ga o'giradi, mahsulotni BAZA topadi)
 *          → nom bir nechta mahsulotga to'g'ri kelsa — ro'yxat chiqadi,
 *            do'konchi qaysinisi ekanini o'zi tanlaydi
 *          → ekranda "nima yoziladi" ko'rsatiladi
 *          → do'konchi tasdiqlaydi → /ai/execute (bazaga yoziladi)
 *
 * Tasdiqlashsiz hech narsa o'zgarmaydi — bu ataylab shunday.
 * Tanlanmagan qator qolsa "Tasdiqlash" ochilmaydi: AI taxmin qilib
 * noto'g'ri kolbasani sotib yuborgandan ko'ra, bir marta so'ragan yaxshi.
 */
import { useEffect, useState } from 'react';
import {
  ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { Image } from 'expo-image';
import { api } from '../api/client';
import type { AiAction, AiCommandResponse, AiNomzod, AiTanlov, Product } from '../api/types';
import { Badge, Button } from './ui';
import { Icon, type IconName } from './Icon';
import { colors, font, money, qty, radius, shadow, spacing } from '../theme';

const MISOLLAR = [
  '2 kg piyoz sotildi',
  "Alisherga 50 ming qarz berdim, 10 kundan keyin to'laydi",
  '3 dona non va 1 litr sut sotildi',
  'Transportga 30 ming chiqim',
  "Dilnoza qarzidan 100 ming to'ladi",
];

/** Amalni do'konchi tiliga o'giradi. */
function describe(a: AiAction): { icon: IconName; title: string; lines: string[]; tone: 'success' | 'danger' | 'primary' | 'warning' } {
  switch (a.type) {
    case 'sale': {
      const total = a.items.reduce((s, i) => s + i.qty * i.unit_price, 0);
      return {
        icon: 'savdo', tone: 'success', title: 'Savdo',
        lines: [
          ...a.items.map((i) => `${qty(i.qty)} ${i.unit} ${i.name} × ${money(i.unit_price)} = ${money(i.qty * i.unit_price)}`),
          `Jami: ${money(total)} so'm`,
          ...(a.customer_name ? [`Mijoz: ${a.customer_name}`] : []),
          `To'lov: ${a.payment_method}`,
        ],
      };
    }
    case 'purchase': {
      const total = a.items.reduce((s, i) => s + i.qty * i.cost_price, 0);
      return {
        icon: 'kirim-qutisi', tone: 'primary', title: 'Omborga kirim',
        lines: [
          ...a.items.map((i) => `${qty(i.qty)} ${i.unit} ${i.name} × ${money(i.cost_price)}`),
          `Jami: ${money(total)} so'm`,
          ...(a.supplier ? [`Yetkazuvchi: ${a.supplier}`] : []),
        ],
      };
    }
    case 'debt':
      return {
        icon: 'qarz', tone: 'warning', title: 'Qarz berildi',
        lines: [
          `${a.customer_name} — ${money(a.amount)} so'm`,
          ...(a.due_date ? [`Muddat: ${a.due_date}`] : []),
        ],
      };
    case 'debt_payment':
      return {
        icon: 'pul', tone: 'success', title: "Qarz to'lovi",
        lines: [`${a.customer_name} — ${money(a.amount)} so'm to'ladi`],
      };
    case 'expense':
      return {
        icon: 'chiqim-grafik', tone: 'danger', title: 'Chiqim',
        lines: [`${a.category}: ${money(a.amount)} so'm`, ...(a.note ? [a.note] : [])],
      };
    case 'create_product':
      return {
        icon: 'qoshish', tone: 'primary', title: 'Yangi mahsulot',
        lines: [
          a.name,
          `Sotuv narxi: ${money(a.sale_price)} so'm / ${a.unit}`,
          `Boshlang'ich qoldiq: ${qty(a.stock)} ${a.unit}`,
        ],
      };
    case 'stock_adjust':
      return {
        icon: 'tuzatish', tone: 'warning', title: 'Qoldiq tuzatish',
        lines: [`Yangi qoldiq: ${qty(a.new_stock)}`],
      };
  }
}

/* ------------------------ YOZAYOTGANDA TAKLIF QILISH ---------------------- */
/*
 * Kassir erkin gap yozadi ("2 kg piyoz sotildi"), lekin taklif qilish uchun
 * bizga faqat MAHSULOT NOMI kerak. Uni gapdan ajratib olamiz.
 *
 * Qoida: oxirgi qatordagi eng oxirgi son yoki o'lchov birligidan KEYINGI
 * so'zlar — hozir yozilayotgan mahsulot nomi. Kassir chapdan o'ngga yozadi,
 * shuning uchun u hozir terayotgan narsa doim oxirida turadi:
 *
 *   "2 kg piyoz sotildi"          → "piyoz"
 *   "3 dona non va 1 litr sut"    → "sut"     (birinchi mahsulot emas)
 *   "2 ta kolb"                   → "kolb"    (tugallanmagan ham bo'ladi)
 *   "Alisherga 50 ming qarz"      → "qarz"    (mahsulot topilmaydi, taklif chiqmaydi)
 *
 * Do'konchilar teskari tartibda ham yozadi — "kartoshka 10 kg". Unda sondan
 * keyin hech narsa qolmaydi, shuning uchun BIRINCHI sondan oldingi so'zlarga
 * qaytamiz. Ikkala uslub ham ishlaydi.
 */
const SON_YOKI_BIRLIK =
  /^([\d.,]+|kg|kilo|kilogramm|gram|gr|litr|lt|dona|ta|metr|quti|pachka|ming|million|mln)$/i;

/** Gap oxiridagi fe'llar nom emas — ular kesib tashlanadi. */
const FEEL =
  /^(sotildi|sotdim|sotdik|sotib|oldim|olindi|olib|keldi|berdim|berildi|qo'shildi|qoshildi|kirim|chiqim|va|hamda|uchun)$/i;

interface Bolak { matn: string; boshi: number; oxiri: number }

/** Oxirgi qatordan mahsulot nomiga o'xshash bo'lakni va uning o'rnini qaytaradi. */
function mahsulotBolagi(oxirgiQator: string): Bolak | null {
  const tokenlar: Array<{ s: string; i: number }> = [];
  const re = /\S+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(oxirgiQator)) !== null) tokenlar.push({ s: m[0], i: m.index });
  if (tokenlar.length === 0) return null;

  /** [bosh, oxir] oralig'idagi so'zlarni bo'lakka aylantiradi. */
  function kesib(boshIndex: number, oxirIndex: number): Bolak | null {
    // Chetlaridagi fe'llarni tashlaymiz: "piyoz sotildi" → "piyoz"
    while (oxirIndex >= boshIndex && FEEL.test(tokenlar[oxirIndex].s)) oxirIndex--;
    while (boshIndex <= oxirIndex && FEEL.test(tokenlar[boshIndex].s)) boshIndex++;
    if (oxirIndex < boshIndex) return null;

    const bosh = tokenlar[boshIndex];
    const oxir = tokenlar[oxirIndex];
    const matn = oxirgiQator.slice(bosh.i, oxir.i + oxir.s.length);
    return matn.trim().length >= 2
      ? { matn, boshi: bosh.i, oxiri: oxir.i + oxir.s.length }
      : null;
  }

  // 1) "2 kg piyoz" — oxirgi son/birlikdan KEYINGI so'zlar
  let keyin = 0;
  for (let k = tokenlar.length - 1; k >= 0; k--) {
    if (SON_YOKI_BIRLIK.test(tokenlar[k].s)) { keyin = k + 1; break; }
  }
  const oxiridan = kesib(keyin, tokenlar.length - 1);
  if (oxiridan) return oxiridan;

  // 2) "kartoshka 10 kg" — birinchi sondan OLDINGI so'zlar
  let oldin = tokenlar.length - 1;
  for (let k = 0; k < tokenlar.length; k++) {
    if (SON_YOKI_BIRLIK.test(tokenlar[k].s)) { oldin = k - 1; break; }
  }
  return oldin >= 0 ? kesib(0, oldin) : null;
}

/** Pul/qoldiq ko'rsatkichi — mijoz nomzodida boshqa maydonlar bo'ladi. */
function nomzodTavsif(c: AiNomzod, nima: 'mahsulot' | 'mijoz'): string {
  if (nima === 'mijoz') {
    return [
      c.balance ? `qarzi ${money(c.balance)} so'm` : 'qarzi yo\'q',
      c.phone,
    ].filter(Boolean).join(' · ');
  }
  return `${money(c.sale_price ?? 0)} so'm/${c.unit ?? 'dona'} · qoldiq ${qty(c.stock ?? 0)}`;
}

/**
 * Bitta noaniq nom uchun variantlar ro'yxati.
 * Rasm bor mahsulotda rasm, yo'g'ida shunchaki nom ko'rinadi.
 */
function TanlovKarta({ t, onPick }: { t: AiTanlov; onPick: (c: AiNomzod) => void }) {
  return (
    <View style={s.tanlov}>
      <View style={s.actionHead}>
        <Icon name="qidiruv" size={17} color={colors.textMuted} />
        <Text style={[font.bodyBold, { color: colors.text, flex: 1 }]}>
          Qaysi "{t.soralgan}"?
        </Text>
        <Badge text={`${t.nomzodlar.length} ta`} tone="warning" />
      </View>

      {t.taxminiy && (
        <Text style={[font.tiny, { color: colors.warning }]}>
          Aynan topilmadi — shunga o'xshashlari
        </Text>
      )}

      {t.nomzodlar.map((c) => (
        <Pressable
          key={c.id}
          onPress={() => onPick(c)}
          style={({ pressed }) => [s.nomzod, pressed && { opacity: 0.6 }]}
        >
          {c.photo_url
            ? <Image source={{ uri: c.photo_url }} style={s.thumb} contentFit="cover" />
            : <View style={[s.thumb, s.thumbBosh]}>
                <Icon name={t.nima === 'mijoz' ? 'qarz' : 'mahsulot'}
                  size={18} color={colors.textFaint} />
              </View>}

          <View style={{ flex: 1 }}>
            <Text style={[font.body, { color: colors.text }]} numberOfLines={1}>{c.name}</Text>
            <Text style={[font.tiny, { color: colors.textMuted }]} numberOfLines={1}>
              {nomzodTavsif(c, t.nima)}
            </Text>
          </View>

          <Icon name="oldinga" size={16} color={colors.textFaint} />
        </Pressable>
      ))}
    </View>
  );
}

export function AiCommandBar({ onDone }: { onDone?: () => void }) {
  const [text, setText] = useState('');
  const [thinking, setThinking] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [result, setResult] = useState<AiCommandResponse | null>(null);
  /** Yozayotganda chiqadigan mahsulot takliflari. */
  const [takliflar, setTakliflar] = useState<Product[]>([]);

  const bolak = mahsulotBolagi(text.split('\n').pop() ?? '');

  /**
   * Nom yozilayotganda mahsulotlarni taklif qilamiz — AI'siz, to'g'ridan-to'g'ri
   * `/products?search=` orqali. Bu ombor ekranidagi qidiruvning AYNAN o'zi,
   * shuning uchun taklif bilan keyin topiladigan mahsulot bir xil bo'ladi.
   *
   * Kassir taklifni bossa, nom gapga aniq ko'chiriladi va yuborilgandan keyin
   * "qaysi kolbasa?" degan savol umuman chiqmaydi.
   */
  useEffect(() => {
    const q = bolak?.matn.trim() ?? '';
    if (q.length < 2 || result) { setTakliflar([]); return; }

    const id = setTimeout(() => {
      api<Product[]>(`/products?search=${encodeURIComponent(q)}&limit=6`)
        .then(setTakliflar)
        .catch(() => setTakliflar([]));
    }, 250);
    return () => clearTimeout(id);
  }, [bolak?.matn, result]);

  /**
   * Yozilgani mahsulot nomining O'ZI bo'lsa, uni taklifda ko'rsatishning
   * ma'nosi yo'q — tanlanadigan narsa qolmadi. Bu tanlangandan keyin ham
   * kerak: nom matnga qo'yilgach qidiruv yana o'sha mahsulotni topadi.
   */
  const korinadigan = takliflar.filter(
    (p) => p.name.toLowerCase() !== (bolak?.matn ?? '').trim().toLowerCase());

  /** Taklif tanlandi — yozilayotgan bo'lakni to'liq nom bilan almashtiramiz. */
  function taklifniQoy(p: Product) {
    if (!bolak) return;
    const qatorlar = text.split('\n');
    const oxirgi = qatorlar[qatorlar.length - 1];
    qatorlar[qatorlar.length - 1] =
      oxirgi.slice(0, bolak.boshi) + p.name + oxirgi.slice(bolak.oxiri);
    setText(qatorlar.join('\n'));
    setTakliflar([]);
  }

  async function send() {
    const t = text.trim();
    if (t.length < 2) return;

    setThinking(true);
    setResult(null);
    setTakliflar([]);
    try {
      const res = await api<AiCommandResponse>('/ai/command', {
        method: 'POST', body: { text: t }, timeoutMs: 90000,
      });
      setResult(res);
    } catch (e: any) {
      Alert.alert('AI javob bermadi', e.message);
    } finally {
      setThinking(false);
    }
  }

  /**
   * Do'konchi variantni tanladi — amalni shu yerda to'ldiramiz va tanlovni
   * ro'yxatdan olib tashlaymiz. Serverga qayta murojaat qilinmaydi:
   * kerakli hamma narsa (id, narx, birlik) nomzod ichida keldi.
   */
  function tanla(t: AiTanlov, c: AiNomzod) {
    setResult((oldingi) => {
      if (!oldingi) return oldingi;
      const actions = oldingi.actions.map((a, i) => (i === t.amal ? { ...a } : a));
      const a: any = actions[t.amal];
      if (!a) return oldingi;

      if (t.nima === 'mijoz') {
        a.customer_id = c.id;
        a.customer_name = c.name;
      } else {
        const items = [...(a.items ?? [])];
        const qator: any = { ...items[t.qator] };
        qator.product_id = c.id;
        qator.name = c.name;
        qator.unit = c.unit ?? qator.unit;
        // Do'konchi narxni o'zi aytgan bo'lsa (unit_price > 0) unga tegmaymiz.
        if (a.type === 'sale' && !qator.unit_price) qator.unit_price = c.sale_price ?? 0;
        if (a.type === 'purchase' && !qator.cost_price) qator.cost_price = c.cost_price ?? 0;
        items[t.qator] = qator;
        a.items = items;
      }

      return {
        ...oldingi,
        actions,
        choices: oldingi.choices.filter((x) => x !== t),
        needs_choice: oldingi.choices.filter((x) => x !== t).length > 0,
      };
    });
  }

  async function confirm() {
    if (!result?.actions.length) return;
    setExecuting(true);
    try {
      const res = await api<{ summary: string; warnings: string[] }>('/ai/execute', {
        method: 'POST',
        body: { actions: result.actions, log_id: result.log_id },
        timeoutMs: 30000,
      });
      setResult(null);
      setText('');
      Alert.alert('Bajarildi', res.summary);
      onDone?.();
    } catch (e: any) {
      Alert.alert('Yozib bo\'lmadi', e.message);
    } finally {
      setExecuting(false);
    }
  }

  return (
    <View style={s.wrap}>
      <View style={s.inputRow}>
        <TextInput
          style={s.input}
          placeholder="Masalan: 2 kg piyoz sotildi"
          placeholderTextColor={colors.textFaint}
          value={text}
          onChangeText={setText}
          multiline
          onSubmitEditing={send}
          editable={!thinking && !executing}
        />
        <Pressable
          onPress={send}
          disabled={thinking || text.trim().length < 2}
          style={({ pressed }) => [
            s.sendBtn,
            (thinking || text.trim().length < 2) && { opacity: 0.4 },
            pressed && { opacity: 0.7 },
          ]}
        >
          {thinking
            ? <ActivityIndicator color="#fff" size="small" />
            : <Icon name="yuborish" size={20} color="#fff" />}
        </Pressable>
      </View>

      {/* Yozayotganda mahsulot takliflari — bosilsa nom gapga qo'yiladi */}
      {korinadigan.length > 0 && !result && (
        <View style={s.takliflar}>
          {korinadigan.map((p) => (
            <Pressable
              key={p.id}
              onPress={() => taklifniQoy(p)}
              style={({ pressed }) => [s.taklif, pressed && { opacity: 0.6 }]}
            >
              {p.photo_url
                ? <Image source={{ uri: p.photo_url }} style={s.thumb} contentFit="cover" />
                : <View style={[s.thumb, s.thumbBosh]}>
                    <Icon name="mahsulot" size={17} color={colors.textFaint} />
                  </View>}
              <View style={{ flex: 1 }}>
                <Text style={[font.body, { color: colors.text }]} numberOfLines={1}>
                  {p.name}
                </Text>
                <Text style={[font.tiny, {
                  color: Number(p.stock) <= 0 ? colors.danger : colors.textMuted,
                }]}>
                  {money(p.sale_price)} so'm / {p.unit} · qoldiq {qty(p.stock)}
                </Text>
              </View>
              <Icon name="oldinga" size={15} color={colors.textFaint} />
            </Pressable>
          ))}
        </View>
      )}

      {/* Misollar — faqat bo'sh holatda */}
      {!result && !thinking && text.length === 0 && korinadigan.length === 0 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: spacing.sm, paddingVertical: spacing.xs }}>
          {MISOLLAR.map((m) => (
            <Pressable key={m} onPress={() => setText(m)} style={s.chip}>
              <Text style={[font.tiny, { color: colors.textMuted }]}>{m}</Text>
            </Pressable>
          ))}
        </ScrollView>
      )}

      {thinking && (
        <Text style={[font.small, { color: colors.textMuted, paddingVertical: spacing.sm }]}>
          O'ylayapman…
        </Text>
      )}

      {/* Natija: nima yoziladi */}
      {result && (
        <View style={s.result}>
          <Text style={[font.body, { color: colors.text }]}>{result.summary}</Text>

          {/* Ma'lumot yetishmasa — AI ning savoli */}
          {result.savol && (
            <View style={s.warn}>
              <Text style={[font.small, { color: colors.warning }]}>{result.savol}</Text>
            </View>
          )}

          {/* Noaniq nomlar: qaysi mahsulot ekanini do'konchi tanlaydi */}
          {result.choices.map((t, i) => (
            <TanlovKarta key={`${t.amal}-${t.qator}-${i}`} t={t}
              onPick={(c) => tanla(t, c)} />
          ))}

          {result.actions.map((a, i) => {
            const d = describe(a);
            return (
              <View key={i} style={s.action}>
                <View style={s.actionHead}>
                  <Icon name={d.icon} size={17} color={colors.textMuted} />
                  <Text style={[font.bodyBold, { color: colors.text, flex: 1 }]}>{d.title}</Text>
                  <Badge text="tasdiqlanmagan" tone={d.tone} />
                </View>
                {d.lines.map((l, j) => (
                  <Text key={j} style={[font.small, { color: colors.textMuted }]}>{l}</Text>
                ))}
              </View>
            );
          })}

          {result.warnings.length > 0 && (
            <View style={s.warn}>
              {result.warnings.map((w, i) => (
                <View key={i} style={s.warnRow}>
                  <Icon name="ogohlantirish" size={15} color={colors.warning} />
                  <Text style={[font.small, { color: colors.warning, flex: 1 }]}>{w}</Text>
                </View>
              ))}
            </View>
          )}

          {result.needs_confirm ? (
            <View style={{ flexDirection: 'row', gap: spacing.sm }}>
              <Button title="Bekor" variant="secondary" style={{ flex: 1 }}
                onPress={() => setResult(null)} />
              <Button
                title={result.choices.length > 0
                  ? `Avval tanlang (${result.choices.length})`
                  : 'Tasdiqlash'}
                style={{ flex: 2 }}
                disabled={result.choices.length > 0}
                loading={executing}
                onPress={confirm} />
            </View>
          ) : (
            <Button title="Yopish" variant="secondary" onPress={() => setResult(null)} />
          )}
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    gap: spacing.sm,
    ...shadow,
  },
  inputRow: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm },
  input: {
    flex: 1,
    minHeight: 44,
    maxHeight: 110,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingTop: 12,
    paddingBottom: 12,
    fontSize: 16,
    color: colors.text,
  },
  sendBtn: {
    width: 44, height: 44,
    borderRadius: radius.md,
    backgroundColor: colors.primary,
    alignItems: 'center', justifyContent: 'center',
  },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.pill,
  },
  result: { gap: spacing.md, paddingTop: spacing.sm },
  action: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: 3,
  },
  actionHead: {
    flexDirection: 'row', alignItems: 'center',
    gap: spacing.sm, marginBottom: spacing.xs,
  },
  takliflar: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    overflow: 'hidden',
  },
  taklif: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    padding: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  tanlov: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.xs,
    borderWidth: 1,
    borderColor: colors.warningSoft,
  },
  nomzod: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.sm,
  },
  thumb: { width: 40, height: 40, borderRadius: radius.sm },
  thumbBosh: {
    backgroundColor: colors.surfaceAlt,
    alignItems: 'center', justifyContent: 'center',
  },
  warnRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  warn: {
    backgroundColor: colors.warningSoft,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.xs,
  },
});
