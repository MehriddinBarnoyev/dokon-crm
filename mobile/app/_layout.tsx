import { Stack, useRouter, useSegments } from 'expo-router';
import { useEffect } from 'react';
import { View, Text } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, { FadeIn } from 'react-native-reanimated';
import { AuthProvider, useAuth } from '../src/api/auth';
import { ConfirmProvider } from '../src/components/Confirm';
import { ToastProvider } from '../src/components/Toast';
import { Icon } from '../src/components/Icon';
import { useAppFonts } from '../src/theme/fonts';
import { colors, font, radius, spacing, elevation } from '../src/theme';

/**
 * Ilova ochilayotgandagi ekran.
 * Bo'sh oq ekran o'rniga logotip — birinchi soniyadayoq "yuklanyapti,
 * qotib qolgani yo'q" degan xabar beradi.
 */
function Splash() {
  return (
    <View style={{
      flex: 1, alignItems: 'center', justifyContent: 'center',
      backgroundColor: colors.bg, gap: spacing.lg,
    }}>
      <Animated.View
        entering={FadeIn.duration(300)}
        style={{
          width: 84, height: 84, borderRadius: radius.xl,
          backgroundColor: colors.surface,
          alignItems: 'center', justifyContent: 'center',
          ...elevation[2],
        }}
      >
        <Icon name="dokon" size={40} color={colors.primary} />
      </Animated.View>
      <Text style={[font.small, { color: colors.textFaint }]}>Do'kon CRM</Text>
    </View>
  );
}

/**
 * Kirilganmi-yo'qmi — shunga qarab yo'naltiradi.
 * Bu Stack ichida turishi kerak, aks holda router hali tayyor bo'lmaydi.
 */
function AuthGate() {
  const { user, loading } = useAuth();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    const inAuthScreen = segments[0] === 'login';

    if (!user && !inAuthScreen) router.replace('/login');
    else if (user && inAuthScreen) router.replace('/(tabs)');
  }, [user, loading, segments]);

  if (loading) return <Splash />;

  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }}>
      <Stack.Screen name="login" />
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="sale/new"     options={{ presentation: 'modal' }} />
      {/* Chek savdodan keyin `replace` bilan ochiladi — modal ko'rinishi
          savdo oqimining davomi ekanini bildiradi. */}
      <Stack.Screen name="chek"         options={{ presentation: 'modal' }} />
      <Stack.Screen name="product/new"  options={{ presentation: 'modal' }} />
      <Stack.Screen name="purchase/new" options={{ presentation: 'modal' }} />
      <Stack.Screen name="settings"     options={{ presentation: 'modal' }} />
      <Stack.Screen name="expense/new"  options={{ presentation: 'modal' }} />
      <Stack.Screen name="debt/new"     options={{ presentation: 'modal' }} />
      <Stack.Screen name="expense/[id]" options={{ presentation: 'modal' }} />
      <Stack.Screen name="product/[id]" />
      <Stack.Screen name="debt/[id]" />
      <Stack.Screen name="day/[date]" />
    </Stack>
  );
}

export default function RootLayout() {
  const fontsReady = useAppFonts();

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <StatusBar style="dark" />
        {/* Shrift kelmasdan chizsak, matn avval tizim shriftida chiqib,
            keyin sakrab almashadi — shuning uchun kutamiz. */}
        {!fontsReady ? <Splash /> : (
          <ToastProvider>
            <AuthProvider>
              <ConfirmProvider>
                <AuthGate />
              </ConfirmProvider>
            </AuthProvider>
          </ToastProvider>
        )}
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
