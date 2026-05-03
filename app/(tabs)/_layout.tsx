import { Tabs, useRouter } from 'expo-router';
import React from 'react';

export default function TabLayout() {
  const router = useRouter();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          display: 'none',
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
          title: 'List Assist',
          tabBarLabel: 'Home',
        }}
      />
    </Tabs>
  );
}
