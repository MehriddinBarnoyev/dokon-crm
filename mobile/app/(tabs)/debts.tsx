import { useCallback, useState } from 'react';
import {
  FlatList, Pressable, RefreshControl, StyleSheet, Text, View, Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { api } from '../../src/api/client';
import type { Debtor } from '../../src/api/types';
import { Badge, Empty, Loading } from '../../src/components/ui';
import { colors, font, money, radius, shadow, spacing } from '../../src/theme';
import { Icon } from '../../src/components/Icon';

export default function DebtsScreen() {
  const router = useRouter();
  const [items, setItems] = useState<Debtor[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [onlyOwing, setOnlyOwing] = useState(true);

  const load = useCallback(async (owing: boolean) => {
    setItems(await api<Debtor[]>(`/debts${owing ? '?only_owing=1' : ''}`));
  }, []);

  useFocusEffect(useCallback(() => { load(onlyOwing).catch(() => {}); }, [load, onlyOwing]));

  const total = (items ?? []).reduce((s, d) => s + Number(d.balance), 0);
  const overdue = (items ?? []).filter((d) => d.overdue).length;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      <View style={s.head}>
        <Text style={[font.h2, { color: colors.text }]}>Qarzlar</Text>

        <View style={s.summary}>
          <View style={{ flex: 1 }}>
            <Text style={[font.tiny, { color: colors.textMuted }]}>Umumiy qarz</Text>
            <Text style={[font.h2, { color: colors.text }]}>{money(total)} so'm</Text>
          </View>
          {overdue > 0 && <Badge text={`${overdue} ta muddati o'tgan`} tone="danger" />}
        </View>

        <View style={{ flexDirection: 'row', gap: spacing.sm }}>
          <Pressable
            onPress={() => setOnlyOwing(true)}
            style={[s.chip, onlyOwing && s.chipOn]}
          >
            <Text style={[font.tiny, { color: onlyOwing ? '#fff' : colors.textMuted }]}>
              Qarzi borlar
            </Text>
          </Pressable>
          <Pressable
            onPress={() => setOnlyOwing(false)}
            style={[s.chip, !onlyOwing && s.chipOn]}
          >
            <Text style={[font.tiny, { color: !onlyOwing ? '#fff' : colors.textMuted }]}>
              Barcha mijozlar
            </Text>
          </Pressable>
        </View>
      </View>

      {!items ? <Loading /> : (
        <FlatList
          data={items}
          keyExtractor={(d) => d.customer_id}
          contentContainerStyle={s.list}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={async () => {
              setRefreshing(true); await load(onlyOwing).catch(() => {}); setRefreshing(false);
            }} />
          }
          ListEmptyComponent={
            <Empty icon="qarzlar" title={onlyOwing ? "Qarzdor yo'q" : "Mijoz yo'q"}
              hint={onlyOwing ? 'Hamma hisob-kitob qilingan' : undefined} />
          }
          renderItem={({ item }) => (
            <Pressable
              onPress={() => router.push(`/debt/${item.customer_id}`)}
              style={({ pressed }) => [s.card, pressed && { opacity: 0.8 }]}
            >
              <View style={s.avatar}>
                <Text style={[font.bodyBold, { color: colors.primary }]}>
                  {item.name.charAt(0).toUpperCase()}
                </Text>
              </View>

              <View style={{ flex: 1, gap: 2 }}>
                <Text style={[font.bodyBold, { color: colors.text }]}>{item.name}</Text>
                {item.nearest_due ? (
                  <Text style={[
                    font.tiny,
                    { color: item.overdue ? colors.danger : colors.textMuted },
                  ]}>
                    {item.overdue ? 'Muddati o\'tgan: ' : 'Muddat: '}{item.nearest_due}
                  </Text>
                ) : item.phone ? (
                  <Text style={[font.tiny, { color: colors.textMuted }]}>{item.phone}</Text>
                ) : null}
              </View>

              <View style={{ alignItems: 'flex-end', gap: 4 }}>
                <Text style={[
                  font.bodyBold,
                  { color: Number(item.balance) > 0 ? colors.danger : colors.success },
                ]}>
                  {money(item.balance)}
                </Text>
                {item.phone ? (
                  <Pressable
                    onPress={() => Linking.openURL(`tel:${item.phone}`)}
                    hitSlop={8}
                  >
                    <Icon name="telefon" size={18} color={colors.primary} />
                  </Pressable>
                ) : null}
              </View>
            </Pressable>
          )}
        />
      )}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  head: { padding: spacing.lg, gap: spacing.md },
  summary: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    backgroundColor: colors.surface, borderRadius: radius.lg,
    padding: spacing.lg, ...shadow,
  },
  chip: {
    paddingHorizontal: spacing.md, paddingVertical: 7,
    borderRadius: radius.pill, backgroundColor: colors.surfaceAlt,
  },
  chipOn: { backgroundColor: colors.primary },
  list: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.sm },
  card: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    backgroundColor: colors.surface, borderRadius: radius.lg,
    padding: spacing.md, ...shadow,
  },
  avatar: {
    width: 42, height: 42, borderRadius: radius.pill,
    backgroundColor: colors.primarySoft,
    alignItems: 'center', justifyContent: 'center',
  },
});
