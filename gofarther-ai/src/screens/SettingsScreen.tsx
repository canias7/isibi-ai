import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, Alert, Linking, Switch, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { C } from '../lib/theme';
import { useTheme } from '../lib/ThemeContext';
import { Ionicons } from '@expo/vector-icons';
import { logout, getMe } from '../lib/api';
import { isBiometricAvailable, getBiometricType } from '../lib/biometrics';
import { registerForPushNotifications } from '../lib/notifications';
import { getBiometricEnabled, saveBiometricEnabled } from '../lib/storage';
import {
  getCustomInstructions, saveCustomInstructions,
  getMemory, clearMemory, MemoryFact,
  getLanguage, saveLanguage,
} from '../lib/storage';

interface UserInfo { name?: string; email?: string; }

export default function SettingsScreen({ onLogout, onBack }: { onLogout: () => void; onBack: () => void }) {
  const [user, setUser] = useState<UserInfo | null>(null);
  const [loadingUser, setLoadingUser] = useState(true);
  const [customInstructions, setCustomInstructions] = useState('');
  const [showInstructions, setShowInstructions] = useState(false);
  const [memory, setMemory] = useState<MemoryFact[]>([]);
  const [showMemory, setShowMemory] = useState(false);
  const [language, setLanguage] = useState('en');
  const [biometricOn, setBiometricOn] = useState(false);
  const [biometricAvail, setBiometricAvail] = useState(false);
  const [bioType, setBioType] = useState('Biometric');
  const [pushToken, setPushToken] = useState<string | null>(null);
  const { mode: themeMode, toggle: toggleTheme } = useTheme();

  useEffect(() => {
    getMe().then(setUser).catch(() => {}).finally(() => setLoadingUser(false));
    getCustomInstructions().then(setCustomInstructions);
    getMemory().then(setMemory);
    getLanguage().then(setLanguage);
    isBiometricAvailable().then(setBiometricAvail);
    getBiometricType().then(setBioType);
    getBiometricEnabled().then(setBiometricOn);
    registerForPushNotifications().then(setPushToken).catch(() => {});
  }, []);

  const handleLogout = () => {
    Alert.alert('Log Out', 'Are you sure?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Log Out', style: 'destructive', onPress: async () => { await logout(); onLogout(); } },
    ]);
  };

  const saveInstructions = async () => {
    await saveCustomInstructions(customInstructions);
    setShowInstructions(false);
    Alert.alert('Saved', 'Custom instructions updated');
  };

  const handleClearMemory = () => {
    Alert.alert('Clear Memory', 'The AI will forget everything it remembers about you.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Clear', style: 'destructive', onPress: async () => { await clearMemory(); setMemory([]); } },
    ]);
  };

  const initials = user?.name ? user.name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2) : (loadingUser ? '...' : '?');

  return (
    <SafeAreaView style={[s.safe, { backgroundColor: tc.bg2 }]}>
      <View style={s.header}>
        <TouchableOpacity onPress={onBack} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }} accessibilityLabel="Back" accessibilityRole="button">
          <Ionicons name="chevron-back" size={24} color={tc.text} />
        </TouchableOpacity>
        <Text style={[s.headerTitle, { color: tc.text }]}>Settings</Text>
        <View style={{ width: 28 }} />
      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={s.scrollContent} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        {/* Profile */}
        <View style={s.profileSection}>
          <View style={s.avatar}><Text style={s.avatarText}>{initials}</Text></View>
          <Text style={[s.profileName, { color: tc.text }]}>{user?.name || 'Loading...'}</Text>
          <Text style={[s.profileEmail, { color: tc.textMid }]}>{user?.email || ''}</Text>
        </View>

        {/* Custom Instructions */}
        <Text style={[s.sectionLabel, { color: tc.textMid }]}>Personalization</Text>
        <View style={[s.card, { backgroundColor: tc.bg }]}>
          <TouchableOpacity style={s.row} onPress={() => setShowInstructions(!showInstructions)}>
            <Text style={s.rowLabel}>Custom Instructions</Text>
            <Text style={s.chevron}>{showInstructions ? 'v' : '>'}</Text>
          </TouchableOpacity>
          {showInstructions && (
            <View style={s.expandedSection}>
              <Text style={s.expandedHint}>Tell the AI how to behave across all chats</Text>
              <TextInput
                style={s.instructionsInput}
                value={customInstructions}
                onChangeText={setCustomInstructions}
                placeholder="e.g. Always respond in Spanish. Be very concise. My name is Mario."
                placeholderTextColor="#bbb"
                multiline
                textAlignVertical="top"
              />
              <TouchableOpacity style={s.saveBtn} onPress={saveInstructions}>
                <Text style={s.saveBtnText}>Save Instructions</Text>
              </TouchableOpacity>
            </View>
          )}
          <View style={s.rowDivider} />
          <TouchableOpacity style={s.row} onPress={() => setShowMemory(!showMemory)}>
            <Text style={s.rowLabel}>Memory</Text>
            <Text style={s.rowValue}>{memory.length} facts</Text>
          </TouchableOpacity>
          {showMemory && (
            <View style={s.expandedSection}>
              <Text style={s.expandedHint}>Things the AI remembers about you</Text>
              {memory.length === 0 ? (
                <Text style={s.memoryEmpty}>No memories yet. Tell the AI "remember that..." in chat.</Text>
              ) : (
                memory.slice(0, 20).map(m => (
                  <Text key={m.id} style={s.memoryFact}>- {m.fact}</Text>
                ))
              )}
              {memory.length > 0 && (
                <TouchableOpacity style={s.clearMemBtn} onPress={handleClearMemory}>
                  <Text style={s.clearMemText}>Clear all memory</Text>
                </TouchableOpacity>
              )}
            </View>
          )}
          <View style={s.rowDivider} />
          <TouchableOpacity style={[s.row, s.rowLast]} onPress={() => {
            const langs = ['English', 'Spanish', 'French'];
            const codes = ['en', 'es', 'fr'];
            Alert.alert('Language', 'Choose AI response language', [
              ...langs.map((l, i) => ({
                text: l + (codes[i] === language ? ' *' : ''),
                onPress: () => { setLanguage(codes[i]); saveLanguage(codes[i]); },
              })),
              { text: 'Cancel', style: 'cancel' as const },
            ]);
          }}>
            <Text style={s.rowLabel}>AI Language</Text>
            <Text style={s.rowValue}>{language === 'en' ? 'English' : language === 'es' ? 'Spanish' : language === 'fr' ? 'French' : language === 'pt' ? 'Portuguese' : 'German'}</Text>
          </TouchableOpacity>
        </View>

        {/* App */}
        <Text style={[s.sectionLabel, { color: tc.textMid }]}>App</Text>
        <View style={[s.card, { backgroundColor: tc.bg }]}>
          <View style={s.row}>
            <Text style={s.rowLabel}>Dark Mode</Text>
            <Switch value={themeMode === 'dark'} onValueChange={toggleTheme} trackColor={{ false: '#ddd', true: C.primary + '60' }} thumbColor={themeMode === 'dark' ? C.primary : '#f4f4f4'} />
          </View>
          {biometricAvail && (
            <>
              <View style={s.rowDivider} />
              <View style={s.row}>
                <Text style={s.rowLabel}>{bioType} Lock</Text>
                <Switch value={biometricOn} onValueChange={(v) => { setBiometricOn(v); saveBiometricEnabled(v); }} trackColor={{ false: '#ddd', true: C.primary + '60' }} thumbColor={biometricOn ? C.primary : '#f4f4f4'} />
              </View>
            </>
          )}
          <View style={s.rowDivider} />
          <Row label="Notifications" value={pushToken ? 'On' : 'Off'} onPress={async () => {
            const t = await registerForPushNotifications();
            setPushToken(t);
            Alert.alert('Notifications', t ? 'Push notifications enabled' : 'Could not enable. Check Settings.');
          }} />
          <View style={s.rowDivider} />
          <Row label="AI Model" value="Claude Sonnet" />
          <Row label="Image Generation" value="DALL-E 3" />
          <Row label="Voice" value="ElevenLabs" />
          <Row label="Version" value="1.0.0" last />
        </View>

        {/* About */}
        <Text style={[s.sectionLabel, { color: tc.textMid }]}>About</Text>
        <View style={[s.card, { backgroundColor: tc.bg }]}>
          <Row label="Report Bug" chevron onPress={() => Linking.openURL('mailto:support@isibi.ai?subject=GoFarther%20Bug')} />
          <Row label="Help Center" chevron onPress={() => Linking.openURL('https://isibi.ai/help')} />
          <Row label="Terms of Use" chevron onPress={() => Linking.openURL('https://isibi.ai/terms')} />
          <Row label="Privacy Policy" chevron onPress={() => Linking.openURL('https://isibi.ai/privacy')} last />
        </View>

        {/* Log out */}
        <TouchableOpacity style={[s.logoutCard, { backgroundColor: tc.bg }]} onPress={handleLogout} activeOpacity={0.7}>
          <Text style={[s.logoutText, { color: tc.text }]}>Log out</Text>
        </TouchableOpacity>

        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

