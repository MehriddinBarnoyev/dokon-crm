/**
 * BOSILADIGAN YUZALAR
 * ===================
 * `opacity: 0.7` — eng arzon javob. Barmoq ostida yuza bir oz "cho'kishi"
 * kerak: shunda bosish seziladi va ilova tirik tuyuladi.
 */
import React from 'react';
import { Pressable, type PressableProps, type ViewStyle, type StyleProp } from 'react-native';
import Animated, {
  useAnimatedStyle, useSharedValue, withTiming,
} from 'react-native-reanimated';
import { motion } from '../theme';
import { haptic } from '../lib/haptics';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export function PressScale({
  children, style, onPress, scale = motion.pressScale, feedback = false,
  disabled, dim = true, ...rest
}: Omit<PressableProps, 'style'> & {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  /** Qanchalik cho'kadi. Katta karta uchun 0.985, kichik tugma uchun 0.94. */
  scale?: number;
  /** Bosilganda tebransinmi. Faqat muhim amallarda yoqiladi. */
  feedback?: boolean;
  disabled?: boolean;
  /**
   * O'chirilganda xiralashsinmi. Yuklanayotgan tugma uchun `false`:
   * u ham bosilmaydi, lekin xiralashsa ichidagi spinner ko'rinmay qoladi.
   */
  dim?: boolean;
}) {
  const k = useSharedValue(1);
  const anim = useAnimatedStyle(() => ({ transform: [{ scale: k.value }] }));

  return (
    <AnimatedPressable
      {...rest}
      disabled={disabled}
      onPressIn={(e) => {
        k.value = withTiming(scale, { duration: motion.fast });
        if (feedback) haptic.press();
        rest.onPressIn?.(e);
      }}
      onPressOut={(e) => {
        k.value = withTiming(1, { duration: motion.base });
        rest.onPressOut?.(e);
      }}
      onPress={onPress}
      style={[style, anim, disabled && dim ? { opacity: 0.45 } : null]}
    >
      {children}
    </AnimatedPressable>
  );
}
