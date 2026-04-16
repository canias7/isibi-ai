import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, FlatList, TextInput, Alert, ScrollView, Switch } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { C } from '../lib/theme';
import { useTheme } from '../lib/ThemeContext';
import { Ionicons } from '@expo/vector-icons';
import { getScheduledTasks, saveScheduledTasks, ScheduledTask, getAgents, Agent, runScheduledTaskNow } from '../lib/storage';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function formatTime(h: number, m: number): string {
  const mm = String(m).padStart(2, '0');
  if (h === 0) return `12:${mm} AM`;
  if (h < 12) return `${h}:${mm} AM`;
  if (h === 12) return `12:${mm} PM`;
  return `${h - 12}:${mm} PM`;
}

function formatTimeShort(h: number, m: number): string {
  const mm = String(m).padStart(2, '0');
  if (h === 0) return `12:${mm}am`;
  if (h < 12) return `${h}:${mm}am`;
  if (h === 12) return `12:${mm}pm`;
  return `${h - 12}:${mm}pm`;
}

/** Parse "H" (legacy) or "H:M" → [hour, minute] */
function parseHourMinute(s: string): [number, number] {
  if (!s) return [9, 0];
  const [hStr, mStr] = s.split(':');
  return [parseInt(hStr) || 0, parseInt(mStr) || 0];
}

