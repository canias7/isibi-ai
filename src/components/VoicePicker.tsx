import React, { useState, useRef } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, Dimensions,
  ScrollView, NativeSyntheticEvent, NativeScrollEvent,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { C } from '../lib/theme';

const { width: SW } = Dimensions.get('window');
const CIRCLE_SIZE = SW * 0.52;

// Our ElevenLabs voices with visual identity
export interface VoiceOption {
  id: string;
  name: string;
  description: string;
  color1: string;
  color2: string;
  /** OpenAI TTS voice: alloy, echo, fable, onyx, nova, shimmer */
  ttsVoice: string;
}

export const VOICES: VoiceOption[] = [
  { id: 'nova', name: 'Nova', description: 'Warm and friendly', color1: '#ec4899', color2: '#db2777', ttsVoice: 'nova' },
  { id: 'alloy', name: 'Alloy', description: 'Balanced and clear', color1: '#3b82f6', color2: '#1d4ed8', ttsVoice: 'alloy' },
  { id: 'echo', name: 'Echo', description: 'Smooth and deep', color1: '#8b5cf6', color2: '#6d28d9', ttsVoice: 'echo' },
  { id: 'onyx', name: 'Onyx', description: 'Deep and authoritative', color1: '#1a1a1a', color2: '#333333', ttsVoice: 'onyx' },
  { id: 'fable', name: 'Fable', description: 'Expressive and lively', color1: '#f59e0b', color2: '#d97706', ttsVoice: 'fable' },
  { id: 'shimmer', name: 'Shimmer', description: 'Bright and cheerful', color1: '#06b6d4', color2: '#0891b2', ttsVoice: 'shimmer' },
];

interface Props {
  onSelect: (voice: VoiceOption) => void;
  onCancel: () => void;
}

export default function VoicePicker({ onSelect, onCancel }: Props) {
  const [activeIdx, setActiveIdx] = useState(0);
  const insets = useSafeAreaInsets();
  const scrollRef = useRef<ScrollView>(null);

  const handleScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const x = e.nativeEvent.contentOffset.x;
    const idx = Math.round(x / SW);
    if (idx !== activeIdx && idx >= 0 && idx < VOICES.length) {
      setActiveIdx(idx);
    }
  };

  return (
    <View style={[s.container, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={s.header}>
        <TouchableOpacity style={s.cancelBtn} onPress={onCancel} activeOpacity={0.7}>
          <Text style={s.cancelText}>Cancel</Text>
        </TouchableOpacity>
        <Text style={s.title}>Choose a voice</Text>
        <View style={{ width: 80 }} />
      </View>

      {/* Voice cards carousel */}
      <View style={s.carouselWrap}>
        <ScrollView
          ref={scrollRef}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          onMomentumScrollEnd={handleScroll}
          decelerationRate="fast"
          contentContainerStyle={{ alignItems: 'center' }}
        >
          {VOICES.map((voice, i) => (
            <View key={voice.id} style={s.cardPage}>
              <View style={[s.circle, { backgroundColor: voice.color1 }]}>
                <View style={[s.circleInner, { backgroundColor: voice.color2 }]} />
                <View style={s.circleHighlight} />
              </View>
              <Text style={s.voiceName}>{voice.name}</Text>
              <Text style={s.voiceDesc}>{voice.description}</Text>
            </View>
          ))}
        </ScrollView>
      </View>

      {/* Dots */}
      <View style={s.dots}>
        {VOICES.map((_, i) => (
          <View key={i} style={[s.dot, i === activeIdx && s.dotActive]} />
        ))}
      </View>

      {/* Get started button */}
      <View style={[s.bottomArea, { paddingBottom: insets.bottom + 16 }]}>
        <TouchableOpacity style={s.startBtn} onPress={() => onSelect(VOICES[activeIdx])} activeOpacity={0.8}>
          <Text style={s.startText}>Get started</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },

  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 12,
  },
  cancelBtn: { backgroundColor: '#ebebeb', paddingHorizontal: 18, paddingVertical: 10, borderRadius: 20 },
  cancelText: { fontSize: 15, fontWeight: '500', color: '#1a1a1a' },
  title: { fontSize: 17, fontWeight: '600', color: '#1a1a1a' },

  carouselWrap: { flex: 1, justifyContent: 'center' },
  cardPage: { width: SW, alignItems: 'center', justifyContent: 'center' },

  circle: {
    width: CIRCLE_SIZE, height: CIRCLE_SIZE, borderRadius: CIRCLE_SIZE / 2,
    alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
    marginBottom: 24,
  },
  circleInner: {
    width: CIRCLE_SIZE * 0.7, height: CIRCLE_SIZE * 0.7, borderRadius: CIRCLE_SIZE * 0.35,
    opacity: 0.6,
  },
  circleHighlight: {
    position: 'absolute', top: CIRCLE_SIZE * 0.15, left: CIRCLE_SIZE * 0.2,
    width: CIRCLE_SIZE * 0.35, height: CIRCLE_SIZE * 0.25,
    borderRadius: CIRCLE_SIZE * 0.2,
    backgroundColor: 'rgba(255,255,255,0.3)',
    transform: [{ rotate: '-20deg' }],
  },

  voiceName: { fontSize: 24, fontWeight: '700', color: '#1a1a1a', marginBottom: 4 },
  voiceDesc: { fontSize: 15, color: '#888' },

  dots: { flexDirection: 'row', justifyContent: 'center', gap: 6, paddingVertical: 16 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#d0d0d0' },
  dotActive: { backgroundColor: '#1a1a1a' },

  bottomArea: { paddingHorizontal: 20 },
  startBtn: {
    backgroundColor: '#1a1a1a', borderRadius: 28, height: 56,
    alignItems: 'center', justifyContent: 'center',
  },
  startText: { fontSize: 16, fontWeight: '600', color: '#ffffff' },
});
