import { Tabs } from 'expo-router';
import { TabBar } from '../../src/components/TabBar';
import { colors } from '../../src/theme';

/**
 * Panelning ko'rinishi `TabBar.tsx` da. Bu yerda faqat bo'limlar va
 * ularning tartibi — do'konchi eng ko'p ochadigan ekran birinchi.
 */
export default function TabsLayout() {
  return (
    <Tabs
      tabBar={(props) => <TabBar {...props} />}
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: colors.bg },
        // Bo'limlar orasida yengil o'tish — sakrash o'rniga silliq almashinuv
        animation: 'shift',
      }}
    >
      <Tabs.Screen name="index"    options={{ title: 'Bosh sahifa' }} />
      <Tabs.Screen name="products" options={{ title: 'Ombor' }} />
      <Tabs.Screen name="sales"    options={{ title: 'Savdolar' }} />
      <Tabs.Screen name="debts"    options={{ title: 'Qarzlar' }} />
      <Tabs.Screen name="reports"  options={{ title: 'Hisobot' }} />
    </Tabs>
  );
}
