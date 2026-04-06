import React, { useState, useRef } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, Dimensions, ScrollView,
  NativeSyntheticEvent, NativeScrollEvent,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { setOnboardingComplete } from '../lib/storage';

const { width: SW } = Dimensions.get('window');

const SLIDES = [
  {
    icon: 'chatbubbles-outline',
    title: 'Your AI, everywhere',
    subtitle: 'Make calls, send texts, create files, search the web — all from a simple conversation.',
    bg: '#f0f0f0',
    iconColor: '#1a1a1a',
  },
  {
    icon: 'document-text-outline',
    title: 'Create anything',
    subtitle: 'PDFs, spreadsheets, Word docs, resumes, invoices — just describe what you need.',
    bg: '#e8f4fd',
    iconColor: '#3b82f6',
  },
  {
    icon: 'mic-outline',
    title: 'Talk naturally',
    subtitle: 'Voice mode lets you have real conversations with your AI assistant.',
    bg: '#f0fdf4',
    iconColor: '#22c55e',
  },
  {
    icon: 'sparkles-outline',
    title: 'Gets smarter',
    subtitle: 'It remembers your preferences and gets better the more you use it.',
    bg: '#fef3c7',
    iconColor: '#f59e0b',
  },
];

export default function OnboardingScreen({ onComplete }: { onComplete: () => void }) {
  const [activeIdx, setActiveIdx] = useState(0);
  const insets = useSafeAreaInsets();
  const scrollRef = useRef<ScrollView>(null);

  const handleScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const idx = Math.round(e.nativeEvent.contentOffset.x / SW);
    if (idx !== activeIdx && idx >= 0 && idx < SLIDES.length) {
      setActiveIdx(idx);
    }
  };

  const handleNext = () => {
    if (activeIdx < SLIDES.length - 1) {
      scrollRef.current?.scrollTo({ x: SW * (activeIdx + 1), animated: true });
    } else {
      finish();
    }
  };

  const finish = async () => {
    await setOnboardingComplete();
    onComplete();
  };

  const isLast = activeIdx === SLIDES.length - 1;

  return (
    <View style={[s.container, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      {/* Skip */}
      <View style={s.topRow}>
        <Text style={s.logo}>GoFarther</Text>
        {!isLast && (
          <TouchableOpacity onPress={finish} activeOpacity={0.7}>
            <Text style={s.skipText}>Skip</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Slides */}
      <ScrollView
        ref={scrollRef}
        horizontal pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={handleScroll}
        decelerationRate="fast"
      >
        {SLIDES.map((slide, i) => (
          <View key={i} style={s.slide}>
            <View style={[s.iconCircle, { backgroundColor: slide.bg }]}>
              <Ionicons name={slide.icon as any} size={48} color={slide.iconColor} />
            </View>
            <Text style={s.slideTitle}>{slide.title}</Text>
            <Text style={s.slideSub}>{slide.subtitle}</Text>
          </View>
        ))}
      </ScrollView>

      {/* Dots + Button */}
      <View style={s.bottomArea}>
        <View style={s.dots}>
          {SLIDES.map((_, i) => (
            <View key={i} style={[s.dot, i === activeIdx && s.dotActive]} />
          ))}
        </View>

        <TouchableOpacity style={s.nextBtn} onPress={handleNext} activeOpacity={0.8}>
          <Text style={s.nextText}>{isLast ? 'Get started' : 'Next'}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#ffffff' },
  topRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 24, paddingVertical: 16 },
  logo: { fontSize: 20, fontWeight: '700', color: '#1a1a1a', letterSpacing: -0.5 },
  skipText: { fontSize: 16, color: '#999', fontWeight: '500' },

  slide: { width: SW, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 48 },
  iconCircle: { width: 120, height: 120, borderRadius: 60, alignItems: 'center', justifyContent: 'center', marginBottom: 48 },
  slideTitle: { fontSize: 32, fontWeight: '800', color: '#1a1a1a', textAlign: 'center', marginBottom: 16, letterSpacing: -0.5 },
  slideSub: { fontSize: 17, color: '#666', textAlign: 'center', lineHeight: 26 },

  bottomArea: { paddingHorizontal: 24, paddingBottom: 24 },
  dots: { flexDirection: 'row', justifyContent: 'center', gap: 8, marginBottom: 28 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#e0e0e0' },
  dotActive: { backgroundColor: '#1a1a1a', width: 28, borderRadius: 4 },
  nextBtn: { backgroundColor: '#1a1a1a', borderRadius: 16, height: 56, alignItems: 'center', justifyContent: 'center' },
  nextText: { fontSize: 17, fontWeight: '600', color: '#ffffff' },
});
