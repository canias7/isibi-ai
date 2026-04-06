import React, { useRef, useEffect, useState, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, TouchableWithoutFeedback,
  StyleSheet, Animated, ScrollView, TextInput, Keyboard, Alert,
  ActionSheetIOS, Platform, Modal,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { getAIName, saveAIName, ChatSession, deleteChatSession, renameChatSession } from '../lib/storage';
import { useTheme } from '../lib/ThemeContext';

const DRAWER_W = 300;

export type NavScreen = 'chat' | 'agents' | 'templates' | 'scheduled' | 'settings';

interface DrawerProps {
  isOpen: boolean;
  onClose: () => void;
  activeScreen: NavScreen;
  onNavigate: (screen: NavScreen) => void;
  onLogout: () => void;
  sessions: ChatSession[];
  activeSessionId: string | null;
  onSelectSession: (id: string) => void;
  onNewChat: () => void;
  onSessionDeleted?: (id: string) => void;
  onSessionRenamed?: (id: string, title: string) => void;
}

export function HamburgerButton({ onPress, color }: { onPress: () => void; color?: string }) {
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.6} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }} accessibilityLabel="Open menu" accessibilityRole="button">
      <Ionicons name="menu-outline" size={24} color={color || '#1a1a1a'} />
    </TouchableOpacity>
  );
}

function groupSessions(sessions: ChatSession[]) {
  const now = Date.now();
  const day = 86400000;
  const groups: { label: string; items: ChatSession[] }[] = [];
  const today: ChatSession[] = [], yesterday: ChatSession[] = [], week: ChatSession[] = [], older: ChatSession[] = [];
  for (const s of sessions) {
    const age = now - s.createdAt;
    if (age < day) today.push(s);
    else if (age < day * 2) yesterday.push(s);
    else if (age < day * 7) week.push(s);
    else older.push(s);
  }
  if (today.length) groups.push({ label: 'Today', items: today });
  if (yesterday.length) groups.push({ label: 'Yesterday', items: yesterday });
  if (week.length) groups.push({ label: 'This week', items: week });
  if (older.length) groups.push({ label: 'Older', items: older });
  return groups;
}

