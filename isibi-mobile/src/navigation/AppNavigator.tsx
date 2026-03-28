import React, { useState, useCallback } from "react";
import { View, Text } from "react-native";
import { NavigationContainer } from "@react-navigation/native";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { C, F } from "../lib/theme";
import { Project } from "../lib/api";
import MyAppsScreen       from "../screens/MyAppsScreen";
import ConnectingScreen   from "../screens/ConnectingScreen";
import CommandScreen      from "../screens/CommandScreen";
import SettingsScreen     from "../screens/SettingsScreen";

const Tab = createBottomTabNavigator();

interface Props {
  onLogout: () => void;
}

export default function AppNavigator({ onLogout }: Props) {
  const [connectedProject, setConnectedProject] = useState<Project | null>(null);
  const [connectingProject, setConnectingProject] = useState<Project | null>(null);

  const handleConnectToApp = useCallback((project: Project) => {
    setConnectingProject(project);
  }, []);

  const handleConnected = useCallback(() => {
    if (connectingProject) {
      setConnectedProject(connectingProject);
      setConnectingProject(null);
    }
  }, [connectingProject]);

  const handleDisconnect = useCallback(() => {
    setConnectedProject(null);
    setConnectingProject(null);
  }, []);

  // Show connecting animation as full-screen overlay
  if (connectingProject) {
    return (
      <ConnectingScreen
        appName={connectingProject.name}
        onConnected={handleConnected}
      />
    );
  }

  return (
    <NavigationContainer>
      <Tab.Navigator
        screenOptions={({ route }) => ({
          headerStyle: {
            backgroundColor: C.card,
            borderBottomWidth: 1,
            borderBottomColor: C.border,
            elevation: 0,
            shadowOpacity: 0,
          },
          headerTitleStyle: {
            color: C.text,
            fontWeight: "700",
            fontSize: F.md,
          },
          tabBarStyle: {
            backgroundColor: C.card,
            borderTopColor: C.border,
            borderTopWidth: 1,
            paddingBottom: 4,
            height: 60,
          },
          tabBarActiveTintColor: C.primary,
          tabBarInactiveTintColor: C.textDim,
          tabBarLabelStyle: { fontSize: 10, fontWeight: "600", marginTop: -2 },
          tabBarIcon: ({ focused }) => {
            let icon = "";
            if (route.name === "My Apps") icon = "\uD83C\uDFE0";
            else if (route.name === "Command") icon = "\uD83C\uDFA4";
            else if (route.name === "Settings") icon = "\u2699\uFE0F";
            return (
              <Text style={{ fontSize: 20, opacity: focused ? 1 : 0.5 }}>
                {icon}
              </Text>
            );
          },
        })}
      >
        <Tab.Screen name="My Apps">
          {() => (
            <MyAppsScreen
              connectedProjectId={connectedProject?.id ?? null}
              onConnectToApp={handleConnectToApp}
              onDisconnect={handleDisconnect}
            />
          )}
        </Tab.Screen>

        {connectedProject ? (
          <Tab.Screen name="Command">
            {() => (
              <CommandScreen
                project={connectedProject}
                onDisconnect={handleDisconnect}
              />
            )}
          </Tab.Screen>
        ) : (
          <Tab.Screen
            name="Command"
            options={{
              tabBarBadge: undefined,
              tabBarLabelStyle: { fontSize: 10, fontWeight: "600", marginTop: -2, color: C.textDim },
            }}
          >
            {() => (
              <View style={{ flex: 1, backgroundColor: C.bg, alignItems: "center", justifyContent: "center", padding: 40 }}>
                <Text style={{ fontSize: 40, marginBottom: 16 }}>{"\uD83C\uDFA4"}</Text>
                <Text style={{ fontSize: F.lg, fontWeight: "700", color: C.textMid, marginBottom: 8, textAlign: "center" }}>
                  No app connected
                </Text>
                <Text style={{ fontSize: F.sm, color: C.textDim, textAlign: "center", lineHeight: 20 }}>
                  Go to My Apps and tap an app to connect. Then come back here to give commands.
                </Text>
              </View>
            )}
          </Tab.Screen>
        )}

        <Tab.Screen name="Settings">
          {() => <SettingsScreen onLogout={onLogout} />}
        </Tab.Screen>
      </Tab.Navigator>
    </NavigationContainer>
  );
}
