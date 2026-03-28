import "expo-dev-client";
import React, { useEffect, useState } from "react";
import { View, ActivityIndicator } from "react-native";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { getToken } from "./src/lib/api";
import { C } from "./src/lib/theme";
import LoginScreen  from "./src/screens/LoginScreen";
import AppNavigator from "./src/navigation/AppNavigator";

export default function App() {
  const [authState, setAuthState] = useState<"loading" | "authed" | "unauthed">("loading");

  useEffect(() => {
    getToken().then(t => setAuthState(t ? "authed" : "unauthed"));
  }, []);

  if (authState === "loading") {
    return (
      <View style={{ flex: 1, backgroundColor: C.bg, justifyContent: "center", alignItems: "center" }}>
        <ActivityIndicator color={C.primary} size="large" />
      </View>
    );
  }

  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      {authState === "unauthed"
        ? <LoginScreen onLogin={() => setAuthState("authed")} />
        : <AppNavigator onLogout={() => setAuthState("unauthed")} />
      }
    </SafeAreaProvider>
  );
}
