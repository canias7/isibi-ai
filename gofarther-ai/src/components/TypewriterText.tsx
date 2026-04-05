import React, { useState, useEffect, useRef } from 'react';
import { Text } from 'react-native';

interface Props {
  text: string;
  speed?: number; // ms per word
  style?: any;
  onDone?: () => void;
}

/** Reveals text word by word for a typing effect */
export default function TypewriterText({ text, speed = 30, style, onDone }: Props) {
  const [visibleCount, setVisibleCount] = useState(0);
  const words = text.split(' ');
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    setVisibleCount(0);
    timerRef.current = setInterval(() => {
      setVisibleCount(prev => {
        if (prev >= words.length) {
          if (timerRef.current) clearInterval(timerRef.current);
          onDone?.();
          return prev;
        }
        return prev + 1;
      });
    }, speed);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [text]);

  const visible = words.slice(0, visibleCount).join(' ');

  return <Text style={style}>{visible}</Text>;
}
