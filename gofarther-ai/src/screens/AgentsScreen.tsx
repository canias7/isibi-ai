import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { C, F } from '../lib/theme';

export default function AgentsScreen() {
  return (
    <View style={s.container}>
      <Text style={s.title}>Agents</Text>
      <Text style={s.sub}>Coming soon — create custom AI agents</Text>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg, justifyContent: 'center', alignItems: 'center' },
  title: { fontSize: F.xl, fontWeight: '700', color: C.text },
  sub: { fontSize: F.sm, color: C.textDim, marginTop: 8 },
});
