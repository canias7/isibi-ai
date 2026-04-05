import React, { useState, useRef } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, Dimensions, ScrollView,
  NativeSyntheticEvent, NativeScrollEvent, Animated,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { setOnboardingComplete } from '../lib/storage';
import { C } from '../lib/theme';

const { width: SW } = Dimensions.get('window');

const SLIDES = [
  {
    title: 'Your AI, everywhere',
    subtitle: 'GoFarther AI is your personal assistant that can make calls, send texts, write emails, and more.',
    color: C.primary,
  },
  {
    title: 'Custom agents',
    subtitle: 'Create agents with unique personalities and skills. Send them to work on tasks for you.',
    color: '#8b5cf6',
  },
  {
    title: 'Voice mode',
    subtitle: 'Talk naturally with your AI. Choose from multiple voices and have real conversations.',
    color: '#3b82f6',
  },
  {
    title: 'It remembers you',
    subtitle: 'Your AI learns your preferences across chats. The more you use it, the better it gets.',
    color: '#22c55e',
  },
];

export default function OnboardingScreen({ onComplete }: { onComplete: () => void }) {
  const [activeIdx, setActiveIdx] = useState(0);
  const insets = useSafeAreaInsets();
  const scrollRef = useRef<ScrollView>(null);
  const fadeAnims = useRef(SLIDES.map(() => new Animated.Value(0))).current;

  const handleScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const idx = Math.round(e.nativeEvent.contentOffset.x / SW);
    if (idx !== activeIdx && idx >= 0 && idx < SLIDES.length) {
      setActiveIdx(idx);
      Animated.timing(fadeAnims[idx], { toValue: 1, duration: 400, useNativeDriver: true }).start();
    }
  };

  React.useEffect(() => {
    Animated.timing(fadeAnims[0], { toValue: 1, duration: 600, useNativeDriver: true }).start();
  }, []);

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
        <View />
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
            <View style={[s.orbWrap]}>
              <View style={[s.orb, { backgroundColor: slide.color + '20' }]}>
                <View style={[s.orbInner, { backgroundColor: slide.color }]} />
              </View>
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
  topRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 12 },
  skipText: { fontSize: 15, color: '#999', fontWeight: '500' },

  slide: { width: SW, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 40 },
  orbWrap: { marginBottom: 40 },
  orb: { width: 140, height: 140, borderRadius: 70, alignItems: 'center', justifyContent: 'center' },
  orbInner: { width: 80, height: 80, borderRadius: 40 },
  slideTitle: { fontSize: 28, fontWeight: '800', color: '#1a1a1a', textAlign: 'center', marginBottom: 12 },
  slideSub: { fontSize: 16, color: '#666', textAlign: 'center', lineHeight: 24 },

  bottomArea: { paddingHorizontal: 20, paddingBottom: 20 },
  dots: { flexDirection: 'row', justifyContent: 'center', gap: 8, marginBottom: 24 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#ddd' },
  dotActive: { backgroundColor: '#1a1a1a', width: 24 },
  nextBtn: { backgroundColor: '#1a1a1a', borderRadius: 28, height: 56, alignItems: 'center', justifyContent: 'center' },
  nextText: { fontSize: 16, fontWeight: '600', color: '#ffffff' },
});
