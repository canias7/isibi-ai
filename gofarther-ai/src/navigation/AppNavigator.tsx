import React, { useState, useEffect, useCallback } from 'react';
import { View } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import Drawer, { NavScreen } from '../components/Drawer';
import ChatScreen from '../screens/ChatScreen';
import AgentsScreen from '../screens/AgentsScreen';
import TemplatesScreen from '../screens/TemplatesScreen';
import SettingsScreen from '../screens/SettingsScreen';
import ScheduledScreen from '../screens/ScheduledScreen';
import { getChatSessions, saveChatSessions, ChatSession } from '../lib/storage';

const Stack = createNativeStackNavigator();

export default function AppNavigator({ onLogout }: { onLogout: () => void }) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [chatKey, setChatKey] = useState(0);
  const navigationRef = React.useRef<any>(null);

  const loadSessions = useCallback(async () => {
    const s = await getChatSessions();
    setSessions(s);
  }, []);

  useEffect(() => { loadSessions(); }, []);

  const navigate = (screen: NavScreen) => {
    setDrawerOpen(false);
    if (screen === 'chat') {
      navigationRef.current?.navigate('Chat');
    } else {
      const screenMap: Record<string, string> = { agents: 'Agents', templates: 'Templates', scheduled: 'Scheduled', settings: 'Settings' };
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
          const nameMap: Record<string, NavScreen> = { Chat: 'chat', Agents: 'agents', Templates: 'templates', Scheduled: 'scheduled', Settings: 'settings' };
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
          <Stack.Screen name="Templates">
            {() => <TemplatesScreen onBack={() => navigationRef.current?.goBack()} />}
          </Stack.Screen>
          <Stack.Screen name="Scheduled">
            {() => <ScheduledScreen onBack={() => navigationRef.current?.goBack()} />}
          </Stack.Screen>
          <Stack.Screen name="Settings">
            {() => <SettingsScreen onLogout={onLogout} onBack={() => navigationRef.current?.goBack()} />}
          </Stack.Screen>
        </Stack.Navigator>
      </NavigationContainer>

      <Drawer
        isOpen={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        activeScreen={activeScreen}
        onNavigate={navigate}
        onLogout={onLogout}
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
