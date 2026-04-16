/**
 * Inactivity timeout hook — auto-logout after 30 minutes of no activity.
 * Tracks foreground inactivity and background duration.
 * SOC 2 compliance: session timeout control.
 */

import { useEffect, useRef, useCallback } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import * as SecureStore from 'expo-secure-store';

const TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes
const LAST_ACTIVE_KEY = 'last_active_ts';

export function useInactivityTimeout(onTimeout: () => void) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const resetTimer = useCallback(() => {
    clearTimer();
    // Store current timestamp for background check
    SecureStore.setItemAsync(LAST_ACTIVE_KEY, String(Date.now())).catch(() => {});
    timerRef.current = setTimeout(() => {
      onTimeout();
    }, TIMEOUT_MS);
  }, [clearTimer, onTimeout]);

  useEffect(() => {
    // Start timer on mount
    resetTimer();

    // Handle app state changes (background/foreground)
    const subscription = AppState.addEventListener('change', async (nextState: AppStateStatus) => {
      if (appStateRef.current.match(/inactive|background/) && nextState === 'active') {
        // App came to foreground — check elapsed time
        try {
          const stored = await SecureStore.getItemAsync(LAST_ACTIVE_KEY);
          if (stored) {
            const elapsed = Date.now() - parseInt(stored, 10);
            if (elapsed >= TIMEOUT_MS) {
              onTimeout();
              return;
            }
          }
        } catch {}
        resetTimer();
      } else if (nextState.match(/inactive|background/)) {
        // Going to background — save timestamp, clear foreground timer
        clearTimer();
        SecureStore.setItemAsync(LAST_ACTIVE_KEY, String(Date.now())).catch(() => {});
      }
      appStateRef.current = nextState;
    });

    return () => {
      clearTimer();
      subscription.remove();
    };
  }, [resetTimer, clearTimer, onTimeout]);

  return { resetTimer };
}
