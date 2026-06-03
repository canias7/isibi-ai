import React, { useState, useEffect, useCallback } from 'react';
import { View } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import Drawer, { NavScreen } from '../components/Drawer';
import ChatScreen from '../screens/ChatScreen';
import AgentsScreen from '../screens/AgentsScreen';
// Templates now live in AI memory — saved via a `save_template` sidecar
// in useChat.ts and injected into every system prompt via promptContext.ts.
// The separate Templates screen was removed as of the connected-apps-only
// email rework.
import SettingsScreen from '../screens/SettingsScreen';
import ScheduledScreen from '../screens/ScheduledScreen';
import SubscriptionScreen from '../screens/SubscriptionScreen';
import { getChatSessions, saveChatSessions, ChatSession } from '../lib/storage';
import { ensureDefaultWorkspace, onWorkspaceChange } from '../lib/workspaces';
import { addNotificationResponseListener, registerForPushNotifications, unregisterFromPushNotifications } from '../lib/notifications';
import { useInactivityTimeout } from '../lib/useInactivityTimeout';
import { clearToken, logout as apiLogout } from '../lib/api';

const Stack = createNativeStackNavigator();

export default function AppNavigator({ onLogout }: { onLogout: () => void }) {
  // Full logout handler: runs the api.ts logout() which clears the
  // SecureStore token, writes the logout sentinel, clears active_user_id,
  // etc. — then calls the navigation callback to flip React state. Both
  // the drawer's "Log out" button and the inactivity timeout use this
  // so token clearing can never be skipped.
  const handleFullLogout = useCallback(async () => {
    // Unregister the device token BEFORE clearing the auth token so
    // the backend still authorizes the call. Swallow errors — if
    // unregister fails, the next push that targets this device will
    // just get DeviceNotRegistered and the server deactivates the row.
    try { await unregisterFromPushNotifications(); } catch {}
    try { await apiLogout(); } catch {}
    onLogout();
  }, [onLogout]);

  // SOC 2: auto-logout after 30 minutes of inactivity
  const { resetTimer } = useInactivityTimeout(handleFullLogout);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [chatKey, setChatKey] = useState(0);
  const navigationRef = React.useRef<any>(null);

  const loadSessions = useCallback(async () => {
    const s = await getChatSessions();
    setSessions(s);
  }, []);

  // Ensure the user has at least one workspace before loading their
  // sessions. On a fresh install after the workspaces feature ships,
  // this silently creates "Personal" and migrates all pre-workspace
  // keys into it. Idempotent on every subsequent launch.
  useEffect(() => {
    (async () => {
      await ensureDefaultWorkspace();
      await loadSessions();
      // Register for push notifications on every launch. The helper
      // is idempotent — if the token hasn't changed it's a cheap no-op
      // on the backend. Runs AFTER ensureDefaultWorkspace so the auth
      // header + workspace id are both ready.
      try { await registerForPushNotifications(); } catch {}
    })();
  }, []);

  // Reload everything when the user switches workspace: pull that
  // workspace's chat sessions, reset the active session to null so the
  // chat screen shows a clean "New chat" state, and bump chatKey to
  // force the ChatScreen to re-mount (so useChat re-hydrates with
  // the new workspace's local storage).
  useEffect(() => {
    const off = onWorkspaceChange(async () => {
      await loadSessions();
      setActiveSessionId(null);
      setChatKey(k => k + 1);
      navigationRef.current?.navigate('Chat');
    });
    return off;
  }, [loadSessions]);

  // Deep link: when user taps a notification with sessionId, open that chat
  useEffect(() => {
    return addNotificationResponseListener((sessionId) => {
      openSession(sessionId);
    });
  }, []);

  const navigate = (screen: NavScreen) => {
    setDrawerOpen(false);
    if (screen === 'chat') {
      navigationRef.current?.navigate('Chat');
    } else {
      const screenMap: Record<string, string> = { agents: 'Agents', scheduled: 'Scheduled', settings: 'Settings' };
      navigationRef.current?.navigate(screenMap[screen] || 'Chat');
    }
  };

  const openDrawer = () => {
    loadSessions();
    setDrawerOpen(true);
  };

  const openSession = (sessionId: string) => {
    setActiveSessionId(sessionId);
    setChatKey(k => k + 1);
    setDrawerOpen(false);
    navigationRef.current?.navigate('Chat');
  };

  const startNewChat = () => {
    setActiveSessionId(null);
    setChatKey(k => k + 1);
    setDrawerOpen(false);
    navigationRef.current?.navigate('Chat');
  };

  const handleSessionCreated = (session: ChatSession) => {
    setSessions(prev => [session, ...prev.filter(s => s.id !== session.id)]);
  };

  // Detect which screen is active for drawer highlighting
  const [activeScreen, setActiveScreen] = useState<NavScreen>('chat');

  return (
    <View style={{ flex: 1 }}>
      <NavigationContainer
        ref={navigationRef}
        onStateChange={(state) => {
          const route = state?.routes[state.index];
          const nameMap: Record<string, NavScreen> = { Chat: 'chat', Agents: 'agents', Scheduled: 'scheduled', Settings: 'settings' };
          setActiveScreen(nameMap[route?.name || 'Chat'] || 'chat');
        }}
      >
        <Stack.Navigator screenOptions={{ headerShown: false, animation: 'slide_from_right' }}>
          <Stack.Screen name="Chat">
            {() => (
              <ChatScreen
                key={chatKey}
                onOpenDrawer={openDrawer}
                sessionId={activeSessionId}
                onSessionCreated={handleSessionCreated}
              />
            )}
          </Stack.Screen>
          <Stack.Screen name="Agents">
            {() => <AgentsScreen onBack={() => navigationRef.current?.goBack()} />}
          </Stack.Screen>
          <Stack.Screen name="Scheduled">
            {() => <ScheduledScreen onBack={() => navigationRef.current?.goBack()} />}
          </Stack.Screen>
          <Stack.Screen name="Settings">
            {() => (
              <SettingsScreen
                onLogout={handleFullLogout}
                onBack={() => navigationRef.current?.goBack()}
                onOpenSubscription={() => navigationRef.current?.navigate('Subscription')}
              />
            )}
          </Stack.Screen>
          <Stack.Screen name="Subscription">
            {() => <SubscriptionScreen onBack={() => navigationRef.current?.goBack()} />}
          </Stack.Screen>
        </Stack.Navigator>
      </NavigationContainer>

      <Drawer
        isOpen={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        activeScreen={activeScreen}
        onNavigate={navigate}
        onLogout={handleFullLogout}
        sessions={sessions}
        activeSessionId={activeSessionId}
        onSelectSession={openSession}
        onNewChat={startNewChat}
        onSessionDeleted={(id) => {
          setSessions(prev => prev.filter(s => s.id !== id));
          if (activeSessionId === id) { setActiveSessionId(null); setChatKey(k => k + 1); }
        }}
        onSessionRenamed={(id, title) => {
          setSessions(prev => prev.map(s => s.id === id ? { ...s, title } : s));
        }}
      />
    </View>
  );
}
