import React, { useState } from "react";
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, ActivityIndicator, KeyboardAvoidingView,
  Platform, Alert,
} from "react-native";
import { C, F, R } from "../lib/theme";
import { login } from "../lib/api";

interface Props {
  onLogin: () => void;
}

export default function LoginScreen({ onLogin }: Props) {
  const [email,    setEmail]    = useState("");
  const [password, setPassword] = useState("");
  const [loading,  setLoading]  = useState(false);

  const handleLogin = async () => {
    if (!email.trim() || !password) {
      Alert.alert("Missing fields", "Please enter your email and password.");
      return;
    }
    setLoading(true);
    try {
      await login(email.trim().toLowerCase(), password);
      onLogin();
    } catch (err: any) {
      Alert.alert("Login failed", err.message ?? "Check your credentials.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={s.root}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View style={s.inner}>
        {/* Logo orb */}
        <View style={s.logoWrap}>
          <View style={s.logoGlow} />
          <View style={s.logoDot} />
        </View>

        <Text style={s.title}>isibi.ai</Text>
        <Text style={s.sub}>Log in with your isibi.ai account</Text>

        <View style={s.form}>
          <Text style={s.label}>Email</Text>
          <TextInput
            style={s.input}
            placeholder="you@example.com"
            placeholderTextColor={C.textDim}
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
          />

          <Text style={[s.label, { marginTop: 14 }]}>Password</Text>
          <TextInput
            style={s.input}
            placeholder="••••••••"
            placeholderTextColor={C.textDim}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
          />

          <TouchableOpacity
            style={[s.btn, loading && s.btnDisabled]}
            onPress={handleLogin}
            disabled={loading}
            activeOpacity={0.8}
          >
            {loading
              ? <ActivityIndicator color="#fff" size="small" />
              : <Text style={s.btnText}>Sign In</Text>
            }
          </TouchableOpacity>
        </View>

        <Text style={s.footer}>Voice-control your software</Text>
      </View>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: C.bg,
    justifyContent: "center",
  },
  inner: {
    paddingHorizontal: 28,
    alignItems: "center",
  },
  logoWrap: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: C.primaryL,
    borderWidth: 1,
    borderColor: C.primary + "55",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 18,
  },
  logoGlow: {
    position: "absolute",
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: C.primary + "10",
  },
  logoDot: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: C.primary,
    opacity: 0.9,
  },
  title: {
    fontSize: 28,
    fontWeight: "800",
    color: C.text,
    letterSpacing: 1,
  },
  sub: {
    fontSize: F.sm,
    color: C.textDim,
    marginTop: 6,
    marginBottom: 36,
    letterSpacing: 0.3,
  },
  form: {
    width: "100%",
    gap: 0,
  },
  label: {
    fontSize: F.xs,
    color: C.textMid,
    marginBottom: 6,
    fontWeight: "600",
    letterSpacing: 0.4,
    textTransform: "uppercase",
  },
  input: {
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: R.md,
    paddingHorizontal: 14,
    paddingVertical: 13,
    fontSize: F.md,
    color: C.text,
  },
  btn: {
    backgroundColor: C.primary,
    borderRadius: R.md,
    paddingVertical: 14,
    alignItems: "center",
    marginTop: 22,
  },
  btnDisabled: {
    opacity: 0.6,
  },
  btnText: {
    color: "#fff",
    fontSize: F.md,
    fontWeight: "700",
    letterSpacing: 0.3,
  },
  footer: {
    marginTop: 48,
    fontSize: F.xs,
    color: C.textDim,
    letterSpacing: 0.5,
  },
});
