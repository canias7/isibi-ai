import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, FlatList, TextInput, Alert, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { C, F, R } from '../lib/theme';
import { getAgents, saveAgents, Agent } from '../lib/storage';

const EMOJIS = ['🤖', '📧', '📅', '📊', '🛒', '🎯', '🚀', '🔍', '📝', '🌐', '💬', '📁', '🏢', '⚙️', '🎨', '📞'];
const COLORS = ['#ec4899', '#8b5cf6', '#6366f1', '#3b82f6', '#22c55e', '#eab308', '#ef4444', '#f97316', '#14b8a6', '#06b6d4'];

export default function AgentsScreen() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [role, setRole] = useState('');
  const [instructions, setInstructions] = useState('');
  const [emoji, setEmoji] = useState('🤖');
  const [color, setColor] = useState('#ec4899');

  const load = useCallback(async () => { setAgents(await getAgents()); }, []);
  useEffect(() => { load(); }, []);

  const openCreate = () => { setEditId(null); setName(''); setRole(''); setInstructions(''); setEmoji('🤖'); setColor('#ec4899'); setShowModal(true); };
  const openEdit = (a: Agent) => { setEditId(a.id); setName(a.name); setRole(a.role); setInstructions(a.instructions); setEmoji(a.emoji); setColor(a.color); setShowModal(true); };

  const save = async () => {
    if (!name.trim()) { Alert.alert('Error', 'Name is required'); return; }
    let updated = [...agents];
    if (editId) {
      updated = updated.map(a => a.id === editId ? { ...a, name: name.trim(), role: role.trim(), instructions: instructions.trim(), emoji, color } : a);
    } else {
      updated.push({ id: Date.now().toString(), name: name.trim(), emoji, role: role.trim(), instructions: instructions.trim(), isActive: true, color });
    }
    await saveAgents(updated);
    setAgents(updated);
    setShowModal(false);
  };

  const remove = (id: string) => {
    Alert.alert('Delete Agent', 'Are you sure?', [
      { text: 'Cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => { const u = agents.filter(a => a.id !== id); await saveAgents(u); setAgents(u); }},
    ]);
  };

  const toggle = async (id: string) => {
    const u = agents.map(a => a.id === id ? { ...a, isActive: !a.isActive } : a);
    await saveAgents(u); setAgents(u);
  };

  if (showModal) {
    return (
      <SafeAreaView style={s.container}>
        <ScrollView contentContainerStyle={s.modal} keyboardShouldPersistTaps="handled">
          <View style={s.modalHeader}>
            <TouchableOpacity onPress={() => setShowModal(false)}><Text style={s.back}>‹ Back</Text></TouchableOpacity>
            <Text style={s.modalTitle}>{editId ? 'Edit Agent' : 'New Agent'}</Text>
            <TouchableOpacity onPress={save}><Text style={s.saveText}>Save</Text></TouchableOpacity>
          </View>

          <Text style={s.label}>Emoji</Text>
          <View style={s.row}>{EMOJIS.map(e => (
            <TouchableOpacity key={e} style={[s.emojiOpt, e === emoji && s.emojiSel]} onPress={() => setEmoji(e)}><Text style={{ fontSize: 20 }}>{e}</Text></TouchableOpacity>
          ))}</View>

          <Text style={s.label}>Name</Text>
          <TextInput style={s.input} value={name} onChangeText={setName} placeholder="e.g. Email Bot" placeholderTextColor={C.textDim} />

          <Text style={s.label}>Role</Text>
          <TextInput style={s.input} value={role} onChangeText={setRole} placeholder="e.g. Handle email tasks" placeholderTextColor={C.textDim} />

          <Text style={s.label}>System Prompt</Text>
          <TextInput style={[s.input, { height: 140 }]} value={instructions} onChangeText={setInstructions} placeholder="Tell the agent what to do..." placeholderTextColor={C.textDim} multiline textAlignVertical="top" />

          <Text style={s.label}>Color</Text>
          <View style={s.row}>{COLORS.map(c => (
            <TouchableOpacity key={c} style={[s.colorOpt, { backgroundColor: c }, c === color && s.colorSel]} onPress={() => setColor(c)} />
          ))}</View>

          {editId && <TouchableOpacity style={s.delBtn} onPress={() => { remove(editId); setShowModal(false); }}><Text style={s.delText}>Delete Agent</Text></TouchableOpacity>}
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.container}>
      <View style={s.header}>
        <Text style={s.title}>Agents</Text>
        <TouchableOpacity style={s.addBtn} onPress={openCreate}><Text style={s.addText}>+ New</Text></TouchableOpacity>
      </View>

      {agents.length === 0 ? (
        <View style={s.empty}>
          <Text style={{ fontSize: 40, marginBottom: 12 }}>🤖</Text>
          <Text style={s.emptyTitle}>No agents yet</Text>
          <Text style={s.emptySub}>Create agents with custom personalities</Text>
          <TouchableOpacity style={s.emptyBtn} onPress={openCreate}><Text style={s.emptyBtnText}>Create Agent</Text></TouchableOpacity>
        </View>
      ) : (
        <FlatList data={agents} keyExtractor={a => a.id} contentContainerStyle={{ padding: 16 }} renderItem={({ item: a }) => (
          <TouchableOpacity style={s.card} onPress={() => openEdit(a)} activeOpacity={0.7}>
            <View style={[s.cardAvatar, { backgroundColor: a.color + '20' }]}><Text style={{ fontSize: 24 }}>{a.emoji}</Text></View>
            <View style={s.cardInfo}>
              <Text style={s.cardName}>{a.name}</Text>
              <Text style={s.cardRole} numberOfLines={1}>{a.role || 'No role'}</Text>
            </View>
            <TouchableOpacity onPress={() => toggle(a.id)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <View style={[s.dot, { backgroundColor: a.isActive ? C.green : C.textDim }]} />
            </TouchableOpacity>
          </TouchableOpacity>
        )} />
      )}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 12 },
  title: { fontSize: 24, fontWeight: '700', color: C.text },
  addBtn: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20, backgroundColor: C.primary },
  addText: { color: '#fff', fontSize: F.sm, fontWeight: '600' },
  empty: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  emptyTitle: { fontSize: F.lg, fontWeight: '600', color: C.text, marginBottom: 4 },
  emptySub: { fontSize: F.sm, color: C.textDim, marginBottom: 20 },
  emptyBtn: { paddingHorizontal: 24, paddingVertical: 14, borderRadius: R.md, backgroundColor: C.primary },
  emptyBtnText: { color: '#fff', fontSize: F.md, fontWeight: '600' },
  card: { flexDirection: 'row', alignItems: 'center', backgroundColor: C.card, borderRadius: R.lg, padding: 16, marginBottom: 10, borderWidth: 1, borderColor: C.border },
  cardAvatar: { width: 48, height: 48, borderRadius: 14, alignItems: 'center', justifyContent: 'center', marginRight: 14 },
  cardInfo: { flex: 1 },
  cardName: { fontSize: F.md, fontWeight: '600', color: C.text, marginBottom: 2 },
  cardRole: { fontSize: F.xs, color: C.textDim },
  dot: { width: 10, height: 10, borderRadius: 5 },
  // Modal
  modal: { padding: 20, paddingTop: 8 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  back: { fontSize: 28, color: C.primary, fontWeight: '300' },
  modalTitle: { fontSize: F.lg, fontWeight: '700', color: C.text },
  saveText: { fontSize: F.md, color: C.primary, fontWeight: '600' },
  label: { fontSize: 10, fontWeight: '600', color: C.textDim, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8, marginTop: 16 },
  input: { backgroundColor: C.card, borderWidth: 1, borderColor: C.border, borderRadius: R.md, padding: 14, color: C.text, fontSize: F.md },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  emojiOpt: { width: 42, height: 42, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: C.card, borderWidth: 2, borderColor: 'transparent' },
  emojiSel: { borderColor: C.primary, backgroundColor: C.primary + '15' },
  colorOpt: { width: 32, height: 32, borderRadius: 16, borderWidth: 2, borderColor: 'transparent' },
  colorSel: { borderColor: '#fff' },
  delBtn: { marginTop: 32, padding: 16, borderRadius: R.md, backgroundColor: C.red + '15', alignItems: 'center' },
  delText: { color: C.red, fontSize: F.md, fontWeight: '600' },
});
