/**
 * PASTKI PANEL
 * ============
 * Panelning vazifasi — do'konchi kun davomida eng ko'p qiladigan ishni
 * eng oson qilib qo'yish. U ish esa bitta: YANGI SAVDO YOZISH.
 *
 * Avval besh bo'lim bir xil ko'rinishda turardi va "Savdo" tabi savdolar
 * RO'YXATini ochardi — yangi savdo esa faqat bosh sahifadagi tugmadan
 * boshlanardi. Ya'ni kunda yuz marta takrorlanadigan amal uchun avval
 * bosh sahifaga qaytish kerak edi.
 *
 * Endi markazda ko'tarilgan tugma turadi: qaysi bo'limda bo'lmang, bitta
 * bosishda savdo oynasi ochiladi. U qolgan ikonkalardan kattaroq, ko'k va
 * panel ustiga chiqib turadi — ko'z uni qidirmaydi.
 *
 *          ╭────╮
 *   🏠  📦 │ ➕ │ 👤  📊
 *  Bosh Ombor   Qarz Savdo
 *
 * "Hisobot" panelda emas: unga kuniga bir marta qaraladi va bosh
 * sahifadagi "Hisobot →" havolasi yetadi. Panelda joy tor — u yerda
 * faqat kun davomida qayta-qayta bosiladigan narsa turishi kerak.
 */
import React from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import type { BottomTabBarProps } from 'expo-router/tabs';
import { useRouter } from 'expo-router';
import Animated, {
  useAnimatedStyle, useSharedValue, withSpring, withTiming,
} from 'react-native-reanimated';
import { colors, elevation, font, radius, spacing } from '../theme';
import { Icon, type IconName } from './Icon';
import { haptic } from '../lib/haptics';

/** Marshrut nomi → ikonka. Ikonka nomlari `Icon.tsx` dagi ma'noli nomlar. */
const ICON: Record<string, IconName> = {
  index:    'bosh-sahifa',
  products: 'ombor',
  sales:    'savdo',
  debts:    'qarzlar',
  reports:  'hisobot',
};

/** Panelda ko'rinadigan bo'limlar — markazdagi tugmaning chapi va o'ngi. */
const CHAP = ['index', 'products'] as const;
const ONG  = ['debts', 'sales'] as const;

/** Markazdagi tugma panel ustiga shuncha chiqadi. */
const FAB_CHIQISH = 24;
const FAB_OLCHAM = 60;

export function TabBar({ state, descriptors, navigation, insets }: BottomTabBarProps) {
  const router = useRouter();

  function tab(name: string) {
    const i = state.routes.findIndex((r) => r.name === name);
    if (i < 0) return null;

    const route = state.routes[i];
    const { options } = descriptors[route.key];
    const focused = state.index === i;
    const label = typeof options.title === 'string' ? options.title : route.name;
    const base = ICON[route.name] ?? 'bosh-sahifa';

    function onPress() {
      const event = navigation.emit({
        type: 'tabPress', target: route.key, canPreventDefault: true,
      });
      if (focused || event.defaultPrevented) return;
      haptic.tap();
      navigation.navigate(route.name, route.params);
    }

    return (
      <Tab
        key={route.key}
        label={label}
        icon={(focused ? `${base}-faol` : base) as IconName}
        focused={focused}
        onPress={onPress}
      />
    );
  }

  return (
    // `box-none` — tugma ustidagi shaffof bo'sh joy ro'yxat bosishlarini
    // ushlab qolmasin. Aks holda paneldan yuqoridagi kartalar "o'lik" bo'lardi.
    <View style={s.wrap} pointerEvents="box-none">
      <View style={[s.bar, { paddingBottom: Math.max(insets.bottom, spacing.sm) }]}>
        {CHAP.map(tab)}
        {/* Markazdagi tugma panel ustida "suzadi" — bu yerda faqat uning yorlig'i */}
        <View style={s.fabSlot}>
          <Text style={[font.tiny, { color: colors.primary }]}>Savdo</Text>
        </View>
        {ONG.map(tab)}
      </View>

      <Fab onPress={() => { haptic.tap(); router.push('/sale/new'); }} />
    </View>
  );
}

