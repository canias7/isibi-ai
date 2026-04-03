import React, { useState, useRef } from 'react';
import { View, Text, TextInput, TouchableOpacity, FlatList, StyleSheet, KeyboardAvoidingView, Platform, ActivityIndicator } from 'react-native';
import { C, F, R } from '../lib/theme';
import { chat, Message } from '../lib/ai';
import { executeAction } from '../lib/actions';

interface ChatMsg {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export default function ChatScreen() {
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const flatList = useRef<FlatList>(null);

  const send = async () => {
    const text = input.trim();
    if (!text || loading) return;
    setInput('');

    const userMsg: ChatMsg = { id: Date.now().toString(), role: 'user', content: text };
    setMessages(prev => [...prev, userMsg]);

    setLoading(true);
    try {
      const history: Message[] = messages.slice(-20).map(m => ({ role: m.role === 'system' ? 'assistant' : m.role, content: m.content }));
      history.push({ role: 'user', content: text });

      const response = await chat(history);
      const aiMsg: ChatMsg = { id: (Date.now() + 1).toString(), role: 'assistant', content: response };
      setMessages(prev => [...prev, aiMsg]);

      // Check if response contains an action
      try {
        const actionMatch = response.match(/\{[^}]*"type"[^}]*\}/);
        if (actionMatch) {
          const action = JSON.parse(actionMatch[0]);
          executeAction(action);
        }
      } catch {}
    } catch (e: any) {
      setMessages(prev => [...prev, { id: (Date.now() + 1).toString(), role: 'system', content: 'Error: ' + (e.message || 'Something went wrong') }]);
    } finally {
      setLoading(false);
    }
  };

  const renderMessage = ({ item }: { item: ChatMsg }) => (
    <View style={[s.msgRow, item.role === 'user' && s.msgRowUser]}>
      <View style={[s.bubble, item.role === 'user' ? s.bubbleUser : item.role === 'system' ? s.bubbleSystem : s.bubbleAI]}>
        <Text style={[s.msgText, item.role === 'user' && s.msgTextUser]}>{item.content}</Text>
      </View>
    </View>
  );

  return (
    <KeyboardAvoidingView style={s.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={90}>
      {messages.length === 0 ? (
        <View style={s.empty}>
          <View style={s.orb} />
          <Text style={s.emptyTitle}>What can I help you with?</Text>
          <Text style={s.emptySub}>Type a message or use voice</Text>
          <View style={s.chips}>
            {['Send a text', 'Check weather', 'Generate image', 'Call someone'].map(chip => (
              <TouchableOpacity key={chip} style={s.chip} onPress={() => { setInput(chip); }}>
                <Text style={s.chipText}>{chip}</Text>
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
          onContentSizeChange={() => flatList.current?.scrollToEnd()}
        />
      )}

      {/* Input bar */}
      <View style={s.inputBar}>
        <TextInput
          style={s.input}
          value={input}
          onChangeText={setInput}
          placeholder="Message GoFarther AI..."
          placeholderTextColor={C.textDim}
          multiline
          returnKeyType="send"
          onSubmitEditing={send}
        />
        <TouchableOpacity style={s.sendBtn} onPress={send} disabled={loading}>
          {loading ? <ActivityIndicator color="white" size="small" /> : <Text style={s.sendIcon}>➤</Text>}
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  list: { padding: 16, paddingBottom: 8 },
  empty: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  orb: { width: 48, height: 48, borderRadius: 24, backgroundColor: C.primary, marginBottom: 16, shadowColor: C.primary, shadowOpacity: 0.4, shadowRadius: 16 },
  emptyTitle: { fontSize: F.lg, fontWeight: '600', color: C.textMid, marginBottom: 4 },
  emptySub: { fontSize: F.sm, color: C.textDim, marginBottom: 20 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 8 },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 16, borderWidth: 1, borderColor: C.primaryFaint, backgroundColor: C.primaryFaint },
  chipText: { fontSize: F.xs, color: C.primaryLight },
  msgRow: { marginBottom: 12 },
  msgRowUser: { alignItems: 'flex-end' },
  bubble: { maxWidth: '80%', padding: 12, borderRadius: 16 },
  bubbleUser: { backgroundColor: C.primaryFaint, borderBottomRightRadius: 4 },
  bubbleAI: { backgroundColor: C.card, borderBottomLeftRadius: 4 },
  bubbleSystem: { backgroundColor: C.card2, alignSelf: 'center' },
  msgText: { fontSize: F.md, color: C.text, lineHeight: 22 },
  msgTextUser: { color: C.primaryLight },
  inputBar: { flexDirection: 'row', alignItems: 'flex-end', padding: 12, gap: 8, borderTopWidth: 1, borderTopColor: C.border },
  input: { flex: 1, backgroundColor: C.card, borderRadius: R.lg, padding: 12, paddingTop: 12, color: C.text, fontSize: F.md, maxHeight: 120, borderWidth: 1, borderColor: C.border },
  sendBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: C.primary, justifyContent: 'center', alignItems: 'center' },
  sendIcon: { color: 'white', fontSize: 18 },
});
