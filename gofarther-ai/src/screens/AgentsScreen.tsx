import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, FlatList, TextInput,
  Alert, ScrollView, KeyboardAvoidingView, Platform, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { C } from '../lib/theme';
import { useTheme } from '../lib/ThemeContext';
import { Ionicons } from '@expo/vector-icons';
import { ChatMsg, genId } from '../lib/types';
import { useChat } from '../lib/useChat';
import { getAgents, saveAgents, Agent } from '../lib/storage';
import { buildUserContextPrompt } from '../lib/promptContext';

const COLORS = ['#ec4899', '#8b5cf6', '#6366f1', '#3b82f6', '#22c55e', '#eab308', '#ef4444', '#f97316', '#14b8a6', '#06b6d4'];

export default function AgentsScreen({ onBack }: { onBack: () => void }) {
  const { colors: tc } = useTheme();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [selectedAgent, setSelectedAgent] = useState<Agent | null>(null);
  const [showDropdown, setShowDropdown] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [role, setRole] = useState('');
  const [instructions, setInstructions] = useState('');
  const [color, setColor] = useState('#ec4899');

  const [input, setInput] = useState('');
  const flatList = useRef<FlatList>(null);
  // Base agent prompt — the shared user-context extras (contacts, memory,
  // nickname, prefs, custom instructions, email subject rule) are appended
  // async in a useEffect below so the agent knows who "my boss" is too.
  const baseAgentPrompt = selectedAgent
    ? `You are "${selectedAgent.name}". ${selectedAgent.instructions || selectedAgent.role || 'You are a helpful assistant.'}\n\nYou can perform actions by including a single JSON object:\n{"type":"call","target":"number or name"}\n{"type":"sms","target":"number or name","text":"message"}\n{"type":"email","target":"email","key":"subject","text":"body"}\n{"type":"open_url","target":"url"}\n{"type":"maps","target":"query"}\nOnly include action JSON if asked to DO something.`
    : '';
  const [agentPrompt, setAgentPrompt] = useState(baseAgentPrompt);
  const [contactsVersion, setContactsVersion] = useState(0);
  // Keep the user-context extras (saved contacts, memory, nickname, etc.)
  // attached to whatever agent is currently selected. Rebuild when the
  // selected agent changes or when a chat turn saves a new contact.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const extras = await buildUserContextPrompt({ terseWhenEmpty: true });
      if (!cancelled) setAgentPrompt(baseAgentPrompt + extras);
    })();
    return () => { cancelled = true; };
  }, [baseAgentPrompt, contactsVersion]);
  const { messages, loading, confirmAction, cancelAction, send: chatSend } = useChat({
    sessionId: selectedAgent ? `agent_${selectedAgent.id}` : null,
    systemPrompt: agentPrompt,
    onContactsChanged: () => setContactsVersion(v => v + 1),
  });

  const load = useCallback(async () => {
    const a = await getAgents();
    setAgents(a);
    if (a.length > 0 && !selectedAgent) setSelectedAgent(a[0]);
  }, []);
  useEffect(() => { load(); }, []);

  const openCreate = () => { setEditId(null); setName(''); setRole(''); setInstructions(''); setColor('#ec4899'); setShowEdit(true); };
  const openEditAgent = () => {
    if (!selectedAgent) return;
    setEditId(selectedAgent.id); setName(selectedAgent.name); setRole(selectedAgent.role);
    setInstructions(selectedAgent.instructions); setColor(selectedAgent.color); setShowEdit(true);
  };

  const saveAgent = async () => {
    if (!name.trim()) { Alert.alert('Error', 'Name is required'); return; }
    let updated = [...agents];
    if (editId) {
      updated = updated.map(a => a.id === editId ? { ...a, name: name.trim(), role: role.trim(), instructions: instructions.trim(), emoji: name.trim()[0]?.toUpperCase() || 'A', color } : a);
      if (selectedAgent?.id === editId) setSelectedAgent(updated.find(a => a.id === editId) || null);
    } else {
      const newAgent: Agent = { id: genId(), name: name.trim(), emoji: name.trim()[0]?.toUpperCase() || 'A', role: role.trim(), instructions: instructions.trim(), isActive: true, color };
      updated.push(newAgent);
      setSelectedAgent(newAgent);
    }
    await saveAgents(updated);
    setAgents(updated);
    setShowEdit(false);
  };

  const removeAgent = () => {
    if (!editId) return;
    Alert.alert('Delete Agent', 'Are you sure?', [
      { text: 'Cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => {
        const u = agents.filter(a => a.id !== editId);
        await saveAgents(u); setAgents(u);
        setSelectedAgent(u.length > 0 ? u[0] : null);
        setShowEdit(false);
      }},
    ]);
  };

  const sendToAgent = () => {
    const text = input.trim();
    if (!text || loading || !selectedAgent) return;
    setInput('');
    chatSend(text);
  };

  // ==================== EDIT/CREATE ====================
  if (showEdit) {
    return (
      <SafeAreaView style={[s.container, { backgroundColor: tc.bg }]}>
        <ScrollView contentContainerStyle={s.editContent} keyboardShouldPersistTaps="handled">
          <View style={s.editHeader}>
            <TouchableOpacity onPress={() => setShowEdit(false)}><Text style={[s.backText, { color: tc.text }]}>Back</Text></TouchableOpacity>
            <Text style={[s.editTitle, { color: tc.text }]}>{editId ? 'Edit Agent' : 'New Agent'}</Text>
            <TouchableOpacity onPress={saveAgent}><Text style={s.saveText}>Save</Text></TouchableOpacity>
          </View>

          <Text style={[s.label, { color: tc.textDim }]}>Name</Text>
          <TextInput style={[s.input, { backgroundColor: tc.card, borderColor: tc.border, color: tc.text }]} value={name} onChangeText={setName} placeholder="e.g. Pedro" placeholderTextColor={tc.textDim} />
          <Text style={[s.label, { color: tc.textDim }]}>Role</Text>
          <TextInput style={[s.input, { backgroundColor: tc.card, borderColor: tc.border, color: tc.text }]} value={role} onChangeText={setRole} placeholder="e.g. Handle email tasks" placeholderTextColor={tc.textDim} />
          <Text style={[s.label, { color: tc.textDim }]}>System Prompt</Text>
          <TextInput style={[s.input, { height: 140, backgroundColor: tc.card, borderColor: tc.border, color: tc.text }]} value={instructions} onChangeText={setInstructions} placeholder="Tell the agent what to do..." placeholderTextColor={tc.textDim} multiline textAlignVertical="top" />
          <Text style={s.label}>Color</Text>
          <View style={s.colorRow}>{COLORS.map(c => (
            <TouchableOpacity key={c} style={[s.colorOpt, { backgroundColor: c }, c === color && s.colorSel]} onPress={() => setColor(c)} />
          ))}</View>
          {editId && <TouchableOpacity style={s.delBtn} onPress={removeAgent}><Text style={s.delText}>Delete Agent</Text></TouchableOpacity>}
        </ScrollView>
      </SafeAreaView>
    );
  }

  // ==================== MAIN SCREEN ====================
  return (
    <SafeAreaView style={[s.container, { backgroundColor: tc.bg }]}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        {/* Header with dropdown + actions */}
        <View style={[s.header, { borderBottomColor: tc.border }]}>
          <TouchableOpacity onPress={onBack} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }} accessibilityLabel="Back" accessibilityRole="button">
            <Ionicons name="chevron-back" size={24} color={tc.text} />
          </TouchableOpacity>
          <TouchableOpacity style={[s.dropdownBtn, { backgroundColor: tc.card }]} onPress={() => setShowDropdown(!showDropdown)} activeOpacity={0.7}>
            {selectedAgent ? (
              <>
                <View style={[s.dropDot, { backgroundColor: selectedAgent.color }]} />
                <Text style={[s.dropBtnName, { color: tc.text }]}>{selectedAgent.name}</Text>
              </>
            ) : (
              <Text style={[s.dropBtnName, { color: tc.textMid }]}>Select Agent</Text>
            )}
            <Text style={s.dropChevron}>v</Text>
          </TouchableOpacity>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }}>
            {selectedAgent && (
              <TouchableOpacity onPress={openEditAgent} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                <Text style={s.editLink}>Edit</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity style={s.addBtn} onPress={openCreate}><Text style={s.addText}>+</Text></TouchableOpacity>
          </View>
        </View>

        {/* Dropdown */}
        {showDropdown && (
          <View style={[s.dropdown, { backgroundColor: tc.bg, borderColor: tc.border }]}>
            {agents.length === 0 ? (
              <View style={s.dropEmpty}>
                <Text style={s.dropEmptyText}>No agents — tap + to create one</Text>
              </View>
            ) : (
              agents.map(a => (
                <TouchableOpacity key={a.id} style={[s.dropItem, selectedAgent?.id === a.id && s.dropItemActive]} onPress={() => { setSelectedAgent(a); setShowDropdown(false); }} activeOpacity={0.6}>
                  <View style={[s.dropItemDot, { backgroundColor: a.color }]} />
                  <View style={{ flex: 1 }}>
                    <Text style={[s.dropItemName, { color: tc.text }]}>{a.name}</Text>
                    <Text style={[s.dropItemRole, { color: tc.textDim }]}>{a.role || 'No role'}</Text>
                  </View>
                </TouchableOpacity>
              ))
            )}
          </View>
        )}

        {/* Chat area */}
        {!selectedAgent ? (
          <View style={s.empty}>
            <Text style={[s.emptyTitle, { color: tc.text }]}>No agents yet</Text>
            <Text style={[s.emptySub, { color: tc.textDim }]}>Create agents with custom personalities and send them to work</Text>
            <TouchableOpacity style={s.emptyBtn} onPress={openCreate}><Text style={s.emptyBtnText}>Create Agent</Text></TouchableOpacity>
          </View>
        ) : messages.length === 0 ? (
          <View style={s.empty}>
            <View style={[s.emptyAvatar, { backgroundColor: selectedAgent.color + '15' }]}>
              <Text style={[s.emptyAvatarText, { color: selectedAgent.color }]}>{selectedAgent.name[0]?.toUpperCase()}</Text>
            </View>
            <Text style={s.emptyTitle}>Send {selectedAgent.name} to work</Text>
            <Text style={s.emptySub}>{selectedAgent.role || 'Tell this agent what to do'}</Text>
          </View>
        ) : (
          <FlatList
            ref={flatList}
            data={messages}
            keyExtractor={item => item.id}
            contentContainerStyle={{ padding: 16, paddingBottom: 8 }}
            onContentSizeChange={() => flatList.current?.scrollToEnd({ animated: true })}
            showsVerticalScrollIndicator={false}
            renderItem={({ item }) => (
              <View style={[s.msgRow, item.role === 'user' && s.msgRowUser]}>
                {item.role === 'assistant' && (
                  <View style={[s.msgAvatar, { backgroundColor: selectedAgent.color + '15' }]}>
                    <Text style={[s.msgAvatarLetter, { color: selectedAgent.color }]}>{selectedAgent.name[0]}</Text>
                  </View>
                )}
                <View style={{ maxWidth: '80%' }}>
                  <View style={[s.bubble, item.role === 'user' ? s.bubbleUser : item.role === 'system' ? s.bubbleSystem : s.bubbleAI]}>
                    <Text style={[s.msgText, item.role === 'user' && { color: '#fff' }]} selectable>{item.content}</Text>
                  </View>
                  {item.action && item.actionStatus === 'confirm' && (
                    <View style={s.confirmCard}>
                      <Text style={s.confirmLabel}>{item.action.type} {item.action.target || ''}</Text>
                      <View style={s.confirmBtns}>
                        <TouchableOpacity style={s.confirmYes} onPress={() => confirmAction(item.id)}><Text style={s.confirmYesText}>Proceed</Text></TouchableOpacity>
                        <TouchableOpacity style={s.confirmNo} onPress={() => cancelAction(item.id)}><Text style={s.confirmNoText}>Cancel</Text></TouchableOpacity>
                      </View>
                    </View>
                  )}
                  {item.action && item.actionStatus && item.actionStatus !== 'confirm' && (
                    <View style={[s.statusCard, { borderLeftColor: item.actionStatus === 'done' ? C.green : C.red }]}>
                      <Text style={{ fontSize: 12, fontWeight: '600', color: item.actionStatus === 'done' ? C.green : C.red }}>{item.actionStatus === 'done' ? 'Done' : 'Cancelled'}</Text>
                    </View>
                  )}
                </View>
              </View>
            )}
          />
        )}

        {/* Input */}
        {selectedAgent && (
          <View style={[s.inputBar, { borderTopColor: tc.border }]}>
            <TextInput
              style={[s.chatInput, { backgroundColor: tc.inputBg, borderColor: tc.border, color: tc.text }]}
              value={input}
              onChangeText={setInput}
              placeholder={`Tell ${selectedAgent.name} what to do...`}
              placeholderTextColor="#999"
              multiline maxLength={2000}
              onSubmitEditing={sendToAgent}
              blurOnSubmit={false}
            />
            <TouchableOpacity style={[s.sendBtn, (!input.trim() || loading) && { opacity: 0.2 }]} onPress={sendToAgent} disabled={!input.trim() || loading} activeOpacity={0.7}>
              {loading ? <ActivityIndicator color="white" size="small" /> : <Ionicons name="arrow-up" size={20} color="#ffffff" />}
            </TouchableOpacity>
          </View>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#ffffff' },

  // Header
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#e8e8e8' },
  backArrow: { fontSize: 20, color: '#1a1a1a', fontWeight: '400' },
  dropdownBtn: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#f2f2f2', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, gap: 6 },
  dropDot: { width: 8, height: 8, borderRadius: 4 },
  dropBtnName: { fontSize: 14, fontWeight: '600', color: '#1a1a1a' },
  dropChevron: { fontSize: 10, color: '#999', fontWeight: '300' },
  editLink: { fontSize: 14, color: '#999', fontWeight: '500' },
  addBtn: { width: 32, height: 32, borderRadius: 16, backgroundColor: '#1a1a1a', alignItems: 'center', justifyContent: 'center' },
  addText: { color: '#ffffff', fontSize: 18, fontWeight: '600', marginTop: -1 },

  // Dropdown
  dropdown: { position: 'absolute', top: 56, left: 16, right: 16, backgroundColor: '#fff', borderRadius: 14, borderWidth: 1, borderColor: '#e0e0e0', zIndex: 100, elevation: 10, shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 12, overflow: 'hidden' },
  dropItem: { flexDirection: 'row', alignItems: 'center', padding: 14, gap: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#f0f0f0' },
  dropItemActive: { backgroundColor: '#f5f5f5' },
  dropItemDot: { width: 10, height: 10, borderRadius: 5 },
  dropItemName: { fontSize: 15, fontWeight: '600', color: '#1a1a1a' },
  dropItemRole: { fontSize: 12, color: '#999' },
  dropEmpty: { padding: 20, alignItems: 'center' },
  dropEmptyText: { fontSize: 13, color: '#999' },

  // Empty
  empty: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  emptyAvatar: { width: 64, height: 64, borderRadius: 20, alignItems: 'center', justifyContent: 'center', marginBottom: 16 },
  emptyAvatarText: { fontSize: 28, fontWeight: '700' },
  emptyTitle: { fontSize: 17, fontWeight: '600', color: '#1a1a1a', marginBottom: 4 },
  emptySub: { fontSize: 13, color: '#999', textAlign: 'center', marginBottom: 20 },
  emptyBtn: { paddingHorizontal: 24, paddingVertical: 14, borderRadius: 12, backgroundColor: '#1a1a1a' },
  emptyBtnText: { color: '#ffffff', fontSize: 15, fontWeight: '600' },

  // Chat
  msgRow: { marginBottom: 12, flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  msgRowUser: { justifyContent: 'flex-end' },
  msgAvatar: { width: 26, height: 26, borderRadius: 8, alignItems: 'center', justifyContent: 'center', marginTop: 2 },
  msgAvatarLetter: { fontSize: 12, fontWeight: '700' },
  bubble: { padding: 12, borderRadius: 18 },
  bubbleUser: { backgroundColor: C.primary, borderBottomRightRadius: 4 },
  bubbleAI: { backgroundColor: '#f2f2f2', borderBottomLeftRadius: 4, borderWidth: 1, borderColor: '#e8e8e8' },
  bubbleSystem: { backgroundColor: '#fef2f2', borderRadius: 12, borderWidth: 1, borderColor: '#fecaca' },
  msgText: { fontSize: 15, color: '#1a1a1a', lineHeight: 22 },

  confirmCard: { marginTop: 8, padding: 12, borderRadius: 12, backgroundColor: '#f5f5f5', borderWidth: 1, borderColor: '#e0e0e0' },
  confirmLabel: { fontSize: 13, fontWeight: '600', color: '#1a1a1a', marginBottom: 8 },
  confirmBtns: { flexDirection: 'row', gap: 8 },
  confirmYes: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 8, backgroundColor: '#1a1a1a' },
  confirmYesText: { fontSize: 13, fontWeight: '600', color: '#fff' },
  confirmNo: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 8, borderWidth: 1, borderColor: '#ddd' },
  confirmNoText: { fontSize: 13, fontWeight: '500', color: '#666' },
  statusCard: { marginTop: 6, padding: 10, borderRadius: 10, backgroundColor: '#f5f5f5', borderLeftWidth: 3 },

  // Input
  inputBar: { flexDirection: 'row', alignItems: 'flex-end', padding: 12, gap: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#e8e8e8' },
  chatInput: { flex: 1, backgroundColor: '#f2f2f2', borderRadius: 22, paddingHorizontal: 16, paddingVertical: 10, color: '#1a1a1a', fontSize: 15, maxHeight: 120, borderWidth: 1, borderColor: '#e0e0e0' },
  sendBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#1a1a1a', justifyContent: 'center', alignItems: 'center', marginBottom: 2 },
  sendIcon: { color: '#ffffff', fontSize: 18, fontWeight: '700' },

  // Edit
  editContent: { padding: 20, paddingTop: 8, paddingBottom: 40 },
  editHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  backText: { fontSize: 15, color: '#1a1a1a', fontWeight: '500' },
  editTitle: { fontSize: 17, fontWeight: '600', color: '#1a1a1a' },
  saveText: { fontSize: 15, color: C.primary, fontWeight: '600' },
  label: { fontSize: 11, fontWeight: '600', color: '#999', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8, marginTop: 16 },
  input: { backgroundColor: '#f5f5f5', borderWidth: 1, borderColor: '#e8e8e8', borderRadius: 12, padding: 14, color: '#1a1a1a', fontSize: 15 },
  colorRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  colorOpt: { width: 32, height: 32, borderRadius: 16, borderWidth: 2, borderColor: 'transparent' },
  colorSel: { borderColor: '#1a1a1a', borderWidth: 3 },
  delBtn: { marginTop: 32, padding: 16, borderRadius: 12, backgroundColor: '#fef2f2', alignItems: 'center' },
  delText: { color: C.red, fontSize: 15, fontWeight: '600' },
});
