import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import { C, F, R } from '../lib/theme';
import { logout } from '../lib/api';

export default function SettingsScreen({ onLogout }: { onLogout: () => void }) {
  const handleLogout = () => {
    Alert.alert('Log Out', 'Are you sure?', [
      { text: 'Cancel' },
      { text: 'Log Out', style: 'destructive', onPress: async () => { await logout(); onLogout(); } },
    ]);
  };

  return (
    <View style={s.container}>
      <Text style={s.title}>Settings</Text>
      <View style={s.card}>
        <Text style={s.label}>App</Text>
        <Text style={s.value}>GoFarther AI v1.0.0</Text>
      </View>
      <View style={s.card}>
        <Text style={s.label}>AI Model</Text>
        <Text style={s.value}>Claude Sonnet 4</Text>
      </View>
      <View style={s.card}>
        <Text style={s.label}>Image Generation</Text>
        <Text style={s.value}>DALL-E 3</Text>
      </View>
      <View style={s.card}>
        <Text style={s.label}>Voice</Text>
        <Text style={s.value}>ElevenLabs</Text>
      </View>
      <TouchableOpacity style={s.logoutBtn} onPress={handleLogout}>
        <Text style={s.logoutText}>Log Out</Text>
      </TouchableOpacity>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg, padding: 20, paddingTop: 60 },
  title: { fontSize: F.xxl, fontWeight: '700', color: C.text, marginBottom: 24 },
  card: { backgroundColor: C.card, borderRadius: R.md, padding: 16, marginBottom: 8, flexDirection: 'row', justifyContent: 'space-between' },
  label: { fontSize: F.md, color: C.textMid },
  value: { fontSize: F.md, color: C.text },
  logoutBtn: { backgroundColor: C.red + '20', borderRadius: R.md, padding: 16, alignItems: 'center', marginTop: 24 },
  logoutText: { color: C.red, fontSize: F.md, fontWeight: '600' },
});
