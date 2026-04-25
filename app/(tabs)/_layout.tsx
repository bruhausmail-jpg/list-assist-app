import { Tabs, useRouter } from 'expo-router';
import React from 'react';

export default function TabLayout() {
  const router = useRouter();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: '#60A5FA',
        tabBarInactiveTintColor: '#94A3B8',
        tabBarLabelStyle: {
          fontWeight: '700',
          fontSize: 12,
        },
        tabBarStyle: {
          paddingBottom: 6,
          height: 70,
        },
      }}
    >
      <Tabs.Screen
        name="index"
        listeners={{
          tabPress: (event) => {
            event.preventDefault();
            router.replace({
              pathname: '/(tabs)',
              params: { homeReset: String(Date.now()) },
            });
          },
        }}
        options={{
          title: 'Start Over',
          tabBarLabel: 'Start Over',
        }}
      />
    </Tabs>
  );
}
