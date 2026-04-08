import 'react-native-get-random-values';
import * as Sentry from '@sentry/react-native';
import React, { useEffect, useState } from 'react';

Sentry.init({
  dsn: 'https://d507da0360876bf4a3624870ab19fd02@o4511162940719104.ingest.us.sentry.io/4511162961166336',
  enableAutoSessionTracking: true,
  tracesSampleRate: 0.2,
  enabled: !__DEV__,
});
import { View, ActivityIndicator, Text, TouchableOpacity } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { getToken, clearTokenIfReinstalled } from './src/lib/api';
import { C } from './src/lib/theme';
import { ThemeProvider } from './src/lib/ThemeContext';
import { hasCompletedOnboarding, getBiometricEnabled } from './src/lib/storage';
import { authenticate } from './src/lib/biometrics';
import LoginScreen from './src/screens/LoginScreen';
import OnboardingScreen from './src/screens/OnboardingScreen';
import AppNavigator from './src/navigation/AppNavigator';
import ErrorBoundary from './src/components/ErrorBoundary';
import OfflineBanner from './src/components/OfflineBanner';
import { startScheduler } from './src/lib/scheduler';
import { registerForPushNotifications } from './src/lib/notifications';
import { pullRemoteSessions } from './src/lib/chatSync';

function App() {
  const [auth, setAuth] = useState<'loading' | 'yes' | 'no'>('loading');
  const [onboarded, setOnboarded] = useState(true);
  const [locked, setLocked] = useState(false);

  useEffect(() => {
    fetch('https://isibi-backend.onrender.com/api/ghost/me').catch(() => {});
    clearTokenIfReinstalled().then(() => Promise.all([
      getToken(),
      hasCompletedOnboarding(),
      getBiometricEnabled(),
    ])).then(async ([t, ob, bioEnabled]) => {
      setOnboarded(ob);
      if (t) { startScheduler(); registerForPushNotifications(); pullRemoteSessions(); }
      if (t && bioEnabled) {
        setLocked(true);
        setAuth('yes');
        const ok = await authenticate();
        setLocked(!ok);
      } else {
        setAuth(t ? 'yes' : 'no');
      }
    });
  }, []);

  if (auth === 'loading') {
    return (
      <View style={{ flex: 1, backgroundColor: '#ffffff', justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator color={C.primary} size="large" />
      </View>
    );
  }

  return (
    <ErrorBoundary>
    <SafeAreaProvider>
    <ThemeProvider>
      <StatusBar style="dark" />
      <OfflineBanner />
      {locked ? (
        <View style={{ flex: 1, backgroundColor: '#ffffff', justifyContent: 'center', alignItems: 'center' }}>
          <Text style={{ fontSize: 17, fontWeight: '600', color: '#1a1a1a', marginBottom: 16 }}>GoFarther AI is locked</Text>
          <TouchableOpacity onPress={async () => { const ok = await authenticate(); setLocked(!ok); }} style={{ paddingHorizontal: 24, paddingVertical: 14, borderRadius: 12, backgroundColor: '#1a1a1a' }}>
            <Text style={{ color: '#fff', fontSize: 15, fontWeight: '600' }}>Unlock</Text>
          </TouchableOpacity>
        </View>
      ) : !onboarded ? (
        <OnboardingScreen onComplete={() => setOnboarded(true)} />
      ) : auth === 'no' ? (
        <LoginScreen onLogin={() => setAuth('yes')} />
      ) : (
        <AppNavigator onLogout={() => setAuth('no')} />
      )}
    </ThemeProvider>
    </SafeAreaProvider>
    </ErrorBoundary>
  );
}

export default Sentry.wrap(App);
