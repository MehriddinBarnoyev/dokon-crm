/**
 * SANALADIGAN RAQAM
 * =================
 * Asosiy summa ekranga shunchaki "paydo bo'lmasin" — noldan o'sib chiqsin.
 * Bu bezak emas: ko'z raqam o'zgarganini ilg'aydi, savdo yozilgach
 * "tushum ko'paydi" degan his qoladi.
 *
 * Nega reanimated emas? Reanimated matnni faqat `TextInput` orqali
 * yangilay oladi, `TextInput` esa qatorda butun bo'sh joyni egallaydi —
 * yonidagi "so'm" yozuvi chetga surilib ketadi. Bitta qisqa animatsiya
 * uchun oddiy `Text` va 400 ms lik hisoblagich ancha xavfsiz.
 */
import { useEffect, useRef, useState } from 'react';
import { Text, type TextStyle, type StyleProp } from 'react-native';
import { money, motion } from '../theme';

/** Oxiriga yaqinlashganda sekinlashadi — tabiiy to'xtash. */
function easeOut(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

export function AnimatedMoney({ value, style, duration = motion.slow }: {
  value: number;
  style?: StyleProp<TextStyle>;
  duration?: number;
}) {
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  const frame = useRef<number | null>(null);

  useEffect(() => {
    const boshi = from.current;
    const farq = value - boshi;

    // O'zgarish yo'q yoki juda kichik — animatsiya qilishning ma'nosi yo'q
    if (Math.abs(farq) < 1) {
      from.current = value;
      setShown(value);
      return;
    }

    const start = Date.now();
    const tick = () => {
      const t = Math.min(1, (Date.now() - start) / duration);
      setShown(boshi + farq * easeOut(t));
      if (t < 1) frame.current = requestAnimationFrame(tick);
      else from.current = value;
    };
    frame.current = requestAnimationFrame(tick);

    return () => { if (frame.current !== null) cancelAnimationFrame(frame.current); };
  }, [value, duration]);

  return <Text style={style} numberOfLines={1}>{money(shown)}</Text>;
}
