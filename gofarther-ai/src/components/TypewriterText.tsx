import React, { useState, useEffect, useRef } from 'react';
import { Text, View, StyleSheet, Platform } from 'react-native';

interface Props {
  text: string;
  speed?: number; // ms per character
  style?: any;
  onDone?: () => void;
}

/** Reveals text character by character with a blinking cursor */
export default function TypewriterText({ text, speed = 12, style, onDone }: Props) {
  const [charCount, setCharCount] = useState(0);
  const [showCursor, setShowCursor] = useState(true);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const cursorRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const doneRef = useRef(false);

  useEffect(() => {
    setCharCount(0);
    doneRef.current = false;

    // Character reveal timer
    timerRef.current = setInterval(() => {
      setCharCount(prev => {
        const next = prev + 1;
        if (next >= text.length) {
          if (timerRef.current) clearInterval(timerRef.current);
          if (!doneRef.current) {
            doneRef.current = true;
            setTimeout(() => onDone?.(), 200);
          }
          return text.length;
        }
        return next;
      });
    }, speed);

    // Blinking cursor
    cursorRef.current = setInterval(() => {
      setShowCursor(prev => !prev);
    }, 500);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (cursorRef.current) clearInterval(cursorRef.current);
    };
  }, [text]);

  const visible = text.slice(0, charCount);
  const isDone = charCount >= text.length;

  return (
    <Text style={style}>
      {visible}
      {!isDone && <Text style={[style, { opacity: showCursor ? 1 : 0 }]}>{'\u258C'}</Text>}
    </Text>
  );
}
