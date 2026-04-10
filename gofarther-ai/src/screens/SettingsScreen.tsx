import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, Alert, Linking, Switch, TextInput, ActivityIndicator, Modal } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { C } from '../lib/theme';
import { useTheme } from '../lib/ThemeContext';
import { Ionicons } from '@expo/vector-icons';
import { logout, getMe, getSmtpSettings, saveSmtpSettings, detectSmtp, getConnectors, connectApp, disconnectApp, deleteAccount, getUsage, setup2FA, verify2FA, disable2FA, getSessions, revokeSession, revokeAllSessions, SessionInfo, exportMyData, startOAuth } from '../lib/api';
import * as WebBrowser from 'expo-web-browser';
import { isBiometricAvailable, getBiometricType } from '../lib/biometrics';
import { registerForPushNotifications } from '../lib/notifications';
import { getBiometricEnabled, saveBiometricEnabled } from '../lib/storage';
import {
  getCustomInstructions, saveCustomInstructions,
  getMemory, clearMemory, MemoryFact,
  getLearnedPreferences, saveLearnedPreferences, deleteLearnedPreference, LearnedPreference,
  getLanguage, saveLanguage,
  getSavedContacts, saveSavedContacts, SavedContact,
  getConnectedApps, saveConnectedApps, ConnectedApp,
} from '../lib/storage';

interface UserInfo { name?: string; email?: string; }

