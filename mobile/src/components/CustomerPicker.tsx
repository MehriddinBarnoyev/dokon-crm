/**
 * MIJOZ TANLASH
 * ==============
 * Savdoda mijozni belgilash uchun. Qarzga sotishda SHART, naqd sotishda
 * ixtiyoriy — lekin foydali: keyin "bu mijoz nima olgan edi?" deb ko'rish
 * mumkin bo'ladi.
 *
 * Qidiruv xato yozilgan ismni ham topadi ("Alsiher" → "Alisher Karimov"),
 * chunki mahsulot qidiruvidagi bir xil qoidalar ishlatiladi.
 *
 * Ro'yxatda yo'q ism yozilsa — shu yerning o'zida yangi mijoz qo'shiladi
 * (ism + telefon). Telefon muhim: qarzdorga qo'ng'iroq qilish kerak bo'ladi,
 * keyin uni alohida qidirib topish esa ortiqcha ish.
 */
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator, Keyboard, Modal, Pressable, ScrollView,
  StyleSheet, Text, TextInput, View,
} from 'react-native';
import { api } from '../api/client';
import * as customerStore from '../data/customers';
import { search as fuzzySearch } from '../lib/search';
import { Button } from './ui';
import { useToast } from './Toast';
import { Icon } from './Icon';
import { colors, elevation, font, money, radius, spacing } from '../theme';

export interface PickedCustomer {
  id: string | null;      // null — yangi mijoz, savdo paytida ochiladi
  name: string;
}

/** Ombordagi tur bilan AYNAN bir xil bo'lishi uchun o'sha yerdan olinadi. */
type CustomerRow = customerStore.Customer;

