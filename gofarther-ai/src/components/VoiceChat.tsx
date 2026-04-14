/** VoiceChat — hands-free conversation mode for GoFarther.
 *
 * Key differences from the previous version:
 *   1. Uses the main useChat hook so every action the text chat can do
 *      — connector calls, plans, saved contacts, templates, memory —
 *      works the same way when spoken. Voice is no longer a crippled
 *      subset of chat; it's a voice wrapper around chat.
 *   2. iOS audio mode is explicitly set on mount so recording works
 *      and playback isn't muted in silent mode.
 *   3. Continuous conversation loop: after the AI finishes speaking,
 *      we auto-start listening again so the user can just keep
 *      talking. Tap once to start the session, tap again to end it.
 *   4. Tap during AI speech interrupts playback and starts listening
 *      immediately (like Siri).
 *   5. Haptic feedback on every state transition.
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, Animated, Dimensions, TextInput, KeyboardAvoidingView, Platform, ScrollView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Speech from 'expo-speech';
import { useAudioRecorder, createAudioPlayer, AudioModule, RecordingPresets, setAudioModeAsync } from 'expo-audio';
import { C } from '../lib/theme';
import { useTheme } from '../lib/ThemeContext';
import { transcribeAudio, textToSpeech } from '../lib/ai';
import { useChat } from '../lib/useChat';
import { buildUserContextPrompt } from '../lib/promptContext';
import { getConnectedApps } from '../lib/storage';
import { tapHaptic, errorHaptic, selectionHaptic } from '../lib/haptics';
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
  chatSessionId?: string | null;
}

type VoiceStatus = 'idle' | 'listening' | 'thinking' | 'speaking';

export default function VoiceChat({ voice, onClose, agentName, agentInstructions, chatSessionId }: Props) {
  const [status, setStatus] = useState<VoiceStatus>('idle');
  const { colors: tc } = useTheme();
  const [input, setInput] = useState('');
  const [response, setResponse] = useState('');
  const [debugLog, setDebugLog] = useState<string[]>([]);
  const [showDebug, setShowDebug] = useState(false);
  const [showInput, setShowInput] = useState(false);
  const addLog = (msg: string) => setDebugLog(prev => [...prev.slice(-15), `${new Date().toLocaleTimeString()}: ${msg}`]);
  const [systemPrompt, setSystemPrompt] = useState('');
  // Continuous mode: once the user has started a conversation we keep
  // auto-listening after each AI reply. Toggled off when the user taps
  // the orb during speaking to "hang up".
  const [continuous, setContinuous] = useState(false);
  const continuousRef = useRef(false);
  useEffect(() => { continuousRef.current = continuous; }, [continuous]);

  const insets = useSafeAreaInsets();
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const autoStopRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const permissionReady = useRef(false);

  // Drive the main chat pipeline so every action the text chat can do
  // (plans, connectors, saved_contact sidecars, templates, memory)
  // works the same way over voice. The session id is fixed so voice
  // history persists across sessions and can be resumed in text chat.
  const sessionId = useRef(chatSessionId || `voice_${Date.now()}`).current;
  const { messages, loading, send: chatSend } = useChat({
    sessionId,
    systemPrompt,
    fast: true,
  });

  // Track which assistant messages we've already spoken so we don't
  // re-TTS the same reply on every render.
  const spokenIdsRef = useRef<Set<string>>(new Set());

  const orbScale = useRef(new Animated.Value(1)).current;
  const spinAnim = useRef(new Animated.Value(0)).current;
  const spinRef = useRef<Animated.CompositeAnimation | null>(null);
  const pulseAnim = useRef<Animated.CompositeAnimation | null>(null);

  // Spin interpolation for the thinking ring
  const spinInterpolate = spinAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  // ── iOS audio mode + permission on mount ───────────────────────────
  useEffect(() => {
    (async () => {
      try {
        addLog('Requesting mic permission...');
        const permStatus = await AudioModule.requestRecordingPermissionsAsync();
        addLog(`Permission: ${permStatus.granted ? 'GRANTED' : 'DENIED'}`);
        if (!permStatus.granted) {
          setResponse('Microphone permission is required for voice mode.');
          return;
        }
        addLog('Setting audio mode...');
        if (Platform.OS === 'ios') {
          await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true } as any);
        }
        addLog('Audio mode set. Ready.');
        permissionReady.current = true;
        setTimeout(() => {
          addLog('Auto-starting recording...');
          setContinuous(true);
          startRecording();
        }, 500);
      } catch (e: any) {
        addLog(`Setup error: ${e?.message}`);
        setResponse('Audio setup failed: ' + (e?.message || ''));
      }
    })();

    return () => {
      pulseAnim.current?.stop();
      spinRef.current?.stop();
      Speech.stop();
      if (autoStopRef.current) clearTimeout(autoStopRef.current);
      try { if (recorder.isRecording) recorder.stop(); } catch {}
      if (Platform.OS === 'ios') {
        setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true } as any).catch(() => {});
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Build the full system prompt (contacts + connected apps + rules) ─
  const loadSystemPrompt = useCallback(async () => {
    const base = agentInstructions
      ? `You are "${agentName}" speaking to the user over voice. ${agentInstructions}`
      : 'You are GoFarther AI speaking to the user over voice.';

    // Voice-specific rules: keep replies short and spoken-friendly.
    const voiceRules = `\n\nVOICE-MODE RULES:\n- Keep every reply under 2 short sentences unless the user explicitly asks for more detail. No lists, no markdown, no emoji — this will be read aloud.\n- When the user asks you to DO something (send email, check inbox, read a file, schedule a task, summarize something) you MUST emit the same action JSON the text chat uses. Never describe what you would do without actually emitting the action.\n- When an action completes, read back only the most important result — do NOT enumerate every step.`;

    // Include the shared user-context block (contacts, memory, templates,
    // email rules, custom instructions, nickname).
    const extras = await buildUserContextPrompt({ terseWhenEmpty: true });

    // Append the connected apps so voice knows which connector actions
    // are available, same way the main chat does.
    const connectedApps = await getConnectedApps();
    const appsStr = connectedApps && connectedApps.length > 0
      ? '\n\n=== CONNECTED APPS ===\nYou can use these apps by emitting a plan with connector steps:\n' +
        connectedApps.map((app: any) => {
          const actionLines = (app.actions || []).slice(0, 8).join(', ');
          return `- ${app.name} (id: "${app.id}"): ${actionLines}`;
        }).join('\n') +
        '\n\nFor sends, always use a plan with an email step — never a direct <app>.send_email connector action. Example action JSON for voice:\n{"type":"plan","steps":[{"id":"send","type":"email","params":{"to":"<email>","subject":"<subject>","html":"<p>...</p>"}}]}'
      : '\n\n(No apps connected yet. If the user asks you to send email, check inbox, or use an app, tell them to connect one in Settings first.)';

    setSystemPrompt(base + voiceRules + extras + appsStr);
  }, [agentInstructions, agentName]);

  useEffect(() => { loadSystemPrompt(); }, [loadSystemPrompt]);

  // ── Orb state management — no scale animations, just spinner ring ───
  useEffect(() => {
    // Kill all animations — orb stays perfectly still in every state
    pulseAnim.current?.stop();
    orbScale.setValue(1);

    // Spinning ring only during thinking
    if (status === 'thinking') {
      spinAnim.setValue(0);
      spinRef.current = Animated.loop(
        Animated.timing(spinAnim, { toValue: 1, duration: 1200, useNativeDriver: true }),
      );
      spinRef.current.start();
    } else {
      spinRef.current?.stop();
    }
  }, [status]);

  // ── Recording (expo-audio with prepareToRecordAsync) ────────────────
  const startRecording = async () => {
    try {
      tapHaptic();
      addLog('startRecording: preparing...');
      if (autoStopRef.current) { clearTimeout(autoStopRef.current); autoStopRef.current = null; }
      // Re-enable recording mode (gets disabled during TTS playback)
      if (Platform.OS === 'ios') {
        await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true } as any);
      }
      await recorder.prepareToRecordAsync();
      addLog('startRecording: prepared. Calling record()...');
      recorder.record();
      // Give native a moment to start, then verify
      await new Promise(r => setTimeout(r, 200));
      addLog(`isRecording: ${recorder.isRecording}`);
      setStatus('listening');
      setResponse('');
      autoStopRef.current = setTimeout(() => {
        addLog('Auto-stop timer fired');
        stopRecording();
      }, 10000);
    } catch (e: any) {
      addLog(`startRecording ERROR: ${e?.message}`);
      setResponse('');
      setStatus('idle');
      // Silently retry after a brief pause
      if (continuousRef.current) setTimeout(() => startRecording(), 1000);
    }
  };

  const stopRecording = async (cancel = false) => {
    if (autoStopRef.current) { clearTimeout(autoStopRef.current); autoStopRef.current = null; }
    addLog(`stopRecording. cancel=${cancel}, isRecording=${recorder.isRecording}`);
    if (!recorder.isRecording) { addLog('Not recording — skipping'); return; }
    try {
      recorder.stop();
      addLog(`Stopped. uri=${recorder.uri ? 'YES' : 'NO'}`);
      if (cancel) { setStatus('idle'); return; }
      const uri = recorder.uri;
      if (!uri) { addLog('No URI'); setStatus('idle'); return; }
      setStatus('thinking');
      setResponse('');
      const base64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
      addLog(`Base64 length: ${base64.length}`);
      const result = await transcribeAudio(base64);
      addLog(`Transcribe: ${JSON.stringify(result).slice(0, 100)}`);
      const text = (result.text || result.transcript || '').trim();
      if (!text) {
        errorHaptic();
        addLog('Empty transcription');
        setResponse('');
        setStatus('idle');
        // Auto-retry listening
        if (continuousRef.current) setTimeout(() => startRecording(), 500);
        return;
      }
      selectionHaptic();
      addLog(`Got: "${text}"`);
      setInput(text);
      setResponse('');
      await chatSend(text);
    } catch (e: any) {
      addLog(`stopRecording ERROR: ${e?.message}`);
      errorHaptic();
      setResponse('Error: ' + (e.message || 'unknown'));
      setStatus('idle');
    }
  };

  // ── Watch messages array and speak new assistant replies ──────────
  useEffect(() => {
    if (loading) {
      // Still streaming — reflect that in the orb
      if (status !== 'thinking' && status !== 'speaking') setStatus('thinking');
      return;
    }
    const last = messages[messages.length - 1];
    if (!last || last.role !== 'assistant') return;
    if (spokenIdsRef.current.has(last.id)) return;
    // Wait until the message has actual content (it can briefly be empty
    // while the plan executor is running)
    const raw = (last.content || '').trim();
    if (!raw) return;

    spokenIdsRef.current.add(last.id);

    // Strip markdown so TTS doesn't pronounce asterisks / underscores.
    const cleanText = raw
      .replace(/```[\s\S]*?```/g, '') // fenced code blocks → gone
      .replace(/`([^`]+)`/g, '$1')
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/\*([^*]+)\*/g, '$1')
      .replace(/__([^_]+)__/g, '$1')
      .replace(/_([^_]+)_/g, '$1')
      .replace(/^#{1,6}\s+/gm, '')
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      .replace(/!\[([^\]]+)\]\([^)]+\)/g, '')
      .replace(/[🟢🔴✅❌✓✗·→]/g, '')
      .replace(/\s+/g, ' ')
      .trim();

    // Skip the TTS step if the message is purely action-status (like a
    // plan checklist) — the voice listener doesn't need to hear "Done!
    // Read your spreadsheet. Sent email to boss@x.com". A short spoken
    // confirmation is friendlier.
    const isPlanResult = /^(Done!|Something went wrong)/.test(raw);
    const toSpeak = isPlanResult
      ? raw.includes('Sent email')
        ? 'Done. Email sent.'
        : raw.includes('Something went wrong')
          ? 'Something went wrong. Check the chat for details.'
          : 'Done.'
      : cleanText.slice(0, 400);  // cap at ~400 chars so replies stay snappy

    // Show text immediately — audio follows when TTS is ready
    setResponse(toSpeak);
    setStatus('speaking');
    Speech.stop();
    if (Platform.OS === 'ios') {
      setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true } as any).catch(() => {});
    }
    addLog(`Speaking: "${toSpeak.slice(0, 60)}..."`);

    (async () => {
      try {
        const { audio_base64 } = await textToSpeech(toSpeak, voice.ttsVoice || 'nova');
        const tempFile = FileSystem.cacheDirectory + `tts_${Date.now()}.mp3`;
        await FileSystem.writeAsStringAsync(tempFile, audio_base64, { encoding: FileSystem.EncodingType.Base64 });
        addLog('TTS audio received, playing...');

        const player = createAudioPlayer(tempFile);
        player.play();

        // Estimate playback time from text length (~150 words/min, ~5 chars/word)
        const estimatedMs = Math.max(2000, (toSpeak.length / 5) * (60000 / 150));
        setTimeout(() => {
          addLog('TTS playback done (estimated)');
          try { player.remove(); } catch {}
          setStatus('idle');
          if (continuousRef.current) {
            setTimeout(() => {
              if (continuousRef.current && !recorder.isRecording) startRecording();
            }, 300);
          }
        }, estimatedMs);
      } catch (e: any) {
        addLog(`OpenAI TTS failed: ${e?.message}, falling back to expo-speech`);
        Speech.speak(toSpeak, {
          rate: 0.98, pitch: 1.0,
          onDone: () => {
            setStatus('idle');
            if (continuousRef.current) setTimeout(() => { if (!recorder.isRecording) startRecording(); }, 300);
          },
          onError: () => setStatus('idle'),
          onStopped: () => setStatus('idle'),
        });
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages, loading]);

  // ── Orb tap handler — interrupt or start, based on current state ──
  const handleOrbTap = () => {
    tapHaptic();
    if (status === 'speaking') {
      // Interrupt playback and start listening right away
      Speech.stop();
      setStatus('idle');
      setTimeout(() => startRecording(), 120);
      setContinuous(true);
      return;
    }
    if (status === 'listening') {
      // Stop recording and send whatever we captured
      stopRecording();
      return;
    }
    if (status === 'thinking') {
      // No-op — wait for the response
      return;
    }
    // idle → start a fresh listening session and flip into continuous mode
    setContinuous(true);
    startRecording();
  };

  // ── Text input fallback ────────────────────────────────────────────
  const sendMessage = async () => {
    const text = input.trim();
    if (!text) return;
    setInput('');
    setResponse('');
    setStatus('thinking');
    await chatSend(text);
  };

  // ── Hang up / end session ──────────────────────────────────────────
  const hangUp = () => {
    Speech.stop();
    if (autoStopRef.current) { clearTimeout(autoStopRef.current); autoStopRef.current = null; }
    try { if (recorder.isRecording) recorder.stop(); } catch {}
    setContinuous(false);
    setStatus('idle');
    onClose();
  };

  return (
    <KeyboardAvoidingView style={[s.container, { paddingTop: insets.top, paddingBottom: insets.bottom, backgroundColor: tc.bg }]} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      {/* Header */}
      <View style={s.header}>
        <TouchableOpacity onPress={hangUp} style={s.closeBtn} activeOpacity={0.7} accessibilityLabel="End voice session">
          <Ionicons name="close" size={20} color="#1a1a1a" />
        </TouchableOpacity>
        <TouchableOpacity style={s.voiceBadge} onLongPress={() => setShowDebug(!showDebug)} delayLongPress={800}>
          <View style={[s.voiceDot, { backgroundColor: voice.color1 }]} />
          <Text style={s.voiceBadgeText}>{voice.name}</Text>
          {continuous && <View style={s.liveDot} />}
        </TouchableOpacity>
        <View style={{ width: 40 }} />
      </View>

      {/* Debug panel — long-press voice name to toggle */}
      {showDebug && (
        <ScrollView style={{ maxHeight: 200, backgroundColor: '#111', borderRadius: 12, marginHorizontal: 16, marginBottom: 8, padding: 10 }}>
          {debugLog.map((line, i) => (
            <Text key={i} style={{ fontSize: 10, color: '#0f0', fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', lineHeight: 14 }}>{line}</Text>
          ))}
          {debugLog.length === 0 && <Text style={{ fontSize: 10, color: '#666' }}>No logs yet. Interact with voice mode...</Text>}
        </ScrollView>
      )}

      {/* Center */}
      <View style={s.center}>
        {response ? <Text style={s.responseText} numberOfLines={6}>{response}</Text> : null}

        <TouchableOpacity onPress={handleOrbTap} activeOpacity={0.9} style={s.orbTouch} accessibilityLabel="Voice orb">
          {/* Thinking spinner ring */}
          {status === 'thinking' && (
            <Animated.View style={[s.spinnerRing, {
              width: ORB_SIZE + 24, height: ORB_SIZE + 24, borderRadius: (ORB_SIZE + 24) / 2,
              borderColor: voice.color1,
              transform: [{ rotate: spinInterpolate }],
            }]} />
          )}
          {/* Static glow behind orb */}
          {status !== 'thinking' && (
            <View style={[s.orbGlow, { width: ORB_SIZE + 24, height: ORB_SIZE + 24, borderRadius: (ORB_SIZE + 24) / 2, backgroundColor: voice.color1 + '15' }]} />
          )}
          {/* The orb — always same color, always same size */}
          <View style={[s.orb, { backgroundColor: voice.color1 }]}>
            <Ionicons
              name={status === 'speaking' ? 'volume-high' : 'mic'}
              size={ORB_SIZE * 0.28}
              color="#fff"
            />
          </View>
        </TouchableOpacity>
      </View>

      {/* Input bar */}
      <View style={s.inputBar}>
        <TouchableOpacity style={s.keyboardToggle} onPress={() => setShowInput(!showInput)} accessibilityLabel="Toggle keyboard input">
          <Ionicons name={showInput ? 'mic' : 'keypad'} size={22} color="#666" />
        </TouchableOpacity>
        {showInput ? (
          <>
            <TextInput
              style={s.textInput}
              value={input}
              onChangeText={setInput}
              placeholder="Type your message…"
              placeholderTextColor="#999"
              onSubmitEditing={sendMessage}
              returnKeyType="send"
              editable={status === 'idle'}
            />
            <TouchableOpacity style={[s.sendBtn, (!input.trim() || status !== 'idle') && { opacity: 0.3 }]} onPress={sendMessage} disabled={!input.trim() || status !== 'idle'} accessibilityLabel="Send message">
              <Ionicons name="send" size={16} color="#fff" />
            </TouchableOpacity>
          </>
        ) : (
          <Text style={s.voiceHint}></Text>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fafafa' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12 },
  closeBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#ebebeb', alignItems: 'center', justifyContent: 'center' },
  voiceBadge: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#ebebeb', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, gap: 8 },
  voiceDot: { width: 8, height: 8, borderRadius: 4 },
  voiceBadgeText: { fontSize: 14, fontWeight: '600', color: '#1a1a1a' },
  liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#22c55e', marginLeft: 2 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 32 },
  responseText: { fontSize: 16, color: '#444', textAlign: 'center', lineHeight: 24, marginBottom: 24, maxWidth: 320 },
  orbTouch: { alignItems: 'center', justifyContent: 'center', marginBottom: 20 },
  orbGlow: { position: 'absolute' },
  spinnerRing: { position: 'absolute', borderWidth: 3, borderColor: 'transparent', borderTopWidth: 3 },
  orb: { width: ORB_SIZE, height: ORB_SIZE, borderRadius: ORB_SIZE / 2, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  inputBar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, gap: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#e8e8e8' },
  textInput: { flex: 1, backgroundColor: '#f0f0f0', borderRadius: 22, paddingHorizontal: 16, paddingVertical: 10, fontSize: 15, color: '#1a1a1a', borderWidth: 1, borderColor: '#e0e0e0' },
  sendBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#1a1a1a', alignItems: 'center', justifyContent: 'center' },
  keyboardToggle: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#f0f0f0', alignItems: 'center', justifyContent: 'center' },
  voiceHint: { flex: 1, fontSize: 14, color: '#999', textAlign: 'center' },
});
