/**
 * SOZLAMALAR
 * ==========
 * "Chiqish" tugmasi Hisobot ekranining tagida turardi — hisobotni pastgacha
 * varaqlagan odam tasodifan bosishi mumkin edi, va hech kim uni u yerdan
 * qidirmaydi ham. Hisobga tegishli hamma narsa endi shu yerda.
 */
import { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import Constants from 'expo-constants';
import { useAuth } from '../src/api/auth';
import { BASE_URL } from '../src/api/client';
import { useConfirm } from '../src/components/Confirm';
import { ScreenHeader } from '../src/components/ScreenHeader';
import { Button, Card, Divider, IconButton, SectionTitle } from '../src/components/ui';
import { PressScale } from '../src/components/Press';
import { useToast } from '../src/components/Toast';
import * as outbox from '../src/lib/outbox';
import { Icon, type IconName } from '../src/components/Icon';
import { colors, dateLabel, font, radius, spacing } from '../src/theme';

export default function SettingsScreen() {
  const { user, shop, logout } = useAuth();
  const confirm = useConfirm();
  const router = useRouter();
  const toast = useToast();

  const version = Constants.expoConfig?.version ?? '—';

  const [navbat, setNavbat] = useState<outbox.Mutation[]>([]);
  const [radEtilgan, setRadEtilgan] = useState<outbox.Rejected[]>([]);

  const yuklaNavbat = useCallback(async () => {
    const r = await outbox.royxat();
    setNavbat(r.navbat);
    setRadEtilgan(r.radEtilgan);
  }, []);

  useFocusEffect(useCallback(() => { yuklaNavbat().catch(() => {}); }, [yuklaNavbat]));

  async function askLogout() {
    const ok = await confirm({
      title: 'Hisobdan chiqish',
      icon: 'chiqish',
      lines: [
        'Ma\'lumotlaringiz serverda saqlanib qoladi',
        'Qaytib kirish uchun telefon va parol kerak bo\'ladi',
        'Qurilmadagi shifrlangan nusxa butunlay o\'chadi',
      ],
      // Yuborilmagan yozuv bo'lsa buni AYTAMIZ: chiqish cache'ni
      // o'chiradi, ya'ni ular yo'qolishi mumkin.
      warnings: navbat.length > 0
        ? [`${navbat.length} ta o'zgarish hali serverga yuborilmagan. `
           + 'Chiqishdan oldin yuborishga urinamiz; internet bo\'lmasa ular yo\'qoladi.']
        : [],
      confirmText: 'Chiqish',
      destructive: true,
    });
    if (ok) await logout();
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScreenHeader
        title="Sozlamalar"
        left={
          <IconButton
            name="orqaga" label="Orqaga" onPress={() => router.back()}
            tone="soft" size={22}
          />
        }
      />

      <ScrollView contentContainerStyle={s.scroll}>
        {/* Do'kon */}
        <Card>
          <View style={s.shopRow}>
            <View style={s.logo}>
              <Icon name="dokon" size={26} color={colors.primary} />
            </View>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={[font.h3, { color: colors.text }]} numberOfLines={1}>
                {shop?.name ?? "Do'kon"}
              </Text>
              <Text style={[font.small, { color: colors.textMuted }]}>
                {user?.name}{user?.role === 'owner' ? ' · egasi' : ' · sotuvchi'}
              </Text>
            </View>
          </View>
        </Card>

        {/* Yuborilmagan o'zgarishlar */}
        {(navbat.length > 0 || radEtilgan.length > 0) && (
          <>
            <SectionTitle
              right={navbat.length > 0 ? (
                <PressScale
                  accessibilityRole="button"
                  accessibilityLabel="Hozir yuborish"
                  onPress={async () => {
                    await outbox.flush().catch(() => {});
                    await yuklaNavbat();
                  }}
                  scale={0.94}
                >
                  <Text style={[font.smallBold, { color: colors.primary }]}>
                    Hozir yuborish
                  </Text>
                </PressScale>
              ) : undefined}
            >
              Yuborilmagan o'zgarishlar
            </SectionTitle>

            <Card style={{ gap: spacing.sm }}>
              {navbat.map((m) => (
                <View key={m.id} style={s.qator}>
                  <Icon name="tuzatish" size={16} color={colors.warning} />
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={[font.body, { color: colors.text }]}>{m.label}</Text>
                    <Text style={[font.tiny, { color: colors.textMuted }]}>
                      {dateLabel(m.at)}
                      {m.tries > 0 ? ` · ${m.tries} marta urinildi` : ''}
                    </Text>
                  </View>
                </View>
              ))}

              {radEtilgan.map((r) => (
                <View key={r.id} style={s.qator}>
                  <Icon name="ogohlantirish" size={16} color={colors.danger} />
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={[font.body, { color: colors.text }]}>{r.label}</Text>
                    <Text style={[font.tiny, { color: colors.danger }]}>{r.error}</Text>
                  </View>
                  <PressScale
                    accessibilityRole="button"
                    accessibilityLabel="Qayta urinish"
                    onPress={async () => {
                      await outbox.qaytaUrin(r.id);
                      await yuklaNavbat();
                      toast.info('Qayta yuborishga qo\'yildi');
                    }}
                    scale={0.94}
                  >
                    <Text style={[font.smallBold, { color: colors.primary }]}>Qayta</Text>
                  </PressScale>
                  <PressScale
                    accessibilityRole="button"
                    accessibilityLabel="O'chirish"
                    onPress={async () => {
                      const ok = await confirm({
                        title: 'O\'zgarishni tashlash',
                        icon: 'ogohlantirish',
                        lines: [r.label, r.error],
                        warnings: ['Bu yozuv serverga hech qachon bormaydi'],
                        confirmText: 'Tashlash',
                        destructive: true,
                      });
                      if (!ok) return;
                      await outbox.radniOchir(r.id);
                      await yuklaNavbat();
                    }}
                    scale={0.94}
                  >
                    <Icon name="yopish" size={16} color={colors.textFaint} />
                  </PressScale>
                </View>
              ))}
            </Card>
          </>
        )}

        {/* Ilova haqida */}
        <Card style={{ paddingVertical: spacing.sm }}>
          <Info icon="yulduz" label="Ilova versiyasi" value={version} />
          <Divider inset={38} />
          <Info icon="shield" label="Server" value={hostOf(BASE_URL)} />
        </Card>

        <Button
          title="Hisobdan chiqish"
          variant="danger"
          icon="chiqish"
          onPress={askLogout}
          style={{ marginTop: spacing.sm }}
        />

        <Text style={[font.tiny, { color: colors.textFaint, textAlign: 'center' }]}>
          Do'kon CRM · savdo, ombor va qarz bitta joyda
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

/** Uzun URL o'rniga faqat manzil ko'rsatiladi — ekran tozaroq bo'ladi. */
function hostOf(url: string): string {
  return url.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
}

function Info({ icon, label, value }: { icon: IconName; label: string; value: string }) {
  return (
    <View style={s.info}>
      <Icon name={icon} size={18} color={colors.textFaint} />
      <Text style={[font.body, { color: colors.text, flex: 1 }]}>{label}</Text>
      <Text style={[font.smallBold, { color: colors.textMuted }]} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

const s = StyleSheet.create({
  scroll: { padding: spacing.lg, paddingTop: 0, gap: spacing.md },
  shopRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  logo: {
    width: 52, height: 52, borderRadius: radius.md,
    backgroundColor: colors.primarySoft,
    alignItems: 'center', justifyContent: 'center',
  },
  info: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    paddingVertical: spacing.md,
  },
  qator: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
  },
});
