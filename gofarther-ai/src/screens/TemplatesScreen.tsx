import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, FlatList, TextInput, Alert, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { C } from '../lib/theme';
import { useTheme } from '../lib/ThemeContext';
import { Ionicons } from '@expo/vector-icons';
import { getTemplates, saveTemplates, EmailTemplate, getSMSTemplates, saveSMSTemplates, SMSTemplate } from '../lib/storage';
import { sendEmail, sendSMS } from '../lib/actions';

type Tab = 'email' | 'sms';

export default function TemplatesScreen({ onBack }: { onBack: () => void }) {
  const { colors: tc } = useTheme();
  const [tab, setTab] = useState<Tab>('email');
  const [emailTemplates, setEmailTemplates] = useState<EmailTemplate[]>([]);
  const [smsTemplates, setSmsTemplates] = useState<SMSTemplate[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [sendTo, setSendTo] = useState('');
  const [showSend, setShowSend] = useState<string | null>(null);

  const load = useCallback(async () => {
    setEmailTemplates(await getTemplates());
    setSmsTemplates(await getSMSTemplates());
  }, []);
  useEffect(() => { load(); }, []);

  const templates = tab === 'email' ? emailTemplates : smsTemplates;

  const openCreate = () => { setEditId(null); setName(''); setSubject(''); setBody(''); setShowModal(true); };
  const openEdit = (t: any) => { setEditId(t.id); setName(t.name); setSubject(t.subject || ''); setBody(t.body); setShowModal(true); };

  const save = async () => {
    if (!name.trim() || !body.trim()) { Alert.alert('Error', 'Fill in all fields'); return; }
    if (tab === 'email' && !subject.trim()) { Alert.alert('Error', 'Subject is required for email'); return; }

    if (tab === 'email') {
      let updated = [...emailTemplates];
      if (editId) {
        updated = updated.map(t => t.id === editId ? { ...t, name: name.trim(), subject: subject.trim(), body: body.trim() } : t);
      } else {
        updated.push({ id: Date.now().toString(), name: name.trim(), subject: subject.trim(), body: body.trim() });
      }
      await saveTemplates(updated);
      setEmailTemplates(updated);
    } else {
      let updated = [...smsTemplates];
      if (editId) {
        updated = updated.map(t => t.id === editId ? { ...t, name: name.trim(), body: body.trim() } : t);
      } else {
        updated.push({ id: Date.now().toString(), name: name.trim(), body: body.trim() });
      }
      await saveSMSTemplates(updated);
      setSmsTemplates(updated);
    }
    setShowModal(false);
  };

  const remove = (id: string) => {
    Alert.alert('Delete Template', 'Are you sure?', [
      { text: 'Cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => {
        if (tab === 'email') {
          const u = emailTemplates.filter(t => t.id !== id); await saveTemplates(u); setEmailTemplates(u);
        } else {
          const u = smsTemplates.filter(t => t.id !== id); await saveSMSTemplates(u); setSmsTemplates(u);
        }
      }},
    ]);
  };

  const quickSend = (t: any) => {
    if (!sendTo.trim()) { Alert.alert('Error', 'Enter recipient'); return; }
    if (tab === 'email') {
      sendEmail(sendTo.trim(), t.subject, t.body);
    } else {
      sendSMS(sendTo.trim(), t.body);
    }
    setShowSend(null); setSendTo('');
  };

  // ==================== EDIT MODAL ====================
  if (showModal) {
    return (
      <SafeAreaView style={[s.container, { backgroundColor: tc.bg }]}>
        <ScrollView contentContainerStyle={s.modal} keyboardShouldPersistTaps="handled">
          <View style={s.modalHeader}>
            <TouchableOpacity onPress={() => setShowModal(false)}><Text style={[s.backText, { color: tc.text }]}>Back</Text></TouchableOpacity>
            <Text style={[s.modalTitle, { color: tc.text }]}>{editId ? 'Edit' : 'New'} {tab === 'email' ? 'Email' : 'SMS'}</Text>
            <TouchableOpacity onPress={save}><Text style={s.saveText}>Save</Text></TouchableOpacity>
          </View>

          <Text style={[s.label, { color: tc.textDim }]}>Template Name</Text>
          <TextInput style={[s.input, { backgroundColor: tc.card, borderColor: tc.border, color: tc.text }]} value={name} onChangeText={setName} placeholder={tab === 'email' ? 'e.g. Approval Email' : 'e.g. Quick Check-in'} placeholderTextColor="#999" />

          {tab === 'email' && (
            <>
              <Text style={[s.label, { color: tc.textDim }]}>Subject Line</Text>
              <TextInput style={[s.input, { backgroundColor: tc.card, borderColor: tc.border, color: tc.text }]} value={subject} onChangeText={setSubject} placeholder="e.g. You've Been Approved!" placeholderTextColor="#999" />
            </>
          )}

          <Text style={[s.label, { color: tc.textDim }]}>{tab === 'email' ? 'Email Body' : 'Message'}</Text>
          <TextInput style={[s.input, { height: tab === 'email' ? 200 : 120 }]} value={body} onChangeText={setBody} placeholder={tab === 'email' ? 'Type your email template...' : 'Type your SMS template...'} placeholderTextColor="#999" multiline textAlignVertical="top" />

          {editId && <TouchableOpacity style={s.delBtn} onPress={() => { remove(editId); setShowModal(false); }}><Text style={s.delText}>Delete Template</Text></TouchableOpacity>}
        </ScrollView>
      </SafeAreaView>
    );
  }

  // ==================== LIST ====================
  return (
    <SafeAreaView style={[s.container, { backgroundColor: tc.bg }]}>
      <View style={s.header}>
        <TouchableOpacity onPress={onBack} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Ionicons name="chevron-back" size={24} color={tc.text} />
        </TouchableOpacity>
        <Text style={[s.title, { color: tc.text }]}>Templates</Text>
        <TouchableOpacity style={s.addBtn} onPress={openCreate}><Text style={s.addText}>+ New</Text></TouchableOpacity>
      </View>

      {/* Tab toggle */}
      <View style={[s.tabRow, { backgroundColor: tc.card }]}>
        <TouchableOpacity style={[s.tab, tab === 'email' && [s.tabActive, { backgroundColor: tc.bg }]]} onPress={() => setTab('email')} activeOpacity={0.7}>
          <Text style={[s.tabText, { color: tc.textDim }, tab === 'email' && { color: tc.text, fontWeight: '600' }]}>Email</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[s.tab, tab === 'sms' && [s.tabActive, { backgroundColor: tc.bg }]]} onPress={() => setTab('sms')} activeOpacity={0.7}>
          <Text style={[s.tabText, { color: tc.textDim }, tab === 'sms' && { color: tc.text, fontWeight: '600' }]}>SMS</Text>
        </TouchableOpacity>
      </View>

      {templates.length === 0 ? (
        <View style={s.empty}>
          <Text style={[s.emptyTitle, { color: tc.text }]}>No {tab} templates yet</Text>
          <Text style={[s.emptySub, { color: tc.textDim }]}>Save {tab} templates for quick sending</Text>
          <TouchableOpacity style={s.emptyBtn} onPress={openCreate}><Text style={s.emptyBtnText}>Create Template</Text></TouchableOpacity>
        </View>
      ) : (
        <FlatList data={templates} keyExtractor={t => t.id} contentContainerStyle={{ padding: 16 }} renderItem={({ item: t }) => (
          <View style={[s.card, { backgroundColor: tc.surface, borderColor: tc.border }]}>
            <TouchableOpacity style={s.cardContent} onPress={() => openEdit(t)} activeOpacity={0.7}>
              <Text style={[s.cardName, { color: tc.text }]}>{t.name}</Text>
              {tab === 'email' && 'subject' in t && <Text style={s.cardSubject}>{(t as EmailTemplate).subject}</Text>}
              <Text style={[s.cardBody, { color: tc.textMid }]} numberOfLines={2}>{t.body}</Text>
            </TouchableOpacity>
            {showSend === t.id ? (
              <View style={s.sendRow}>
                <TextInput style={s.sendInput} value={sendTo} onChangeText={setSendTo} placeholder={tab === 'email' ? 'recipient@email.com' : 'Contact name or number'} placeholderTextColor="#999" keyboardType={tab === 'email' ? 'email-address' : 'default'} autoCapitalize="none" />
                <TouchableOpacity style={s.sendGo} onPress={() => quickSend(t)}><Text style={s.sendGoText}>Send</Text></TouchableOpacity>
                <TouchableOpacity onPress={() => setShowSend(null)}><Text style={s.cancelText}>x</Text></TouchableOpacity>
              </View>
            ) : (
              <TouchableOpacity style={s.quickSendBtn} onPress={() => { setShowSend(t.id); setSendTo(''); }}>
                <Text style={s.quickSendText}>Quick Send</Text>
              </TouchableOpacity>
            )}
          </View>
        )} />
      )}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#ffffff' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 12 },
  backArrow: { fontSize: 20, color: '#1a1a1a', fontWeight: '400' },
  title: { fontSize: 17, fontWeight: '600', color: '#1a1a1a' },
  addBtn: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20, backgroundColor: '#1a1a1a' },
  addText: { color: '#ffffff', fontSize: 13, fontWeight: '600' },

  // Tabs
  tabRow: { flexDirection: 'row', marginHorizontal: 20, marginBottom: 8, backgroundColor: '#f2f2f2', borderRadius: 10, padding: 3 },
  tab: { flex: 1, paddingVertical: 8, borderRadius: 8, alignItems: 'center' },
  tabActive: { backgroundColor: '#ffffff', shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 4, shadowOffset: { width: 0, height: 1 } },
  tabText: { fontSize: 14, fontWeight: '500', color: '#999' },
  tabTextActive: { color: '#1a1a1a', fontWeight: '600' },

  empty: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  emptyTitle: { fontSize: 17, fontWeight: '600', color: '#1a1a1a', marginBottom: 4 },
  emptySub: { fontSize: 13, color: '#999', marginBottom: 20 },
  emptyBtn: { paddingHorizontal: 24, paddingVertical: 14, borderRadius: 12, backgroundColor: '#1a1a1a' },
  emptyBtnText: { color: '#ffffff', fontSize: 15, fontWeight: '600' },
  card: { backgroundColor: '#f8f8f8', borderRadius: 14, padding: 16, marginBottom: 10, borderWidth: 1, borderColor: '#f0f0f0' },
  cardContent: { marginBottom: 8 },
  cardName: { fontSize: 15, fontWeight: '600', color: '#1a1a1a', marginBottom: 2 },
  cardSubject: { fontSize: 13, color: C.primary, marginBottom: 4 },
  cardBody: { fontSize: 12, color: '#888', lineHeight: 18 },
  quickSendBtn: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: 8, backgroundColor: '#f0f0f0', alignSelf: 'flex-start' },
  quickSendText: { fontSize: 12, color: '#1a1a1a', fontWeight: '600' },
  sendRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  sendInput: { flex: 1, backgroundColor: '#f0f0f0', borderRadius: 8, padding: 10, color: '#1a1a1a', fontSize: 13, borderWidth: 1, borderColor: '#e0e0e0' },
  sendGo: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 8, backgroundColor: '#1a1a1a' },
  sendGoText: { color: '#ffffff', fontSize: 13, fontWeight: '600' },
  cancelText: { color: '#999', fontSize: 16, paddingHorizontal: 8 },
  // Modal
  modal: { padding: 20, paddingTop: 8 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  backText: { fontSize: 15, color: '#1a1a1a', fontWeight: '500' },
  modalTitle: { fontSize: 17, fontWeight: '600', color: '#1a1a1a' },
  saveText: { fontSize: 15, color: C.primary, fontWeight: '600' },
  label: { fontSize: 11, fontWeight: '600', color: '#999', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8, marginTop: 16 },
  input: { backgroundColor: '#f5f5f5', borderWidth: 1, borderColor: '#e8e8e8', borderRadius: 12, padding: 14, color: '#1a1a1a', fontSize: 15 },
  delBtn: { marginTop: 32, padding: 16, borderRadius: 12, backgroundColor: '#fef2f2', alignItems: 'center' },
  delText: { color: C.red, fontSize: 15, fontWeight: '600' },
});
