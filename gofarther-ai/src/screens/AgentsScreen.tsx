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
import { getAgents, saveAgents, deleteAgent as deleteAgentBoth, Agent, AgentTrigger } from '../lib/storage';
import { buildUserContextPrompt } from '../lib/promptContext';
import { onWorkspaceChange } from '../lib/workspaces';

const DEFAULT_AGENT_COLOR = '#1a1a1a';

const DAY_LABELS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
const DEFAULT_DAYS = 'YYYYY--';

function minutesToLabel(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  const period = h >= 12 ? 'PM' : 'AM';
  const h12 = ((h + 11) % 12) + 1;
  return `${h12}:${m.toString().padStart(2, '0')} ${period}`;
}

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
  const [triggers, setTriggers] = useState<AgentTrigger[]>([]);
  const [showAddTrigger, setShowAddTrigger] = useState(false);

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
    // First-load sync: push local agents up so the backend trigger
    // poller has them. saveAgents() handles new edits going forward;
    // this catches the legacy local-only state on first launch after
    // the proactive-agents update.
    if (a.length > 0) {
      try { await saveAgents(a); } catch {}
    }
  }, []);
  useEffect(() => { load(); }, []);
  // Re-fetch agents whenever the active workspace changes so the list
  // reflects the new workspace's agents, not the one we were viewing
  // when the user switched.
  useEffect(() => {
    const off = onWorkspaceChange(() => {
      setSelectedAgent(null);
      load();
    });
    return off;
  }, [load]);

  const openCreate = () => {
    setEditId(null); setName(''); setRole(''); setInstructions('');
    setTriggers([]); setShowEdit(true);
  };
  const openEditAgent = () => {
    if (!selectedAgent) return;
    setEditId(selectedAgent.id); setName(selectedAgent.name); setRole(selectedAgent.role);
    setInstructions(selectedAgent.instructions);
    setTriggers(selectedAgent.triggers || []);
    setShowEdit(true);
  };

  const saveAgent = async () => {
    if (!name.trim()) { Alert.alert('Error', 'Name is required'); return; }
    let updated = [...agents];
    if (editId) {
      updated = updated.map(a => a.id === editId ? { ...a, name: name.trim(), role: role.trim(), instructions: instructions.trim(), triggers } : a);
      if (selectedAgent?.id === editId) setSelectedAgent(updated.find(a => a.id === editId) || null);
    } else {
      const newAgent: Agent = { id: genId(), name: name.trim(), emoji: name.trim()[0]?.toUpperCase() || 'A', role: role.trim(), instructions: instructions.trim(), isActive: true, color: DEFAULT_AGENT_COLOR, triggers };
      updated.push(newAgent);
      setSelectedAgent(newAgent);
    }
    await saveAgents(updated);
    setAgents(updated);
    setShowEdit(false);
  };

  const addTrigger = (kind: AgentTrigger['kind']) => {
    let next: AgentTrigger;
    if (kind === 'email_from') {
      next = { kind: 'email_from', from_email: '' };
    } else if (kind === 'email_keyword') {
      next = { kind: 'email_keyword', subject_keyword: '' };
    } else {
      // Schedule — default to 9:00 AM weekdays in user's local timezone
      let tz = 'UTC';
      try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch {}
      next = { kind: 'schedule', time_min: 540, days_of_week: DEFAULT_DAYS, timezone_name: tz };
    }
    setTriggers([...triggers, next]);
    setShowAddTrigger(false);
  };

  const updateTrigger = (idx: number, patch: Partial<AgentTrigger>) => {
    setTriggers(triggers.map((t, i) => (i === idx ? { ...t, ...patch } : t)));
  };

  const removeTrigger = (idx: number) => {
    setTriggers(triggers.filter((_, i) => i !== idx));
  };

  const toggleScheduleDay = (idx: number, dayIdx: number) => {
    const t = triggers[idx];
    if (t.kind !== 'schedule') return;
    const dow = (t.days_of_week || DEFAULT_DAYS).split('');
    while (dow.length < 7) dow.push('-');
    dow[dayIdx] = dow[dayIdx] === 'Y' ? '-' : 'Y';
    updateTrigger(idx, { days_of_week: dow.join('') });
  };

  const bumpScheduleTime = (idx: number, deltaMin: number) => {
    const t = triggers[idx];
    if (t.kind !== 'schedule') return;
    const next = ((t.time_min ?? 540) + deltaMin + 24 * 60) % (24 * 60);
    updateTrigger(idx, { time_min: next });
  };

  const removeAgent = () => {
    if (!editId) return;
    Alert.alert('Delete Agent', 'Are you sure?', [
      { text: 'Cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => {
        await deleteAgentBoth(editId);
        const u = agents.filter(a => a.id !== editId);
        setAgents(u);
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

          <Text style={[s.label, { color: tc.textDim }]}>Triggers</Text>
          <Text style={[s.helperText, { color: tc.textDim }]}>
            Wake this agent up automatically. When a trigger fires, the agent runs and pings you with a notification.
          </Text>
          {triggers.length === 0 && (
            <Text style={[s.helperText, { color: tc.textDim, marginTop: 4, fontStyle: 'italic' }]}>
              No triggers yet — this agent only responds in chat.
            </Text>
          )}
          {triggers.map((trig, idx) => (
            <View key={idx} style={[s.triggerCard, { backgroundColor: tc.card, borderColor: tc.border }]}>
              <View style={s.triggerHeader}>
                <Text style={[s.triggerTitle, { color: tc.text }]}>
                  {trig.kind === 'email_from' ? 'Email from sender' : trig.kind === 'email_keyword' ? 'Email subject contains' : 'Scheduled time'}
                </Text>
                <TouchableOpacity onPress={() => removeTrigger(idx)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                  <Ionicons name="close-circle" size={20} color="#999" />
                </TouchableOpacity>
              </View>
              {trig.kind === 'email_from' && (
                <TextInput
                  style={[s.input, { backgroundColor: tc.bg, borderColor: tc.border, color: tc.text, marginTop: 8 }]}
                  value={trig.from_email || ''}
                  onChangeText={txt => updateTrigger(idx, { from_email: txt })}
                  placeholder="boss@acme.com"
                  placeholderTextColor={tc.textDim}
                  autoCapitalize="none"
                  keyboardType="email-address"
                />
              )}
              {trig.kind === 'email_keyword' && (
                <TextInput
                  style={[s.input, { backgroundColor: tc.bg, borderColor: tc.border, color: tc.text, marginTop: 8 }]}
                  value={trig.subject_keyword || ''}
                  onChangeText={txt => updateTrigger(idx, { subject_keyword: txt })}
                  placeholder="invoice, urgent, meeting…"
                  placeholderTextColor={tc.textDim}
                  autoCapitalize="none"
                />
              )}
              {trig.kind === 'schedule' && (
                <View style={{ marginTop: 8 }}>
                  <View style={s.timeRow}>
                    <TouchableOpacity onPress={() => bumpScheduleTime(idx, -30)} style={s.timeBtn}>
                      <Text style={s.timeBtnText}>−30m</Text>
                    </TouchableOpacity>
                    <Text style={[s.timeDisplay, { color: tc.text }]}>{minutesToLabel(trig.time_min ?? 540)}</Text>
                    <TouchableOpacity onPress={() => bumpScheduleTime(idx, 30)} style={s.timeBtn}>
                      <Text style={s.timeBtnText}>+30m</Text>
                    </TouchableOpacity>
                  </View>
                  <View style={s.daysRow}>
                    {DAY_LABELS.map((d, di) => {
                      const dow = (trig.days_of_week || DEFAULT_DAYS).padEnd(7, '-');
                      const on = dow[di] === 'Y';
                      return (
                        <TouchableOpacity key={di} style={[s.dayChip, on && s.dayChipOn]} onPress={() => toggleScheduleDay(idx, di)}>
                          <Text style={[s.dayChipText, on && s.dayChipTextOn]}>{d}</Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </View>
              )}
            </View>
          ))}

          <TouchableOpacity style={s.addTriggerBtn} onPress={() => setShowAddTrigger(!showAddTrigger)}>
            <Ionicons name="add-circle-outline" size={18} color={C.primary} />
            <Text style={s.addTriggerText}>Add a trigger</Text>
          </TouchableOpacity>
          {showAddTrigger && (
            <View style={s.addTriggerMenu}>
              <TouchableOpacity style={[s.triggerOption, { borderBottomColor: tc.border }]} onPress={() => addTrigger('email_from')}>
                <Text style={[s.triggerOptionTitle, { color: tc.text }]}>Email from a specific sender</Text>
                <Text style={[s.triggerOptionDesc, { color: tc.textDim }]}>Fires when an email arrives from a sender you specify (e.g. your boss)</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[s.triggerOption, { borderBottomColor: tc.border }]} onPress={() => addTrigger('email_keyword')}>
                <Text style={[s.triggerOptionTitle, { color: tc.text }]}>Email subject contains keyword</Text>
                <Text style={[s.triggerOptionDesc, { color: tc.textDim }]}>Fires when an email subject contains a word (e.g. "invoice")</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.triggerOption} onPress={() => addTrigger('schedule')}>
                <Text style={[s.triggerOptionTitle, { color: tc.text }]}>On a schedule</Text>
                <Text style={[s.triggerOptionDesc, { color: tc.textDim }]}>Fires at a specific time of day on chosen weekdays</Text>
              </TouchableOpacity>
            </View>
          )}

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
              <Text style={[s.dropBtnName, { color: tc.text }]}>{selectedAgent.name}</Text>
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

  // Triggers
  helperText: { fontSize: 12, lineHeight: 17, marginBottom: 6 },
  triggerCard: { borderRadius: 12, borderWidth: 1, padding: 12, marginTop: 10 },
  triggerHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  triggerTitle: { fontSize: 13, fontWeight: '600' },
  timeRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 },
  timeBtn: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, backgroundColor: '#f0f0f0' },
  timeBtnText: { fontSize: 13, fontWeight: '600', color: '#1a1a1a' },
  timeDisplay: { fontSize: 18, fontWeight: '700' },
  daysRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 12, gap: 4 },
  dayChip: { flex: 1, paddingVertical: 8, borderRadius: 8, backgroundColor: '#f0f0f0', alignItems: 'center' },
  dayChipOn: { backgroundColor: C.primary },
  dayChipText: { fontSize: 12, fontWeight: '600', color: '#666' },
  dayChipTextOn: { color: '#fff' },
  addTriggerBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 12, paddingVertical: 10 },
  addTriggerText: { fontSize: 14, fontWeight: '600', color: C.primary },
  addTriggerMenu: { marginTop: 4, borderRadius: 12, borderWidth: 1, borderColor: '#e8e8e8', overflow: 'hidden' },
  triggerOption: { padding: 14, borderBottomWidth: StyleSheet.hairlineWidth },
  triggerOptionTitle: { fontSize: 14, fontWeight: '600' },
  triggerOptionDesc: { fontSize: 12, marginTop: 2, lineHeight: 16 },
});
