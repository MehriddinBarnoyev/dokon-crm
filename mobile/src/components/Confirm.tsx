/**
 * TASDIQLASH
 * ===========
 * Bazani o'zgartiradigan har bir amal oldidan chiqadi. Pul bilan bog'liq
 * bo'lsa — summa ALOHIDA, katta harflar bilan ko'rsatiladi.
 *
 * Nega tizim Alert emas? Do'konchi tasdiqlashdan oldin nima yozilishini
 * to'liq ko'rishi kerak: qaysi mahsulot, qancha, qaysi narxda, jami qancha.
 * Tizim dialogi bunga joy bermaydi va summani ajratib ko'rsata olmaydi.
 */
import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { FadeIn, SlideInDown } from 'react-native-reanimated';
import { Button } from './ui';
import { Icon, type IconName } from './Icon';
import { colors, elevation, font, money, radius, spacing } from '../theme';

export interface ConfirmRequest {
  /** Nima bo'layotgani: "Savdoni saqlash", "Qarz berish" */
  title: string;
  icon?: IconName;
  /** Tafsilotlar — har biri alohida qator */
  lines?: string[];
  /**
   * Pulli amal bo'lsa summa. Berilsa dialogda katta qilib ko'rsatiladi.
   * Bu ataylab alohida maydon: summa hech qachon matn ichida yo'qolib
   * ketmasligi kerak.
   */
  amount?: number;
  /** Summa nimani anglatishi: "Jami", "Qarz summasi", "Chiqim" */
  amountLabel?: string;
  warnings?: string[];
  confirmText?: string;
  /** Qaytarib bo'lmaydigan amallar uchun qizil tugma */
  destructive?: boolean;
}

type Resolver = (ok: boolean) => void;

const Ctx = createContext<((req: ConfirmRequest) => Promise<boolean>) | null>(null);

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [req, setReq] = useState<ConfirmRequest | null>(null);
  const resolver = useRef<Resolver | null>(null);
  const insets = useSafeAreaInsets();

  const confirm = useCallback((r: ConfirmRequest) => {
    setReq(r);
    return new Promise<boolean>((resolve) => { resolver.current = resolve; });
  }, []);

  const close = useCallback((ok: boolean) => {
    setReq(null);
    resolver.current?.(ok);
    resolver.current = null;
  }, []);

  const value = useMemo(() => confirm, [confirm]);

  return (
    <Ctx.Provider value={value}>
      {children}

      <Modal
        visible={req !== null}
        transparent
        animationType="none"
        statusBarTranslucent
        onRequestClose={() => close(false)}
      >
        <Animated.View entering={FadeIn.duration(160)} style={{ flex: 1 }}>
        <Pressable style={s.backdrop} onPress={() => close(false)}>
          {/* Ichkariga bosilganda yopilmasin */}
          <Animated.View entering={SlideInDown.duration(260).dampingRatio(0.9)}>
          <Pressable
            style={[s.sheet, { paddingBottom: spacing.xl + insets.bottom }]}
            onPress={() => {}}
          >
            {req && (
              <>
                {/* Tutqich — varaqning pastdan chiqqanini bildiradi */}
                <View style={s.grip} />

                <View style={s.head}>
                  {req.icon ? (
                    <View style={[
                      s.iconWrap,
                      req.destructive ? { backgroundColor: colors.dangerSoft } : null,
                    ]}>
                      <Icon
                        name={req.icon} size={20}
                        color={req.destructive ? colors.danger : colors.primary}
                      />
                    </View>
                  ) : null}
                  <Text style={[font.h3, { color: colors.text, flex: 1 }]}>
                    {req.title}
                  </Text>
                </View>

                {req.amount !== undefined && (
                  <View style={s.amountBox}>
                    <Text style={[font.small, { color: colors.textMuted }]}>
                      {req.amountLabel ?? 'Jami'}
                    </Text>
                    <Text style={[font.numBig, { color: colors.text }]}>
                      {money(req.amount)} <Text style={[font.h3, { color: colors.textMuted }]}>so'm</Text>
                    </Text>
                  </View>
                )}

                {req.lines && req.lines.length > 0 && (
                  <ScrollView style={{ maxHeight: 220 }} bounces={false}>
                    <View style={s.lines}>
                      {req.lines.map((l, i) => (
                        <View key={i} style={s.lineRow}>
                          <View style={s.bullet} />
                          <Text style={[font.small, { color: colors.textMuted, flex: 1 }]}>
                            {l}
                          </Text>
                        </View>
                      ))}
                    </View>
                  </ScrollView>
                )}

                {req.warnings && req.warnings.length > 0 && (
                  <View style={s.warn}>
                    {req.warnings.map((w, i) => (
                      <View key={i} style={s.warnRow}>
                        <Icon name="ogohlantirish" size={15} color={colors.warning} />
                        <Text style={[font.small, { color: colors.warning, flex: 1 }]}>
                          {w}
                        </Text>
                      </View>
                    ))}
                  </View>
                )}

                <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                  <Button title="Bekor" variant="secondary" style={{ flex: 1 }}
                    onPress={() => close(false)} />
                  <Button
                    title={req.confirmText ?? 'Tasdiqlash'}
                    variant={req.destructive ? 'danger' : 'primary'}
                    style={{ flex: 2 }}
                    onPress={() => close(true)}
                  />
                </View>
              </>
            )}
          </Pressable>
          </Animated.View>
        </Pressable>
        </Animated.View>
      </Modal>
    </Ctx.Provider>
  );
}

/**
 * `const confirm = useConfirm()` → `if (!(await confirm({...}))) return;`
 */
export function useConfirm() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useConfirm faqat ConfirmProvider ichida ishlaydi');
  return ctx;
}

const s = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: colors.scrim,
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.xxl,
    borderTopRightRadius: radius.xxl,
    padding: spacing.xl,
    gap: spacing.md,
    ...elevation[3],
  },
  grip: {
    width: 40, height: 4, borderRadius: 2,
    backgroundColor: colors.border,
    alignSelf: 'center', marginBottom: spacing.xs,
  },
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  iconWrap: {
    width: 38, height: 38, borderRadius: radius.md,
    backgroundColor: colors.primarySoft,
    alignItems: 'center', justifyContent: 'center',
  },
  amountBox: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: 2,
  },
  lines: { gap: 7 },
  lineRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  bullet: {
    width: 4, height: 4, borderRadius: 2,
    backgroundColor: colors.borderStrong,
  },
  warn: {
    backgroundColor: colors.warningSoft,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.sm,
  },
  warnRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
});
