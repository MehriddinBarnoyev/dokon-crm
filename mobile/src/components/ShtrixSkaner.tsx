/**
 * SHTRIX-KOD SKANERI (to'liq ekran).
 *
 * NEGA KERAK. Skaner ilgari faqat mahsulot QO'SHISH ekranida bor edi —
 * ya'ni kodni bir marta, mahsulotni ro'yxatga kiritayotganda o'qish
 * mumkin edi. Kassada esa u har savdoda kerak: nomni yozib qidirish
 * o'ndan bir soniyalik ish emas, ayniqsa "Coca-Cola 1.5L" kabi uzun
 * nomlarda va navbat turganda.
 *
 * BIR MARTA O'QISH. `onBarcodeScanned` kamera kadr bergan sayin
 * chaqiriladi — sekundiga o'nlab marta. Qulf bo'lmasa bitta shishaning
 * kodi savatga o'n marta tushardi. Shuning uchun birinchi o'qishdayoq
 * qulflab, chaqiruvchiga bir marta xabar beramiz.
 */
import { useEffect, useRef } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Button } from './ui';
import { colors, font, radius, spacing } from '../theme';

/** Do'konda uchraydigan formatlar. QR ataylab yo'q — mahsulotda bo'lmaydi. */
const BARCODE_TYPES = [
  'ean13', 'ean8', 'upc_a', 'upc_e', 'code128', 'code39', 'code93', 'itf14', 'codabar',
] as const;

export function ShtrixSkaner({ visible, onScan, onClose, hint }: {
  visible: boolean;
  /** Bitta o'qishda BIR MARTA chaqiriladi. */
  onScan: (code: string) => void;
  onClose: () => void;
  /** Ramka ostidagi matn — chaqiruvchi kontekstga moslashi uchun. */
  hint?: string;
}) {
  const [permission, requestPermission] = useCameraPermissions();
  const qulf = useRef(false);

  // Har ochilishda qulf ochiladi, aks holda ikkinchi marta hech narsa o'qilmasdi.
  useEffect(() => { if (visible) qulf.current = false; }, [visible]);

  if (!visible) return null;

  return (
    <Modal visible transparent={false} animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: '#000' }}>
        {!permission?.granted ? (
          <SafeAreaView style={s.ruxsat}>
            <Text style={[font.h2, { color: '#fff', textAlign: 'center' }]}>
              Kameraga ruxsat kerak
            </Text>
            <Text style={[font.body, { color: 'rgba(255,255,255,0.7)', textAlign: 'center' }]}>
              Shtrix-kodni o'qish uchun kamera ochiladi. Rasm saqlanmaydi.
            </Text>
            <View style={{ gap: spacing.sm, alignSelf: 'stretch' }}>
              <Button title="Ruxsat berish" onPress={() => { requestPermission(); }} />
              <Button title="Bekor" variant="ghost" onPress={onClose} />
            </View>
          </SafeAreaView>
        ) : (
          <>
            <CameraView
              style={{ flex: 1 }}
              facing="back"
              barcodeScannerSettings={{ barcodeTypes: [...BARCODE_TYPES] }}
              onBarcodeScanned={(r) => {
                if (qulf.current) return;
                qulf.current = true;
                onScan(r.data.trim());
              }}
            />

            <View style={s.overlay} pointerEvents="none">
              <View style={s.frame} />
              <Text style={s.hint}>{hint ?? "Shtrix-kodni ramka ichiga tuting"}</Text>
            </View>

            <SafeAreaView style={s.controls} edges={['bottom']}>
              <Pressable onPress={onClose} style={s.cancel} hitSlop={12}>
                <Text style={{ color: '#fff', fontSize: 16 }}>Yopish</Text>
              </Pressable>
            </SafeAreaView>
          </>
        )}
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  ruxsat: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    gap: spacing.lg, padding: spacing.xl,
  },
  overlay: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    alignItems: 'center', justifyContent: 'center', gap: spacing.lg,
  },
  frame: {
    width: '78%', height: 170, borderRadius: radius.lg,
    borderWidth: 2, borderColor: 'rgba(255,255,255,0.9)',
  },
  hint: { color: '#fff', fontSize: 15, textAlign: 'center', paddingHorizontal: spacing.xl },
  controls: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    alignItems: 'center', paddingVertical: spacing.xl,
  },
  cancel: { paddingHorizontal: spacing.xl, paddingVertical: spacing.sm },
});
