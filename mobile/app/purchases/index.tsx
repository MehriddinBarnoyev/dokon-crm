/**
 * TOVAR KIRIMLARI — kunlik olib kelingan tovarlar, narxlari va statistikasi.
 *
 * Chiqimlar ro'yxati bilan bir xil naqsh: davr chiplari, guruh bo'yicha
 * taqsimot, kunlar bo'yicha SectionList. Ikki farqi bor va ikkalasi ham
 * ataylab:
 *
 *   1) HAR KIRIM QATORLARI BILAN CHIQADI. Chiqimda bitta summa bo'ladi,
 *      kirimda esa asosiy ma'lumot "nima, qancha, qaysi narxda" — uni
 *      ko'rish uchun alohida ekranga kirish kerak bo'lsa, ro'yxatning
 *      ma'nosi qolmaydi.
 *
 *   2) TEPADA "TOVAR AYLANMASI" BLOKI. "Qancha sarfladim" degan raqamning
 *      o'zi yetarli emas: pul tovarga aylandi, qaytishi esa sotuvga bog'liq.
 *      Shuning uchun yonida "sotilganining tan narxi" (qaytgani) va
 *      "omborda turgani" ko'rsatiladi.
 *
 * RANGI KO'K, QIZIL EMAS. Chiqim qizil — pul ketdi. Kirim ko'k — pul
 * ketmadi, TOVARGA aylandi. Ikkalasi bir xil rangda bo'lsa do'konchi
 * yana ularni bir narsa deb o'ylardi, muammo aynan shundan boshlangan edi.
 */