/** Yangi savdo tugmasi — paneldagi eng katta nishon. */
function Fab({ onPress }: { onPress: () => void }) {
  const press = useSharedValue(1);
  const style = useAnimatedStyle(() => ({ transform: [{ scale: press.value }] }));

  return (
    <Animated.View style={[s.fabWrap, style]} pointerEvents="box-none">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Yangi savdo"
        onPress={onPress}
        onPressIn={() => { press.value = withTiming(0.92, { duration: 90 }); }}
        onPressOut={() => { press.value = withSpring(1, { damping: 14, stiffness: 260 }); }}
        style={s.fab}
      >
        <Icon name="qoshish" size={30} color={colors.onPrimary} />
      </Pressable>
    </Animated.View>
  );
}

function Tab({ label, icon, focused, onPress }: {
  label: string; icon: IconName; focused: boolean; onPress: () => void;
}) {
  const press = useSharedValue(1);

  // Kapsula faol bo'limda ochiladi. Spring — mexanik emas, tabiiy tuyulsin.
  const pill = useAnimatedStyle(() => ({
    opacity: withTiming(focused ? 1 : 0, { duration: 160 }),
    transform: [{ scale: withSpring(focused ? 1 : 0.7, { damping: 16, stiffness: 220 }) }],
  }));

  const body = useAnimatedStyle(() => ({ transform: [{ scale: press.value }] }));

  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityState={{ selected: focused }}
      accessibilityLabel={label}
      onPress={onPress}
      onPressIn={() => { press.value = withTiming(0.9, { duration: 90 }); }}
      onPressOut={() => { press.value = withSpring(1, { damping: 14, stiffness: 260 }); }}
      style={s.tab}
    >
      <Animated.View style={[s.tabInner, body]}>
        <View style={s.iconSlot}>
          <Animated.View style={[s.pill, pill]} />
          <Icon name={icon} size={22} color={focused ? colors.primary : colors.textFaint} />
        </View>
        <Text
          numberOfLines={1}
          style={[
            font.tiny,
            { color: focused ? colors.primary : colors.textFaint },
          ]}
        >
          {label}
        </Text>
      </Animated.View>
    </Pressable>
  );
}

const s = StyleSheet.create({
  /**
   * Tugma panel chegarasidan tashqariga chiqadi. Android'da ota-element
   * o'z chegarasidan tashqaridagi bolani soyasi bilan qirqib qo'yadi,
   * shuning uchun panel shaffof "wrap" ichiga olinadi va tugma o'sha
   * wrap ichida qoladi.
   */
  wrap: { paddingTop: FAB_CHIQISH },
  bar: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    paddingTop: spacing.sm,
    // Panel kontent ustida "suzsin" — ro'yxat tagiga yopishib qolmasin
    ...(Platform.OS === 'ios' ? elevation[3] : { elevation: 16 }),
  },
  tab: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  tabInner: { alignItems: 'center', gap: 3 },
  iconSlot: {
    width: 56, height: 30,
    alignItems: 'center', justifyContent: 'center',
  },
  pill: {
    position: 'absolute', left: 0, right: 0, top: 0, bottom: 0,
    borderRadius: radius.pill,
    backgroundColor: colors.primarySoft,
  },

  /* Markazdagi bo'sh o'rin — yorlig'i qolgan tablar yorlig'i bilan bir chiziqda */
  fabSlot: {
    flex: 1, alignItems: 'center',
    paddingTop: 30 + 3,        // iconSlot balandligi + tabInner oralig'i
  },
  fabWrap: {
    position: 'absolute', top: 0, left: 0, right: 0,
    alignItems: 'center',
  },
  fab: {
    width: FAB_OLCHAM, height: FAB_OLCHAM, borderRadius: radius.pill,
    backgroundColor: colors.primary,
    alignItems: 'center', justifyContent: 'center',
    // Oq panel ustida ko'k doira ajralib tursin
    borderWidth: 4, borderColor: colors.surface,
    /**
     * Android'da chizilish tartibini `elevation` hal qiladi — daraxtdagi
     * o'rni emas. Panelning elevation'i 16, shuning uchun tugmaga undan
     * KATTAROQ qiymat kerak; aks holda tugma panel ostiga tushib ketadi.
     */
    ...(Platform.OS === 'ios' ? elevation[3] : { elevation: 20 }),
  },
});
