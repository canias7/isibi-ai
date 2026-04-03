import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, FlatList, TextInput, Alert, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { C, F, R } from '../lib/theme';
import { getTemplates, saveTemplates, EmailTemplate } from '../lib/storage';
import { sendEmail } from '../lib/actions';

export default function TemplatesScreen() {
  const [templates, setTemplates] = useState<EmailTemplate[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [sendTo, setSendTo] = useState('');
  const [showSend, setShowSend] = useState<string | null>(null);

  const load = useCallback(async () => { setTemplates(await getTemplates()); }, []);
  useEffect(() => { load(); }, []);

  const openCreate = () => { setEditId(null); setName(''); setSubject(''); setBody(''); setShowModal(true); };
  const openEdit = (t: EmailTemplate) => { setEditId(t.id); setName(t.name); setSubject(t.subject); setBody(t.body); setShowModal(true); };

  const save = async () => {
    if (!name.trim() || !subject.trim() || !body.trim()) { Alert.alert('Error', 'Fill in all fields'); return; }
    let updated = [...templates];
    if (editId) {
      updated = updated.map(t => t.id === editId ? { ...t, name: name.trim(), subject: subject.trim(), body: body.trim() } : t);
    } else {
      updated.push({ id: Date.now().toString(), name: name.trim(), subject: subject.trim(), body: body.trim() });
    }
    await saveTemplates(updated);
    setTemplates(updated);
    setShowModal(false);
  };

  const remove = (id: string) => {
    Alert.alert('Delete Template', 'Are you sure?', [
      { text: 'Cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => { const u = templates.filter(t => t.id !== id); await saveTemplates(u); setTemplates(u); }},
    ]);
  };

  const quickSend = (t: EmailTemplate) => {
    if (!sendTo.trim()) { Alert.alert('Error', 'Enter recipient email'); return; }
    sendEmail(sendTo.trim(), t.subject, t.body);
    setShowSend(null);
    setSendTo('');
  };

  if (showModal) {
    return (
      <SafeAreaView style={s.container}>
        <ScrollView contentContainerStyle={s.modal} keyboardShouldPersistTaps="handled">
          <View style={s.modalHeader}>
            <TouchableOpacity onPress={() => setShowModal(false)}><Text style={s.back}>‹ Back</Text></TouchableOpacity>
            <Text style={s.modalTitle}>{editId ? 'Edit' : 'New Template'}</Text>
            <TouchableOpacity onPress={save}><Text style={s.saveText}>Save</Text></TouchableOpacity>
          </View>

          <Text style={s.label}>Template Name</Text>
          <TextInput style={s.input} value={name} onChangeText={setName} placeholder="e.g. Approval Email" placeholderTextColor={C.textDim} />

          <Text style={s.label}>Subject Line</Text>
          <TextInput style={s.input} value={subject} onChangeText={setSubject} placeholder="e.g. You've Been Approved!" placeholderTextColor={C.textDim} />

          <Text style={s.label}>Email Body</Text>
          <Text style={s.hint}>Use X or {'{name}'} as placeholder for recipient name</Text>
          <TextInput style={[s.input, { height: 200 }]} value={body} onChangeText={setBody} placeholder="Type your email template..." placeholderTextColor={C.textDim} multiline textAlignVertical="top" />

          {editId && <TouchableOpacity style={s.delBtn} onPress={() => { remove(editId); setShowModal(false); }}><Text style={s.delText}>Delete Template</Text></TouchableOpacity>}
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.container}>
      <View style={s.header}>
        <Text style={s.title}>Templates</Text>
        <TouchableOpacity style={s.addBtn} onPress={openCreate}><Text style={s.addText}>+ New</Text></TouchableOpacity>
      </View>

      {templates.length === 0 ? (
        <View style={s.empty}>
          <Text style={{ fontSize: 40, marginBottom: 12 }}>📄</Text>
          <Text style={s.emptyTitle}>No templates yet</Text>
          <Text style={s.emptySub}>Save email templates for quick sending</Text>
          <TouchableOpacity style={s.emptyBtn} onPress={openCreate}><Text style={s.emptyBtnText}>Create Template</Text></TouchableOpacity>
        </View>
      ) : (
        <FlatList data={templates} keyExtractor={t => t.id} contentContainerStyle={{ padding: 16 }} renderItem={({ item: t }) => (
          <View style={s.card}>
            <TouchableOpacity style={s.cardContent} onPress={() => openEdit(t)} activeOpacity={0.7}>
              <Text style={s.cardName}>{t.name}</Text>
              <Text style={s.cardSubject}>{t.subject}</Text>
              <Text style={s.cardBody} numberOfLines={2}>{t.body}</Text>
            </TouchableOpacity>
            {showSend === t.id ? (
              <View style={s.sendRow}>
                <TextInput style={s.sendInput} value={sendTo} onChangeText={setSendTo} placeholder="recipient@email.com" placeholderTextColor={C.textDim} keyboardType="email-address" autoCapitalize="none" />
                <TouchableOpacity style={s.sendGo} onPress={() => quickSend(t)}><Text style={s.sendGoText}>Send</Text></TouchableOpacity>
                <TouchableOpacity onPress={() => setShowSend(null)}><Text style={s.cancelText}>✕</Text></TouchableOpacity>
              </View>
            ) : (
              <TouchableOpacity style={s.quickSendBtn} onPress={() => { setShowSend(t.id); setSendTo(''); }}>
                <Text style={s.quickSendText}>⚡ Quick Send</Text>
              </TouchableOpacity>
            )}
          </View>
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
  card: { backgroundColor: C.card, borderRadius: R.lg, padding: 16, marginBottom: 10, borderWidth: 1, borderColor: C.border },
  cardContent: { marginBottom: 8 },
  cardName: { fontSize: F.md, fontWeight: '600', color: C.text, marginBottom: 2 },
  cardSubject: { fontSize: F.sm, color: C.primaryLight, marginBottom: 4 },
  cardBody: { fontSize: F.xs, color: C.textDim, lineHeight: 18 },
  quickSendBtn: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: 8, backgroundColor: C.primary + '15', alignSelf: 'flex-start' },
  quickSendText: { fontSize: F.xs, color: C.primary, fontWeight: '600' },
  sendRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  sendInput: { flex: 1, backgroundColor: C.bg, borderRadius: 8, padding: 10, color: C.text, fontSize: F.sm, borderWidth: 1, borderColor: C.border },
  sendGo: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 8, backgroundColor: C.primary },
  sendGoText: { color: '#fff', fontSize: F.sm, fontWeight: '600' },
  cancelText: { color: C.textDim, fontSize: 16, paddingHorizontal: 8 },
  // Modal
  modal: { padding: 20, paddingTop: 8 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  back: { fontSize: 28, color: C.primary, fontWeight: '300' },
  modalTitle: { fontSize: F.lg, fontWeight: '700', color: C.text },
  saveText: { fontSize: F.md, color: C.primary, fontWeight: '600' },
  label: { fontSize: 10, fontWeight: '600', color: C.textDim, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8, marginTop: 16 },
  hint: { fontSize: 10, color: C.textDim, marginBottom: 6 },
  input: { backgroundColor: C.card, borderWidth: 1, borderColor: C.border, borderRadius: R.md, padding: 14, color: C.text, fontSize: F.md },
  delBtn: { marginTop: 32, padding: 16, borderRadius: R.md, backgroundColor: C.red + '15', alignItems: 'center' },
  delText: { color: C.red, fontSize: F.md, fontWeight: '600' },
});