export default function Drawer({ isOpen, onClose, activeScreen, onNavigate, onLogout, sessions, activeSessionId, onSelectSession, onNewChat, onSessionDeleted, onSessionRenamed }: DrawerProps) {
  const { colors: tc } = useTheme();
  const translateX = useRef(new Animated.Value(-DRAWER_W)).current;
  const backdrop = useRef(new Animated.Value(0)).current;
  const insets = useSafeAreaInsets();
  const [aiName, setAiName] = useState('GoFarther');
  const [editingName, setEditingName] = useState(false);
  const [tempName, setTempName] = useState('');
  const [search, setSearch] = useState('');
  const [showSearch, setShowSearch] = useState(false);
  const [renameSession, setRenameSession] = useState<ChatSession | null>(null);
  const [renameText, setRenameText] = useState('');

  useEffect(() => { getAIName().then(setAiName); }, []);

  useEffect(() => {
    Animated.parallel([
      Animated.timing(translateX, { toValue: isOpen ? 0 : -DRAWER_W, duration: 250, useNativeDriver: true }),
      Animated.timing(backdrop, { toValue: isOpen ? 1 : 0, duration: 250, useNativeDriver: true }),
    ]).start();
    if (!isOpen) { setSearch(''); setShowSearch(false); }
  }, [isOpen]);

  const startEditName = () => { setTempName(aiName); setEditingName(true); };
  const saveName = () => { const n = tempName.trim() || 'GoFarther'; setAiName(n); saveAIName(n); setEditingName(false); Keyboard.dismiss(); };

  const handleSessionLongPress = (session: ChatSession) => {
    const actions = ['Rename', 'Delete', 'Cancel'];
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions({ options: actions, destructiveButtonIndex: 1, cancelButtonIndex: 2 }, (idx) => {
        if (idx === 0) promptRename(session);
        if (idx === 1) promptDelete(session);
      });
    } else {
      Alert.alert(session.title, '', [
        { text: 'Rename', onPress: () => promptRename(session) },
        { text: 'Delete', style: 'destructive', onPress: () => promptDelete(session) },
        { text: 'Cancel', style: 'cancel' },
      ]);
    }
  };

  const promptRename = (session: ChatSession) => {
    if (Platform.OS === 'ios' && Alert.prompt) {
      Alert.prompt('Rename Chat', '', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Save', onPress: async (newTitle?: string) => {
          if (newTitle?.trim()) {
            await renameChatSession(session.id, newTitle.trim());
            onSessionRenamed?.(session.id, newTitle.trim());
          }
        }},
      ], 'plain-text', session.title);
    } else {
      // Android — use inline rename modal
      setRenameText(session.title);
      setRenameSession(session);
    }
  };

  const submitRename = async () => {
    if (renameSession && renameText.trim()) {
      await renameChatSession(renameSession.id, renameText.trim());
      onSessionRenamed?.(renameSession.id, renameText.trim());
    }
    setRenameSession(null);
  };

  const promptDelete = (session: ChatSession) => {
    Alert.alert('Delete Chat', `Delete "${session.title}"?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => {
        await deleteChatSession(session.id);
        onSessionDeleted?.(session.id);
      }},
    ]);
  };

  const backdropOpacity = backdrop.interpolate({ inputRange: [0, 1], outputRange: [0, 0.4] });

  // Filter sessions by search
  const filteredSessions = search.trim()
    ? sessions.filter(s => s.title.toLowerCase().includes(search.toLowerCase()))
    : sessions;
  const grouped = groupSessions(filteredSessions);

  const navItems: { key: NavScreen; label: string }[] = [
    { key: 'agents', label: 'Agents' },
    { key: 'templates', label: 'Templates' },
    { key: 'scheduled', label: 'Scheduled' },
    { key: 'settings', label: 'Settings' },
  ];

  return (
    <View style={[StyleSheet.absoluteFill, { zIndex: isOpen ? 100 : -1 }]} pointerEvents={isOpen ? 'auto' : 'none'}>
      <TouchableWithoutFeedback onPress={onClose}>
        <Animated.View style={[s.backdrop, { opacity: backdropOpacity }]} />
      </TouchableWithoutFeedback>

      <Animated.View style={[s.panel, { transform: [{ translateX }], paddingTop: insets.top + 12, backgroundColor: tc.bg2, borderRightColor: tc.border }]}>
        {/* Header — fixed at top */}
        <View style={s.header}>
          <Text style={[s.brand, { color: tc.text }]}>GoFarther AI</Text>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <TouchableOpacity onPress={() => setShowSearch(!showSearch)} style={s.headerBtn} activeOpacity={0.7} accessibilityLabel="Search chats" accessibilityRole="button">
              <Ionicons name="search-outline" size={18} color={tc.textMid} />
            </TouchableOpacity>
            <TouchableOpacity onPress={onNewChat} style={s.headerBtn} activeOpacity={0.7} accessibilityLabel="New chat" accessibilityRole="button">
              <Ionicons name="add" size={20} color={tc.textMid} />
            </TouchableOpacity>
          </View>
        </View>

        {/* Search bar */}
        {showSearch && (
          <View style={s.searchBar}>
            <TextInput style={s.searchInput} value={search} onChangeText={setSearch} placeholder="Search chats..." placeholderTextColor="#bbb" autoFocus />
            {search.length > 0 && (
              <TouchableOpacity onPress={() => setSearch('')} style={s.searchClear}>
                <Text style={s.searchClearText}>x</Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        {/* New Chat */}
        <TouchableOpacity style={[s.navItem, activeScreen === 'chat' && !activeSessionId && s.navItemActive]} onPress={onNewChat} activeOpacity={0.6} accessibilityLabel="New chat" accessibilityRole="button">
          <Ionicons name="chatbubble-outline" size={18} color={tc.text} style={{ marginRight: 12 }} />
          <Text style={[s.navLabel, { color: tc.text }, activeScreen === 'chat' && !activeSessionId && s.navLabelActive]}>New chat</Text>
        </TouchableOpacity>

        <View style={s.divider} />

        {/* Chat list — scrollable */}
        <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
          {grouped.map(group => (
            <View key={group.label}>
              <Text style={[s.sectionTitle, { color: tc.textDim }]}>{group.label}</Text>
              {group.items.map(session => (
                <TouchableOpacity
                  key={session.id}
                  style={[s.sessionItem, activeSessionId === session.id && { backgroundColor: tc.card }]}
                  onPress={() => onSelectSession(session.id)}
                  onLongPress={() => handleSessionLongPress(session)}
                  delayLongPress={500}
                  activeOpacity={0.6}
                  accessibilityLabel={`Chat: ${session.title}`}
                >
                  <Text style={[s.sessionText, { color: tc.textMid }, activeSessionId === session.id && { color: tc.text, fontWeight: '600' }]} numberOfLines={1}>{session.title}</Text>
                </TouchableOpacity>
              ))}
            </View>
          ))}

          {filteredSessions.length === 0 && (
            <Text style={s.noSessions}>{search ? 'No matches' : 'No chats yet'}</Text>
          )}
        </ScrollView>

        <View style={s.divider} />

        {/* Nav — fixed at bottom */}
        {navItems.map(item => (
          <TouchableOpacity key={item.key} style={[s.navItem, activeScreen === item.key && { backgroundColor: tc.card }]} onPress={() => onNavigate(item.key)} activeOpacity={0.6} accessibilityLabel={item.label} accessibilityRole="button">
            <Text style={[s.navLabel, { color: tc.text }, activeScreen === item.key && s.navLabelActive]}>{item.label}</Text>
          </TouchableOpacity>
        ))}

        {/* Footer */}
        <View style={[s.footer, { paddingBottom: insets.bottom + 12 }]}>
          <View style={s.divider} />
          <View style={s.aiNameSection}>
            <Text style={s.aiNameLabel}>Your AI name</Text>
            {editingName ? (
              <View style={s.aiNameEditRow}>
                <TextInput style={s.aiNameInput} value={tempName} onChangeText={setTempName} placeholder="e.g. Chris" placeholderTextColor="#bbb" autoFocus maxLength={20} returnKeyType="done" onSubmitEditing={saveName} />
                <TouchableOpacity onPress={saveName} style={s.aiNameSaveBtn}><Text style={s.aiNameSaveText}>Save</Text></TouchableOpacity>
              </View>
            ) : (
              <TouchableOpacity onPress={startEditName} style={s.aiNameDisplay} activeOpacity={0.6}>
                <Text style={s.aiNameValue}>"Hey {aiName}"</Text>
                <Text style={s.aiNameEdit}>Edit</Text>
              </TouchableOpacity>
            )}
          </View>
          <View style={s.divider} />
          <TouchableOpacity style={s.logoutItem} onPress={onLogout} activeOpacity={0.6}>
            <Text style={s.logoutText}>Log out</Text>
          </TouchableOpacity>
        </View>
      </Animated.View>

      {/* Android rename modal */}
      {renameSession && (
        <Modal transparent animationType="fade" visible={!!renameSession}>
          <TouchableWithoutFeedback onPress={() => setRenameSession(null)}>
            <View style={s.renameBackdrop}>
              <TouchableWithoutFeedback>
                <View style={s.renameBox}>
                  <Text style={s.renameTitle}>Rename Chat</Text>
                  <TextInput style={s.renameInput} value={renameText} onChangeText={setRenameText} autoFocus maxLength={60} returnKeyType="done" onSubmitEditing={submitRename} />
                  <View style={s.renameBtns}>
                    <TouchableOpacity onPress={() => setRenameSession(null)}><Text style={s.renameCancelText}>Cancel</Text></TouchableOpacity>
                    <TouchableOpacity onPress={submitRename} style={s.renameSaveBtn}><Text style={s.renameSaveText}>Save</Text></TouchableOpacity>
                  </View>
                </View>
              </TouchableWithoutFeedback>
            </View>
          </TouchableWithoutFeedback>
        </Modal>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: '#000' },
  panel: { position: 'absolute', top: 0, left: 0, bottom: 0, width: DRAWER_W, backgroundColor: '#f5f5f5', borderRightWidth: StyleSheet.hairlineWidth, borderRightColor: '#e0e0e0', paddingHorizontal: 16 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingBottom: 16, paddingHorizontal: 4 },
  brand: { fontSize: 18, fontWeight: '700', color: '#1a1a1a' },
  headerBtn: { width: 32, height: 32, borderRadius: 16, backgroundColor: '#e8e8e8', alignItems: 'center', justifyContent: 'center' },
  searchIconText: { fontSize: 14, fontWeight: '700', color: '#666' },
  plusIcon: { width: 18, height: 18, alignItems: 'center', justifyContent: 'center' },
  plusH: { position: 'absolute', width: 14, height: 2, backgroundColor: '#666', borderRadius: 1 },
  plusV: { position: 'absolute', width: 2, height: 14, backgroundColor: '#666', borderRadius: 1 },

  searchBar: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#e8e8e8', borderRadius: 10, marginBottom: 12, paddingHorizontal: 12 },
  searchInput: { flex: 1, paddingVertical: 10, fontSize: 14, color: '#1a1a1a' },
  searchClear: { paddingLeft: 8 },
  searchClearText: { fontSize: 16, color: '#999' },

  chatIcon: { width: 20, height: 20, marginRight: 12, justifyContent: 'center', alignItems: 'center' },
  chatBubble: { width: 16, height: 14, borderRadius: 4, borderWidth: 1.5, borderColor: '#1a1a1a' },
  navItem: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, paddingHorizontal: 12, borderRadius: 10, marginBottom: 2 },
  navItemActive: { backgroundColor: '#e8e8e8' },
  navLabel: { fontSize: 15, fontWeight: '500', color: '#1a1a1a' },
  navLabelActive: { fontWeight: '600' },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: '#ddd', marginVertical: 12 },
  sectionTitle: { fontSize: 11, fontWeight: '600', color: '#999', paddingHorizontal: 12, marginBottom: 4, marginTop: 8, textTransform: 'uppercase', letterSpacing: 0.5 },
  sessionItem: { paddingVertical: 10, paddingHorizontal: 12, borderRadius: 8, marginBottom: 1 },
  sessionItemActive: { backgroundColor: '#e8e8e8' },
  sessionText: { fontSize: 14, color: '#444' },
  sessionTextActive: { fontWeight: '600', color: '#1a1a1a' },
  noSessions: { fontSize: 13, color: '#bbb', paddingHorizontal: 12, paddingVertical: 8 },
  footer: { paddingTop: 4 },
  aiNameSection: { paddingHorizontal: 4, paddingVertical: 8 },
  aiNameLabel: { fontSize: 11, fontWeight: '600', color: '#999', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 },
  aiNameDisplay: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  aiNameValue: { fontSize: 15, fontWeight: '600', color: '#1a1a1a' },
  aiNameEdit: { fontSize: 13, color: '#999', fontWeight: '500' },
  aiNameEditRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  aiNameInput: { flex: 1, backgroundColor: '#ffffff', borderWidth: 1, borderColor: '#ddd', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, color: '#1a1a1a' },
  aiNameSaveBtn: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 10, backgroundColor: '#1a1a1a' },
  aiNameSaveText: { fontSize: 13, fontWeight: '600', color: '#ffffff' },
  logoutItem: { paddingVertical: 12, paddingHorizontal: 12, borderRadius: 10 },
  logoutText: { fontSize: 15, fontWeight: '500', color: '#888' },

  // Rename modal
  renameBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', alignItems: 'center' },
  renameBox: { backgroundColor: '#fff', borderRadius: 14, padding: 20, width: 280 },
  renameTitle: { fontSize: 17, fontWeight: '600', color: '#1a1a1a', marginBottom: 12 },
  renameInput: { backgroundColor: '#f5f5f5', borderWidth: 1, borderColor: '#e0e0e0', borderRadius: 10, padding: 12, fontSize: 15, color: '#1a1a1a', marginBottom: 16 },
  renameBtns: { flexDirection: 'row', justifyContent: 'flex-end', gap: 12 },
  renameCancelText: { fontSize: 15, color: '#999', fontWeight: '500' },
  renameSaveBtn: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 8, backgroundColor: '#1a1a1a' },
  renameSaveText: { fontSize: 15, fontWeight: '600', color: '#fff' },
});