import { useCallback, useMemo, useState } from 'react';
import { RefreshControl, ScrollView, SectionList, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { api } from '../../src/api/client';
import { useKeshlangan } from '../../src/lib/keshRoyxat';
import type { Kirim, TovarAylanma } from '../../src/api/types';
import { Chip, Empty, IconButton } from '../../src/components/ui';
import { ScreenHeader } from '../../src/components/ScreenHeader';
import { SkeletonList } from '../../src/components/Skeleton';
import { PressScale } from '../../src/components/Press';
import { Icon } from '../../src/components/Icon';
import {
  colors, elevation, font, kunKaliti, money, moneyShort, qty as fq,
  radius, sanaToliq, soat, spacing,
} from '../../src/theme';

const DAVRLAR = [
  { kun: 7, label: '7 kun' },
  { kun: 30, label: '30 kun' },
  { kun: 90, label: '90 kun' },
] as const;

/** "2026-08-31" → "Bugun" / "Kecha" / "31-avgust, dushanba" */
function kunNomi(iso: string): string {
  const bugun = kunKaliti(new Date());
  const kecha = kunKaliti(new Date(Date.now() - 864e5));
  if (iso === bugun) return 'Bugun';
  if (iso === kecha) return 'Kecha';
  // Soat 12 — yozgi/qishki vaqt siljishida kun almashib ketmasin
  return sanaToliq(new Date(`${iso}T12:00:00`));
}

/** Yetkazib beruvchisi yo'q kirimlar shu nom ostida guruhlanadi. */
const NOMSIZ = '(nomsiz)';

export default function PurchasesScreen() {
  const router = useRouter();
  const [refreshing, setRefreshing] = useState(false);
  const [kun, setKun] = useState<number>(30);
  const [beruvchi, setBeruvchi] = useState<string | null>(null);

  const from = useMemo(
    () => kunKaliti(new Date(Date.now() - (kun - 1) * 864e5)), [kun]);

  const olib = useCallback(
    () => api<Kirim[]>(`/purchases?from=${from}&limit=500`), [from]);
  const { data: items, yangila: load } = useKeshlangan<Kirim[]>(`purchases.${kun}`, olib);

  const olibAylanma = useCallback(
    () => api<TovarAylanma>(`/purchases/meta/aylanma?from=${from}`), [from]);
  const { data: aylanma, yangila: loadAylanma } =
    useKeshlangan<TovarAylanma>(`purchases.aylanma.${kun}`, olibAylanma);

  useFocusEffect(useCallback(() => {
    load().catch(() => {});
    loadAylanma().catch(() => {});
  }, [load, loadAylanma]));

  /** Yetkazib beruvchi taqsimoti — filtrdan OLDIN, chip'lar doim to'liq. */
  const beruvchilar = useMemo(() => {
    if (!items) return [];
    const map = new Map<string, number>();
    for (const k of items) {
      const nom = k.supplier?.trim() || NOMSIZ;
      map.set(nom, (map.get(nom) ?? 0) + Number(k.total));
    }
    return [...map.entries()]
      .map(([name, total]) => ({ name, total }))
      .sort((a, b) => b.total - a.total);
  }, [items]);

  const korinadigan = useMemo(
    () => (items ?? []).filter(
      (k) => !beruvchi || (k.supplier?.trim() || NOMSIZ) === beruvchi),
    [items, beruvchi]);

  const sections = useMemo(() => {
    const map = new Map<string, Kirim[]>();
    for (const k of korinadigan) {
      const kalit = kunKaliti(new Date(k.created_at));
      const ro = map.get(kalit);
      if (ro) ro.push(k); else map.set(kalit, [k]);
    }
    return [...map.entries()].map(([kalit, list]) => ({
      title: kalit,
      jami: list.reduce((x, r) => x + Number(r.total), 0),
      data: list,
    }));
  }, [korinadigan]);

  const jami = korinadigan.reduce((x, r) => x + Number(r.total), 0);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      <ScreenHeader
        title="Tovar kirimlari"
        subtitle={items ? `${korinadigan.length} ta · ${money(jami)} so'm` : undefined}
        left={
          <IconButton
            name="orqaga" label="Orqaga" tone="soft" size={22}
            onPress={() => (router.canGoBack() ? router.back() : router.replace('/(tabs)'))}
          />
        }
        action={{
          icon: 'qoshish', label: 'Tovar olish',
          onPress: () => router.push('/purchase/new'),
        }}
      />

      <View style={s.filtrlar}>
        <ScrollView
          horizontal showsHorizontalScrollIndicator={false}
          contentContainerStyle={s.chipQator}
        >
          {DAVRLAR.map((d) => (
            <Chip
              key={d.kun} label={d.label} active={kun === d.kun}
              onPress={() => setKun(d.kun)}
            />
          ))}
        </ScrollView>

        {beruvchilar.length > 1 && (
          <ScrollView
            horizontal showsHorizontalScrollIndicator={false}
            contentContainerStyle={s.chipQator}
          >
            <Chip
              label="Hammasi" active={beruvchi === null}
              onPress={() => setBeruvchi(null)}
            />
            {beruvchilar.map((b) => (
              <Chip
                key={b.name}
                label={`${b.name} · ${moneyShort(b.total)}`}
                active={beruvchi === b.name}
                onPress={() => setBeruvchi(beruvchi === b.name ? null : b.name)}
              />
            ))}
          </ScrollView>
        )}
      </View>

      {!items ? (
        <View style={{ paddingHorizontal: spacing.lg }}><SkeletonList /></View>
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(x) => x.id}
          contentContainerStyle={s.list}
          showsVerticalScrollIndicator={false}
          stickySectionHeadersEnabled={false}
          ListHeaderComponent={aylanma ? <Aylanma d={aylanma} /> : null}
          renderSectionHeader={({ section }) => (
            <View style={s.kunSarlavha}>
              <Text style={[font.bodyBold, { color: colors.text, flex: 1 }]}>
                {kunNomi(section.title)}
              </Text>
              <Text style={[font.num, { color: colors.primary }]}>
                {money(section.jami)}
              </Text>
            </View>
          )}
          refreshControl={
            <RefreshControl
              refreshing={refreshing} tintColor={colors.primary}
              onRefresh={async () => {
                setRefreshing(true);
                await Promise.all([load().catch(() => {}), loadAylanma().catch(() => {})]);
                setRefreshing(false);
              }}
            />
          }
          ListEmptyComponent={
            <Empty
              icon="kirim"
              title={beruvchi
                ? `"${beruvchi}" dan kirim yo'q`
                : "Bu davrda tovar kirimi yo'q"}
              hint={beruvchi
                ? 'Boshqa yetkazib beruvchini tanlang'
                : "Do'konga mol kelganda shu yerga yoziladi — chiqimga emas."
                  + ' Chunki mol olish xarajat emas, pulning tovarga aylanishi.'}
              action={beruvchi ? undefined : {
                title: 'Tovar olish', icon: 'qoshish',
                onPress: () => router.push('/purchase/new'),
              }}
            />
          }
          renderItem={({ item }) => <KirimKarta kirim={item} />}
        />
      )}
    </SafeAreaView>
  );
}

/**
 * TOVAR AYLANMASI bloki.
 *
 * Uchta raqam bir savolga javob beradi: "tovarga qo'ygan pulim qayerda?"
 *   sarflandi — shu davrda tovarga ketgani
 *   qaytdi    — sotilgan molning tan narxi, ya'ni pul bo'lib qaytgani
 *   omborda   — hali javonda turgani (HOZIRGI holat, davrga bog'liq emas)
 */
