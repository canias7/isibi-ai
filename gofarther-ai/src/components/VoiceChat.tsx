/** VoiceChat — premium hands-free voice mode for GoFarther AI.
 *
 * Design: dark background, gradient orb with glow, animated ring
 * for thinking, waveform bars while speaking, floating particles,
 * fade-in text. Full premium feel.
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, Animated, Dimensions,
  TextInput, KeyboardAvoidingView, Platform, ScrollView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Speech from 'expo-speech';
import { useAudioRecorder, createAudioPlayer, AudioModule, RecordingPresets, setAudioModeAsync } from 'expo-audio';
import { transcribeAudio, textToSpeech } from '../lib/ai';
import { useChat } from '../lib/useChat';
import { buildUserContextPrompt } from '../lib/promptContext';
import { getConnectedApps } from '../lib/storage';
import { tapHaptic, errorHaptic, selectionHaptic } from '../lib/haptics';
import { VoiceOption } from './VoicePicker';
import { Ionicons } from '@expo/vector-icons';
import * as FileSystem from 'expo-file-system/legacy';
// No native gradient dependency — use a pure-View layered approach

const { width: SW, height: SH } = Dimensions.get('window');
const ORB_SIZE = SW * 0.38;
const NUM_PARTICLES = 12;
const NUM_BARS = 5;

interface Props {
  voice: VoiceOption;
  onClose: () => void;
  agentName?: string;
  agentInstructions?: string;
  chatSessionId?: string | null;
}

type VoiceStatus = 'idle' | 'listening' | 'thinking' | 'speaking';

// ── Floating particles component ──────────────────────────────────────
function FloatingParticles({ color, active }: { color: string; active: boolean }) {
  const anims = useRef(
    Array.from({ length: NUM_PARTICLES }, () => ({
      x: new Animated.Value(Math.random() * SW),
      y: new Animated.Value(SH * 0.3 + Math.random() * SH * 0.4),
      opacity: new Animated.Value(0),
      scale: new Animated.Value(0.3 + Math.random() * 0.7),
    })),
  ).current;
  const loopsRef = useRef<Animated.CompositeAnimation[]>([]);

  useEffect(() => {
    loopsRef.current.forEach(l => l.stop());
    loopsRef.current = [];
    if (!active) {
      anims.forEach(a => a.opacity.setValue(0));
      return;
    }
    anims.forEach((a, i) => {
      const dur = 3000 + Math.random() * 4000;
      const loop = Animated.loop(
        Animated.sequence([
          Animated.delay(i * 300),
          Animated.parallel([
            Animated.timing(a.opacity, { toValue: 0.4 + Math.random() * 0.3, duration: dur * 0.3, useNativeDriver: true }),
            Animated.timing(a.y, { toValue: SH * 0.2 + Math.random() * SH * 0.15, duration: dur, useNativeDriver: true }),
          ]),
          Animated.parallel([
            Animated.timing(a.opacity, { toValue: 0, duration: dur * 0.3, useNativeDriver: true }),
            Animated.timing(a.y, { toValue: SH * 0.3 + Math.random() * SH * 0.4, duration: 1, useNativeDriver: true }),
          ]),
        ]),
      );
      loop.start();
      loopsRef.current.push(loop);
    });
    return () => loopsRef.current.forEach(l => l.stop());
  }, [active]);

  return (
    <>
      {anims.map((a, i) => (
        <Animated.View
          key={i}
          pointerEvents="none"
          style={{
            position: 'absolute',
            width: 4 + Math.random() * 4,
            height: 4 + Math.random() * 4,
            borderRadius: 4,
            backgroundColor: color,
            opacity: a.opacity,
            transform: [{ translateX: a.x }, { translateY: a.y }, { scale: a.scale }],
          }}
        />
      ))}
    </>
  );
}

// ── Waveform bars component ───────────────────────────────────────────
function WaveformBars({ color, active }: { color: string; active: boolean }) {
  const bars = useRef(
    Array.from({ length: NUM_BARS }, () => new Animated.Value(0.15)),
  ).current;
  const loopsRef = useRef<Animated.CompositeAnimation[]>([]);

  useEffect(() => {
    loopsRef.current.forEach(l => l.stop());
    loopsRef.current = [];
    if (!active) {
      bars.forEach(b => b.setValue(0.15));
      return;
    }
    bars.forEach((b, i) => {
      const loop = Animated.loop(
        Animated.sequence([
          Animated.delay(i * 80),
          Animated.timing(b, { toValue: 0.5 + Math.random() * 0.5, duration: 200 + Math.random() * 200, useNativeDriver: true }),
          Animated.timing(b, { toValue: 0.15 + Math.random() * 0.15, duration: 200 + Math.random() * 200, useNativeDriver: true }),
        ]),
      );
      loop.start();
      loopsRef.current.push(loop);
    });
    return () => loopsRef.current.forEach(l => l.stop());
  }, [active]);

  return (
    <View style={vs.waveContainer}>
      {bars.map((b, i) => (
        <Animated.View
          key={i}
          style={[vs.waveBar, {
            backgroundColor: color,
            transform: [{ scaleY: b }],
          }]}
        />
      ))}
    </View>
  );
}

// ── Main VoiceChat ────────────────────────────────────────────────────
export default function VoiceChat({ voice, onClose, agentName, agentInstructions, chatSessionId }: Props) {
  const [status, setStatus] = useState<VoiceStatus>('idle');
  const [input, setInput] = useState('');
  const [response, setResponse] = useState('');
  const [debugLog, setDebugLog] = useState<string[]>([]);
  const [showDebug, setShowDebug] = useState(false);
  const addLog = (msg: string) => setDebugLog(prev => [...prev.slice(-15), `${new Date().toLocaleTimeString()}: ${msg}`]);
  const [systemPrompt, setSystemPrompt] = useState('');
  const [continuous, setContinuous] = useState(false);
  const continuousRef = useRef(false);
  useEffect(() => { continuousRef.current = continuous; }, [continuous]);
  const [textOpacity] = useState(new Animated.Value(0));

  const insets = useSafeAreaInsets();
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const autoStopRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const permissionReady = useRef(false);

  const sessionId = useRef(chatSessionId || `voice_${Date.now()}`).current;
  const { messages, loading, send: chatSend } = useChat({
    sessionId,
    systemPrompt,
    fast: true,
  });

  const spokenIdsRef = useRef<Set<string>>(new Set());

  // Animations
  const spinAnim = useRef(new Animated.Value(0)).current;
  const spinRef = useRef<Animated.CompositeAnimation | null>(null);
  const glowAnim = useRef(new Animated.Value(0.3)).current;
  const glowRef = useRef<Animated.CompositeAnimation | null>(null);

  const spinInterpolate = spinAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  // ── Audio setup ─────────────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      try {
        addLog('Requesting mic permission...');
        const permStatus = await AudioModule.requestRecordingPermissionsAsync();
        addLog(`Permission: ${permStatus.granted ? 'GRANTED' : 'DENIED'}`);
        if (!permStatus.granted) {
          setResponse('Microphone permission required.');
          return;
        }
        if (Platform.OS === 'ios') {
          await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true } as any);
        }
        addLog('Ready.');
        permissionReady.current = true;
        setTimeout(() => {
          setContinuous(true);
          startRecording();
        }, 500);
      } catch (e: any) {
        addLog(`Setup error: ${e?.message}`);
      }
    })();
    return () => {
      spinRef.current?.stop();
      glowRef.current?.stop();
      Speech.stop();
      if (autoStopRef.current) clearTimeout(autoStopRef.current);
      try { if (recorder.isRecording) recorder.stop(); } catch {}
      if (Platform.OS === 'ios') {
        setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true } as any).catch(() => {});
      }
    };
  }, []);

  // ── System prompt ───────────────────────────────────────────────────
  const loadSystemPrompt = useCallback(async () => {
    const base = agentInstructions
      ? `You are "${agentName}" speaking to the user over voice. ${agentInstructions}`
      : 'You are GoFarther AI speaking to the user over voice.';
    const voiceRules = `\n\nVOICE-MODE RULES:\n- Keep every reply under 2 short sentences unless asked for more. No lists, no markdown, no emoji — this will be read aloud.\n- When asked to DO something, emit the action JSON. Never describe what you would do without doing it.\n- After actions complete, give only the key result.`;
    const extras = await buildUserContextPrompt({ terseWhenEmpty: true });
    const connectedApps = await getConnectedApps();
    const appsStr = connectedApps && connectedApps.length > 0
      ? '\n\n=== CONNECTED APPS ===\n' +
        connectedApps.map((app: any) => `- ${app.name} (id: "${app.id}"): ${(app.actions || []).slice(0, 8).join(', ')}`).join('\n')
      : '';
    setSystemPrompt(base + voiceRules + extras + appsStr);
  }, [agentInstructions, agentName]);

  useEffect(() => { loadSystemPrompt(); }, [loadSystemPrompt]);

  // ── State-driven animations ─────────────────────────────────────────
  useEffect(() => {
    // Spinner
    spinRef.current?.stop();
    if (status === 'thinking') {
      spinAnim.setValue(0);
      spinRef.current = Animated.loop(
        Animated.timing(spinAnim, { toValue: 1, duration: 1500, useNativeDriver: true }),
      );
      spinRef.current.start();
    }

    // Glow pulse
    glowRef.current?.stop();
    if (status === 'listening' || status === 'thinking') {
      glowRef.current = Animated.loop(Animated.sequence([
        Animated.timing(glowAnim, { toValue: 0.6, duration: 2000, useNativeDriver: true }),
        Animated.timing(glowAnim, { toValue: 0.25, duration: 2000, useNativeDriver: true }),
      ]));
      glowRef.current.start();
    } else {
      glowAnim.setValue(0.3);
    }
  }, [status]);

  // Fade in text
  const showText = (text: string) => {
    textOpacity.setValue(0);
    setResponse(text);
    Animated.timing(textOpacity, { toValue: 1, duration: 400, useNativeDriver: true }).start();
  };

  // ── Recording ───────────────────────────────────────────────────────
  const startRecording = async () => {
    try {
      tapHaptic();
      addLog('startRecording: preparing...');
      if (autoStopRef.current) { clearTimeout(autoStopRef.current); autoStopRef.current = null; }
      if (Platform.OS === 'ios') {
        await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true } as any);
      }
      await recorder.prepareToRecordAsync();
      addLog('prepared. Calling record()...');
      recorder.record();
      await new Promise(r => setTimeout(r, 200));
      addLog(`isRecording: ${recorder.isRecording}`);
      setStatus('listening');
      setResponse('');
      autoStopRef.current = setTimeout(() => {
        addLog('Auto-stop');
        stopRecording();
      }, 10000);
    } catch (e: any) {
      addLog(`startRecording ERROR: ${e?.message}`);
      setStatus('idle');
      if (continuousRef.current) setTimeout(() => startRecording(), 1000);
    }
  };

  const stopRecording = async (cancel = false) => {
    if (autoStopRef.current) { clearTimeout(autoStopRef.current); autoStopRef.current = null; }
    if (!recorder.isRecording) return;
    try {
      recorder.stop();
      if (cancel) { setStatus('idle'); return; }
      const uri = recorder.uri;
      if (!uri) { setStatus('idle'); return; }
      setStatus('thinking');
      setResponse('');
      const base64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
      addLog(`Base64: ${base64.length}`);
      const result = await transcribeAudio(base64);
      const text = (result.text || result.transcript || '').trim();
      if (!text) {
        setStatus('idle');
        if (continuousRef.current) setTimeout(() => startRecording(), 500);
        return;
      }
      selectionHaptic();
      addLog(`"${text}"`);
      setInput(text);
      await chatSend(text);
    } catch (e: any) {
      addLog(`stop ERROR: ${e?.message}`);
      setStatus('idle');
    }
  };

  // ── TTS on new messages ─────────────────────────────────────────────
  useEffect(() => {
    if (loading) {
      if (status !== 'thinking' && status !== 'speaking') setStatus('thinking');
      return;
    }
    const last = messages[messages.length - 1];
    if (!last || last.role !== 'assistant') return;
    if (spokenIdsRef.current.has(last.id)) return;
    const raw = (last.content || '').trim();
    if (!raw) return;
    spokenIdsRef.current.add(last.id);

    const cleanText = raw
      .replace(/```[\s\S]*?```/g, '').replace(/`([^`]+)`/g, '$1')
      .replace(/\*\*([^*]+)\*\*/g, '$1').replace(/\*([^*]+)\*/g, '$1')
      .replace(/__([^_]+)__/g, '$1').replace(/_([^_]+)_/g, '$1')
      .replace(/^#{1,6}\s+/gm, '').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      .replace(/!\[([^\]]+)\]\([^)]+\)/g, '').replace(/[🟢🔴✅❌✓✗·→]/g, '')
      .replace(/\s+/g, ' ').trim();

    const isPlanResult = /^(Done!|Something went wrong)/.test(raw);
    const toSpeak = isPlanResult
      ? raw.includes('Sent email') ? 'Done. Email sent.'
        : raw.includes('Something went wrong') ? 'Something went wrong.' : 'Done.'
      : cleanText.slice(0, 400);

    showText(toSpeak);
    setStatus('speaking');
    Speech.stop();
    if (Platform.OS === 'ios') {
      setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true } as any).catch(() => {});
    }

    (async () => {
      try {
        const { audio_base64 } = await textToSpeech(toSpeak, voice.ttsVoice || 'nova');
        const tempFile = FileSystem.cacheDirectory + `tts_${Date.now()}.mp3`;
        await FileSystem.writeAsStringAsync(tempFile, audio_base64, { encoding: FileSystem.EncodingType.Base64 });
        const player = createAudioPlayer(tempFile);
        player.play();
        const estimatedMs = Math.max(2000, (toSpeak.length / 5) * (60000 / 150));
        setTimeout(() => {
          try { player.remove(); } catch {}
          setStatus('idle');
          if (continuousRef.current) {
            setTimeout(() => { if (continuousRef.current && !recorder.isRecording) startRecording(); }, 300);
          }
        }, estimatedMs);
      } catch {
        Speech.speak(toSpeak, {
          rate: 0.95, pitch: 1.0,
          onDone: () => { setStatus('idle'); if (continuousRef.current) setTimeout(() => { if (!recorder.isRecording) startRecording(); }, 300); },
          onError: () => setStatus('idle'),
          onStopped: () => setStatus('idle'),
        });
      }
    })();
  }, [messages, loading]);

  // ── Tap handler ─────────────────────────────────────────────────────
  const handleOrbTap = () => {
    tapHaptic();
    if (status === 'speaking') {
      Speech.stop();
      setStatus('idle');
      setTimeout(() => startRecording(), 120);
      setContinuous(true);
      return;
    }
    if (status === 'listening') { stopRecording(); return; }
    if (status === 'thinking') return;
    setContinuous(true);
    startRecording();
  };

  const hangUp = () => {
    Speech.stop();
    if (autoStopRef.current) clearTimeout(autoStopRef.current);
    try { if (recorder.isRecording) recorder.stop(); } catch {}
    setContinuous(false);
    setStatus('idle');
    onClose();
  };

  const isActive = status === 'thinking' || status === 'listening';

  return (
    <View style={[vs.container, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      {/* Floating particles */}
      <FloatingParticles color={voice.color1} active={isActive} />

      {/* Header */}
      <View style={vs.header}>
        <TouchableOpacity onPress={hangUp} style={vs.closeBtn} activeOpacity={0.7}>
          <Ionicons name="close" size={18} color="#fff" />
        </TouchableOpacity>
        <TouchableOpacity style={vs.voiceBadge} onLongPress={() => setShowDebug(!showDebug)} delayLongPress={800}>
          <View style={[vs.badgeDot, { backgroundColor: voice.color1 }]} />
          <Text style={vs.badgeText}>{voice.name}</Text>
          {continuous && <View style={vs.liveDot} />}
        </TouchableOpacity>
        <View style={{ width: 40 }} />
      </View>

      {/* Debug */}
      {showDebug && (
        <ScrollView style={vs.debugPanel}>
          {debugLog.map((line, i) => (
            <Text key={i} style={vs.debugLine}>{line}</Text>
          ))}
        </ScrollView>
      )}

      {/* Center */}
      <View style={vs.center}>
        {/* Response text with fade-in */}
        {response ? (
          <Animated.Text style={[vs.responseText, { opacity: textOpacity }]} numberOfLines={6}>
            {response}
          </Animated.Text>
        ) : null}

        {/* Orb */}
        <TouchableOpacity onPress={handleOrbTap} activeOpacity={0.85} style={vs.orbTouch}>
          {/* Animated glow */}
          <Animated.View style={[vs.orbGlow, {
            width: ORB_SIZE + 60, height: ORB_SIZE + 60, borderRadius: (ORB_SIZE + 60) / 2,
            backgroundColor: voice.color1,
            opacity: glowAnim,
          }]} />

          {/* Thinking spinner ring */}
          {status === 'thinking' && (
            <Animated.View style={[vs.spinnerRing, {
              width: ORB_SIZE + 28, height: ORB_SIZE + 28, borderRadius: (ORB_SIZE + 28) / 2,
              borderTopColor: voice.color1,
              borderRightColor: voice.color2 || voice.color1,
              transform: [{ rotate: spinInterpolate }],
            }]} />
          )}

          {/* Orb body — layered colors to simulate gradient */}
          <View style={[vs.orb, { backgroundColor: voice.color2 || voice.color1 }]}>
            <View style={[StyleSheet.absoluteFill, {
              borderRadius: ORB_SIZE / 2,
              backgroundColor: voice.color1,
              opacity: 0.7,
            }]} />
            <Ionicons
              name={status === 'speaking' ? 'volume-high' : 'mic'}
              size={ORB_SIZE * 0.26}
              color="rgba(255,255,255,0.95)"
            />
          </View>
        </TouchableOpacity>

        {/* Waveform bars */}
        <WaveformBars color={voice.color1} active={status === 'speaking'} />

        {/* Status hint */}
        {status === 'speaking' && <Text style={vs.hint}>Tap to interrupt</Text>}
        {status === 'listening' && <Text style={vs.hint}>Listening...</Text>}
      </View>
    </View>
  );
}

const vs = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0f' },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 12,
  },
  closeBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.1)', alignItems: 'center', justifyContent: 'center',
  },
  voiceBadge: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.08)',
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, gap: 8,
  },
  badgeDot: { width: 8, height: 8, borderRadius: 4 },
  badgeText: { fontSize: 14, fontWeight: '600', color: 'rgba(255,255,255,0.85)' },
  liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#22c55e' },

  debugPanel: {
    maxHeight: 180, backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 12,
    marginHorizontal: 16, marginBottom: 8, padding: 10,
  },
  debugLine: { fontSize: 10, color: '#0f0', fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', lineHeight: 14 },

  center: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 32 },

  responseText: {
    fontSize: 18, color: 'rgba(255,255,255,0.9)', textAlign: 'center',
    lineHeight: 26, marginBottom: 32, maxWidth: 320, fontWeight: '400',
  },

  orbTouch: { alignItems: 'center', justifyContent: 'center', marginBottom: 24 },
  orbGlow: { position: 'absolute' },
  spinnerRing: {
    position: 'absolute', borderWidth: 3,
    borderColor: 'transparent', borderTopWidth: 3, borderRightWidth: 3,
  },
  orb: {
    width: ORB_SIZE, height: ORB_SIZE, borderRadius: ORB_SIZE / 2,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.4, shadowRadius: 20, elevation: 16,
  },

  waveContainer: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    height: 40, gap: 4, marginBottom: 12,
  },
  waveBar: {
    width: 4, height: 32, borderRadius: 2,
  },

  hint: {
    fontSize: 14, color: 'rgba(255,255,255,0.4)', fontWeight: '500',
  },
});