export function CustomerPicker({ visible, value, onPick, onClose }: {
  visible: boolean;
  value: PickedCustomer | null;
  onPick: (c: PickedCustomer | null) => void;
  onClose: () => void;
}) {
  const toast = useToast();
  const [all, setAll] = useState<CustomerRow[]>([]);
  const [q, setQ] = useState('');
  /** Yangi mijoz formasi ochiqmi (null — yopiq). */
  const [yangiTel, setYangiTel] = useState<string | null>(null);
  const [saqlanyapti, setSaqlanyapti] = useState(false);
  /**
   * Klaviatura balandligi. Modal ichida Android oynani o'zi qisqartirmaydi
   * (edge-to-edge rejimida adjustResize ishlamaydi), shuning uchun pastdagi
   * varaqni klaviatura ustiga o'zimiz ko'taramiz — aks holda planshetda
   * yozilayotgan matn klaviatura ostida ko'rinmay qoladi.
   */
  const [kbBalandlik, setKbBalandlik] = useState(0);

  useEffect(() => {
    const ochildi = Keyboard.addListener('keyboardDidShow',
      (e) => setKbBalandlik(e.endCoordinates.height));
    const yopildi = Keyboard.addListener('keyboardDidHide',
      () => setKbBalandlik(0));
    return () => { ochildi.remove(); yopildi.remove(); };
  }, []);

  useEffect(() => {
    if (!visible) { setKbBalandlik(0); return; }
    setQ('');
    setYangiTel(null);
    // Keshdan darhol, so'ng fon so'rovi yangilaydi. Internet yo'q bo'lsa
    // ham oxirgi ma'lum ro'yxat ko'rinadi — `data/customers.ts`.
    customerStore.loadAndRefresh(setAll).then(setAll).catch(() => {});
  }, [visible]);

  /** Yangi mijozni DARHOL bazaga qo'shadi va tanlaydi. */
  async function qosh() {
    const ism = q.trim();
    if (ism.length < 2) return;
    setSaqlanyapti(true);
    try {
      const c = await api<CustomerRow>('/debts/customers', {
        method: 'POST',
        body: { name: ism, phone: yangiTel?.trim() || null },
      });
      setAll((x) => [c, ...x]);
      await customerStore.qosh(c);
      onPick({ id: c.id, name: c.name });
      onClose();
    } catch (e: any) {
      toast.xato(`Qo'shib bo'lmadi: ${e.message}`);
    } finally {
      setSaqlanyapti(false);
    }
  }

  const { items: found, taxminiy } = useMemo(
    () => fuzzySearch(all, q, (c) => c.name, { limit: 30 }),
    [all, q]);

  // Yozilgan ism ro'yxatda yo'q bo'lsa — yangi mijoz sifatida qo'shish taklifi
  const yangiTaklif = q.trim().length >= 2
    && !all.some((c) => c.name.toLowerCase() === q.trim().toLowerCase());

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={s.backdrop} onPress={onClose}>
        <Pressable
          style={[s.sheet, kbBalandlik > 0 && {
            paddingBottom: kbBalandlik + spacing.md,
            // Klaviatura ochiq bo'lsa varaqqa ko'proq joy kerak — aks holda
            // 85% chegara ro'yxatni butunlay siqib qo'yadi.
            maxHeight: '100%',
          }]}
          onPress={() => {}}
        >
          <View style={s.head}>
            <Text style={[font.h3, { color: colors.text, flex: 1 }]}>Mijoz</Text>
            <Pressable onPress={onClose} hitSlop={10}>
              <Icon name="yopish" size={22} color={colors.textMuted} />
            </Pressable>
          </View>

          <TextInput
            style={s.input}
            placeholder="Ism bo'yicha qidirish yoki yangi ism yozing"
            placeholderTextColor={colors.textFaint}
            value={q}
            onChangeText={setQ}
            autoFocus
          />

          <ScrollView
            style={{ maxHeight: 320, flexShrink: 1 }}
            keyboardShouldPersistTaps="handled"
          >
            {value && (
              <Pressable
                onPress={() => { onPick(null); onClose(); }}
                style={[s.row, { backgroundColor: colors.dangerSoft }]}
              >
                <Icon name="yopish" size={17} color={colors.danger} />
                <Text style={[font.body, { color: colors.danger, flex: 1 }]}>
                  Mijozsiz davom etish
                </Text>
              </Pressable>
            )}

            {yangiTaklif && yangiTel === null && (
              <Pressable
                onPress={() => setYangiTel('')}
                style={({ pressed }) => [s.row,
                  { backgroundColor: colors.primarySoft }, pressed && { opacity: 0.7 }]}
              >
                <Icon name="qoshish" size={18} color={colors.primary} />
                <View style={{ flex: 1 }}>
                  <Text style={[font.bodyBold, { color: colors.primary }]}>
                    "{q.trim()}" — yangi mijoz qo'shish
                  </Text>
                  <Text style={[font.tiny, { color: colors.primary }]}>
                    Telefon raqamini ham kiritish mumkin
                  </Text>
                </View>
                <Icon name="oldinga" size={16} color={colors.primary} />
              </Pressable>
            )}

            {yangiTaklif && yangiTel !== null && (
              <View style={s.yangiForma}>
                <Text style={[font.bodyBold, { color: colors.text }]}>
                  Yangi mijoz: {q.trim()}
                </Text>

                <TextInput
                  style={s.telInput}
                  placeholder="Telefon (ixtiyoriy) — +998 90 123 45 67"
                  placeholderTextColor={colors.textFaint}
                  value={yangiTel}
                  onChangeText={setYangiTel}
                  keyboardType="phone-pad"
                  autoFocus
                />

                <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                  <Button title="Bekor" variant="secondary" style={{ flex: 1 }}
                    onPress={() => setYangiTel(null)} />
                  <Pressable
                    onPress={qosh}
                    disabled={saqlanyapti}
                    style={({ pressed }) => [s.qoshBtn, pressed && { opacity: 0.8 }]}
                  >
                    {saqlanyapti
                      ? <ActivityIndicator color="#fff" size="small" />
                      : <Text style={[font.bodyBold, { color: '#fff' }]}>Qo'shish</Text>}
                  </Pressable>
                </View>
              </View>
            )}

            {taxminiy && found.length > 0 && (
              <Text style={[font.tiny, { color: colors.warning, padding: spacing.sm }]}>
                Aynan topilmadi — shunga o'xshashlari
              </Text>
            )}

            {found.map((c) => (
              <Pressable
                key={c.id}
                onPress={() => { onPick({ id: c.id, name: c.name }); onClose(); }}
                style={({ pressed }) => [s.row, pressed && { opacity: 0.7 }]}
              >
                <View style={s.avatar}>
                  <Text style={[font.small, { color: colors.primary }]}>
                    {c.name.charAt(0).toUpperCase()}
                  </Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[font.body, { color: colors.text }]}>{c.name}</Text>
                  {c.phone ? (
                    <Text style={[font.tiny, { color: colors.textMuted }]}>{c.phone}</Text>
                  ) : null}
                </View>
                {Number(c.balance) > 0 && (
                  <Text style={[font.tiny, { color: colors.danger }]}>
                    qarz {money(c.balance)}
                  </Text>
                )}
              </Pressable>
            ))}

            {found.length === 0 && !yangiTaklif && (
              <Text style={[font.small, { color: colors.textMuted, padding: spacing.md }]}>
                {q ? 'Topilmadi' : "Hali mijoz yo'q — ism yozing"}
              </Text>
            )}
          </ScrollView>

          <Button title="Yopish" variant="secondary" onPress={onClose} />
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop: {
    flex: 1, backgroundColor: colors.scrim, justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl,
    padding: spacing.xl, paddingBottom: spacing.xxl,
    gap: spacing.md, maxHeight: '85%', ...elevation[3],
  },
  head: { flexDirection: 'row', alignItems: 'center' },
  input: {
    backgroundColor: colors.surfaceAlt, borderRadius: radius.md,
    paddingHorizontal: spacing.md, height: 48, fontSize: 16, color: colors.text,
  },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    paddingVertical: spacing.md, paddingHorizontal: spacing.md,
    borderRadius: radius.md, marginBottom: spacing.xs,
  },
  yangiForma: {
    backgroundColor: colors.primarySoft,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.sm,
    marginBottom: spacing.xs,
  },
  telInput: {
    backgroundColor: colors.surface, borderRadius: radius.sm,
    paddingHorizontal: spacing.md, height: 44, fontSize: 16, color: colors.text,
  },
  qoshBtn: {
    flex: 1, height: 44, borderRadius: radius.md,
    backgroundColor: colors.primary,
    alignItems: 'center', justifyContent: 'center',
  },
  avatar: {
    width: 34, height: 34, borderRadius: 17,
    backgroundColor: colors.primarySoft,
    alignItems: 'center', justifyContent: 'center',
  },
});
