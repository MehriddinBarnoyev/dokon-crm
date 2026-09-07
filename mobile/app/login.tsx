import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Animated, { FadeInDown, FadeIn } from 'react-native-reanimated';
import { useAuth } from '../src/api/auth';
import { Button, Field } from '../src/components/ui';
import { useToast } from '../src/components/Toast';
import { colors, elevation, font, radius, spacing } from '../src/theme';
import { BASE_URL } from '../src/api/client';
import { Icon, type IconName } from '../src/components/Icon';

export default function LoginScreen() {
  const { login, register } = useAuth();
  const toast = useToast();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [busy, setBusy] = useState(false);

  // Ishlab chiqishda har safar qo'lda yozmaslik uchun — tayyor hisob.
  // Chiqarilgan ilovada maydonlar bo'sh keladi.
  const [phone, setPhone] = useState(__DEV__ ? '+998901234567' : '');
  const [password, setPassword] = useState(__DEV__ ? '1234' : '');
  const [name, setName] = useState('');
  const [shopName, setShopName] = useState('');

  const kirish = mode === 'login';

  async function submit() {
    if (!phone.trim() || !password) {
      toast.ogoh('Telefon va parolni kiriting');
      return;
    }
    setBusy(true);
    try {
      if (kirish) {
        await login(phone.trim(), password);
      } else {
        if (!shopName.trim() || !name.trim()) {
          toast.ogoh("Do'kon nomi va ismingizni kiriting");
          return;
        }
        await register(shopName.trim(), name.trim(), phone.trim(), password);
      }
    } catch (e: any) {
      toast.xato(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">
          <Animated.View entering={FadeInDown.duration(320)} style={{ alignItems: 'center' }}>
            <View style={s.logo}>
              <Icon name="dokon" size={40} color={colors.primary} />
            </View>

            <Text style={[font.h1, { color: colors.text, marginTop: spacing.lg }]}>
              Do'kon CRM
            </Text>
            <Text style={[font.small, { color: colors.textMuted, marginTop: 4 }]}>
              Savdo, ombor va qarz — bitta joyda
            </Text>
          </Animated.View>

          {/* Nima berishini bir qarashda ko'rsatamiz — kirishdan oldingi ishonch */}
          <Animated.View entering={FadeIn.duration(320).delay(120)} style={s.pills}>
            <Pill icon="savdo" text="Savdo" />
            <Pill icon="ombor" text="Ombor" />
            <Pill icon="qarzlar" text="Qarz" />
            <Pill icon="ai" text="AI" />
          </Animated.View>

          <Animated.View entering={FadeInDown.duration(320).delay(80)} style={s.card}>
            <View style={s.tabs}>
              <Tab label="Kirish" active={kirish} onPress={() => setMode('login')} />
              <Tab label="Yangi do'kon" active={!kirish} onPress={() => setMode('register')} />
            </View>

            <View style={s.form}>
              {!kirish && (
                <>
                  <Field
                    label="DO'KON NOMI"
                    placeholder="Baraka Do'koni"
                    value={shopName}
                    onChangeText={setShopName}
                  />
                  <Field
                    label="ISMINGIZ"
                    placeholder="Alisher"
                    value={name}
                    onChangeText={setName}
                  />
                </>
              )}

              <Field
                label="TELEFON"
                placeholder="+998 90 123 45 67"
                value={phone}
                onChangeText={setPhone}
                keyboardType="phone-pad"
                autoCapitalize="none"
                autoComplete="tel"
              />
              <Field
                label="PAROL"
                placeholder="••••"
                value={password}
                onChangeText={setPassword}
                secureTextEntry
                onSubmitEditing={submit}
                returnKeyType="go"
              />

              <Button
                title={kirish ? 'Kirish' : "Do'kon ochish"}
                size="lg"
                onPress={submit}
                loading={busy}
                style={{ marginTop: spacing.sm }}
              />
            </View>
          </Animated.View>

          <View style={s.foot}>
            <Icon name="qulf" size={13} color={colors.textFaint} />
            <Text style={[font.tiny, { color: colors.textFaint }]}>
              Ma'lumotlaringiz shifrlangan aloqa orqali uzatiladi
            </Text>
          </View>

          {/* Server manzili faqat ishlab chiqishda kerak —
              do'konchi uchun bu ortiqcha va qo'rqitadigan ma'lumot */}
          {__DEV__ ? (
            <Text style={[font.tiny, { color: colors.textFaint, textAlign: 'center' }]}>
              {BASE_URL}
            </Text>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function Tab({ label, active, onPress }: {
  label: string; active: boolean; onPress: () => void;
}) {
  return (
    <Button
      title={label}
      variant={active ? 'primary' : 'secondary'}
      size="sm"
      style={{ flex: 1 }}
      onPress={onPress}
    />
  );
}

function Pill({ icon, text }: { icon: IconName; text: string }) {
  return (
    <View style={s.pill}>
      <Icon name={icon} size={14} color={colors.primary} />
      <Text style={[font.tiny, { color: colors.textMuted }]}>{text}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  scroll: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: spacing.xl,
    gap: spacing.lg,
  },
  logo: {
    width: 84, height: 84,
    borderRadius: radius.xl,
    backgroundColor: colors.surface,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: colors.borderSoft,
    ...elevation[2],
  },
  pills: {
    flexDirection: 'row', flexWrap: 'wrap',
    justifyContent: 'center', gap: spacing.sm,
  },
  pill: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: spacing.md, paddingVertical: 6,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    borderWidth: 1, borderColor: colors.borderSoft,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    padding: spacing.lg,
    gap: spacing.lg,
    borderWidth: 1, borderColor: colors.borderSoft,
    ...elevation[2],
  },
  tabs: {
    flexDirection: 'row', gap: spacing.sm,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    padding: 4,
  },
  form: { gap: spacing.md },
  foot: {
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'center', gap: 6,
  },
});
