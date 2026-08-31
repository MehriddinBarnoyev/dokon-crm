import { Tabs } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon, type IconName } from '../../src/components/Icon';
import { colors, font } from '../../src/theme';

/** Faol bo'limda to'ldirilgan, boshqasida chiziqli ikonka. */
function TabIcon({ name, focused }: { name: IconName; focused: boolean }) {
  return (
    <Icon
      name={(focused ? `${name}-faol` : name) as IconName}
      size={23}
      color={focused ? colors.primary : colors.textFaint}
    />
  );
}

export default function TabsLayout() {
  // Android 15+ va iOS da tizim paneli ekran ostidan joy oladi.
  // Uni hisobga olmasak, tab yorliqlari kesilib qoladi.
  const insets = useSafeAreaInsets();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textFaint,
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.border,
          height: 62 + insets.bottom,
          paddingBottom: 8 + insets.bottom,
          paddingTop: 6,
        },
        tabBarLabelStyle: { ...font.tiny },
        sceneStyle: { backgroundColor: colors.bg },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Bosh sahifa',
          tabBarIcon: ({ focused }) => <TabIcon name="bosh-sahifa" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="products"
        options={{
          title: 'Ombor',
          tabBarIcon: ({ focused }) => <TabIcon name="ombor" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="sales"
        options={{
          title: 'Savdo',
          tabBarIcon: ({ focused }) => <TabIcon name="savdo" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="debts"
        options={{
          title: 'Qarzlar',
          tabBarIcon: ({ focused }) => <TabIcon name="qarzlar" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="reports"
        options={{
          title: 'Hisobot',
          tabBarIcon: ({ focused }) => <TabIcon name="hisobot" focused={focused} />,
        }}
      />
    </Tabs>
  );
}
