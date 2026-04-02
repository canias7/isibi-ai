import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { NavigationContainer } from '@react-navigation/native';
import { Text } from 'react-native';
import { C } from '../lib/theme';
import ChatScreen from '../screens/ChatScreen';
import AgentsScreen from '../screens/AgentsScreen';
import TemplatesScreen from '../screens/TemplatesScreen';
import SettingsScreen from '../screens/SettingsScreen';

const Tab = createBottomTabNavigator();

export default function AppNavigator({ onLogout }: { onLogout: () => void }) {
  return (
    <NavigationContainer>
      <Tab.Navigator
        screenOptions={{
          headerShown: false,
          tabBarStyle: { backgroundColor: C.bg, borderTopColor: C.border, borderTopWidth: 1, paddingBottom: 4, paddingTop: 4, height: 56 },
          tabBarActiveTintColor: C.primary,
          tabBarInactiveTintColor: C.textDim,
          tabBarLabelStyle: { fontSize: 10 },
        }}
      >
        <Tab.Screen
          name="Chat"
          component={ChatScreen}
          options={{ tabBarIcon: ({ color }) => <Text style={{ fontSize: 20, color }}>💬</Text> }}
        />
        <Tab.Screen
          name="Agents"
          component={AgentsScreen}
          options={{ tabBarIcon: ({ color }) => <Text style={{ fontSize: 20, color }}>🤖</Text> }}
        />
        <Tab.Screen
          name="Templates"
          component={TemplatesScreen}
          options={{ tabBarIcon: ({ color }) => <Text style={{ fontSize: 20, color }}>📄</Text> }}
        />
        <Tab.Screen
          name="Settings"
          options={{ tabBarIcon: ({ color }) => <Text style={{ fontSize: 20, color }}>⚙️</Text> }}
        >
          {() => <SettingsScreen onLogout={onLogout} />}
        </Tab.Screen>
      </Tab.Navigator>
    </NavigationContainer>
  );
}
