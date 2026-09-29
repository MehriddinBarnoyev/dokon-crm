/**
 * XODIM QO'SHISH
 * ==============
 * Faqat do'kon egasi ochadi (`staff/index.tsx` orqali — server ham
 * `requireAuth` + rol tekshiruvi bilan qayta tasdiqlaydi). Yangi xodim
 * darhol o'zining raqami va paroli bilan kira oladi. Roli doim "sotuvchi" —
 * do'kon egaligi faqat `/auth/register` orqali, yangi do'kon ochilganda
 * beriladi.
 */
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { api, ApiError } from '../../src/api/client';
import { Button, Field, PhoneField } from '../../src/components/ui';
import { ModalHeader } from '../../src/components/ScreenHeader';
import { useToast } from '../../src/components/Toast';
import { useKeyboardHeight } from '../../src/lib/keyboard';
import * as tel from '../../src/lib/telefon';
import { colors, font, spacing } from '../../src/theme';

export default function YangiXodim() {
  const router = useRouter();
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const kb = useKeyboardHeight();

  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!name.trim()) { toast.ogoh('Ismini kiriting'); return; }
    if (!tel.toliqmi(phone)) {
      toast.ogoh(`Telefon raqami to'liq emas — ${tel.XONA} xona kerak`);
      return;
    }
    if (password.length < 4) {
      toast.ogoh("Parol kamida 4 ta belgidan iborat bo'lsin");
      return;
    }

    setSaving(true);
    try {
      await api('/auth/staff', {
        method: 'POST',
        body: { name: name.trim(), phone: tel.toliq(phone), password },
      });
      toast.ok(`${name.trim()} xodim sifatida qo'shildi`);
      router.back();
    } catch (e: any) {
      toast.xato(e instanceof ApiError && e.status === 409
        ? 'Bu telefon raqami band' : e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      <View style={{ flex: 1 }}>
        <ModalHeader title="Xodim qo'shish" onClose={() => router.back()} />

        <View style={s.form}>
          <Field
            label="Ismi" placeholder="Alisher"
            value={name} onChangeText={setName} autoFocus
          />
          <PhoneField value={phone} onChangeText={setPhone} />
          <Field
            label="Parol" placeholder="••••"
            value={password} onChangeText={setPassword}
            secureTextEntry
            hint="Kamida 4 ta belgi — xodim shu bilan kiradi"
          />
          <Text style={[font.tiny, { color: colors.textFaint }]}>
            Xodim sotuvchi huquqi bilan qo'shiladi: savdo, ombor va qarz yoza
            oladi, lekin boshqa xodim qo'sha olmaydi va yozuvlarni o'chira olmaydi.
          </Text>
        </View>

        <View style={[s.bar, {
          marginBottom: kb,
          paddingBottom: kb > 0 ? spacing.md : spacing.md + insets.bottom,
        }]}>
          <Button title="Qo'shish" size="lg" onPress={save} loading={saving} />
        </View>
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  form: { padding: spacing.lg, gap: spacing.md },
  bar: {
    paddingHorizontal: spacing.lg, paddingTop: spacing.md,
    backgroundColor: colors.surface,
    borderTopWidth: 1, borderTopColor: colors.borderSoft,
  },
});
