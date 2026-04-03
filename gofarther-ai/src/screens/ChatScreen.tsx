import React, { useState, useRef, useEffect } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, FlatList, StyleSheet,
  KeyboardAvoidingView, Platform, ActivityIndicator,
} from 'react-native';
import { C, F, R } from '../lib/theme';
import { chat, Message } from '../lib/ai';
import { executeAction } from '../lib/actions';
import { getAgents, Agent, getChatHistory, saveChatHistory } from '../lib/storage';

interface ChatMsg {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  action?: any;
  actionStatus?: string;
}

export default function ChatScreen() {
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [activeAgent, setActiveAgent] = useState<Agent | null>(null);
  const [showAgentPicker, setShowAgentPicker] = useState(false);
  const flatList = useRef<FlatList>(null);

  useEffect(() => {
    getAgents().then(a => {
      setAgents(a);
      if (a.length > 0) setActiveAgent(a.find(x => x.isActive) || a[0]);
    });
  }, []);

  useEffect(() => {
    if (activeAgent) {
      getChatHistory(activeAgent.id).then(h => {
        setMessages(h.map((m, i) => ({ ...m, id: String(i) })));
      });
    } else {
      getChatHistory('default').then(h => {
        setMessages(h.map((m, i) => ({ ...m, id: String(i) })));
      });
    }
  }, [activeAgent?.id]);

  useEffect(() => {
    if (messages.length > 0) {
      saveChatHistory(activeAgent?.id || 'default', messages.map(m => ({ role: m.role, content: m.content, timestamp: Date.now() })));
    }
  }, [messages]);

  const send = async () => {
    const text = input.trim();
    if (!text || loading) return;
    setInput('');

    const userMsg: ChatMsg = { id: Date.now().toString(), role: 'user', content: text };
    setMessages(prev => [...prev, userMsg]);
    setLoading(true);

    try {
      const history: Message[] = messages.slice(-20).map(m => ({
        role: m.role === 'system' ? 'assistant' as const : m.role,
        content: m.content,
      }));
      history.push({ role: 'user', content: text });

      const systemPrompt = activeAgent?.instructions
        ? `You are "${activeAgent.name}". ${activeAgent.instructions}\n\nYou can perform actions by including a single JSON object in your response:\n{"type":"call","target":"555-1234"}\n{"type":"sms","target":"555-1234","text":"hello"}\n{"type":"email","target":"john@email.com","key":"Subject","text":"Body"}\n{"type":"open_url","target":"https://..."}\n{"type":"maps","target":"coffee near me"}\n{"type":"directions","target":"destination","text":"from"}\nOnly include action JSON if the user asks you to DO something. For conversation, respond normally.`
        : `You are GoFarther AI, a helpful mobile assistant. Be concise and friendly.\n\nYou can perform actions by including a single JSON object in your response:\n{"type":"call","target":"number"}\n{"type":"sms","target":"number","text":"message"}\n{"type":"email","target":"email","key":"subject","text":"body"}\n{"type":"open_url","target":"url"}\n{"type":"maps","target":"query"}\nOnly include action JSON if the user asks to DO something.`;

      const response = await chat(history, systemPrompt);

      let action = null;
      let cleanResponse = response;
      try {
        const match = response.match(/\{[^{}]*"type"\s*:\s*"[^"]+\"[^{}]*\}/);
        if (match) {
          action = JSON.parse(match[0]);
          cleanResponse = response.replace(match[0], '').trim();
        }
      } catch {}

      const aiMsg: ChatMsg = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: cleanResponse || (action ? getActionLabel(action) : response),
        action,
        actionStatus: action ? 'ready' : undefined,
      };
      setMessages(prev => [...prev, aiMsg]);

      if (action) {
        try {
          executeAction(action);
          setMessages(prev => prev.map(m => m.id === aiMsg.id ? { ...m, actionStatus: 'done' } : m));
        } catch {
          setMessages(prev => prev.map(m => m.id === aiMsg.id ? { ...m, actionStatus: 'failed' } : m));
        }
      }
    } catch (e: any) {
      setMessages(prev => [...prev, { id: (Date.now() + 1).toString(), role: 'system', content: '⚠️ ' + (e.message || 'Something went wrong') }]);
    } finally {
      setLoading(false);
    }
  };

  const getActionLabel = (action: any) => {
    const labels: Record<string, string> = {
      call: '📞 Calling ' + (action.target || ''),
      sms: '💬 Texting ' + (action.target || ''),
      email: '📧 Emailing ' + (action.target || ''),
      open_url: '🌐 Opening link',
      maps: '📍 ' + (action.target || 'Maps'),
      directions: '🗺️ Getting directions',
      search: '🔍 Searching',
      youtube: '▶️ YouTube',
    };
    return labels[action.type] || '⚡ ' + action.type;
  };

  const renderAction = (action: any, status?: string) => {
    if (!action) return null;
    const statusColor = status === 'done' ? C.green : status === 'failed' ? C.red : C.amber;
    const statusIcon = status === 'done' ? ' ✓' : status === 'failed' ? ' ✗' : ' →';

    return (
      <TouchableOpacity style={[s.actionCard, { borderLeftColor: statusColor }]} onPress={() => executeAction(action)} activeOpacity={0.7}>
        <Text style={[s.actionLabel, { color: statusColor }]}>{getActionLabel(action)}{statusIcon}</Text>
      </TouchableOpacity>
    );
  };

  const renderMessage = ({ item }: { item: ChatMsg }) => (
    <View style={[s.msgRow, item.role === 'user' && s.msgRowUser]}>
      {item.role === 'assistant' && (
        <View style={[s.avatar, { backgroundColor: (activeAgent?.color || C.primary) + '30' }]}>
          <Text style={s.avatarText}>{activeAgent?.emoji || '🤖'}</Text>
        </View>
      )}
      <View style={{ flex: 1, maxWidth: '82%' }}>
        {item.role === 'assistant' && (
          <Text style={s.agentName}>{activeAgent?.name || 'GoFarther AI'}</Text>
        )}
        <View style={[s.bubble, item.role === 'user' ? s.bubbleUser : item.role === 'system' ? s.bubbleSystem : s.bubbleAI]}>
          <Text style={[s.msgText, item.role === 'user' && s.msgTextUser]} selectable>{item.content}</Text>
        </View>
        {item.action && renderAction(item.action, item.actionStatus)}
      </View>
    </View>
  );

  return (
    <KeyboardAvoidingView style={s.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={90}>
      {/* Agent picker */}
      <View style={s.topBar}>
        <TouchableOpacity style={s.agentBtn} onPress={() => setShowAgentPicker(!showAgentPicker)} activeOpacity={0.7}>
          <Text style={s.agentEmoji}>{activeAgent?.emoji || '🤖'}</Text>
          <Text style={s.agentBtnName}>{activeAgent?.name || 'GoFarther AI'}</Text>
          <Text style={s.chevron}>▾</Text>
        </TouchableOpacity>
      </View>

      {showAgentPicker && (
        <View style={s.dropdown}>
          <TouchableOpacity style={[s.dropItem, !activeAgent && s.dropItemActive]} onPress={() => { setActiveAgent(null); setShowAgentPicker(false); setMessages([]); }}>
            <Text style={s.dropEmoji}>🤖</Text>
            <Text style={s.dropName}>GoFarther AI</Text>
          </TouchableOpacity>
          {agents.map(a => (
            <TouchableOpacity key={a.id} style={[s.dropItem, activeAgent?.id === a.id && s.dropItemActive]} onPress={() => { setActiveAgent(a); setShowAgentPicker(false); }}>
              <Text style={s.dropEmoji}>{a.emoji}</Text>
              <Text style={s.dropName}>{a.name}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {/* Messages or empty */}
      {messages.length === 0 ? (
        <View style={s.empty}>
          <View style={s.orb} />
          <Text style={s.emptyTitle}>What can I help you with?</Text>
          <Text style={s.emptySub}>Type a message or tap a suggestion</Text>
          <View style={s.chips}>
            {['Send a text', 'Call someone', 'Check weather', 'Get directions', 'Send email', 'Search Google'].map(c => (
              <TouchableOpacity key={c} style={s.chip} onPress={() => setInput(c)} activeOpacity={0.7}>
                <Text style={s.chipText}>{c}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      ) : (
        <FlatList
          ref={flatList}
          data={messages}
          renderItem={renderMessage}
          keyExtractor={item => item.id}
          contentContainerStyle={s.list}
          onContentSizeChange={() => flatList.current?.scrollToEnd({ animated: true })}
          showsVerticalScrollIndicator={false}
        />
      )}

      {/* Input */}
      <View style={s.inputBar}>
        <TextInput
          style={s.input}
          value={input}
          onChangeText={setInput}
          placeholder={activeAgent ? `Message ${activeAgent.name}...` : 'Message GoFarther AI...'}
          placeholderTextColor={C.textDim}
          multiline
          maxLength={2000}
          onSubmitEditing={send}
          blurOnSubmit={false}
        />
        <TouchableOpacity style={[s.sendBtn, (!input.trim() || loading) && s.sendBtnOff]} onPress={send} disabled={!input.trim() || loading} activeOpacity={0.7}>
          {loading ? <ActivityIndicator color="white" size="small" /> : <Text style={s.sendIcon}>➤</Text>}
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },

  topBar: { paddingHorizontal: 16, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: C.border, alignItems: 'center' },
  agentBtn: { flexDirection: 'row', alignItems: 'center', paddingVertical: 6, paddingHorizontal: 14, borderRadius: 20, backgroundColor: C.card },
  agentEmoji: { fontSize: 16, marginRight: 6 },
  agentBtnName: { fontSize: F.sm, fontWeight: '600', color: C.text },
  chevron: { fontSize: 10, color: C.textDim, marginLeft: 4 },

  dropdown: { position: 'absolute', top: 52, left: 16, right: 16, backgroundColor: C.card, borderRadius: R.md, borderWidth: 1, borderColor: C.border, zIndex: 100, elevation: 10 },
  dropItem: { flexDirection: 'row', alignItems: 'center', padding: 14, borderBottomWidth: 1, borderBottomColor: C.border },
  dropItemActive: { backgroundColor: C.primaryFaint },
  dropEmoji: { fontSize: 18, marginRight: 10 },
  dropName: { fontSize: F.md, color: C.text, fontWeight: '500' },

  list: { padding: 16, paddingBottom: 8 },
  empty: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  orb: { width: 48, height: 48, borderRadius: 24, backgroundColor: C.primary, marginBottom: 16, shadowColor: C.primary, shadowOpacity: 0.4, shadowRadius: 16 },
  emptyTitle: { fontSize: F.lg, fontWeight: '600', color: C.text, marginBottom: 4 },
  emptySub: { fontSize: F.sm, color: C.textDim, marginBottom: 24 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 8 },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, borderWidth: 1, borderColor: C.primary + '30', backgroundColor: C.primary + '10' },
  chipText: { fontSize: F.xs, color: C.primaryLight, fontWeight: '500' },

  msgRow: { marginBottom: 14, flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  msgRowUser: { justifyContent: 'flex-end' },
  avatar: { width: 28, height: 28, borderRadius: 8, alignItems: 'center', justifyContent: 'center', marginTop: 18 },
  avatarText: { fontSize: 14 },
  agentName: { fontSize: 10, fontWeight: '600', color: C.textDim, marginBottom: 2, marginLeft: 2 },
  bubble: { padding: 12, borderRadius: 18 },
  bubbleUser: { backgroundColor: C.primary, borderBottomRightRadius: 4 },
  bubbleAI: { backgroundColor: C.card, borderBottomLeftRadius: 4, borderWidth: 1, borderColor: C.border },
  bubbleSystem: { backgroundColor: C.red + '15', borderRadius: 12, borderWidth: 1, borderColor: C.red + '30' },
  msgText: { fontSize: 15, color: C.text, lineHeight: 22 },
  msgTextUser: { color: '#fff' },

  actionCard: { marginTop: 6, padding: 10, borderRadius: 10, backgroundColor: C.card2, borderLeftWidth: 3 },
  actionLabel: { fontSize: F.xs, fontWeight: '600' },

  inputBar: { flexDirection: 'row', alignItems: 'flex-end', padding: 12, gap: 8, borderTopWidth: 1, borderTopColor: C.border },
  input: { flex: 1, backgroundColor: C.card, borderRadius: 22, paddingHorizontal: 16, paddingVertical: 12, color: C.text, fontSize: 15, maxHeight: 120, borderWidth: 1, borderColor: C.border },
  sendBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: C.primary, justifyContent: 'center', alignItems: 'center' },
  sendBtnOff: { opacity: 0.3 },
  sendIcon: { color: 'white', fontSize: 18 },
});
