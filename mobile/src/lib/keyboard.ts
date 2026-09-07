/**
 * KLAVIATURA BALANDLIGI
 * =====================
 * `KeyboardAvoidingView` Android'da `adjustResize` ga tayanadi, lekin ilova
 * edge-to-edge rejimida ishlagani uchun oyna kichraymaydi — pastdagi
 * "Saqlash" paneli klaviatura ostida ko'rinmay qoladi.
 *
 * Shuning uchun balandlikni o'zimiz o'lchaymiz va panelni qo'lda ko'taramiz.
 */
import { useEffect, useState } from 'react';
import { Keyboard, Platform } from 'react-native';

export function useKeyboardHeight(): number {
  const [height, setHeight] = useState(0);

  useEffect(() => {
    // iOS'da "will" hodisalari animatsiya bilan bir vaqtda keladi,
    // Android'da faqat "did" ishonchli ishlaydi.
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';

    const show = Keyboard.addListener(showEvent, (e) => setHeight(e.endCoordinates.height));
    const hide = Keyboard.addListener(hideEvent, () => setHeight(0));
    return () => { show.remove(); hide.remove(); };
  }, []);

  return height;
}
