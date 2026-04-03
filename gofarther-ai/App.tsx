import React, { useEffect, useState } from 'react';
import { View, ActivityIndicator } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { getToken } from './src/lib/api';
import { C } from './src/lib/theme';
import LoginScreen from './src/screens/LoginScreen';
import AppNavigator from './src/navigation/AppNavigator';

export default function App() {
  const [auth, setAuth] = useState<'loading' | 'yes' | 'no'>('loading');

  useEffect(() => {
    getToken().then(t => setAuth(t ? 'yes' : 'no'));
  }, []);

  if (auth === 'loading') {
    return (
      <View style={{ flex: 1, backgroundColor: C.bg, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator color={C.primary} size="large" />
      </View>
    );
  }

  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      {auth === 'no'
        ? <LoginScreen onLogin={() => setAuth('yes')} />
        : <AppNavigator onLogout={() => setAuth('no')} />
      }
    </SafeAreaProvider>
  );
}
