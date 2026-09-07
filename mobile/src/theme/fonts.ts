/**
 * Shrift yuklash.
 *
 * MUHIM: har bir og'irlik ALOHIDA yo'ldan olinadi
 * (`@expo-google-fonts/inter/400Regular`), paketning umumiy indeksidan emas.
 * Indeksni import qilsak Metro 18 ta og'irlikni (kursivlari bilan, ~6 MB)
 * ilovaga qo'shib yuboradi — bizga esa faqat 4 tasi kerak.
 */
import { useFonts } from 'expo-font';
import { Inter_400Regular } from '@expo-google-fonts/inter/400Regular';
import { Inter_500Medium } from '@expo-google-fonts/inter/500Medium';
import { Inter_600SemiBold } from '@expo-google-fonts/inter/600SemiBold';
import { Inter_700Bold } from '@expo-google-fonts/inter/700Bold';

export function useAppFonts(): boolean {
  const [loaded, error] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
  });
  // Shrift yuklanmasa ham ilova ochilsin — tizim shriftida ishlayveradi.
  return loaded || Boolean(error);
}