function Aylanma({ d }: { d: TovarAylanma }) {
  const foyda = Number(d.savdo) - Number(d.sotilgan);
  return (
    <View style={s.aylanma}>
      <View style={s.aylanmaBosh}>
        <Icon name="ombor" size={16} color={colors.primary} />
        <Text style={[font.smallBold, { color: colors.primary, flex: 1 }]}>
          TOVAR AYLANMASI
        </Text>
      </View>

      <View style={s.aylanmaQator}>
        <Katak label="Sarflandi" value={money(d.sarflandi)} tone={colors.primary} />
        <Katak label="Qaytdi" value={money(d.sotilgan)} tone={colors.text} />
        <Katak label="Omborda" value={money(d.omborda)} tone={colors.text} />
      </View>

      <Text style={[font.tiny, { color: colors.textMuted }]}>
        "Qaytdi" — sotilgan molning tan narxi. Ustiga{' '}
        <Text style={{ color: foyda >= 0 ? colors.success : colors.danger }}>
          {money(foyda)} so'm
        </Text>{' '}
        foyda qo'shilib tushgan. "Omborda" — hozir javonda turgan molning tan narxdagi qiymati.
      </Text>
    </View>
  );
}

function Katak({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <View style={{ flex: 1, gap: 2 }}>
      <Text style={[font.tiny, { color: colors.textMuted }]}>{label}</Text>
      <Text style={[font.num, { color: tone }]} numberOfLines={1}>{value}</Text>
    </View>
  );
}

/** Bitta kirim: sarlavha + mahsulot qatorlari (nima, qancha, qaysi narxda). */
function KirimKarta({ kirim }: { kirim: Kirim }) {
  const qatorlar = kirim.items ?? [];
  return (
    <PressScale
      accessibilityRole="text"
      accessibilityLabel={`${kirim.supplier ?? 'Tovar kirimi'}, ${money(kirim.total)} so'm`}
      scale={1}
      style={s.card}
    >
      <View style={s.kartaBosh}>
        <View style={s.ikonka}>
          <Icon name="kirim" size={17} color={colors.primary} />
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={[font.bodyBold, { color: colors.text }]} numberOfLines={1}>
            {kirim.supplier?.trim() || 'Tovar kirimi'}
          </Text>
          <Text style={[font.tiny, { color: colors.textMuted }]} numberOfLines={1}>
            {soat(new Date(kirim.created_at))}
            {kirim.user_name ? ` · ${kirim.user_name}` : ''}
            {kirim.source === 'ai' ? ' · AI' : ''}
            {kirim.note ? ` · ${kirim.note}` : ''}
          </Text>
        </View>
        <Text style={[font.num, { color: colors.primary }]}>
          {money(kirim.total)}
        </Text>
      </View>

      {qatorlar.length > 0 && (
        <View style={s.qatorlar}>
          {qatorlar.map((q, i) => (
            <View key={`${q.name}-${i}`} style={s.qator}>
              <Text style={[font.small, { color: colors.text, flex: 1 }]} numberOfLines={1}>
                {q.name}
              </Text>
              <Text style={[font.tiny, { color: colors.textMuted }]}>
                {fq(q.qty)} {q.unit} × {money(q.cost_price)}
              </Text>
              <Text style={[font.small, { color: colors.text, minWidth: 72, textAlign: 'right' }]}>
                {money(q.subtotal)}
              </Text>
            </View>
          ))}
        </View>
      )}
    </PressScale>
  );
}

const s = StyleSheet.create({
  filtrlar: { gap: spacing.xs, paddingBottom: spacing.sm },
  chipQator: { paddingHorizontal: spacing.lg, gap: spacing.xs },
  list: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xxxl, gap: spacing.sm },
  aylanma: {
    gap: spacing.sm,
    backgroundColor: colors.primarySoft,
    borderWidth: 1, borderColor: colors.primaryLine,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginBottom: spacing.xs,
  },
  aylanmaBosh: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  aylanmaQator: { flexDirection: 'row', gap: spacing.md },
  kunSarlavha: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md, paddingVertical: spacing.md,
    marginTop: spacing.lg, marginBottom: spacing.xs,
  },
  card: {
    gap: spacing.sm,
    backgroundColor: colors.surface, borderRadius: radius.lg,
    padding: spacing.md,
    borderWidth: 1, borderColor: colors.borderSoft,
    ...elevation[1],
  },
  kartaBosh: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  ikonka: {
    width: 36, height: 36, borderRadius: radius.sm,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.primarySoft,
  },
  qatorlar: {
    gap: 4,
    borderTopWidth: 1, borderTopColor: colors.borderSoft,
    paddingTop: spacing.sm,
  },
  qator: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
});
