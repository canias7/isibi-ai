import React, { createContext, useContext, useState, useEffect } from 'react';
import { getThemeMode, saveThemeMode } from './storage';

type ThemeMode = 'light' | 'dark';

export const LIGHT = {
  bg: '#ffffff',
  bg2: '#f5f5f5',
  card: '#f2f2f2',
  border: '#ebebeb',
  text: '#1a1a1a',
  textMid: '#666666',
  textDim: '#999999',
  inputBg: '#f7f7f8',
  surface: '#f8f8f8',
  bubbleAI: '#f7f7f8',
  bubbleBorder: 'transparent',
};

export const DARK = {
  bg: '#0a0a0a',
  bg2: '#111111',
  card: '#1a1a1a',
  border: '#2a2a2a',
  text: '#f2f2f2',
  textMid: '#888888',
  textDim: '#555555',
  inputBg: '#1a1a1a',
  surface: '#141414',
  bubbleAI: '#1a1a1a',
  bubbleBorder: '#2a2a2a',
};

const ThemeContext = createContext<{
  mode: ThemeMode;
  toggle: () => void;
  colors: typeof LIGHT;
}>({
  mode: 'light',
  toggle: () => {},
  colors: LIGHT,
});

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [mode, setMode] = useState<ThemeMode>('light');

  useEffect(() => {
    getThemeMode().then(setMode);
  }, []);

  const toggle = () => {
    const next = mode === 'light' ? 'dark' : 'light';
    setMode(next);
    saveThemeMode(next);
  };

  const colors = mode === 'light' ? LIGHT : DARK;

  return (
    <ThemeContext.Provider value={{ mode, toggle, colors }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
