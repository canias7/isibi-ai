import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, KeyboardAvoidingView, Platform, Alert, ActivityIndicator } from 'react-native';
import { C, F, R } from '../lib/theme';
import { login, signup } from '../lib/api';

export default function LoginScreen({ onLogin }: { onLogin: () => void }) {
  const [tab, setTab] = useState<'login' | 'signup'>('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    if (!email || !password || (tab === 'signup' && !name)) {
      Alert.alert('Error', 'Please fill in all fields');
      return;
    }
    setLoading(true);
    try {
      if (tab === 'signup') {
        await signup(email.toLowerCase().trim(), name.trim(), password);
      } else {
        await login(email.toLowerCase().trim(), password);
      }
      onLogin();
    } catch (e: any) {
      Alert.alert('Error', e.message || 'Something went wrong');
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView style={s.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      {/* Orb */}
      <View style={s.orb} />
      <Text style={s.title}>GoFarther AI</Text>
      <Text style={s.sub}>Your AI agent, everywhere</Text>

      {/* Tabs */}
      <View style={s.tabs}>
        <TouchableOpacity style={[s.tab, tab === 'login' && s.tabActive]} onPress={() => setTab('login')}>
          <Text style={[s.tabText, tab === 'login' && s.tabTextActive]}>Log In</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[s.tab, tab === 'signup' && s.tabActive]} onPress={() => setTab('signup')}>
          <Text style={[s.tabText, tab === 'signup' && s.tabTextActive]}>Sign Up</Text>
        </TouchableOpacity>
      </View>

      {/* Form */}
      {tab === 'signup' && (
        <TextInput style={s.input} placeholder="Full name" placeholderTextColor={C.textDim} value={name} onChangeText={setName} autoCapitalize="words" />
      )}
      <TextInput style={s.input} placeholder="Email" placeholderTextColor={C.textDim} value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" />
      <TextInput style={s.input} placeholder="Password" placeholderTextColor={C.textDim} value={password} onChangeText={setPassword} secureTextEntry />

      <TouchableOpacity style={s.btn} onPress={handleSubmit} disabled={loading}>
        {loading ? <ActivityIndicator color="white" /> : <Text style={s.btnText}>{tab === 'login' ? 'Log In' : 'Create Account'}</Text>}
      </TouchableOpacity>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg, justifyContent: 'center', alignItems: 'center', padding: 24 },
  orb: { width: 56, height: 56, borderRadius: 28, backgroundColor: C.primary, marginBottom: 16, shadowColor: C.primary, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.5, shadowRadius: 20 },
  title: { fontSize: F.xxl, fontWeight: '700', color: C.primary, marginBottom: 4 },
  sub: { fontSize: F.sm, color: C.textMid, marginBottom: 32 },
  tabs: { flexDirection: 'row', backgroundColor: C.white05, borderRadius: R.md, padding: 3, marginBottom: 20, width: '100%' },
  tab: { flex: 1, paddingVertical: 10, borderRadius: R.sm, alignItems: 'center' },
  tabActive: { backgroundColor: C.primaryFaint },
  tabText: { fontSize: F.sm, fontWeight: '600', color: C.textDim },
  tabTextActive: { color: C.primaryLight },
  input: { width: '100%', padding: 14, backgroundColor: C.white05, borderWidth: 1, borderColor: C.border, borderRadius: R.md, color: C.text, fontSize: F.md, marginBottom: 12 },
  btn: { width: '100%', padding: 16, borderRadius: R.md, backgroundColor: C.primary, alignItems: 'center', marginTop: 8 },
  btnText: { color: 'white', fontSize: F.md, fontWeight: '700' },
});