function Row({ label, value, chevron, onPress, last }: { label: string; value?: string; chevron?: boolean; onPress?: () => void; last?: boolean }) {
  const { colors: rtc } = useTheme();
  const Wrap = onPress ? TouchableOpacity : View;
  return (
    <>
      <Wrap style={[s.row, last && s.rowLast]} {...(onPress ? { onPress, activeOpacity: 0.6 } : {})} accessibilityLabel={label} accessibilityRole={onPress ? 'button' : 'text'}>
        <Text style={[s.rowLabel, { color: rtc.text }]}>{label}</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          {value ? <Text style={[s.rowValue, { color: rtc.textMid }]}>{value}</Text> : null}
          {chevron ? <Ionicons name="chevron-forward" size={16} color={rtc.textDim} /> : null}
        </View>
      </Wrap>
      {!last && <View style={s.rowDivider} />}
    </>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#f2f2f2' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 14 },
  backArrow: { fontSize: 20, color: '#1a1a1a', fontWeight: '400' },
  headerTitle: { fontSize: 17, fontWeight: '600', color: '#1a1a1a' },
  scrollContent: { paddingHorizontal: 16 },
  profileSection: { alignItems: 'center', paddingVertical: 24 },
  avatar: { width: 72, height: 72, borderRadius: 36, backgroundColor: C.primary, alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  avatarText: { fontSize: 24, fontWeight: '700', color: '#ffffff' },
  profileName: { fontSize: 20, fontWeight: '700', color: '#1a1a1a', marginBottom: 4 },
  profileEmail: { fontSize: 13, color: '#888' },
  sectionLabel: { fontSize: 12, fontWeight: '600', color: '#888', paddingHorizontal: 8, paddingTop: 20, paddingBottom: 8 },
  card: { backgroundColor: '#ffffff', borderRadius: 14, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 14, paddingHorizontal: 16 },
  rowLast: {},
  rowDivider: { height: StyleSheet.hairlineWidth, backgroundColor: '#eee', marginLeft: 16 },
  rowLabel: { fontSize: 15, fontWeight: '500', color: '#1a1a1a' },
  rowValue: { fontSize: 14, color: '#888', marginRight: 4 },
  chevron: { fontSize: 16, color: '#ccc', fontWeight: '300' },

  // Expanded sections
  expandedSection: { paddingHorizontal: 16, paddingBottom: 16 },
  expandedHint: { fontSize: 12, color: '#999', marginBottom: 8 },
  instructionsInput: { backgroundColor: '#f5f5f5', borderWidth: 1, borderColor: '#e8e8e8', borderRadius: 12, padding: 12, fontSize: 14, color: '#1a1a1a', height: 100, textAlignVertical: 'top' },
  saveBtn: { marginTop: 10, paddingVertical: 10, paddingHorizontal: 16, borderRadius: 10, backgroundColor: '#1a1a1a', alignSelf: 'flex-start' },
  saveBtnText: { fontSize: 13, fontWeight: '600', color: '#ffffff' },
  memoryEmpty: { fontSize: 13, color: '#bbb', fontStyle: 'italic' },
  memoryFact: { fontSize: 13, color: '#444', lineHeight: 20, marginBottom: 2 },
  clearMemBtn: { marginTop: 10, paddingVertical: 8, paddingHorizontal: 14, borderRadius: 8, backgroundColor: '#fef2f2', alignSelf: 'flex-start' },
  clearMemText: { fontSize: 13, color: '#ef4444', fontWeight: '500' },

  logoutCard: { backgroundColor: '#ffffff', borderRadius: 14, paddingVertical: 14, paddingHorizontal: 16, marginTop: 24, alignItems: 'center' },
  logoutText: { fontSize: 15, fontWeight: '500', color: '#1a1a1a' },
});