export default function ScheduledScreen({ onBack }: { onBack: () => void }) {
  const { colors: tc } = useTheme();
  const [tasks, setTasks] = useState<ScheduledTask[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [showEdit, setShowEdit] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [command, setCommand] = useState('');
  const [label, setLabel] = useState('');
  const [agentId, setAgentId] = useState('');

  // Schedule state
  const [schedMode, setSchedMode] = useState<'recurring' | 'once'>('recurring');
  const [selDays, setSelDays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [selHour, setSelHour] = useState(9);
  const [selMinute, setSelMinute] = useState(0);
  // One-time date
  const [selMonth, setSelMonth] = useState(new Date().getMonth() + 1);
  const [selDay, setSelDay] = useState(new Date().getDate());
  const [selYear, setSelYear] = useState(new Date().getFullYear());

  const load = useCallback(async () => {
    setTasks(await getScheduledTasks());
    const a = await getAgents();
    setAgents(a);
    if (a.length > 0) setAgentId(a[0].id);
  }, []);
  useEffect(() => { load(); }, []);
  // Reload tasks when the active workspace changes so the list shows
  // tasks belonging to the new workspace instead of the old one.
  useEffect(() => {
    const { onWorkspaceChange } = require('../lib/workspaces');
    const off = onWorkspaceChange(() => { load(); });
    return off;
  }, [load]);

  const openCreate = () => {
    setEditId(null); setCommand(''); setLabel('');
    setSelDays([1, 2, 3, 4, 5]); setSelHour(9); setSelMinute(0);
    if (agents.length > 0) setAgentId(agents[0].id);
    setShowEdit(true);
  };

  const openEdit = (t: ScheduledTask) => {
    setEditId(t.id); setCommand(t.command); setLabel(t.label); setAgentId(t.agentId);
    const parts = t.schedule.split('|');
    if (parts[0] === 'once' && parts.length === 3) {
      setSchedMode('once');
      const dateParts = (parts[1] || '').split('/');
      setSelMonth(parseInt(dateParts[0]) || 1);
      setSelDay(parseInt(dateParts[1]) || 1);
      setSelYear(parseInt(dateParts[2]) || 2026);
      const [h, m] = parseHourMinute(parts[2]);
      setSelHour(h); setSelMinute(m);
    } else if (parts.length === 2) {
      setSchedMode('recurring');
      setSelDays(parts[0].split(',').map(Number).filter(n => !isNaN(n)));
      const [h, m] = parseHourMinute(parts[1]);
      setSelHour(h); setSelMinute(m);
    }
    setShowEdit(true);
  };

  const encodeSchedule = () => {
    const time = `${selHour}:${selMinute}`;
    if (schedMode === 'once') return `once|${selMonth}/${selDay}/${selYear}|${time}`;
    return `${selDays.join(',')}|${time}`;
  };

  const getScheduleLabel = (val: string) => {
    if (val.startsWith('once|')) {
      const parts = val.split('|');
      const date = parts[1] || '';
      const [h, m] = parseHourMinute(parts[2]);
      return `${date} at ${formatTimeShort(h, m)}`;
    }
    const parts = val.split('|');
    if (parts.length !== 2) return val;
    const days = parts[0].split(',').map(Number);
    const [h, m] = parseHourMinute(parts[1]);
    const dayStr = days.length === 7 ? 'Every day'
      : days.length === 5 && days.join(',') === '1,2,3,4,5' ? 'Weekdays'
      : days.map(d => DAYS[d]).join(', ');
    return `${dayStr} at ${formatTimeShort(h, m)}`;
  };

  const save = async () => {
    if (!command.trim()) { Alert.alert('Error', 'Command is required'); return; }
    if (!label.trim()) { Alert.alert('Error', 'Label is required'); return; }
    if (!agentId) { Alert.alert('Error', 'Select an agent'); return; }
    if (schedMode === 'recurring' && selDays.length === 0) { Alert.alert('Error', 'Select at least one day'); return; }

    const schedule = encodeSchedule();
    let updated = [...tasks];
    if (editId) {
      updated = updated.map(t => t.id === editId ? { ...t, command: command.trim(), label: label.trim(), schedule, agentId } : t);
    } else {
      updated.push({ id: Date.now().toString(), command: command.trim(), label: label.trim(), schedule, agentId, enabled: true });
    }
    await saveScheduledTasks(updated);
    setTasks(updated);
    setShowEdit(false);
  };

  const remove = (id: string) => {
    Alert.alert('Delete Task', 'Are you sure?', [
      { text: 'Cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => { const u = tasks.filter(t => t.id !== id); await saveScheduledTasks(u); setTasks(u); }},
    ]);
  };

  const toggle = async (id: string) => {
    const u = tasks.map(t => t.id === id ? { ...t, enabled: !t.enabled } : t);
    await saveScheduledTasks(u); setTasks(u);
  };

  const runNow = async (id: string) => {
    Alert.alert('Run Now', 'Trigger this task immediately?', [
      { text: 'Cancel' },
      {
        text: 'Run',
        onPress: async () => {
          const res = await runScheduledTaskNow(id);
          if (res.ok) {
            Alert.alert('Done', res.result ? String(res.result).slice(0, 500) : 'Task executed.');
          } else {
            Alert.alert('Failed', res.error || 'Could not run task');
          }
        },
      },
    ]);
  };

  const toggleDay = (day: number) => {
    setSelDays(prev => prev.includes(day) ? prev.filter(d => d !== day) : [...prev, day].sort());
  };

  const getAgentName = (id: string) => agents.find(a => a.id === id)?.name || 'Unknown';

  // ==================== EDIT ====================
  if (showEdit) {
    return (
      <SafeAreaView style={[s.container, { backgroundColor: tc.bg }]}>
        <ScrollView contentContainerStyle={s.editContent} keyboardShouldPersistTaps="handled">
          <View style={s.editHeader}>
            <TouchableOpacity onPress={() => setShowEdit(false)}><Text style={[s.backText, { color: tc.text }]}>Back</Text></TouchableOpacity>
            <Text style={[s.editTitle, { color: tc.text }]}>{editId ? 'Edit Task' : 'New Task'}</Text>
            <TouchableOpacity onPress={save}><Text style={s.saveText}>Save</Text></TouchableOpacity>
          </View>

          <Text style={[s.sLabel, { color: tc.textDim }]}>Task Name</Text>
          <TextInput style={[s.input, { backgroundColor: tc.card, borderColor: tc.border, color: tc.text }]} value={label} onChangeText={setLabel} placeholder="e.g. Morning briefing" placeholderTextColor="#999" />

          <Text style={[s.sLabel, { color: tc.textDim }]}>Command</Text>
          <Text style={s.hint}>What should the AI do?</Text>
          <TextInput style={[s.input, { height: 100 }]} value={command} onChangeText={setCommand} placeholder="e.g. Check my emails and summarize" placeholderTextColor="#999" multiline textAlignVertical="top" />

          {/* Agent picker — only user-created agents */}
          <Text style={[s.sLabel, { color: tc.textDim }]}>Agent</Text>
          {agents.length === 0 ? (
            <Text style={s.noAgents}>Create an agent first in the Agents tab</Text>
          ) : (
            <View style={s.agentPicker}>
              {agents.map(a => (
                <TouchableOpacity key={a.id} style={[s.agentOpt, agentId === a.id && s.agentOptActive]} onPress={() => setAgentId(a.id)}>
                  <View style={[s.agentDot, { backgroundColor: a.color }]} />
                  <Text style={[s.agentOptText, agentId === a.id && s.agentOptTextActive]}>{a.name}</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}

          {/* Schedule mode toggle */}
          <Text style={[s.sLabel, { color: tc.textDim }]}>Schedule Type</Text>
          <View style={s.modeRow}>
            <TouchableOpacity style={[s.modeBtn, schedMode === 'recurring' && s.modeBtnActive]} onPress={() => setSchedMode('recurring')}>
              <Text style={[s.modeBtnText, schedMode === 'recurring' && s.modeBtnTextActive]}>Recurring</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[s.modeBtn, schedMode === 'once' && s.modeBtnActive]} onPress={() => setSchedMode('once')}>
              <Text style={[s.modeBtnText, schedMode === 'once' && s.modeBtnTextActive]}>One-time</Text>
            </TouchableOpacity>
          </View>

          {schedMode === 'once' ? (
            <>
              <Text style={[s.sLabel, { color: tc.textDim }]}>Date (MM/DD/YYYY)</Text>
              <View style={s.dateRow}>
                <TextInput style={s.dateInput} value={String(selMonth)} onChangeText={t => setSelMonth(parseInt(t) || 1)} keyboardType="number-pad" maxLength={2} placeholder="MM" placeholderTextColor="#ccc" />
                <Text style={s.dateSep}>/</Text>
                <TextInput style={s.dateInput} value={String(selDay)} onChangeText={t => setSelDay(parseInt(t) || 1)} keyboardType="number-pad" maxLength={2} placeholder="DD" placeholderTextColor="#ccc" />
                <Text style={s.dateSep}>/</Text>
                <TextInput style={[s.dateInput, { width: 70 }]} value={String(selYear)} onChangeText={t => setSelYear(parseInt(t) || 2026)} keyboardType="number-pad" maxLength={4} placeholder="YYYY" placeholderTextColor="#ccc" />
              </View>
            </>
          ) : (
            <>
              {/* Day picker */}
              <Text style={[s.sLabel, { color: tc.textDim }]}>Days</Text>
              <View style={s.dayRow}>
            {DAYS.map((d, i) => (
              <TouchableOpacity key={i} style={[s.dayBtn, selDays.includes(i) && s.dayBtnActive]} onPress={() => toggleDay(i)} activeOpacity={0.7}>
                <Text style={[s.dayBtnText, selDays.includes(i) && s.dayBtnTextActive]}>{d}</Text>
              </TouchableOpacity>
            ))}
          </View>
          {/* Quick presets */}
          <View style={s.presetRow}>
            <TouchableOpacity style={s.presetBtn} onPress={() => setSelDays([1, 2, 3, 4, 5])}><Text style={s.presetText}>Weekdays</Text></TouchableOpacity>
            <TouchableOpacity style={s.presetBtn} onPress={() => setSelDays([0, 6])}><Text style={s.presetText}>Weekends</Text></TouchableOpacity>
            <TouchableOpacity style={s.presetBtn} onPress={() => setSelDays([0, 1, 2, 3, 4, 5, 6])}><Text style={s.presetText}>Every day</Text></TouchableOpacity>
          </View>
            </>
          )}

          {/* Time picker — big display + steppers */}
          <Text style={[s.sLabel, { color: tc.textDim }]}>Time</Text>
          <View style={s.timeBox}>
            {/* Hour column */}
            <View style={s.timeCol}>
              <TouchableOpacity
                style={s.stepBtn}
                onPress={() => setSelHour((selHour + 1) % 24)}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                <Ionicons name="chevron-up" size={22} color="#666" />
              </TouchableOpacity>
              <Text style={s.timeBigText}>
                {selHour === 0 || selHour === 12 ? '12' : selHour > 12 ? selHour - 12 : selHour}
              </Text>
              <TouchableOpacity
                style={s.stepBtn}
                onPress={() => setSelHour((selHour + 23) % 24)}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                <Ionicons name="chevron-down" size={22} color="#666" />
              </TouchableOpacity>
            </View>

            <Text style={s.timeColon}>:</Text>

            {/* Minute column */}
            <View style={s.timeCol}>
              <TouchableOpacity
                style={s.stepBtn}
                onPress={() => setSelMinute((selMinute + 1) % 60)}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                <Ionicons name="chevron-up" size={22} color="#666" />
              </TouchableOpacity>
              <Text style={s.timeBigText}>{String(selMinute).padStart(2, '0')}</Text>
              <TouchableOpacity
                style={s.stepBtn}
                onPress={() => setSelMinute((selMinute + 59) % 60)}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                <Ionicons name="chevron-down" size={22} color="#666" />
              </TouchableOpacity>
            </View>

            {/* AM/PM toggle */}
            <View style={s.ampmCol}>
              <TouchableOpacity
                style={[s.ampmBtn, selHour < 12 && s.ampmBtnActive]}
                onPress={() => { if (selHour >= 12) setSelHour(selHour - 12); }}
                activeOpacity={0.7}
              >
                <Text style={[s.ampmText, selHour < 12 && s.ampmTextActive]}>AM</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[s.ampmBtn, selHour >= 12 && s.ampmBtnActive]}
                onPress={() => { if (selHour < 12) setSelHour(selHour + 12); }}
                activeOpacity={0.7}
              >
                <Text style={[s.ampmText, selHour >= 12 && s.ampmTextActive]}>PM</Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* Quick time presets */}
          <View style={s.timePresetRow}>
            <TouchableOpacity style={s.presetBtn} onPress={() => { setSelHour(9); setSelMinute(0); }}>
              <Text style={s.presetText}>9:00 AM</Text>
            </TouchableOpacity>
            <TouchableOpacity style={s.presetBtn} onPress={() => { setSelHour(12); setSelMinute(0); }}>
              <Text style={s.presetText}>Noon</Text>
            </TouchableOpacity>
            <TouchableOpacity style={s.presetBtn} onPress={() => { setSelHour(18); setSelMinute(0); }}>
              <Text style={s.presetText}>6:00 PM</Text>
            </TouchableOpacity>
            <TouchableOpacity style={s.presetBtn} onPress={() => { setSelHour(21); setSelMinute(0); }}>
              <Text style={s.presetText}>9:00 PM</Text>
            </TouchableOpacity>
          </View>

          {editId && <TouchableOpacity style={s.delBtn} onPress={() => { remove(editId); setShowEdit(false); }}><Text style={s.delText}>Delete Task</Text></TouchableOpacity>}
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
        <Text style={s.title}>Scheduled</Text>
        <TouchableOpacity style={s.addBtn} onPress={openCreate}><Text style={s.addText}>+ New</Text></TouchableOpacity>
      </View>

      {tasks.length === 0 ? (
        <View style={s.empty}>
          <Text style={s.emptyTitle}>No scheduled tasks</Text>
          <Text style={s.emptySub}>Automate your AI — schedule agents to run on repeat</Text>
          <TouchableOpacity style={s.emptyBtn} onPress={openCreate}><Text style={s.emptyBtnText}>Create Task</Text></TouchableOpacity>
        </View>
      ) : (
        <FlatList data={tasks} keyExtractor={t => t.id} contentContainerStyle={{ padding: 16 }} renderItem={({ item: t }) => (
          <TouchableOpacity style={s.card} onPress={() => openEdit(t)} activeOpacity={0.7}>
            <View style={s.cardTop}>
              <View style={{ flex: 1 }}>
                <Text style={s.cardLabel}>{t.label}</Text>
                <Text style={s.cardCommand} numberOfLines={2}>{t.command}</Text>
              </View>
              <Switch
                value={t.enabled}
                onValueChange={() => toggle(t.id)}
                trackColor={{ false: '#ddd', true: C.green + '60' }}
                thumbColor={t.enabled ? C.green : '#f4f4f4'}
              />
            </View>
            <View style={s.cardMeta}>
              <Text style={s.cardMetaText}>{getScheduleLabel(t.schedule)}</Text>
              <Text style={s.cardMetaDot}>  ·  </Text>
              <Text style={s.cardMetaText}>{getAgentName(t.agentId)}</Text>
              <View style={{ flex: 1 }} />
              <TouchableOpacity
                style={s.runNowBtn}
                onPress={(e) => { e.stopPropagation?.(); runNow(t.id); }}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Ionicons name="play" size={11} color="#fff" />
                <Text style={s.runNowText}>Run now</Text>
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
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

  empty: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  emptyTitle: { fontSize: 17, fontWeight: '600', color: '#1a1a1a', marginBottom: 4 },
  emptySub: { fontSize: 13, color: '#999', marginBottom: 20, textAlign: 'center' },
  emptyBtn: { paddingHorizontal: 24, paddingVertical: 14, borderRadius: 12, backgroundColor: '#1a1a1a' },
  emptyBtnText: { color: '#ffffff', fontSize: 15, fontWeight: '600' },

  card: { backgroundColor: '#f8f8f8', borderRadius: 14, padding: 16, marginBottom: 10, borderWidth: 1, borderColor: '#f0f0f0' },
  cardTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  cardLabel: { fontSize: 15, fontWeight: '600', color: '#1a1a1a', marginBottom: 4 },
  cardCommand: { fontSize: 13, color: '#666', lineHeight: 18 },
  cardMeta: { flexDirection: 'row', alignItems: 'center', marginTop: 10, paddingTop: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#e8e8e8' },
  cardMetaText: { fontSize: 12, color: '#999', fontWeight: '500' },
  cardMetaDot: { fontSize: 12, color: '#ddd' },
  runNowBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#1a1a1a', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 12 },
  runNowText: { color: '#fff', fontSize: 11, fontWeight: '600' },

  // Edit
  editContent: { padding: 20, paddingTop: 8, paddingBottom: 40 },
  editHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  backText: { fontSize: 15, color: '#1a1a1a', fontWeight: '500' },
  editTitle: { fontSize: 17, fontWeight: '600', color: '#1a1a1a' },
  saveText: { fontSize: 15, color: C.primary, fontWeight: '600' },
  sLabel: { fontSize: 11, fontWeight: '600', color: '#999', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8, marginTop: 16 },
  hint: { fontSize: 11, color: '#bbb', marginBottom: 6 },
  input: { backgroundColor: '#f5f5f5', borderWidth: 1, borderColor: '#e8e8e8', borderRadius: 12, padding: 14, color: '#1a1a1a', fontSize: 15 },
  noAgents: { fontSize: 13, color: '#999', fontStyle: 'italic' },

  // Agent picker
  agentPicker: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  agentOpt: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, borderWidth: 1, borderColor: '#ddd', backgroundColor: '#f8f8f8', gap: 6 },
  agentOptActive: { backgroundColor: '#1a1a1a', borderColor: '#1a1a1a' },
  agentDot: { width: 8, height: 8, borderRadius: 4 },
  agentOptText: { fontSize: 13, fontWeight: '500', color: '#1a1a1a' },
  agentOptTextActive: { color: '#ffffff' },

  // Day picker
  dayRow: { flexDirection: 'row', gap: 6 },
  dayBtn: { flex: 1, paddingVertical: 10, borderRadius: 10, backgroundColor: '#f5f5f5', alignItems: 'center', borderWidth: 1, borderColor: '#e8e8e8' },
  dayBtnActive: { backgroundColor: '#1a1a1a', borderColor: '#1a1a1a' },
  dayBtnText: { fontSize: 12, fontWeight: '600', color: '#666' },
  dayBtnTextActive: { color: '#ffffff' },
  presetRow: { flexDirection: 'row', gap: 8, marginTop: 8 },
  presetBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 14, backgroundColor: '#f0f0f0' },
  presetText: { fontSize: 11, fontWeight: '500', color: '#666' },

  // Time picker (stepper style)
  timeBox: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f5f5f5',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#e8e8e8',
    paddingVertical: 20,
    paddingHorizontal: 16,
    gap: 10,
  },
  timeCol: { alignItems: 'center', justifyContent: 'center', minWidth: 70 },
  stepBtn: { padding: 6 },
  timeBigText: { fontSize: 44, fontWeight: '700', color: '#1a1a1a', fontVariant: ['tabular-nums'], marginVertical: 2 },
  timeColon: { fontSize: 40, fontWeight: '700', color: '#1a1a1a', marginBottom: 8 },
  ampmCol: { marginLeft: 14, gap: 6 },
  ampmBtn: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#e0e0e0',
    backgroundColor: '#ffffff',
    minWidth: 52,
    alignItems: 'center',
  },
  ampmBtnActive: { backgroundColor: '#1a1a1a', borderColor: '#1a1a1a' },
  ampmText: { fontSize: 13, fontWeight: '600', color: '#666' },
  ampmTextActive: { color: '#ffffff' },
  timePresetRow: { flexDirection: 'row', gap: 8, marginTop: 12, flexWrap: 'wrap' },

  // Mode toggle
  modeRow: { flexDirection: 'row', backgroundColor: '#f2f2f2', borderRadius: 10, padding: 3, marginBottom: 8 },
  modeBtn: { flex: 1, paddingVertical: 8, borderRadius: 8, alignItems: 'center' },
  modeBtnActive: { backgroundColor: '#ffffff', shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 4, shadowOffset: { width: 0, height: 1 } },
  modeBtnText: { fontSize: 14, fontWeight: '500', color: '#999' },
  modeBtnTextActive: { color: '#1a1a1a', fontWeight: '600' },

  // Date inputs
  dateRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  dateInput: { backgroundColor: '#f5f5f5', borderWidth: 1, borderColor: '#e8e8e8', borderRadius: 10, padding: 12, fontSize: 18, fontWeight: '600', color: '#1a1a1a', textAlign: 'center', width: 50 },
  dateSep: { fontSize: 20, color: '#999', fontWeight: '300' },

  delBtn: { marginTop: 32, padding: 16, borderRadius: 12, backgroundColor: '#fef2f2', alignItems: 'center' },
  delText: { color: C.red, fontSize: 15, fontWeight: '600' },
});
