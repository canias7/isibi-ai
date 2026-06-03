import React, { useState, useEffect, useRef } from 'react';
import { Text, Animated } from 'react-native';

interface Props {
  text: string;
  speed?: number;
  style?: any;
  onDone?: () => void;
}

/** Fast character-by-character reveal with fade-in chunks and pulsing cursor */
export default function TypewriterText({ text, speed = 6, style, onDone }: Props) {
  const [charCount, setCharCount] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const doneRef = useRef(false);
  const cursorOpacity = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (!text || text.length === 0) return;

    setCharCount(0);
    doneRef.current = false;

    // Blinking cursor animation
    const cursorAnim = Animated.loop(
      Animated.sequence([
        Animated.timing(cursorOpacity, { toValue: 0, duration: 400, useNativeDriver: true }),
        Animated.timing(cursorOpacity, { toValue: 1, duration: 400, useNativeDriver: true }),
      ])
    );
    cursorAnim.start();

    // Fast character reveal — burst 2-3 chars at a time for speed
    timerRef.current = setInterval(() => {
      setCharCount(prev => {
        const burst = Math.random() > 0.3 ? 3 : 2; // variable burst for natural feel
        const next = Math.min(prev + burst, text.length);
        if (next >= text.length) {
          if (timerRef.current) clearInterval(timerRef.current);
          cursorAnim.stop();
          if (!doneRef.current) {
            doneRef.current = true;
            setTimeout(() => onDone?.(), 150);
          }
          return text.length;
        }
        return next;
      });
    }, speed);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      cursorAnim.stop();
    };
  }, [text]);

  const visible = text.slice(0, charCount);
  const isDone = charCount >= text.length;

  return (
    <Text style={style}>
      {visible}
      {!isDone && (
        <Animated.Text style={[style, { opacity: cursorOpacity, color: '#3b82f6' }]}>
          {'\u2588'}
        </Animated.Text>
      )}
    </Text>
  );
}
