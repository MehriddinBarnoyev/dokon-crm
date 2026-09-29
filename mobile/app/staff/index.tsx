/**
 * XODIMLAR
 * ========
 * Kim savdo qildi, kim qarz berdi yoki yig'di — bularning barchasi bazada
 * `user_id` orqali saqlanardi, lekin ko'rsatadigan ekran yo'q edi.
 *
 * Faqat do'kon egasiga ko'rinadi. Ro'yxatning o'zi bugungi faoliyatni ham
 * ko'rsatadi — alohida "statistika" ekrani ochish shart emas, bir qarashda
 * kim nima qilgani ko'rinadi.
 */
import { useCallback, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { api } from '../../src/api/client';
import { useAuth } from '../../src/api/auth';
import type { Employee } from '../../src/api/types';
import { Badge, Empty, IconButton } from '../../src/components/ui';
import { ScreenHeader } from '../../src/components/ScreenHeader';
import { SkeletonList } from '../../src/components/Skeleton';
import { PressScale } from '../../src/components/Press';
import { useConfirm } from '../../src/components/Confirm';
import { useToast } from '../../src/components/Toast';
import { Icon, type IconName } from '../../src/components/Icon';
import { colors, font, money, radius, spacing } from '../../src/theme';

export default function StaffScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const confirm = useConfirm();
  const toast = useToast();
  const [items, setItems] = useState<Employee[] | null>(null);
  const [xato, setXato] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  /**
   * Xato ko'rsatilishi SHART — busiz server javob bermasa (uyquda, tarmoq
   * uzilgan) ekran abadiy skeletonda "muzlab" qolardi: na xato, na qayta
   * urinish tugmasi. Boshqa ro'yxat ekranlarida (`lib/keshRoyxat.ts`) bu
   * allaqachon hal qilingan, bu yerda oddiy `useState` bilan yozilgani
   * uchun alohida qo'shilishi kerak edi.
   */
  const load = useCallback(async () => {
    try {
      const yangi = await api<Employee[]>('/auth/staff');
      setItems(yangi);
      setXato(null);
    } catch (e: any) {
      setXato(e?.message ?? 'Xatolik');
    }
  }, []);

  // Faqat egasi kira oladi — sotuvchi to'g'ridan-to'g'ri havola orqali
  // kirmoqchi bo'lsa ham (server baribir 403 qaytaradi), ekran shu yerda
  // darhol qaytaradi.
  useFocusEffect(useCallback(() => {
    if (user && user.role !== 'owner') { router.replace('/(tabs)'); return; }
    load();
  }, [load, user]));

  async function toggle(e: Employee) {
    const blok = e.is_active;
    const ok = await confirm({
      title: blok ? 'Xodimni bloklash' : 'Xodimni faollashtirish',
      icon: 'xodimlar',
      lines: [
        e.name,
        blok
          ? "Bloklangandan keyin bu raqam bilan kira olmaydi. Yozgan savdo va qarzlari tarixda qoladi."
          : "Qaytadan o'z raqami va paroli bilan kira oladi.",
      ],
      confirmText: blok ? 'Bloklash' : 'Faollashtirish',
      destructive: blok,
    });
    if (!ok) return;

    try {
      await api(`/auth/staff/${e.id}`, { method: 'PATCH', body: { is_active: !blok } });
      await load();
      toast.ok(blok ? `${e.name} bloklandi` : `${e.name} faollashtirildi`);
    } catch (err: any) {
      toast.xato(err.message);
    }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScreenHeader
        title="Xodimlar"
        subtitle={items ? `${items.length} ta` : undefined}
        left={
          <IconButton
            name="orqaga" label="Orqaga" onPress={() => router.back()}
            tone="soft" size={22}
          />
        }
        action={{
          icon: 'qoshish', label: "Xodim qo'shish",
          onPress: () => router.push('/staff/new'),
        }}
      />

      {!items ? (
        xato ? (
          <Empty
            icon="ogohlantirish" title="Yuklab bo'lmadi" hint={xato}
            action={{ title: 'Qayta urinish', icon: 'yangilash', onPress: load }}
          />
        ) : (
          <View style={{ paddingHorizontal: spacing.lg }}><SkeletonList /></View>
        )
      ) : (
        <ScrollView
          contentContainerStyle={s.scroll}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing} tintColor={colors.primary}
              onRefresh={async () => {
                setRefreshing(true); await load(); setRefreshing(false);
              }}
            />
          }
        >
          {items.length === 0 ? (
            <Empty icon="xodimlar" title="Hali xodim yo'q"
              hint="Yuqoridagi tugma orqali qo'shing" />
          ) : items.map((e) => {
            const faolBormi = e.today_sales_count > 0 || e.today_debt_given > 0
              || e.today_debt_collected > 0;
            return (
              <PressScale
                key={e.id}
                accessibilityRole="button"
                accessibilityLabel={`${e.name}, ${e.role === 'owner' ? 'egasi' : 'sotuvchi'}`}
                onPress={e.role === 'owner' ? undefined : () => toggle(e)}
                scale={e.role === 'owner' ? 1 : 0.99}
                style={[s.card, !e.is_active && { opacity: 0.55 }]}
              >
                <View style={s.rowTop}>
                  <View style={s.avatar}>
                    <Text style={[font.bodyBold, { color: colors.primary }]}>
                      {e.name.charAt(0).toUpperCase()}
                    </Text>
                  </View>
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={[font.bodyBold, { color: colors.text }]}>{e.name}</Text>
                    <Text style={[font.tiny, { color: colors.textMuted }]}>{e.phone}</Text>
                  </View>
                  <View style={{ alignItems: 'flex-end', gap: 4 }}>
                    <Badge text={e.role === 'owner' ? 'Egasi' : 'Sotuvchi'}
                      tone={e.role === 'owner' ? 'accent' : 'neutral'} />
                    {!e.is_active && <Badge text="Bloklangan" tone="danger" dot />}
                  </View>
                </View>

                {faolBormi && (
                  <View style={s.stats}>
                    {e.today_sales_count > 0 && (
                      <Stat icon="savdo"
                        text={`Bugun ${e.today_sales_count} ta savdo — ${money(e.today_sales_total)} so'm`} />
                    )}
                    {e.today_debt_given > 0 && (
                      <Stat icon="qarz" tone={colors.warning}
                        text={`Qarz berdi: ${money(e.today_debt_given)} so'm`} />
                    )}
                    {e.today_debt_collected > 0 && (
                      <Stat icon="kirim" tone={colors.success}
                        text={`Qarz yig'di: ${money(e.today_debt_collected)} so'm`} />
                    )}
                  </View>
                )}

                {e.role !== 'owner' && (
                  <Text style={[font.tiny, { color: colors.textFaint, marginTop: spacing.xs }]}>
                    {e.is_active ? 'Bloklash uchun bosing' : 'Faollashtirish uchun bosing'}
                  </Text>
                )}
              </PressScale>
            );
          })}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function Stat({ icon, text, tone }: { icon: IconName; text: string; tone?: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      <Icon name={icon} size={13} color={tone ?? colors.textMuted} />
      <Text style={[font.tiny, { color: tone ?? colors.textMuted, flex: 1 }]}>{text}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  scroll: { padding: spacing.lg, paddingTop: 0, gap: spacing.sm, paddingBottom: spacing.xxxl },
  card: {
    backgroundColor: colors.surface, borderRadius: radius.lg,
    padding: spacing.md, gap: spacing.sm,
    borderWidth: 1, borderColor: colors.borderSoft,
  },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  avatar: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: colors.primarySoft,
    alignItems: 'center', justifyContent: 'center',
  },
  stats: {
    borderTopWidth: 1, borderTopColor: colors.borderSoft,
    paddingTop: spacing.sm, gap: 4,
  },
});
