import { useCallback, useMemo, useState } from 'react';
import {
  FlatList, Linking, StyleSheet, Text, TextInput, View, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { api } from '../../src/api/client';
import type { Debtor } from '../../src/api/types';
import { Badge, Chip, Empty, IconButton } from '../../src/components/ui';
import { ScreenHeader } from '../../src/components/ScreenHeader';
import { SkeletonList } from '../../src/components/Skeleton';
import { PressScale } from '../../src/components/Press';
import { AnimatedMoney } from '../../src/components/AnimatedNumber';
import { useKeshlangan } from '../../src/lib/keshRoyxat';
import * as customerStore from '../../src/data/customers';
import { Icon } from '../../src/components/Icon';
import {
  colors, elevation, font, money, palette, radius, sanaMatni, spacing,
} from '../../src/theme';

/**
 * Ism bo'yicha doimiy rang. Bir mijoz har doim bir xil rangda ko'rinadi —
 * ro'yxatni ko'z bilan tez topish osonlashadi.
 */
const AVATAR = [
  { bg: palette.blue[50],   fg: palette.blue[600] },
  { bg: palette.green[50],  fg: palette.green[600] },
  { bg: palette.violet[50], fg: palette.violet[600] },
  { bg: palette.amber[50],  fg: palette.amber[600] },
];
function rang(name: string) {
  let sum = 0;
  for (let i = 0; i < name.length; i++) sum += name.charCodeAt(i);
  return AVATAR[sum % AVATAR.length];
}

export default function DebtsScreen() {
  const router = useRouter();
  const [refreshing, setRefreshing] = useState(false);
  const [onlyOwing, setOnlyOwing] = useState(true);
  const [q, setQ] = useState('');

  // Ikki filtr — ikki alohida kesh kaliti, aks holda biri ikkinchisini bosardi.
  const olib = useCallback(
    () => api<Debtor[]>(`/debts${onlyOwing ? '?only_owing=1' : ''}`), [onlyOwing]);
  const { data: items, yangila: load } = useKeshlangan<Debtor[]>(
    onlyOwing ? 'debts.qarzdor' : 'debts.hammasi', olib);

  useFocusEffect(useCallback(() => { load().catch(() => {}); }, [load]));

  /**
   * Qidiruv QURILMADA bajariladi. Server `/debts?search=` ni qo'llaydi,
   * lekin ro'yxat baribir to'liq keshda turadi: har harfda so'rov yuborish
   * sekinroq bo'lardi va internet uzilganda qidiruv butunlay ishlamay
   * qolardi. Do'konga qarzdor kelib turganda esa aynan shu kerak bo'ladi.
   */
  const { items: shown, taxminiy } = useMemo(
    () => customerStore.qidir(items ?? [], q),
    [items, q]);

  // Yuqoridagi karta — QIDIRUVDAN qat'i nazar butun ro'yxat bo'yicha:
  // "umumiy qarz" bir mijozni qidirgani uchun o'zgarib ketmasligi kerak.
  const total = (items ?? []).reduce((s, d) => s + Number(d.balance), 0);
  const overdue = (items ?? []).filter((d) => d.overdue).length;
  const qidirilmoqda = q.trim().length > 0;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      <ScreenHeader
        title="Qarzlar"
        action={{
          icon: 'qoshish',
          label: "Qarz qo'shish",
          onPress: () => router.push('/debt/new'),
        }}
      />

      <View style={s.head}>
        <View style={[s.summary, overdue > 0 ? { borderColor: colors.dangerLine } : null]}>
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={[font.label, { color: colors.textMuted }]}>UMUMIY QARZ</Text>
            <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 6 }}>
              <AnimatedMoney value={total} style={[font.numBig, { color: colors.text }]} />
              <Text style={[font.small, { color: colors.textMuted, paddingBottom: 3 }]}>so'm</Text>
            </View>
            <Text style={[font.tiny, { color: colors.textMuted }]}>
              {qidirilmoqda
                ? `${shown.length} ta topildi · jami ${(items ?? []).length} ta mijoz`
                : `${(items ?? []).length} ta mijoz`}
            </Text>
          </View>
          {overdue > 0 && (
            <Badge text={`${overdue} ta muddati o'tgan`} tone="danger" dot />
          )}
        </View>

        <View style={s.searchBox}>
          <Icon name="qidiruv" size={18} color={colors.textFaint} />
          <TextInput
            style={s.search}
            placeholder="Ism yoki telefon…"
            placeholderTextColor={colors.textFaint}
            value={q}
            onChangeText={setQ}
            returnKeyType="search"
            autoCorrect={false}
            accessibilityLabel="Mijoz qidirish"
          />
          {q.length > 0 ? (
            <PressScale
              accessibilityRole="button"
              accessibilityLabel="Qidiruvni tozalash"
              onPress={() => setQ('')}
              scale={0.85}
              hitSlop={10}
            >
              <Icon name="yopish" size={17} color={colors.textFaint} />
            </PressScale>
          ) : null}
        </View>

        <View style={{ flexDirection: 'row', gap: spacing.sm }}>
          <Chip label="Qarzi borlar" active={onlyOwing} onPress={() => setOnlyOwing(true)} />
          <Chip label="Barcha mijozlar" active={!onlyOwing} onPress={() => setOnlyOwing(false)} />
        </View>
      </View>

      {!items ? (
        <View style={{ paddingHorizontal: spacing.lg }}><SkeletonList rows={5} /></View>
      ) : (
        <FlatList
          data={shown}
          keyExtractor={(d) => d.customer_id}
          contentContainerStyle={s.list}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          refreshControl={
            <RefreshControl
              refreshing={refreshing} tintColor={colors.primary}
              onRefresh={async () => {
                setRefreshing(true); await load().catch(() => {}); setRefreshing(false);
              }}
            />
          }
          ListHeaderComponent={
            /* Bo'sh natijada banner ortiqcha — pastda "Topilmadi" turibdi. */
            taxminiy && shown.length > 0 ? (
              <View style={s.hint}>
                <Icon name="qidiruv" size={15} color={colors.warning} />
                <Text style={[font.small, { color: colors.warning, flex: 1 }]}>
                  "{q.trim()}" aynan topilmadi — shunga o'xshashlari
                </Text>
              </View>
            ) : null
          }
          ListEmptyComponent={
            qidirilmoqda ? (
              /* Qidiruvda hech narsa yo'q — bu ro'yxat bo'shligi EMAS.
                 Ko'p uchraydigan sabab: mijoz "qarzi borlar" ro'yxatida
                 yo'q, chunki hisob-kitob qilib bo'lingan. Shuni aytamiz. */
              <Empty
                icon="qidiruv"
                title="Topilmadi"
                hint={onlyOwing
                  ? "Bu mijozning qarzi bo'lmasligi mumkin —"
                    + ' "Barcha mijozlar" ni ko\'ring'
                  : "Ismni boshqacha yozib yoki telefon raqami bilan qidirib ko'ring"}
                action={onlyOwing
                  ? { title: 'Barcha mijozlar', onPress: () => setOnlyOwing(false) }
                  : { title: "Qarz qo'shish", icon: 'qoshish',
                      onPress: () => router.push('/debt/new') }}
              />
            ) : (
              <Empty
                icon={onlyOwing ? 'tasdiq' : 'qarzlar'}
                title={onlyOwing ? "Qarzdor yo'q" : "Mijoz yo'q"}
                hint={onlyOwing
                  ? "Hamma hisob-kitob qilingan — barakalla. Eski daftardagi"
                    + ' qarzlar bo\'lsa, ularni shu yerdan ko\'chiring.'
                  : undefined}
                action={{ title: "Qarz qo'shish", onPress: () => router.push('/debt/new') }}
              />
            )
          }
          renderItem={({ item }) => {
            const c = rang(item.name);
            const owing = Number(item.balance) > 0;
            return (
              <PressScale
                accessibilityRole="button"
                accessibilityLabel={`${item.name}, qarzi ${money(item.balance)} so'm`}
                onPress={() => router.push(`/debt/${item.customer_id}`)}
                scale={0.985}
                style={[
                  s.card,
                  item.overdue ? { borderLeftWidth: 3, borderLeftColor: colors.danger } : null,
                ]}
              >
                <View style={[s.avatar, { backgroundColor: c.bg }]}>
                  <Text style={[font.h3, { color: c.fg }]}>
                    {item.name.charAt(0).toUpperCase()}
                  </Text>
                </View>

                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={[font.bodyBold, { color: colors.text }]} numberOfLines={1}>
                    {item.name}
                  </Text>
                  {item.nearest_due ? (
                    <Text style={[
                      font.tiny,
                      { color: item.overdue ? colors.danger : colors.textMuted },
                    ]}>
                      {item.overdue ? "Muddati o'tgan: " : 'Muddat: '}
                      {sanaMatni(item.nearest_due)}
                    </Text>
                  ) : null}
                  {/* Raqam bo'yicha qidirilganda u ko'rinib tursin —
                      do'konchi topilgan mijoz o'shami-yo'qmi, tekshirsin. */}
                  {item.phone && (qidirilmoqda || !item.nearest_due) ? (
                    <Text style={[font.tiny, { color: colors.textMuted }]}>{item.phone}</Text>
                  ) : null}
                </View>

                <Text style={[
                  font.num,
                  { color: owing ? colors.danger : colors.success },
                ]}>
                  {money(item.balance)}
                </Text>

                {item.phone ? (
                  <IconButton
                    name="telefon"
                    label={`${item.name} ga qo'ng'iroq qilish`}
                    tone="soft"
                    size={18}
                    style={{ minWidth: 40, minHeight: 40 }}
                    onPress={() => Linking.openURL(`tel:${item.phone}`)}
                  />
                ) : null}
              </PressScale>
            );
          }}
        />
      )}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  head: { paddingHorizontal: spacing.lg, gap: spacing.md, paddingBottom: spacing.md },
  searchBox: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    height: 46,
    borderWidth: 1, borderColor: colors.border,
  },
  search: {
    flex: 1, height: '100%',
    fontSize: 16, fontFamily: 'Inter_500Medium', color: colors.text,
  },
  hint: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    backgroundColor: colors.warningSoft,
    borderWidth: 1, borderColor: colors.warningLine,
    borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.xs,
  },
  summary: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    backgroundColor: colors.surface, borderRadius: radius.lg,
    padding: spacing.lg,
    borderWidth: 1, borderColor: colors.borderSoft,
    ...elevation[2],
  },
  list: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xxxl, gap: spacing.sm },
  card: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    backgroundColor: colors.surface, borderRadius: radius.lg,
    padding: spacing.md,
    borderWidth: 1, borderColor: colors.borderSoft,
    ...elevation[1],
  },
  avatar: {
    width: 44, height: 44, borderRadius: radius.pill,
    alignItems: 'center', justifyContent: 'center',
  },
});
