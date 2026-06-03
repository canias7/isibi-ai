import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { setOnboardingComplete } from '../lib/storage';

export default function OnboardingScreen({ onComplete }: { onComplete: () => void }) {
  const insets = useSafeAreaInsets();

  const finish = async () => {
    await setOnboardingComplete();
    onComplete();
  };

  return (
    <View style={[s.container, { paddingTop: insets.top, paddingBottom: insets.bottom + 24 }]}>
      <View style={s.content}>
        <Text style={s.logo}>GoFarther</Text>
        <Text style={s.title}>Your AI assistant{'\n'}that gets things done.</Text>
        <Text style={s.subtitle}>Create files, search the web, make calls,{'\n'}run code, and more — just ask.</Text>
      </View>

      <TouchableOpacity style={s.btn} onPress={finish} activeOpacity={0.8}>
        <Text style={s.btnText}>Get started</Text>
      </TouchableOpacity>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#ffffff', justifyContent: 'space-between', paddingHorizontal: 32 },
  content: { flex: 1, justifyContent: 'center' },
  logo: { fontSize: 18, fontWeight: '600', color: '#999', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 24 },
  title: { fontSize: 38, fontWeight: '800', color: '#1a1a1a', lineHeight: 46, letterSpacing: -1, marginBottom: 20 },
  subtitle: { fontSize: 17, color: '#888', lineHeight: 26 },
  btn: { backgroundColor: '#1a1a1a', borderRadius: 16, height: 56, alignItems: 'center', justifyContent: 'center' },
  btnText: { fontSize: 17, fontWeight: '600', color: '#ffffff' },
});
