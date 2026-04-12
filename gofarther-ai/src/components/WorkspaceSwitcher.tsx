/** WorkspaceSwitcher — the tappable header inside the drawer that lets
 *  users see their current workspace and switch, rename, or delete.
 *  Lives in the slot where "GoFarther AI" used to show. Tapping opens
 *  a modal list of workspaces with a "New Workspace" button. */

import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, Modal, TextInput, Alert,
  ScrollView, ActionSheetIOS, Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../lib/ThemeContext';
import {
  Workspace,
  getWorkspaces,
  getActiveWorkspaceId,
  setActiveWorkspaceId,
  createWorkspace,
  updateWorkspace,
  deleteWorkspace,
  onWorkspaceChange,
} from '../lib/workspaces';

export default function WorkspaceSwitcher() {
  const { colors: tc } = useTheme();
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [showPicker, setShowPicker] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');

  const reload = useCallback(async () => {
    const list = await getWorkspaces();
    const active = await getActiveWorkspaceId();
    setWorkspaces(list);
    setActiveId(active);
  }, []);

  useEffect(() => { reload(); }, [reload]);
  // Re-read whenever the active workspace changes externally (e.g. via
  // a delete that reassigned the active id, or another surface that
  // switched workspaces). Keeps the label in sync.
  useEffect(() => {
    const off = onWorkspaceChange(() => { reload(); });
    return off;
  }, [reload]);

  const active = workspaces.find(w => w.id === activeId) || workspaces[0];

  const handleSwitch = async (ws: Workspace) => {
    await setActiveWorkspaceId(ws.id);
    setShowPicker(false);
  };

  const handleCreate = async () => {
    if (!newName.trim()) return Alert.alert('Name required', 'Give your workspace a short name.');
    const ws = await createWorkspace(newName);
    if (ws) {
      await setActiveWorkspaceId(ws.id);
      await reload();
      setNewName('');
      setShowCreate(false);
      setShowPicker(false);
    } else {
      Alert.alert('Could not create workspace');
    }
  };

  const handleLongPress = (ws: Workspace) => {
    // Quick rename / delete menu. iOS gets a native action sheet,
    // everywhere else gets an Alert with buttons.
    const opts = ['Rename', 'Delete', 'Cancel'];
    const doRename = () => {
      Alert.prompt?.(
        'Rename workspace',
        `Give "${ws.name}" a new name.`,
        async (text?: string) => {
          if (text && text.trim()) {
            await updateWorkspace(ws.id, { name: text.trim() });
            await reload();
          }
        },
        'plain-text',
        ws.name,
      );
    };
    const doDelete = () => {
      Alert.alert(
        'Delete workspace?',
        `Everything inside "${ws.name}" — chats, contacts, memory, templates, agents, and scheduled tasks — will be permanently deleted. This cannot be undone.`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Delete',
            style: 'destructive',
            onPress: async () => {
              const { ok, error } = await deleteWorkspace(ws.id);
              if (!ok) Alert.alert('Could not delete', error || '');
              await reload();
            },
          },
        ],
      );
    };
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        { options: opts, cancelButtonIndex: 2, destructiveButtonIndex: 1 },
        idx => {
          if (idx === 0) doRename();
          if (idx === 1) doDelete();
        },
      );
    } else {
      Alert.alert(ws.name, 'Choose an action', [
        { text: 'Rename', onPress: doRename },
        { text: 'Delete', style: 'destructive', onPress: doDelete },
        { text: 'Cancel', style: 'cancel' },
      ]);
    }
  };

  if (!active) {
    return <Text style={[s.brand, { color: tc.text }]}>GoFarther AI</Text>;
  }

  return (
    <>
      <TouchableOpacity style={s.switcher} activeOpacity={0.7} onPress={() => setShowPicker(true)} accessibilityLabel="Switch workspace" accessibilityRole="button">
        <View style={{ flex: 1 }}>
          <Text style={[s.brand, { color: tc.text }]} numberOfLines={1}>{active.name}</Text>
          <Text style={[s.subtitle, { color: tc.textMid }]}>Workspace · tap to switch</Text>
        </View>
        <Ionicons name="chevron-down" size={16} color={tc.textMid} />
      </TouchableOpacity>

      {/* Picker modal */}
      <Modal visible={showPicker} transparent animationType="fade" onRequestClose={() => setShowPicker(false)}>
        <TouchableOpacity style={s.modalBackdrop} activeOpacity={1} onPress={() => setShowPicker(false)}>
          <TouchableOpacity activeOpacity={1} style={[s.modalCard, { backgroundColor: tc.bg }]} onPress={() => {}}>
            <Text style={[s.modalTitle, { color: tc.text }]}>Workspaces</Text>
            <Text style={[s.modalHint, { color: tc.textMid }]}>Tap to switch · long-press to rename or delete</Text>
            <ScrollView style={{ maxHeight: 320, marginTop: 12 }} showsVerticalScrollIndicator={false}>
              {workspaces.map(ws => (
                <TouchableOpacity
                  key={ws.id}
                  style={[s.wsRow, ws.id === activeId && { backgroundColor: 'rgba(99,102,241,0.08)' }]}
                  onPress={() => handleSwitch(ws)}
                  onLongPress={() => handleLongPress(ws)}
                  delayLongPress={400}
                >
                  <Text style={[s.wsName, { color: tc.text }]} numberOfLines={1}>{ws.name}</Text>
                  {ws.id === activeId && <Ionicons name="checkmark" size={18} color="#22c55e" />}
                </TouchableOpacity>
              ))}
            </ScrollView>
            <TouchableOpacity style={s.createBtn} onPress={() => { setShowPicker(false); setShowCreate(true); }}>
              <Ionicons name="add-circle-outline" size={18} color="#6366f1" />
              <Text style={s.createBtnText}>New workspace</Text>
            </TouchableOpacity>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      {/* Create modal */}
      <Modal visible={showCreate} transparent animationType="fade" onRequestClose={() => setShowCreate(false)}>
        <TouchableOpacity style={s.modalBackdrop} activeOpacity={1} onPress={() => setShowCreate(false)}>
          <TouchableOpacity activeOpacity={1} style={[s.modalCard, { backgroundColor: tc.bg }]} onPress={() => {}}>
            <Text style={[s.modalTitle, { color: tc.text }]}>New workspace</Text>
            <Text style={[s.modalHint, { color: tc.textMid }]}>Everything inside — chats, contacts, memory, templates, agents — will start fresh.</Text>
            <View style={{ marginTop: 16 }}>
              <TextInput
                style={[s.input, { color: tc.text, borderColor: tc.border }]}
                value={newName}
                onChangeText={setNewName}
                placeholder="e.g. Work, Clients, Side Project"
                placeholderTextColor="#bbb"
                autoFocus
                maxLength={30}
              />
            </View>
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 18 }}>
              <TouchableOpacity style={[s.btnSecondary, { borderColor: tc.border }]} onPress={() => setShowCreate(false)}>
                <Text style={[s.btnSecondaryText, { color: tc.textMid }]}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.btnPrimary} onPress={handleCreate}>
                <Text style={s.btnPrimaryText}>Create</Text>
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </>
  );
}

const s = StyleSheet.create({
  switcher: { flexDirection: 'row', alignItems: 'center', flex: 1, paddingRight: 8 },
  brand: { fontSize: 17, fontWeight: '800' },
  subtitle: { fontSize: 11, marginTop: 1 },

  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  modalCard: { width: '100%', maxWidth: 380, borderRadius: 18, padding: 18 },
  modalTitle: { fontSize: 18, fontWeight: '700' },
  modalHint: { fontSize: 12, marginTop: 4 },

  wsRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 10, borderRadius: 12 },
  wsName: { fontSize: 15, fontWeight: '600', flex: 1 },

  createBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 12, marginTop: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#e5e7eb' },
  createBtnText: { color: '#6366f1', fontWeight: '600', fontSize: 14 },

  input: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15 },

  btnSecondary: { flex: 1, paddingVertical: 12, borderRadius: 10, borderWidth: 1, alignItems: 'center' },
  btnSecondaryText: { fontSize: 14, fontWeight: '600' },
  btnPrimary: { flex: 1, paddingVertical: 12, borderRadius: 10, backgroundColor: '#6366f1', alignItems: 'center' },
  btnPrimaryText: { fontSize: 14, fontWeight: '700', color: '#fff' },
});
