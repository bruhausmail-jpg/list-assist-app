import { Stack, useRouter } from 'expo-router';
import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export default function RootLayout() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const handleBackToHome = () => {
    router.replace({
      pathname: '/(tabs)',
      params: { homeReset: String(Date.now()) },
    });
  };

  return (
    <View style={styles.root}>
      <Stack
        screenOptions={{
          headerShown: false,
        }}
      >
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="modal" options={{ presentation: 'modal' }} />
      </Stack>

      <View
        pointerEvents="box-none"
        style={[
          styles.backToHomeContainer,
          {
            // Keep this as low as practical. A tiny safe-area adjustment keeps
            // the pill usable without floating high over camera controls.
            bottom: Math.max(0, insets.bottom - 22),
          },
        ]}
      >
        <TouchableOpacity
          activeOpacity={0.86}
          onPress={handleBackToHome}
          style={styles.backToHomeButton}
        >
          <Text style={styles.backToHomeIcon}>⌂</Text>
          <Text style={styles.backToHomeText}>Back to Home</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  backToHomeContainer: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 9999,
    elevation: 9999,
  },
  backToHomeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 32,
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.14,
    shadowRadius: 8,
    elevation: 6,
  },
  backToHomeIcon: {
    color: '#2563EB',
    fontSize: 15,
    fontWeight: '900',
    lineHeight: 17,
    marginRight: 6,
  },
  backToHomeText: {
    color: '#2563EB',
    fontSize: 14,
    fontWeight: '900',
    lineHeight: 17,
  },
});
