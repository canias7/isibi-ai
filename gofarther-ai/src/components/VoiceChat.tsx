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
  View, Text, TouchableOpacity, StyleSheet, Animated, Dimensions, TextInput, KeyboardAvoidingView, Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Speech from 'expo-speech';
import { useAudioRecorder, AudioModule, RecordingPresets, setAudioModeAsync } from 'expo-audio';
import { C } from '../lib/theme';
import { useTheme } from '../lib/ThemeContext';
import { transcribeAudio } from '../lib/ai';
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
}

type VoiceStatus = 'idle' | 'listening' | 'thinking' | 'speaking';

export default function VoiceChat({ voice, onClose, agentName, agentInstructions }: Props) {
  const [status, setStatus] = useState<VoiceStatus>('idle');
  const { colors: tc } = useTheme();
  const [input, setInput] = useState('');
  const [response, setResponse] = useState('');
  const [showInput, setShowInput] = useState(false);
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
  const sessionId = useRef(`voice_${Date.now()}`).current;
  const { messages, loading, send: chatSend } = useChat({
    sessionId,
    systemPrompt,
  });

  // Track which assistant messages we've already spoken so we don't
  // re-TTS the same reply on every render.
  const spokenIdsRef = useRef<Set<string>>(new Set());

  const orbScale = useRef(new Animated.Value(1)).current;
  const orbOpacity = useRef(new Animated.Value(0.8)).current;
  const pulseAnim = useRef<Animated.CompositeAnimation | null>(null);

  // ── iOS audio mode + permission on mount ───────────────────────────
  useEffect(() => {
    (async () => {
      try {
        // Ask for mic permission upfront
        const permStatus = await AudioModule.requestRecordingPermissionsAsync();
        if (!permStatus.granted) {
          setResponse('Microphone permission is required for voice mode.');
          return;
        }
        // Configure the audio session to both record AND play back TTS.
        // iOS defaults to a playback-only category which silently fails
        // recording; we flip it to allow both and keep playback audible
        // in silent mode.
        if (Platform.OS === 'ios') {
          try {
            await setAudioModeAsync({
              allowsRecording: true,
              playsInSilentMode: true,
            } as any);
          } catch {}
        }
        // Permission granted + audio mode set → mark ready.
        // Auto-start after a brief delay for audio session to settle.
        permissionReady.current = true;
        setTimeout(() => {
          setContinuous(true);
          try { startRecording(); } catch {}
        }, 500);
      } catch (e: any) {
        setResponse('Audio setup failed: ' + (e?.message || ''));
      }
    })();

    startBreathing();
    return () => {
      pulseAnim.current?.stop();
      Speech.stop();
      try { if (recorder.isRecording) recorder.stop(); } catch {}
      // Reset the audio mode on unmount so the rest of the app doesn't
      // inherit the recording-enabled session.
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

  // ── Orb pulse animations by state ──────────────────────────────────
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

  // ── Recording ──────────────────────────────────────────────────────
  const startRecording = async () => {
    try {
      tapHaptic();
      if (autoStopRef.current) { clearTimeout(autoStopRef.current); autoStopRef.current = null; }
      await recorder.record();
      setStatus('listening');
      setResponse('Listening... tap when done');
      // Auto-stop after 10s so it always sends even if user forgets to tap
      autoStopRef.current = setTimeout(() => {
        if (recorder.isRecording) stopRecording();
      }, 10000);
    } catch (e: any) {
      errorHaptic();
      setResponse('Could not start recording: ' + (e.message || ''));
      setStatus('idle');
    }
  };

  const stopRecording = async (cancel = false) => {
    if (autoStopRef.current) { clearTimeout(autoStopRef.current); autoStopRef.current = null; }
    if (!recorder.isRecording) return;
    try {
      await recorder.stop();
      if (cancel) { setStatus('idle'); return; }
      const uri = recorder.uri;
      if (!uri) { setStatus('idle'); return; }
      setStatus('thinking');
      setResponse('Transcribing...');
      const base64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
      const result = await transcribeAudio(base64);
      const text = (result.text || result.transcript || '').trim();
      if (!text) {
        errorHaptic();
        setResponse('I didn\'t catch that. Tap to try again.');
        setStatus('idle');
        return;
      }
      selectionHaptic();
      setInput(text);
      setResponse('');
      // Fire the full chat pipeline so plans, connectors, and actions
      // all work. The assistant reply will show up in `messages` and
      // our effect below will TTS it.
      await chatSend(text);
    } catch (e: any) {
      errorHaptic();
      setResponse('Transcription failed: ' + (e.message || ''));
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

    setResponse(toSpeak);
    setStatus('speaking');
    Speech.stop(); // cancel any in-flight speech before starting a new one
    Speech.speak(toSpeak, {
      rate: 0.98,
      pitch: 1.0,
      onDone: () => {
        setStatus('idle');
        // Continuous conversation: if the user hasn't tapped to hang
        // up, automatically start listening again so they can reply
        // without touching the screen.
        if (continuousRef.current) {
          setTimeout(() => {
            if (continuousRef.current && !recorder.isRecording) {
              startRecording();
            }
          }, 300);
        }
      },
      onError: () => setStatus('idle'),
      onStopped: () => setStatus('idle'),
    });
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
        <View style={s.voiceBadge}>
          <View style={[s.voiceDot, { backgroundColor: voice.color1 }]} />
          <Text style={s.voiceBadgeText}>{voice.name}</Text>
          {continuous && <View style={s.liveDot} />}
        </View>
        <View style={{ width: 40 }} />
      </View>

      {/* Center */}
      <View style={s.center}>
        {response ? <Text style={s.responseText} numberOfLines={6}>{response}</Text> : null}

        <TouchableOpacity onPress={handleOrbTap} activeOpacity={0.9} style={s.orbTouch} accessibilityLabel="Voice orb">
          <Animated.View style={[s.orbOuter, { backgroundColor: voice.color1 + '20', transform: [{ scale: orbScale }] }]} />
          <Animated.View style={[s.orb, { backgroundColor: status === 'listening' ? '#ef4444' : voice.color1, transform: [{ scale: orbScale }] }]}>
            <Ionicons
              name={status === 'listening' ? 'mic' : status === 'speaking' ? 'volume-high' : status === 'thinking' ? 'ellipsis-horizontal' : 'mic-outline'}
              size={ORB_SIZE * 0.3}
              color="#fff"
            />
          </Animated.View>
        </TouchableOpacity>

        <Text style={s.statusText}>
          {status === 'listening' ? 'Listening…' :
            status === 'thinking' ? 'Thinking…' :
            status === 'speaking' ? 'Tap to interrupt' :
            'Conversation mode · tap x to hang up'}
        </Text>
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
          <Text style={s.voiceHint}>{continuous ? 'Conversation mode · tap × to hang up' : 'Tap the orb to start talking'}</Text>
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
  orbOuter: { position: 'absolute', width: ORB_SIZE + 40, height: ORB_SIZE + 40, borderRadius: (ORB_SIZE + 40) / 2 },
  orb: { width: ORB_SIZE, height: ORB_SIZE, borderRadius: ORB_SIZE / 2, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  statusText: { fontSize: 15, fontWeight: '500', color: '#888' },
  inputBar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, gap: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#e8e8e8' },
  textInput: { flex: 1, backgroundColor: '#f0f0f0', borderRadius: 22, paddingHorizontal: 16, paddingVertical: 10, fontSize: 15, color: '#1a1a1a', borderWidth: 1, borderColor: '#e0e0e0' },
  sendBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#1a1a1a', alignItems: 'center', justifyContent: 'center' },
  keyboardToggle: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#f0f0f0', alignItems: 'center', justifyContent: 'center' },
  voiceHint: { flex: 1, fontSize: 14, color: '#999', textAlign: 'center' },
});
