import { Stack, useRouter, useSegments } from 'expo-router';
import { useEffect } from 'react';
import { View, ActivityIndicator } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { AuthProvider, useAuth } from '../src/api/auth';
import { ConfirmProvider } from '../src/components/Confirm';
import { colors } from '../src/theme';

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

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg }}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }}>
      <Stack.Screen name="login" />
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="sale/new"     options={{ presentation: 'modal' }} />
      <Stack.Screen name="product/new"  options={{ presentation: 'modal' }} />
      <Stack.Screen name="product/[id]" />
      <Stack.Screen name="debt/[id]" />
      <Stack.Screen name="day/[date]" />
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <AuthProvider>
          <ConfirmProvider>
            <StatusBar style="dark" />
            <AuthGate />
          </ConfirmProvider>
        </AuthProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
