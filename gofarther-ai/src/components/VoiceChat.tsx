import React, { useState, useRef, useEffect } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, Animated, Dimensions, TextInput, KeyboardAvoidingView, Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Speech from 'expo-speech';
import { useAudioRecorder, AudioModule, RecordingPresets } from 'expo-audio';
import { C } from '../lib/theme';
import { useTheme } from '../lib/ThemeContext';
import { chat, Message, transcribeAudio } from '../lib/ai';
import { buildUserContextPrompt } from '../lib/promptContext';
import { VoiceOption } from './VoicePicker';
import { Ionicons } from '@expo/vector-icons';
import * as FileSystem from 'expo-file-system/legacy';

const { width: SW } = Dimensions.get('window');
const ORB_SIZE = SW * 0.4;

interface Props {
  voice: VoiceOption;
  onClose: () => void;
  agentName?: string;
  agentInstructions?: string;
}

export default function VoiceChat({ voice, onClose, agentName, agentInstructions }: Props) {
  const [status, setStatus] = useState<'idle' | 'listening' | 'thinking' | 'speaking'>('idle');
  const { colors: tc } = useTheme();
  const [input, setInput] = useState('');
  const [response, setResponse] = useState('');
  const [history, setHistory] = useState<Message[]>([]);
  const [showInput, setShowInput] = useState(false);
  const insets = useSafeAreaInsets();
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);

  const orbScale = useRef(new Animated.Value(1)).current;
  const orbOpacity = useRef(new Animated.Value(0.8)).current;
  const pulseAnim = useRef<Animated.CompositeAnimation | null>(null);

  useEffect(() => {
    startBreathing();
    return () => { pulseAnim.current?.stop(); Speech.stop(); if (recorder.isRecording) recorder.stop(); };
  }, []);

  useEffect(() => {
    pulseAnim.current?.stop();
    if (status === 'listening') startListeningPulse();
    else if (status === 'thinking') startThinkingPulse();
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

  const startListeningPulse = () => {
    pulseAnim.current = Animated.loop(Animated.sequence([
      Animated.timing(orbScale, { toValue: 1.2, duration: 400, useNativeDriver: true }),
      Animated.timing(orbScale, { toValue: 0.95, duration: 400, useNativeDriver: true }),
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

  /** Start recording audio */
  const startRecording = async () => {
    try {
      const permStatus = await AudioModule.requestRecordingPermissionsAsync();
      if (!permStatus.granted) { setResponse('Microphone permission needed for voice.'); return; }
      recorder.record();
      setStatus('listening');
      setResponse('Listening...');
    } catch (e: any) {
      setResponse('Could not start recording: ' + (e.message || ''));
      setStatus('idle');
    }
  };

  /** Stop recording and transcribe */
  const stopRecording = async (cancel = false) => {
    if (!recorder.isRecording) return;
    try {
      await recorder.stop();
      if (cancel) return;
      const uri = recorder.uri;
      if (!uri) { setStatus('idle'); return; }
      setStatus('thinking');
      setResponse('Transcribing...');
      const base64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
      const result = await transcribeAudio(base64);
      const text = result.text || result.transcript || '';
      if (!text) { setResponse('Could not understand audio. Try again.'); setStatus('idle'); return; }
      setInput(text);
      await sendMessageWithText(text);
    } catch (e: any) {
      setResponse('Transcription failed: ' + (e.message || ''));
      setStatus('idle');
    }
  };

  /** Handle orb tap — toggle recording or stop speaking */
  const handleOrbTap = () => {
    if (status === 'speaking') { stopSpeaking(); return; }
    if (status === 'listening') { stopRecording(); return; }
    if (status === 'idle') { startRecording(); return; }
  };

  const sendMessage = async () => {
    const text = input.trim();
    if (!text) return;
    setInput('');
    await sendMessageWithText(text);
  };

  const sendMessageWithText = async (msgText: string) => {
    if (!msgText.trim()) return;
    setStatus('thinking');
    setResponse('');

    try {
      const baseVoicePrompt = agentInstructions
        ? `You are "${agentName}". ${agentInstructions}\nKeep responses short — 1-2 sentences max, suitable for voice.`
        : 'You are GoFarther AI. Keep responses brief — 1-2 sentences, suitable for voice.';
      // Pull the shared user-context block (saved contacts, memory, nickname,
      // custom instructions, email subject rule) so voice chat knows "my
      // boss" etc. just like the main chat does.
      const extras = await buildUserContextPrompt({ terseWhenEmpty: true });
      const systemPrompt = baseVoicePrompt + extras;

      const msgs: Message[] = [...history, { role: 'user', content: msgText }];
      const aiResponse = await chat(msgs.slice(-10), systemPrompt);

      setHistory(prev => [...prev, { role: 'user', content: msgText }, { role: 'assistant', content: aiResponse }]);
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

        <TouchableOpacity onPress={handleOrbTap} activeOpacity={0.9} style={s.orbTouch}>
          <Animated.View style={[s.orbOuter, { backgroundColor: voice.color1 + '20', transform: [{ scale: orbScale }] }]} />
          <Animated.View style={[s.orb, { backgroundColor: status === 'listening' ? '#ef4444' : voice.color1, transform: [{ scale: orbScale }] }]}>
            <Ionicons name={status === 'listening' ? 'mic' : status === 'speaking' ? 'volume-high' : 'mic-outline'} size={ORB_SIZE * 0.3} color="#fff" />
          </Animated.View>
        </TouchableOpacity>

        <Text style={s.statusText}>
          {status === 'listening' ? 'Listening... tap to send' : status === 'thinking' ? 'Thinking...' : status === 'speaking' ? 'Tap to stop' : 'Tap to talk'}
        </Text>
      </View>

      {/* Input bar */}
      <View style={s.inputBar}>
        <TouchableOpacity style={s.keyboardToggle} onPress={() => setShowInput(!showInput)}>
          <Ionicons name={showInput ? 'mic' : 'keypad'} size={22} color="#666" />
        </TouchableOpacity>
        {showInput ? (
          <>
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
              <Ionicons name="send" size={16} color="#fff" />
            </TouchableOpacity>
          </>
        ) : (
          <Text style={s.voiceHint}>Tap the orb to start talking</Text>
        )}
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
  keyboardToggle: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#f0f0f0', alignItems: 'center', justifyContent: 'center' },
  voiceHint: { flex: 1, fontSize: 14, color: '#999', textAlign: 'center' },
});