export default function SettingsScreen({ onLogout, onBack, onOpenSubscription }: { onLogout: () => void; onBack: () => void; onOpenSubscription?: () => void }) {
  const [user, setUser] = useState<UserInfo | null>(null);
  const [loadingUser, setLoadingUser] = useState(true);
  const [customInstructions, setCustomInstructions] = useState('');
  const [showInstructions, setShowInstructions] = useState(false);
  const [memory, setMemory] = useState<MemoryFact[]>([]);
  const [showMemory, setShowMemory] = useState(false);
  const [learnedPrefs, setLearnedPrefs] = useState<LearnedPreference[]>([]);
  const [showPrefs, setShowPrefs] = useState(false);
  const [language, setLanguage] = useState('en');
  const [contacts, setContacts] = useState<SavedContact[]>([]);
  const [showContacts, setShowContacts] = useState(false);
  const [addingContact, setAddingContact] = useState(false);
  const [newLabel, setNewLabel] = useState('');
  const [newName, setNewName] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [showSmtp, setShowSmtp] = useState(false);
  const [smtpHost, setSmtpHost] = useState('');
  const [smtpPort, setSmtpPort] = useState('587');
  const [smtpUser, setSmtpUser] = useState('');
  const [smtpPass, setSmtpPass] = useState('');
  const [smtpFrom, setSmtpFrom] = useState('');
  const [smtpConfigured, setSmtpConfigured] = useState(false);
  const [smtpProvider, setSmtpProvider] = useState('');
  const [detectingSmtp, setDetectingSmtp] = useState(false);
  const [showApps, setShowApps] = useState(false);
  const [allApps, setAllApps] = useState<any[]>([]);
  const [appCategories, setAppCategories] = useState<string[]>([]);
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [expandedApp, setExpandedApp] = useState<string | null>(null);
  const [appSearch, setAppSearch] = useState('');
  const [appCredentials, setAppCredentials] = useState<Record<string, Record<string, string>>>({});
  const [connectingApp, setConnectingApp] = useState<string | null>(null);
  const [connectedCount, setConnectedCount] = useState(0);
  const [biometricOn, setBiometricOn] = useState(false);
  const [biometricAvail, setBiometricAvail] = useState(false);
  const [bioType, setBioType] = useState('Biometric');
  // 2FA
  const [is2FAEnabled, setIs2FAEnabled] = useState(false);
  const [show2FASetup, setShow2FASetup] = useState(false);
  const [totpSecret, setTotpSecret] = useState('');
  const [totpQrUrl, setTotpQrUrl] = useState('');
  const [totpCode, setTotpCode] = useState('');
  const [setting2FA, setSetting2FA] = useState(false);
  // Sessions
  const [showSessions, setShowSessions] = useState(false);
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [loadingSessions, setLoadingSessions] = useState(false);
  const [pushToken, setPushToken] = useState<string | null>(null);
  const { mode: themeMode, toggle: toggleTheme, colors: tc } = useTheme();
  const [usageData, setUsageData] = useState<{ total_messages: number; total_tokens: number; credits_remaining: number; plan: string } | null>(null);
  const [usagePeriod, setUsagePeriod] = useState('7d');
  const [showUsage, setShowUsage] = useState(false);

  useEffect(() => {
    getMe().then((u: any) => { setUser(u); setIs2FAEnabled(u?.is_2fa_enabled || false); }).catch(() => {}).finally(() => setLoadingUser(false));
    getUsage('7d').then(setUsageData).catch(() => {});
    getCustomInstructions().then(setCustomInstructions);
    getMemory().then(setMemory);
    getLearnedPreferences().then(setLearnedPrefs);
    getLanguage().then(setLanguage);
    getSavedContacts().then(setContacts);
    getSmtpSettings().then((s: any) => {
      if (s) {
        setSmtpHost(s.smtp_host || '');
        setSmtpPort(String(s.smtp_port || 587));
        setSmtpUser(s.smtp_user || '');
        setSmtpFrom(s.smtp_from || '');
        setSmtpConfigured(s.configured || false);
      }
    }).catch(() => {});
    getConnectors().then((data: any) => {
      setAllApps(data.connectors || []);
      setAppCategories(data.categories || []);
      const connected = (data.connectors || []).filter((a: any) => a.connected);
      setConnectedCount(connected.length);
      saveConnectedApps(connected.map((a: any) => ({ id: a.id, name: a.name, category: a.category, icon: a.icon, actions: a.actions })));
    }).catch(() => {});
    isBiometricAvailable().then(setBiometricAvail);
    getBiometricType().then(setBioType);
    getBiometricEnabled().then(setBiometricOn);
    registerForPushNotifications().then(setPushToken).catch(() => {});
  }, []);

  const handleLogout = () => {
    Alert.alert('Log Out', 'Are you sure?', [
      { text: 'Cancel', style: 'cancel' },
      // onLogout is now the full handleFullLogout from AppNavigator which
      // already calls api.logout() internally — just invoke it directly.
      { text: 'Log Out', style: 'destructive', onPress: () => onLogout() },
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

  const saveContact = async () => {
    if (!newLabel.trim() || !newName.trim()) return Alert.alert('Required', 'Label and name are required');
    const updated = [...contacts, { id: Date.now().toString(), label: newLabel.trim(), name: newName.trim(), email: newEmail.trim() || undefined, phone: newPhone.trim() || undefined }];
    setContacts(updated);
    await saveSavedContacts(updated);
    setNewLabel(''); setNewName(''); setNewEmail(''); setNewPhone('');
    setAddingContact(false);
  };

  const deleteContact = async (id: string) => {
    const updated = contacts.filter(c => c.id !== id);
    setContacts(updated);
    await saveSavedContacts(updated);
  };

  const handleSaveSmtp = async () => {
    try {
      await saveSmtpSettings({
        smtp_host: smtpHost.trim() || undefined,
        smtp_port: parseInt(smtpPort) || 587,
        smtp_user: smtpUser.trim() || undefined,
        smtp_pass: smtpPass.trim() || undefined,
        smtp_from: smtpFrom.trim() || undefined,
      });
      setSmtpConfigured(!!smtpHost.trim() && !!smtpUser.trim() && !!smtpPass.trim());
      Alert.alert('Saved', 'Email settings updated');
      setShowSmtp(false);
    } catch (e: any) {
      Alert.alert('Error', e.message || 'Could not save settings');
    }
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

        {/* Subscription */}
        {onOpenSubscription && (
          <>
            <Text style={[s.sectionLabel, { color: tc.textMid }]}>Billing</Text>
            <View style={[s.card, { backgroundColor: tc.bg }]}>
              <TouchableOpacity style={s.row} onPress={onOpenSubscription}>
                <Text style={s.rowLabel}>Subscription & Plans</Text>
                <Text style={s.chevron}>{'>'}</Text>
              </TouchableOpacity>
            </View>
          </>
        )}

        {/* Usage Stats */}
        <Text style={[s.sectionLabel, { color: tc.textMid }]}>Usage</Text>
        <View style={[s.card, { backgroundColor: tc.bg }]}>
          <TouchableOpacity style={s.row} onPress={() => { setShowUsage(!showUsage); if (!showUsage && !usageData) getUsage(usagePeriod).then(setUsageData).catch(() => {}); }}>
            <Text style={s.rowLabel}>Usage & Analytics</Text>
            <Text style={s.chevron}>{showUsage ? 'v' : '>'}</Text>
          </TouchableOpacity>
          {showUsage && (
            <View style={s.expandedSection}>
              <View style={{ flexDirection: 'row', gap: 8, marginBottom: 12 }}>
                {['7d', '30d', 'all'].map(p => (
                  <TouchableOpacity key={p} onPress={() => { setUsagePeriod(p); getUsage(p).then(setUsageData).catch(() => {}); }}
                    style={{ paddingHorizontal: 14, paddingVertical: 6, borderRadius: 16, backgroundColor: usagePeriod === p ? '#1a1a1a' : '#f0f0f0' }}>
                    <Text style={{ fontSize: 12, fontWeight: '600', color: usagePeriod === p ? '#fff' : '#666' }}>{p === '7d' ? '7 Days' : p === '30d' ? '30 Days' : 'All Time'}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              {usageData ? (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
                  <View style={{ flex: 1, minWidth: '45%', padding: 12, borderRadius: 12, backgroundColor: '#f8f8f8' }}>
                    <Text style={{ fontSize: 22, fontWeight: '700', color: tc.text }}>{usageData.total_messages}</Text>
                    <Text style={{ fontSize: 11, color: tc.textDim, marginTop: 2 }}>Messages</Text>
                  </View>
                  <View style={{ flex: 1, minWidth: '45%', padding: 12, borderRadius: 12, backgroundColor: '#f8f8f8' }}>
                    <Text style={{ fontSize: 22, fontWeight: '700', color: tc.text }}>{usageData.total_tokens >= 1000 ? `${(usageData.total_tokens / 1000).toFixed(1)}k` : usageData.total_tokens}</Text>
                    <Text style={{ fontSize: 11, color: tc.textDim, marginTop: 2 }}>Tokens Used</Text>
                  </View>
                  <View style={{ flex: 1, minWidth: '45%', padding: 12, borderRadius: 12, backgroundColor: '#f8f8f8' }}>
                    <Text style={{ fontSize: 22, fontWeight: '700', color: tc.text }}>{usageData.credits_remaining}</Text>
                    <Text style={{ fontSize: 11, color: tc.textDim, marginTop: 2 }}>Credits Left</Text>
                  </View>
                  <View style={{ flex: 1, minWidth: '45%', padding: 12, borderRadius: 12, backgroundColor: '#f8f8f8' }}>
                    <Text style={{ fontSize: 22, fontWeight: '700', color: tc.text, textTransform: 'capitalize' }}>{usageData.plan}</Text>
                    <Text style={{ fontSize: 11, color: tc.textDim, marginTop: 2 }}>Plan</Text>
                  </View>
                </View>
              ) : (
                <Text style={{ fontSize: 13, color: tc.textDim }}>Loading usage data...</Text>
              )}
            </View>
          )}
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
                style={[s.instructionsInput, { color: tc.text }]}
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
                  <Text key={m.id} style={[s.memoryFact, { color: tc.textMid }]}>- {m.fact}</Text>
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
          <TouchableOpacity style={s.row} onPress={() => setShowPrefs(!showPrefs)}>
            <Text style={s.rowLabel}>Learned Preferences</Text>
            <Text style={s.rowValue}>{learnedPrefs.length} rules</Text>
          </TouchableOpacity>
          {showPrefs && (
            <View style={s.expandedSection}>
              <Text style={s.expandedHint}>Patterns learned from your thumbs up/down reactions</Text>
              {learnedPrefs.length === 0 ? (
                <Text style={s.memoryEmpty}>No preferences learned yet. React to AI messages with thumbs up/down to train it.</Text>
              ) : (
                learnedPrefs.map(p => (
                  <View key={p.id} style={{ flexDirection: 'row', alignItems: 'flex-start', marginBottom: 6 }}>
                    <Text style={[s.memoryFact, { flex: 1, color: tc.textMid }]}>- {p.rule}</Text>
                    <TouchableOpacity onPress={async () => {
                      await deleteLearnedPreference(p.id);
                      setLearnedPrefs(prev => prev.filter(x => x.id !== p.id));
                    }} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                      <Ionicons name="close-circle" size={18} color="#ccc" />
                    </TouchableOpacity>
                  </View>
                ))
              )}
              {learnedPrefs.length > 0 && (
                <TouchableOpacity style={s.clearMemBtn} onPress={() => {
                  Alert.alert('Clear Preferences', 'Remove all learned rules?', [
                    { text: 'Cancel', style: 'cancel' },
                    { text: 'Clear', style: 'destructive', onPress: async () => {
                      await saveLearnedPreferences([]);
                      setLearnedPrefs([]);
                    }},
                  ]);
                }}>
                  <Text style={s.clearMemText}>Clear all preferences</Text>
                </TouchableOpacity>
              )}
            </View>
          )}
          <View style={s.rowDivider} />
          <TouchableOpacity style={s.row} onPress={() => setShowContacts(!showContacts)}>
            <Text style={s.rowLabel}>My Contacts</Text>
            <Text style={s.rowValue}>{contacts.length} saved</Text>
          </TouchableOpacity>
          {showContacts && (
            <View style={s.expandedSection}>
              <Text style={s.expandedHint}>People the AI should know — "my boss", "my mom", etc.</Text>
              {contacts.length === 0 && !addingContact && (
                <Text style={s.memoryEmpty}>No contacts yet. Add someone the AI should know.</Text>
              )}
              {contacts.map(c => (
                <View key={c.id} style={s.contactRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={[s.contactLabel, { color: tc.text }]}>{c.label}</Text>
                    <Text style={s.contactDetail}>{c.name}{c.email ? ` · ${c.email}` : ''}{c.phone ? ` · ${c.phone}` : ''}</Text>
                  </View>
                  <TouchableOpacity onPress={() => deleteContact(c.id)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                    <Ionicons name="close-circle" size={20} color="#ccc" />
                  </TouchableOpacity>
                </View>
              ))}
              {addingContact ? (
                <View style={s.addContactForm}>
                  <TextInput style={s.contactInput} value={newLabel} onChangeText={setNewLabel} placeholder='Label (e.g. "My boss")' placeholderTextColor="#bbb" autoFocus />
                  <TextInput style={s.contactInput} value={newName} onChangeText={setNewName} placeholder="Name" placeholderTextColor="#bbb" />
                  <TextInput style={s.contactInput} value={newEmail} onChangeText={setNewEmail} placeholder="Email (optional)" placeholderTextColor="#bbb" keyboardType="email-address" autoCapitalize="none" />
                  <TextInput style={s.contactInput} value={newPhone} onChangeText={setNewPhone} placeholder="Phone (optional)" placeholderTextColor="#bbb" keyboardType="phone-pad" />
                  <View style={{ flexDirection: 'row', gap: 8, marginTop: 4 }}>
                    <TouchableOpacity style={s.saveBtn} onPress={saveContact}>
                      <Text style={s.saveBtnText}>Save</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={[s.saveBtn, { backgroundColor: '#eee' }]} onPress={() => { setAddingContact(false); setNewLabel(''); setNewName(''); setNewEmail(''); setNewPhone(''); }}>
                      <Text style={[s.saveBtnText, { color: '#666' }]}>Cancel</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ) : (
                <TouchableOpacity style={[s.saveBtn, { marginTop: 10 }]} onPress={() => setAddingContact(true)}>
                  <Text style={s.saveBtnText}>+ Add Contact</Text>
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

        {/* Email Settings */}
        <Text style={[s.sectionLabel, { color: tc.textMid }]}>Email</Text>
        <View style={[s.card, { backgroundColor: tc.bg }]}>
          <TouchableOpacity style={s.row} onPress={() => setShowSmtp(!showSmtp)}>
            <Text style={[s.rowLabel, { color: tc.text }]}>Send from My Email</Text>
            <Text style={[s.rowValue, { color: smtpConfigured ? '#22c55e' : tc.textMid }]}>{smtpConfigured ? 'Connected' : 'Not set up'}</Text>
          </TouchableOpacity>
          {showSmtp && (
            <View style={s.expandedSection}>
              <Text style={[s.expandedHint, { fontSize: 13, marginBottom: 12 }]}>Send emails directly from your own email address. Takes 2 minutes to set up.</Text>

              {/* Step 1 */}
              <Text style={[s.smtpStep, { color: tc.text }]}>Step 1: Enter your email</Text>
              <TextInput style={[s.contactInput, { color: tc.text }]} value={smtpUser} onChangeText={(val) => {
                setSmtpUser(val);
                // Auto-detect via MX records when email looks complete
                const domain = val.split('@')[1]?.toLowerCase();
                if (domain && domain.includes('.') && !detectingSmtp) {
                  setDetectingSmtp(true);
                  detectSmtp(val).then((result) => {
                    setSmtpHost(result.host);
                    setSmtpPort(String(result.port));
                    setSmtpProvider(result.provider);
                  }).catch(() => {}).finally(() => setDetectingSmtp(false));
                }
              }} placeholder="you@company.com" placeholderTextColor="#bbb" autoCapitalize="none" keyboardType="email-address" />
              {detectingSmtp ? (
                <Text style={[s.expandedHint, { color: tc.textMid, marginTop: 2 }]}>Detecting email provider...</Text>
              ) : smtpHost ? (
                <Text style={[s.expandedHint, { color: '#22c55e', marginTop: 2 }]}>Detected: {smtpProvider || smtpHost}</Text>
              ) : null}

              {/* Step 2 — provider-specific instructions */}
              {smtpProvider && (
                <>
                  <Text style={[s.smtpStep, { color: tc.text, marginTop: 14 }]}>Step 2: Get your App Password</Text>
                  {smtpProvider.includes('Google') ? (
                    <View style={s.smtpInstructions}>
                      <Text style={[s.smtpInstructionText, { color: tc.textMid }]}>1. Go to myaccount.google.com</Text>
                      <Text style={[s.smtpInstructionText, { color: tc.textMid }]}>2. Tap Security</Text>
                      <Text style={[s.smtpInstructionText, { color: tc.textMid }]}>3. Tap 2-Step Verification (turn it on if it's off)</Text>
                      <Text style={[s.smtpInstructionText, { color: tc.textMid }]}>4. Scroll down and tap App passwords</Text>
                      <Text style={[s.smtpInstructionText, { color: tc.textMid }]}>5. Name it "GoFarther" and tap Create</Text>
                      <Text style={[s.smtpInstructionText, { color: tc.textMid }]}>6. Copy the 16-character password and paste it below</Text>
                    </View>
                  ) : smtpProvider.includes('Microsoft') ? (
                    <View style={s.smtpInstructions}>
                      <Text style={[s.smtpInstructionText, { color: tc.textMid }]}>1. Go to account.microsoft.com/security</Text>
                      <Text style={[s.smtpInstructionText, { color: tc.textMid }]}>2. Tap Advanced security options</Text>
                      <Text style={[s.smtpInstructionText, { color: tc.textMid }]}>3. Turn on Two-step verification if it's off</Text>
                      <Text style={[s.smtpInstructionText, { color: tc.textMid }]}>4. Tap Create a new app password</Text>
                      <Text style={[s.smtpInstructionText, { color: tc.textMid }]}>5. Copy the password and paste it below</Text>
                    </View>
                  ) : smtpProvider.includes('Yahoo') ? (
                    <View style={s.smtpInstructions}>
                      <Text style={[s.smtpInstructionText, { color: tc.textMid }]}>1. Go to login.yahoo.com/account/security</Text>
                      <Text style={[s.smtpInstructionText, { color: tc.textMid }]}>2. Turn on Two-step verification if it's off</Text>
                      <Text style={[s.smtpInstructionText, { color: tc.textMid }]}>3. Tap Generate app password</Text>
                      <Text style={[s.smtpInstructionText, { color: tc.textMid }]}>4. Select "Other App", name it "GoFarther"</Text>
                      <Text style={[s.smtpInstructionText, { color: tc.textMid }]}>5. Copy the password and paste it below</Text>
                    </View>
                  ) : smtpProvider.includes('Apple') ? (
                    <View style={s.smtpInstructions}>
                      <Text style={[s.smtpInstructionText, { color: tc.textMid }]}>1. Go to appleid.apple.com/sign-in</Text>
                      <Text style={[s.smtpInstructionText, { color: tc.textMid }]}>2. Sign in and go to App-Specific Passwords</Text>
                      <Text style={[s.smtpInstructionText, { color: tc.textMid }]}>3. Generate a password for "GoFarther"</Text>
                      <Text style={[s.smtpInstructionText, { color: tc.textMid }]}>4. Copy the password and paste it below</Text>
                    </View>
                  ) : smtpProvider.includes('Zoho') ? (
                    <View style={s.smtpInstructions}>
                      <Text style={[s.smtpInstructionText, { color: tc.textMid }]}>1. Go to accounts.zoho.com/home</Text>
                      <Text style={[s.smtpInstructionText, { color: tc.textMid }]}>2. Tap Security, then App Passwords</Text>
                      <Text style={[s.smtpInstructionText, { color: tc.textMid }]}>3. Generate a new password for "GoFarther"</Text>
                      <Text style={[s.smtpInstructionText, { color: tc.textMid }]}>4. Copy the password and paste it below</Text>
                    </View>
                  ) : smtpProvider.includes('Titan') ? (
                    <View style={s.smtpInstructions}>
                      <Text style={[s.smtpInstructionText, { color: tc.textMid }]}>1. Log in to your Titan/Neo admin panel</Text>
                      <Text style={[s.smtpInstructionText, { color: tc.textMid }]}>2. Go to Settings and enable SMTP/IMAP access</Text>
                      <Text style={[s.smtpInstructionText, { color: tc.textMid }]}>3. Use your regular email password below</Text>
                    </View>
                  ) : smtpProvider.includes('Namecheap') ? (
                    <View style={s.smtpInstructions}>
                      <Text style={[s.smtpInstructionText, { color: tc.textMid }]}>1. Log in to Namecheap Private Email</Text>
                      <Text style={[s.smtpInstructionText, { color: tc.textMid }]}>2. Use your regular email password below</Text>
                      <Text style={[s.smtpInstructionText, { color: tc.textMid }]}>No app password needed — just your normal password.</Text>
                    </View>
                  ) : smtpProvider.includes('Fastmail') ? (
                    <View style={s.smtpInstructions}>
                      <Text style={[s.smtpInstructionText, { color: tc.textMid }]}>1. Go to fastmail.com/settings/security/tokens</Text>
                      <Text style={[s.smtpInstructionText, { color: tc.textMid }]}>2. Tap New App Password</Text>
                      <Text style={[s.smtpInstructionText, { color: tc.textMid }]}>3. Name it "GoFarther", select SMTP access</Text>
                      <Text style={[s.smtpInstructionText, { color: tc.textMid }]}>4. Copy the password and paste it below</Text>
                    </View>
                  ) : smtpProvider.includes('ProtonMail') ? (
                    <View style={s.smtpInstructions}>
                      <Text style={[s.smtpInstructionText, { color: tc.textMid }]}>1. You need a paid ProtonMail plan for SMTP</Text>
                      <Text style={[s.smtpInstructionText, { color: tc.textMid }]}>2. Go to Settings, then go to IMAP/SMTP</Text>
                      <Text style={[s.smtpInstructionText, { color: tc.textMid }]}>3. Download and set up ProtonMail Bridge</Text>
                      <Text style={[s.smtpInstructionText, { color: tc.textMid }]}>4. Use the Bridge password below</Text>
                    </View>
                  ) : smtpProvider === 'IONOS' || smtpProvider === 'OVH' || smtpProvider.includes('GoDaddy') || smtpProvider.includes('Bluehost') ? (
                    <View style={s.smtpInstructions}>
                      <Text style={[s.smtpInstructionText, { color: tc.textMid }]}>Use your regular email password below.</Text>
                      <Text style={[s.smtpInstructionText, { color: tc.textMid }]}>Most hosting providers ({smtpProvider}) don't require a special app password — your normal email password works.</Text>
                    </View>
                  ) : smtpProvider.includes('Mail.ru') || smtpProvider.includes('Yandex') ? (
                    <View style={s.smtpInstructions}>
                      <Text style={[s.smtpInstructionText, { color: tc.textMid }]}>1. Go to your {smtpProvider} account security settings</Text>
                      <Text style={[s.smtpInstructionText, { color: tc.textMid }]}>2. Enable two-factor authentication</Text>
                      <Text style={[s.smtpInstructionText, { color: tc.textMid }]}>3. Create an App Password for "GoFarther"</Text>
                      <Text style={[s.smtpInstructionText, { color: tc.textMid }]}>4. Paste the password below</Text>
                    </View>
                  ) : smtpProvider.includes('GMX') || smtpProvider.includes('Web.de') ? (
                    <View style={s.smtpInstructions}>
                      <Text style={[s.smtpInstructionText, { color: tc.textMid }]}>1. Log in to {smtpProvider}</Text>
                      <Text style={[s.smtpInstructionText, { color: tc.textMid }]}>2. Go to Settings, then POP3/IMAP</Text>
                      <Text style={[s.smtpInstructionText, { color: tc.textMid }]}>3. Enable "Allow POP3/IMAP access"</Text>
                      <Text style={[s.smtpInstructionText, { color: tc.textMid }]}>4. Use your regular password below</Text>
                    </View>
                  ) : smtpProvider.includes('Tutanota') || smtpProvider.includes('Hey') ? (
                    <View style={s.smtpInstructions}>
                      <Text style={[s.smtpInstructionText, { color: '#ef4444' }]}>{smtpProvider} does not support SMTP.</Text>
                      <Text style={[s.smtpInstructionText, { color: tc.textMid }]}>This email provider doesn't allow sending from third-party apps. Please use a different email address.</Text>
                    </View>
                  ) : smtpProvider.includes('Mailbox.org') || smtpProvider.includes('Posteo') || smtpProvider.includes('Mailfence') || smtpProvider.includes('Runbox') || smtpProvider.includes('Migadu') ? (
                    <View style={s.smtpInstructions}>
                      <Text style={[s.smtpInstructionText, { color: tc.textMid }]}>Use your regular {smtpProvider} password below.</Text>
                      <Text style={[s.smtpInstructionText, { color: tc.textMid }]}>{smtpProvider} supports SMTP with your normal login credentials.</Text>
                    </View>
                  ) : smtpProvider === 'Unknown' ? (
                    <View style={s.smtpInstructions}>
                      <Text style={[s.smtpInstructionText, { color: tc.textMid }]}>We detected your email server but couldn't identify the provider.</Text>
                      <Text style={[s.smtpInstructionText, { color: tc.textMid }]}>Try your regular email password first. If it doesn't work, check your provider's settings for an "App Password" option.</Text>
                    </View>
                  ) : (
                    <View style={s.smtpInstructions}>
                      <Text style={[s.smtpInstructionText, { color: tc.textMid }]}>Use your regular email password below.</Text>
                      <Text style={[s.smtpInstructionText, { color: tc.textMid }]}>Most hosting providers use your normal password for SMTP access.</Text>
                    </View>
                  )}
                </>
              )}

              {/* Step 3 */}
              <Text style={[s.smtpStep, { color: tc.text, marginTop: 14 }]}>{smtpProvider ? 'Step 3' : 'Step 2'}: Paste your App Password</Text>
              <TextInput style={[s.contactInput, { color: tc.text }]} value={smtpPass} onChangeText={setSmtpPass} placeholder="Paste app password here" placeholderTextColor="#bbb" secureTextEntry />

              <TextInput style={[s.contactInput, { color: tc.text, marginTop: 8 }]} value={smtpFrom} onChangeText={setSmtpFrom} placeholder="Your name (shown in emails)" placeholderTextColor="#bbb" />
              <TouchableOpacity style={s.saveBtn} onPress={handleSaveSmtp}>
                <Text style={s.saveBtnText}>Save Email Settings</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>

        {/* Connect Apps */}
        <Text style={[s.sectionLabel, { color: tc.textMid }]}>Integrations</Text>
        <View style={[s.card, { backgroundColor: tc.bg }]}>
          <TouchableOpacity style={s.row} onPress={() => setShowApps(!showApps)}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Ionicons name="apps" size={18} color={C.primary} />
              <Text style={[s.rowLabel, { color: tc.text }]}>Connect Apps</Text>
            </View>
            <Text style={[s.rowValue, { color: connectedCount > 0 ? '#22c55e' : tc.textMid }]}>
              {connectedCount > 0 ? `${connectedCount} connected` : 'None'}
            </Text>
          </TouchableOpacity>
          {showApps && (
            <View style={s.expandedSection}>
              <Text style={[s.expandedHint, { marginBottom: 8 }]}>Connect your apps so the AI can manage them. Say "show my leads" or "create an invoice" and it just works.</Text>
              {/* Search bar */}
              <TextInput
                style={[s.contactInput, { color: tc.text, marginBottom: 10 }]}
                value={appSearch}
                onChangeText={setAppSearch}
                placeholder="Search apps..."
                placeholderTextColor="#bbb"
                autoCapitalize="none"
              />
              {/* Category filter */}
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12 }}>
                <TouchableOpacity
                  style={[s.categoryChip, selectedCategory === 'All' && s.categoryChipActive]}
                  onPress={() => setSelectedCategory('All')}
                >
                  <Text style={[s.categoryChipText, selectedCategory === 'All' && s.categoryChipTextActive]}>All</Text>
                </TouchableOpacity>
                {appCategories.map(cat => (
                  <TouchableOpacity
                    key={cat}
                    style={[s.categoryChip, selectedCategory === cat && s.categoryChipActive]}
                    onPress={() => setSelectedCategory(cat)}
                  >
                    <Text style={[s.categoryChipText, selectedCategory === cat && s.categoryChipTextActive]}>{cat}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
              {/* App list — scrolls independently */}
              <ScrollView style={{ maxHeight: 400 }} nestedScrollEnabled showsVerticalScrollIndicator>
              {allApps
                .filter(a => selectedCategory === 'All' || a.category === selectedCategory)
                .filter(a => !appSearch.trim() || a.name.toLowerCase().includes(appSearch.toLowerCase()) || a.category.toLowerCase().includes(appSearch.toLowerCase()))
                .map(app => (
                <View key={app.id} style={{ marginBottom: 2 }}>
                  <TouchableOpacity
                    style={[s.appRow, expandedApp === app.id && { backgroundColor: 'rgba(0,0,0,0.02)' }]}
                    onPress={() => setExpandedApp(expandedApp === app.id ? null : app.id)}
                    activeOpacity={0.6}
                  >
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 }}>
                      <View style={{ width: 32, height: 32, borderRadius: 8, backgroundColor: (({
                        // CRM
                        hubspot: '#FF7A59', salesforce: '#00A1E0', pipedrive: '#017737', gohighlevel: '#0F4C81',
                        zoho_crm: '#E42527', close: '#1A1A1A', freshsales: '#F36C21', copper: '#1DA1A0',
                        ringy: '#6C63FF', monday_crm: '#FF3D57', keap: '#2CBA00', insightly: '#2196F3',
                        nutshell: '#F5A623', less_annoying_crm: '#4CAF50', liondesk: '#FF6B35',
                        follow_up_boss: '#3B82F6', kvcore: '#1E3A5F', chime: '#00BCD4',
                        // Accounting
                        quickbooks: '#2CA01C', xero: '#13B5EA', freshbooks: '#0075DD',
                        wave: '#1C4E80', sage: '#00DC00', zoho_books: '#E42527',
                        billcom: '#00C4B3', gusto: '#F45D48', adp: '#D0271D', plaid: '#111111',
                        // Project Management
                        asana: '#F06A6A', trello: '#0079BF', monday: '#FF3D57', clickup: '#7B68EE',
                        notion: '#000000', jira: '#0052CC', linear: '#5E6AD2', basecamp: '#1D2D35',
                        wrike: '#08CF65', todoist: '#E44332', teamwork: '#6B47DC',
                        // Communication
                        slack: '#4A154B', teams: '#6264A7', discord: '#5865F2', zoom: '#2D8CFF',
                        telegram: '#0088CC', twilio: '#F22F46', whatsapp_business: '#25D366', intercom: '#286EFA',
                        // Calendar
                        google_calendar: '#4285F4', outlook_calendar: '#0078D4', calendly: '#006BFF',
                        acuity: '#3A8DDE', calcom: '#292929',
                        // E-commerce
                        shopify: '#96BF48', stripe: '#635BFF', square: '#006AFF', paypal: '#003087',
                        woocommerce: '#96588A', amazon_seller: '#FF9900', etsy: '#F16521',
                        // Storage
                        google_drive: '#4285F4', dropbox: '#0061FF', onedrive: '#0078D4',
                        box: '#0061D5', google_sheets: '#0F9D58', airtable: '#FCBF49',
                        // Email Marketing
                        mailchimp: '#FFE01B', convertkit: '#FB6970', klaviyo: '#1A1A1A',
                        activecampaign: '#356AE6', constant_contact: '#0076BE', brevo: '#0B996E',
                        // Customer Support
                        zendesk: '#03363D', freshdesk: '#25C16F', helpscout: '#1292EE',
                        livechat: '#FF5100',
                        // Legal
                        docusign: '#FFD100', hellosign: '#00B4E6', pandadoc: '#4BD964',
                        contractsafe: '#2E5090',
                        // HR
                        bamboohr: '#73C41D', greenhouse: '#24A47F', lever: '#5C5CFF',
                        // Social Media
                        instagram: '#E1306C', facebook_pages: '#1877F2', twitter: '#1DA1F2',
                        linkedin: '#0A66C2', tiktok: '#000000', buffer: '#168EEA', hootsuite: '#143059',
                        // Healthcare
                        athenahealth: '#50B848', drchrono: '#2196F3', simplepractice: '#0077CC',
                        // Finance
                        brex: '#000000', mercury: '#5856D6', ramp: '#0A8548', wise: '#9FE870',
                        // Real Estate
                        propertybase: '#00A0E3', boomtown: '#FF6600',
                        // Legal
                        clio: '#2962FF', lawpay: '#1A237E', mycase: '#4CAF50', practicepanther: '#3F51B5',
                        // Education
                        canvas_lms: '#E13F29', google_classroom: '#0F9D58',
                        // POS
                        toast: '#FF4F00', clover: '#00A651', lightspeed: '#FF6B00',
                        // Field Service
                        servicetitan: '#003B6F', jobber: '#48C774', housecall_pro: '#0066FF',
                        // Logistics
                        shipstation: '#84C225', shippo: '#0066FF', easypost: '#3E7BFA',
                        // Design
                        figma: '#A259FF', canva: '#00C4CC',
                        // Analytics
                        google_analytics: '#E37400', mixpanel: '#7856FF', segment: '#52BD95',
                        // Dev Tools
                        github: '#24292E', gitlab: '#FC6D26', vercel: '#000000',
                        // Video
                        youtube: '#FF0000', loom: '#625DF5',
                        // Surveys
                        typeform: '#262627', surveymonkey: '#00BF6F', tally: '#000000',
                        // Appointments
                        vagaro: '#FF6B00', mindbody: '#00A1E0', fresha: '#1A1A1A', booksy: '#3D5AFE',
                        // Insurance
                        applied_epic: '#003B71', hawksoft: '#1565C0', ezlynx: '#FF6F00',
                        agency_zoom: '#6A1B9A', better_agency: '#00897B',
                        // Construction
                        procore: '#F7941D', buildertrend: '#0072CE', coconstruct: '#2E7D32', plangrid: '#00BCD4',
                        // Automotive
                        dealersocket: '#1A237E', vinsolutions: '#D32F2F',
                        // Nonprofit
                        bloomerang: '#E91E63', donorperfect: '#1976D2', givebutter: '#FFB300',
                        // Hospitality
                        guesty: '#6200EA', hostaway: '#00838F', cloudbeds: '#1E88E5',
                        // Fitness
                        gymmaster: '#FF5722', glofox: '#7C4DFF', wellnessliving: '#43A047',
                        // Dental
                        dentrix: '#0D47A1', open_dental: '#388E3C', curve_dental: '#7B1FA2',
                        // Government
                        govpilot: '#283593', accela: '#00695C',
                        // Automation
                        zapier: '#FF4F00', make: '#6D00CC', ifttt: '#000000',
                        // ERP / Oracle
                        oracle_netsuite: '#C74634', oracle_cloud_erp: '#C74634', oracle_cx_sales: '#C74634',
                        oracle_cx_service: '#C74634', oracle_hcm: '#C74634', oracle_epm: '#C74634',
                        oracle_scm: '#C74634', oracle_apex: '#C74634', oracle_analytics: '#C74634',
                        oracle_commerce: '#C74634',
                      } as Record<string, string>)[app.id]) || '#999', alignItems: 'center', justifyContent: 'center' }}>
                        <Ionicons name={(app.icon || 'cube') as any} size={16} color="#fff" />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={[s.rowLabel, { color: tc.text, fontSize: 14 }]}>{app.name}</Text>
                        <Text style={{ fontSize: 11, color: tc.textMid }}>{app.category}</Text>
                      </View>
                    </View>
                    {app.connected ? (
                      <View style={s.connectedBadge}><Text style={s.connectedBadgeText}>Connected</Text></View>
                    ) : (
                      <Ionicons name="chevron-forward" size={16} color="#ccc" />
                    )}
                  </TouchableOpacity>
                  {expandedApp === app.id && (
                    <View style={s.appExpanded}>
                      {app.connected ? (
                        <>
                          <Text style={[s.expandedHint, { color: '#22c55e', marginBottom: 4 }]}>Connected and ready to use in chat.</Text>
                          <Text style={[s.expandedHint]}>Actions: {app.actions.join(', ')}</Text>
                          <TouchableOpacity
                            style={[s.saveBtn, { backgroundColor: '#fef2f2', marginTop: 8 }]}
                            onPress={async () => {
                              try {
                                await disconnectApp(app.id);
                                setAllApps(prev => prev.map(a => a.id === app.id ? { ...a, connected: false } : a));
                                setConnectedCount(prev => prev - 1);
                                const connected = allApps.filter(a => a.id !== app.id && a.connected);
                                saveConnectedApps(connected.map(a => ({ id: a.id, name: a.name, category: a.category, icon: a.icon, actions: a.actions })));
                              } catch (e: any) { Alert.alert('Error', e.message); }
                            }}
                          >
                            <Text style={[s.saveBtnText, { color: '#ef4444' }]}>Disconnect</Text>
                          </TouchableOpacity>
                        </>
                      ) : app.oauth_flow === 'microsoft' ? (
                        <>
                          <View style={s.smtpInstructions}>
                            <Text style={[s.smtpInstructionText, { color: tc.textMid }]}>{app.setup}</Text>
                          </View>
                          <TouchableOpacity
                            style={[s.saveBtn, { marginTop: 10, backgroundColor: '#2f2f2f', opacity: connectingApp === app.id ? 0.5 : 1 }]}
                            disabled={connectingApp === app.id}
                            onPress={async () => {
                              setConnectingApp(app.id);
                              try {
                                const { authorize_url } = await startOAuth(app.id);
                                await WebBrowser.openBrowserAsync(authorize_url);
                                // After the browser closes, refresh the connectors list to see if it succeeded
                                const data = await getConnectors();
                                const fresh = data?.connectors || [];
                                const updated = fresh.find((a: any) => a.id === app.id);
                                if (updated?.connected) {
                                  setAllApps(prev => prev.map(a => a.id === app.id ? { ...a, connected: true } : a));
                                  setConnectedCount(prev => prev + 1);
                                  const connected = fresh.filter((a: any) => a.connected);
                                  saveConnectedApps(connected.map((a: any) => ({ id: a.id, name: a.name, category: a.category, icon: a.icon, actions: a.actions, action_hints: a.action_hints || {} })));
                                  setExpandedApp(null);
                                  Alert.alert('Connected', `${app.name} is now connected! Try saying "list my Excel files" in chat.`);
                                } else {
                                  Alert.alert('Not Connected', 'It looks like you didn\u2019t finish the Microsoft sign-in. Try again when ready.');
                                }
                              } catch (e: any) {
                                Alert.alert('Connection Failed', e.message || 'Could not start OAuth');
                              } finally { setConnectingApp(null); }
                            }}
                          >
                            <Text style={[s.saveBtnText, { color: '#fff' }]}>{connectingApp === app.id ? 'Connecting...' : 'Connect with Microsoft'}</Text>
                          </TouchableOpacity>
                        </>
                      ) : (
                        <>
                          <View style={s.smtpInstructions}>
                            <Text style={[s.smtpInstructionText, { color: tc.textMid }]}>{app.setup}</Text>
                          </View>
                          {app.auth_fields.map((field: any) => (
                            <TextInput
                              key={field.key}
                              style={[s.contactInput, { color: tc.text, marginTop: 8 }]}
                              value={appCredentials[app.id]?.[field.key] || ''}
                              onChangeText={(v) => setAppCredentials(prev => ({
                                ...prev,
                                [app.id]: { ...(prev[app.id] || {}), [field.key]: v },
                              }))}
                              placeholder={field.label}
                              placeholderTextColor="#bbb"
                              secureTextEntry={field.secure}
                              autoCapitalize="none"
                              autoCorrect={false}
                            />
                          ))}
                          <TouchableOpacity
                            style={[s.saveBtn, { marginTop: 10, opacity: connectingApp === app.id ? 0.5 : 1 }]}
                            disabled={connectingApp === app.id}
                            onPress={async () => {
                              const creds = appCredentials[app.id] || {};
                              const missing = app.auth_fields.filter((f: any) => !creds[f.key]?.trim());
                              if (missing.length) return Alert.alert('Missing', `Please fill in: ${missing.map((f: any) => f.label).join(', ')}`);
                              setConnectingApp(app.id);
                              try {
                                await connectApp(app.id, creds);
                                setAllApps(prev => prev.map(a => a.id === app.id ? { ...a, connected: true } : a));
                                setConnectedCount(prev => prev + 1);
                                const connected = [...allApps.filter(a => a.connected), app];
                                saveConnectedApps(connected.map(a => ({ id: a.id, name: a.name, category: a.category, icon: a.icon, actions: a.actions })));
                                setExpandedApp(null);
                                Alert.alert('Connected', `${app.name} is now connected! Try saying "show my ${app.actions[0]?.replace('get_', '').replace('_', ' ') || 'data'}" in chat.`);
                              } catch (e: any) {
                                Alert.alert('Connection Failed', e.message || 'Could not connect');
                              } finally { setConnectingApp(null); }
                            }}
                          >
                            <Text style={s.saveBtnText}>{connectingApp === app.id ? 'Connecting...' : 'Connect'}</Text>
                          </TouchableOpacity>
                        </>
                      )}
                    </View>
                  )}
                </View>
              ))}
              </ScrollView>
            </View>
          )}
        </View>

        {/* Security */}
        <Text style={[s.sectionLabel, { color: tc.textMid }]}>Security</Text>
        <View style={[s.card, { backgroundColor: tc.bg }]}>
          {/* 2FA Toggle */}
          <TouchableOpacity style={s.row} onPress={async () => {
            if (is2FAEnabled) {
              // Disable flow — ask for code
              Alert.prompt('Disable 2FA', 'Enter your authenticator code to disable 2FA:', async (code) => {
                if (!code || code.length !== 6) return;
                try {
                  await disable2FA(code);
                  setIs2FAEnabled(false);
                  Alert.alert('Done', '2FA has been disabled');
                } catch (e: any) { Alert.alert('Error', e.message || 'Invalid code'); }
              }, 'plain-text', '', 'number-pad');
            } else {
              // Enable flow — setup
              setSetting2FA(true);
              try {
                const data = await setup2FA();
                setTotpSecret(data.secret);
                setTotpQrUrl(data.qr_url);
                setShow2FASetup(true);
              } catch (e: any) { Alert.alert('Error', e.message || 'Could not setup 2FA'); }
              finally { setSetting2FA(false); }
            }
          }} activeOpacity={0.7}>
            <Text style={s.rowLabel}>Two-Factor Authentication</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              {setting2FA && <ActivityIndicator size="small" color={C.primary} style={{ marginRight: 8 }} />}
              <Text style={{ fontSize: 13, color: is2FAEnabled ? '#22c55e' : '#999', fontWeight: '600' }}>{is2FAEnabled ? 'Enabled' : 'Off'}</Text>
              <Ionicons name="chevron-forward" size={16} color="#ccc" style={{ marginLeft: 6 }} />
            </View>
          </TouchableOpacity>
          <View style={s.rowDivider} />
          {/* Active Sessions */}
          <TouchableOpacity style={s.row} onPress={async () => {
            setShowSessions(true);
            setLoadingSessions(true);
            try {
              const data = await getSessions();
              setSessions(data);
            } catch (e: any) { Alert.alert('Error', e.message || 'Could not load sessions'); }
            finally { setLoadingSessions(false); }
          }} activeOpacity={0.7}>
            <Text style={s.rowLabel}>Active Sessions</Text>
            <Ionicons name="chevron-forward" size={16} color="#ccc" />
          </TouchableOpacity>
          <View style={s.rowDivider} />
          {/* Export My Data */}
          <TouchableOpacity style={s.row} onPress={async () => {
            try {
              Alert.alert('Exporting...', 'Preparing your data export');
              const data = await exportMyData();
              const json = JSON.stringify(data, null, 2);
              // Use share sheet
              const { Share } = require('react-native');
              await Share.share({ message: json, title: 'GoFarther AI Data Export' });
            } catch (e: any) { Alert.alert('Error', e.message || 'Could not export data'); }
          }} activeOpacity={0.7}>
            <Text style={s.rowLabel}>Export My Data</Text>
            <Ionicons name="chevron-forward" size={16} color="#ccc" />
          </TouchableOpacity>
        </View>

        {/* 2FA Setup Modal */}
        <Modal visible={show2FASetup} animationType="slide" presentationStyle="pageSheet">
          <SafeAreaView style={{ flex: 1, backgroundColor: tc.surface }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16 }}>
              <TouchableOpacity onPress={() => { setShow2FASetup(false); setTotpCode(''); }}><Text style={{ fontSize: 16, color: C.primary }}>Cancel</Text></TouchableOpacity>
              <Text style={{ fontSize: 17, fontWeight: '600', color: tc.text }}>Setup 2FA</Text>
              <View style={{ width: 50 }} />
            </View>
            <ScrollView contentContainerStyle={{ padding: 24, alignItems: 'center' }}>
              <View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: '#ec489915', alignItems: 'center', justifyContent: 'center', marginBottom: 16 }}>
                <Text style={{ fontSize: 28 }}>🔐</Text>
              </View>
              <Text style={{ fontSize: 18, fontWeight: '600', color: tc.text, marginBottom: 8, textAlign: 'center' }}>Add to your authenticator app</Text>
              <Text style={{ fontSize: 13, color: tc.textMid, marginBottom: 24, textAlign: 'center' }}>Open Google Authenticator, Authy, or any TOTP app and add this account manually with the secret below:</Text>
              <View style={{ backgroundColor: tc.bg, borderRadius: 12, padding: 16, width: '100%', marginBottom: 20 }}>
                <Text style={{ fontSize: 12, color: tc.textMid, marginBottom: 4 }}>Secret Key</Text>
                <Text style={{ fontSize: 15, fontWeight: '700', color: tc.text, letterSpacing: 2 }} selectable>{totpSecret}</Text>
              </View>
              <Text style={{ fontSize: 14, color: tc.text, fontWeight: '600', marginBottom: 12, alignSelf: 'flex-start' }}>Enter the 6-digit code to verify:</Text>
              <TextInput
                style={{ width: '100%', backgroundColor: tc.bg, borderRadius: 12, padding: 16, fontSize: 24, textAlign: 'center', letterSpacing: 8, color: tc.text, borderWidth: 1, borderColor: '#e0e0e0', marginBottom: 20 }}
                placeholder="000000" placeholderTextColor="#ccc"
                value={totpCode} onChangeText={(t) => setTotpCode(t.replace(/\D/g, '').slice(0, 6))}
                keyboardType="number-pad" maxLength={6} autoFocus
              />
              <TouchableOpacity
                style={{ width: '100%', height: 52, borderRadius: 26, backgroundColor: totpCode.length === 6 ? C.primary : '#ccc', alignItems: 'center', justifyContent: 'center' }}
                disabled={totpCode.length !== 6}
                onPress={async () => {
                  try {
                    await verify2FA(totpCode);
                    setIs2FAEnabled(true);
                    setShow2FASetup(false);
                    setTotpCode('');
                    Alert.alert('2FA Enabled', 'Two-factor authentication is now active. You will need your authenticator app to log in.');
                  } catch (e: any) { Alert.alert('Error', e.message || 'Invalid code'); }
                }}
              >
                <Text style={{ color: '#fff', fontSize: 16, fontWeight: '700' }}>Enable 2FA</Text>
              </TouchableOpacity>
            </ScrollView>
          </SafeAreaView>
        </Modal>

        {/* Sessions Modal */}
        <Modal visible={showSessions} animationType="slide" presentationStyle="pageSheet">
          <SafeAreaView style={{ flex: 1, backgroundColor: tc.surface }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16 }}>
              <TouchableOpacity onPress={() => setShowSessions(false)}><Text style={{ fontSize: 16, color: C.primary }}>Done</Text></TouchableOpacity>
              <Text style={{ fontSize: 17, fontWeight: '600', color: tc.text }}>Active Sessions</Text>
              <TouchableOpacity onPress={() => {
                Alert.alert('Log out everywhere?', 'All other sessions will be revoked. You will stay logged in on this device.', [
                  { text: 'Cancel', style: 'cancel' },
                  { text: 'Log Out All', style: 'destructive', onPress: async () => {
                    try {
                      const r = await revokeAllSessions();
                      Alert.alert('Done', `Revoked ${r.revoked} session(s)`);
                      const data = await getSessions();
                      setSessions(data);
                    } catch (e: any) { Alert.alert('Error', e.message); }
                  }},
                ]);
              }}><Text style={{ fontSize: 14, color: '#ef4444', fontWeight: '600' }}>Revoke All</Text></TouchableOpacity>
            </View>
            {loadingSessions ? (
              <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}><ActivityIndicator size="large" color={C.primary} /></View>
            ) : (
              <ScrollView contentContainerStyle={{ padding: 16 }}>
                {sessions.length === 0 && <Text style={{ textAlign: 'center', color: tc.textMid, marginTop: 40 }}>No active sessions</Text>}
                {sessions.map((sess) => (
                  <View key={sess.id} style={{ backgroundColor: tc.bg, borderRadius: 12, padding: 16, marginBottom: 10, borderWidth: sess.is_current ? 1.5 : 0, borderColor: sess.is_current ? C.primary : 'transparent' }}>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                      <View style={{ flex: 1 }}>
                        <Text style={{ fontSize: 15, fontWeight: '600', color: tc.text }}>{sess.device_name || 'Unknown device'}{sess.is_current ? ' (this device)' : ''}</Text>
                        <Text style={{ fontSize: 12, color: tc.textMid, marginTop: 4 }}>IP: {sess.ip_address || 'Unknown'}</Text>
                        <Text style={{ fontSize: 12, color: tc.textMid, marginTop: 2 }}>Last active: {new Date(sess.last_active).toLocaleDateString()}</Text>
                      </View>
                      {!sess.is_current && (
                        <TouchableOpacity onPress={async () => {
                          try {
                            await revokeSession(sess.id);
                            setSessions(prev => prev.filter(s => s.id !== sess.id));
                          } catch (e: any) { Alert.alert('Error', e.message); }
                        }} style={{ paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8, backgroundColor: '#ef444415' }}>
                          <Text style={{ fontSize: 13, fontWeight: '600', color: '#ef4444' }}>Revoke</Text>
                        </TouchableOpacity>
                      )}
                    </View>
                  </View>
                ))}
              </ScrollView>
            )}
          </SafeAreaView>
        </Modal>

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

        {/* Delete Account */}
        <TouchableOpacity style={[s.logoutCard, { backgroundColor: tc.bg, marginTop: 12 }]} onPress={() => {
          Alert.alert(
            'Delete Account',
            'This will permanently delete your account and all your data. This action cannot be undone.',
            [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Delete Account', style: 'destructive', onPress: () => {
                Alert.alert(
                  'Are you sure?',
                  'Your account, chat history, contacts, and all settings will be permanently deleted.',
                  [
                    { text: 'Cancel', style: 'cancel' },
                    { text: 'Yes, Delete Everything', style: 'destructive', onPress: async () => {
                      try {
                        await deleteAccount();
                        await logout();
                        onLogout();
                      } catch (e: any) {
                        Alert.alert('Error', e.message || 'Could not delete account');
                      }
                    }},
                  ]
                );
              }},
            ]
          );
        }} activeOpacity={0.7}>
          <Text style={{ fontSize: 15, fontWeight: '500', color: '#ef4444' }}>Delete Account</Text>
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
  rowLabel: { fontSize: 15, fontWeight: '500' },
  rowValue: { fontSize: 14, color: '#888', marginRight: 4 },
  chevron: { fontSize: 16, color: '#ccc', fontWeight: '300' },

  // Expanded sections
  expandedSection: { paddingHorizontal: 16, paddingBottom: 16 },
  expandedHint: { fontSize: 12, color: '#999', marginBottom: 8 },
  instructionsInput: { backgroundColor: '#f5f5f5', borderWidth: 1, borderColor: '#e8e8e8', borderRadius: 12, padding: 12, fontSize: 14, height: 100, textAlignVertical: 'top' },
  saveBtn: { marginTop: 10, paddingVertical: 10, paddingHorizontal: 16, borderRadius: 10, backgroundColor: '#1a1a1a', alignSelf: 'flex-start' },
  saveBtnText: { fontSize: 13, fontWeight: '600', color: '#ffffff' },
  memoryEmpty: { fontSize: 13, color: '#bbb', fontStyle: 'italic' },
  memoryFact: { fontSize: 13, lineHeight: 20, marginBottom: 2 },
  clearMemBtn: { marginTop: 10, paddingVertical: 8, paddingHorizontal: 14, borderRadius: 8, backgroundColor: '#fef2f2', alignSelf: 'flex-start' },
  clearMemText: { fontSize: 13, color: '#ef4444', fontWeight: '500' },

  smtpStep: { fontSize: 14, fontWeight: '700', marginBottom: 6 },
  smtpInstructions: { backgroundColor: 'rgba(0,0,0,0.03)', borderRadius: 10, padding: 12, marginTop: 4, gap: 6 },
  smtpInstructionText: { fontSize: 13, lineHeight: 20 },
  contactRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, gap: 8 },
  contactLabel: { fontSize: 14, fontWeight: '600' },
  contactDetail: { fontSize: 12, color: '#888', marginTop: 1 },
  addContactForm: { marginTop: 8, gap: 8 },
  contactInput: { backgroundColor: '#f5f5f5', borderWidth: 1, borderColor: '#e8e8e8', borderRadius: 10, padding: 10, fontSize: 14 },

  // Connect Apps
  categoryChip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, backgroundColor: '#f0f0f0', marginRight: 8 },
  categoryChipActive: { backgroundColor: '#1a1a1a' },
  categoryChipText: { fontSize: 12, fontWeight: '500', color: '#666' },
  categoryChipTextActive: { color: '#fff' },
  appRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 10, paddingHorizontal: 16, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#f0f0f0' },
  appExpanded: { paddingHorizontal: 16, paddingBottom: 14, paddingTop: 4 },
  connectedBadge: { backgroundColor: '#dcfce7', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  connectedBadgeText: { fontSize: 11, fontWeight: '600', color: '#16a34a' },

  logoutCard: { backgroundColor: '#ffffff', borderRadius: 14, paddingVertical: 14, paddingHorizontal: 16, marginTop: 24, alignItems: 'center' },
  logoutText: { fontSize: 15, fontWeight: '500', color: '#1a1a1a' },
});
