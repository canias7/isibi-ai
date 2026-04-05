import React, { useState, useRef, useEffect } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, Animated, Dimensions, TextInput, KeyboardAvoidingView, Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Speech from 'expo-speech';
import { C } from '../lib/theme';
import { useTheme } from '../lib/ThemeContext';
import { chat, Message } from '../lib/ai';
import { VoiceOption } from './VoicePicker';

const { width: SW } = Dimensions.get('window');
const ORB_SIZE = SW * 0.4;

interface Props {
  voice: VoiceOption;
  onClose: () => void;
  agentName?: string;
  agentInstructions?: string;
}

export default function VoiceChat({ voice, onClose, agentName, agentInstructions }: Props) {
  const [status, setStatus] = useState<'idle' | 'thinking' | 'speaking'>('idle');
  const { colors: tc } = useTheme();
  const [input, setInput] = useState('');
  const [response, setResponse] = useState('');
  const [history, setHistory] = useState<Message[]>([]);
  const insets = useSafeAreaInsets();

  const orbScale = useRef(new Animated.Value(1)).current;
  const orbOpacity = useRef(new Animated.Value(0.8)).current;
  const pulseAnim = useRef<Animated.CompositeAnimation | null>(null);

  useEffect(() => {
    startBreathing();
    return () => { pulseAnim.current?.stop(); Speech.stop(); };
  }, []);

  useEffect(() => {
    pulseAnim.current?.stop();
    if (status === 'thinking') startThinkingPulse();
    else if (status === 'speaking') startSpeakingPulse();
    else startBreathing();
  }, [status]);

  const startBreathing = () => {
    pulseAnim.current = Animated.loop(Animated.sequence([
      Animated.timing(orbScale, { toValue: 1.05, duration: 2000, useNativeDriver: true }),
      Animated.timing(orbScale, { toValue: 1, duration: 2000, useNativeDriver: true }),
    ]));
    pulseAnim.current.start();
  };

  const startThinkingPulse = () => {
    pulseAnim.current = Animated.loop(Animated.sequence([
      Animated.timing(orbScale, { toValue: 0.9, duration: 600, useNativeDriver: true }),
      Animated.timing(orbScale, { toValue: 1.1, duration: 600, useNativeDriver: true }),
    ]));
    pulseAnim.current.start();
  };

  const startSpeakingPulse = () => {
    pulseAnim.current = Animated.loop(Animated.sequence([
      Animated.timing(orbScale, { toValue: 1.15, duration: 300, useNativeDriver: true }),
      Animated.timing(orbScale, { toValue: 1, duration: 300, useNativeDriver: true }),
    ]));
    pulseAnim.current.start();
  };

  const sendMessage = async () => {
    const text = input.trim();
    if (!text) return;
    setInput('');
    setStatus('thinking');
    setResponse('');

    try {
      const systemPrompt = agentInstructions
        ? `You are "${agentName}". ${agentInstructions}\nKeep responses short — 1-2 sentences max, suitable for voice.`
        : 'You are GoFarther AI. Keep responses brief — 1-2 sentences, suitable for voice.';

      const msgs: Message[] = [...history, { role: 'user', content: text }];
      const aiResponse = await chat(msgs.slice(-10), systemPrompt);

      setHistory(prev => [...prev, { role: 'user', content: text }, { role: 'assistant', content: aiResponse }]);
      setResponse(aiResponse);
      setStatus('speaking');

      Speech.speak(aiResponse, {
        rate: 0.95, pitch: 1.0,
        onDone: () => setStatus('idle'),
        onError: () => setStatus('idle'),
      });
    } catch (e: any) {
      setResponse('Sorry, something went wrong.');
      setStatus('idle');
    }
  };

  const stopSpeaking = () => { Speech.stop(); setStatus('idle'); };

  return (
    <KeyboardAvoidingView style={[s.container, { paddingTop: insets.top, paddingBottom: insets.bottom, backgroundColor: tc.bg }]} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      {/* Header */}
      <View style={s.header}>
        <TouchableOpacity onPress={() => { Speech.stop(); onClose(); }} style={s.closeBtn} activeOpacity={0.7}>
          <Text style={s.closeX}>x</Text>
        </TouchableOpacity>
        <View style={s.voiceBadge}>
          <View style={[s.voiceDot, { backgroundColor: voice.color1 }]} />
          <Text style={s.voiceBadgeText}>{voice.name}</Text>
        </View>
        <View style={{ width: 40 }} />
      </View>

      {/* Center */}
      <View style={s.center}>
        {response ? <Text style={s.responseText} numberOfLines={6}>{response}</Text> : null}

        <TouchableOpacity onPress={status === 'speaking' ? stopSpeaking : undefined} activeOpacity={0.9} style={s.orbTouch}>
          <Animated.View style={[s.orbOuter, { backgroundColor: voice.color1 + '20', transform: [{ scale: orbScale }] }]} />
          <Animated.View style={[s.orb, { backgroundColor: voice.color1, transform: [{ scale: orbScale }] }]}>
            <View style={[s.orbInner, { backgroundColor: voice.color2 }]} />
          </Animated.View>
        </TouchableOpacity>

        <Text style={s.statusText}>
          {status === 'thinking' ? 'Thinking...' : status === 'speaking' ? 'Tap orb to stop' : 'Type and send'}
        </Text>
      </View>

      {/* Input bar */}
      <View style={s.inputBar}>
        <TextInput
          style={s.textInput}
          value={input}
          onChangeText={setInput}
          placeholder="Type your message..."
          placeholderTextColor="#999"
          onSubmitEditing={sendMessage}
          returnKeyType="send"
          editable={status === 'idle'}
        />
        <TouchableOpacity style={[s.sendBtn, (!input.trim() || status !== 'idle') && { opacity: 0.3 }]} onPress={sendMessage} disabled={!input.trim() || status !== 'idle'}>
          <Text style={s.sendText}>{'>'}</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fafafa' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12 },
  closeBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#ebebeb', alignItems: 'center', justifyContent: 'center' },
  closeX: { fontSize: 18, color: '#1a1a1a', fontWeight: '500' },
  voiceBadge: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#ebebeb', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20 },
  voiceDot: { width: 8, height: 8, borderRadius: 4, marginRight: 8 },
  voiceBadgeText: { fontSize: 14, fontWeight: '600', color: '#1a1a1a' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 32 },
  responseText: { fontSize: 16, color: '#444', textAlign: 'center', lineHeight: 24, marginBottom: 24, maxWidth: 300 },
  orbTouch: { alignItems: 'center', justifyContent: 'center', marginBottom: 20 },
  orbOuter: { position: 'absolute', width: ORB_SIZE + 40, height: ORB_SIZE + 40, borderRadius: (ORB_SIZE + 40) / 2 },
  orb: { width: ORB_SIZE, height: ORB_SIZE, borderRadius: ORB_SIZE / 2, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  orbInner: { width: ORB_SIZE * 0.6, height: ORB_SIZE * 0.6, borderRadius: ORB_SIZE * 0.3, opacity: 0.5 },
  statusText: { fontSize: 15, fontWeight: '500', color: '#888' },
  inputBar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, gap: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#e8e8e8' },
  textInput: { flex: 1, backgroundColor: '#f0f0f0', borderRadius: 22, paddingHorizontal: 16, paddingVertical: 10, fontSize: 15, color: '#1a1a1a', borderWidth: 1, borderColor: '#e0e0e0' },
  sendBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#1a1a1a', alignItems: 'center', justifyContent: 'center' },
  sendText: { color: '#fff', fontSize: 18, fontWeight: '700' },
});
