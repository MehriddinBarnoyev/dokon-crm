import { useState } from 'react';
import {
  KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../src/api/auth';
import { Button, Field } from '../src/components/ui';
import { colors, font, radius, spacing } from '../src/theme';
import { BASE_URL } from '../src/api/client';
import { Icon } from '../src/components/Icon';

export default function LoginScreen() {
  const { login, register } = useAuth();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [busy, setBusy] = useState(false);

  const [phone, setPhone] = useState('+998901234567');
  const [password, setPassword] = useState('1234');
  const [name, setName] = useState('');
  const [shopName, setShopName] = useState('');

  async function submit() {
    setBusy(true);
    try {
      if (mode === 'login') {
        await login(phone.trim(), password);
      } else {
        if (!shopName.trim() || !name.trim()) {
          Alert.alert('To\'ldiring', 'Do\'kon nomi va ismingizni kiriting.');
          return;
        }
        await register(shopName.trim(), name.trim(), phone.trim(), password);
      }
    } catch (e: any) {
      Alert.alert('Kirib bo\'lmadi', e.message);
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
        <ScrollView
          contentContainerStyle={s.scroll}
          keyboardShouldPersistTaps="handled"
        >
          <View style={s.logo}>
            <Icon name="dokon" size={44} color={colors.primary} />
          </View>

          <Text style={[font.h1, { color: colors.text, textAlign: 'center' }]}>
            Do'kon CRM
          </Text>
          <Text style={[font.small, { color: colors.textMuted, textAlign: 'center' }]}>
            Savdo, ombor va qarz — bitta joyda
          </Text>

          <View style={s.form}>
            {mode === 'register' && (
              <>
                <Field
                  label="Do'kon nomi"
                  placeholder="Baraka Do'koni"
                  value={shopName}
                  onChangeText={setShopName}
                />
                <Field
                  label="Ismingiz"
                  placeholder="Alisher"
                  value={name}
                  onChangeText={setName}
                />
              </>
            )}

            <Field
              label="Telefon"
              placeholder="+998 90 123 45 67"
              value={phone}
              onChangeText={setPhone}
              keyboardType="phone-pad"
              autoCapitalize="none"
            />
            <Field
              label="Parol"
              placeholder="••••"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
            />

            <Button
              title={mode === 'login' ? 'Kirish' : "Ro'yxatdan o'tish"}
              onPress={submit}
              loading={busy}
              style={{ marginTop: spacing.sm }}
            />

            <Button
              title={mode === 'login'
                ? "Yangi do'kon ochish"
                : 'Menda hisob bor'}
              variant="ghost"
              onPress={() => setMode(mode === 'login' ? 'register' : 'login')}
            />
          </View>

          <Text style={[font.tiny, { color: colors.textFaint, textAlign: 'center' }]}>
            Server: {BASE_URL}
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  scroll: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: spacing.xl,
    gap: spacing.sm,
  },
  logo: {
    alignSelf: 'center',
    width: 88, height: 88,
    borderRadius: radius.xl,
    backgroundColor: colors.surface,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: spacing.md,
  },
  form: {
    gap: spacing.md,
    marginTop: spacing.xl,
    marginBottom: spacing.xl,
  },
});
