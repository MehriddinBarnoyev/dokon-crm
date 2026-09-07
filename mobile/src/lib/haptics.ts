/**
 * Tebranish.
 * Qoida: har bosishda emas — faqat NATIJA bo'lganda.
 *   tap    — tanlov o'zgardi (chip, tab)
 *   ok     — amal muvaffaqiyatli tugadi (savdo saqlandi, qarz to'landi)
 *   xato   — amal bajarilmadi
 *   ogoh   — ogohlantirish (tugagan mahsulot, muddati o'tgan qarz)
 */
import * as Haptics from 'expo-haptics';

export const haptic = {
  tap:  () => { Haptics.selectionAsync().catch(() => {}); },
  ok:   () => { Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {}); },
  xato: () => { Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {}); },
  ogoh: () => { Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {}); },
  press:() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {}); },
};
