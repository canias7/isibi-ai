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
  bg: '#000000',
  bg2: '#0a0a0a',
  card: '#1c1c1e',
  border: '#2c2c2e',
  text: '#f5f5f7',
  textMid: '#98989f',
  textDim: '#636366',
  inputBg: '#1c1c1e',
  surface: '#141414',
  bubbleAI: '#1c1c1e',
  bubbleBorder: '#2c2c2e',
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
