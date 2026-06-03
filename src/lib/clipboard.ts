/**
 * Secure clipboard utility — auto-clears clipboard after a delay.
 */

import * as Clipboard from 'expo-clipboard';

let _clearTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Copy text to clipboard and automatically clear it after the specified delay.
 * @param text - Text to copy
 * @param delayMs - Auto-clear delay in milliseconds (default: 30 seconds)
 */
export async function copyWithAutoClear(text: string, delayMs: number = 30000): Promise<void> {
  await Clipboard.setStringAsync(text);

  // Clear any existing timer
  if (_clearTimer) {
    clearTimeout(_clearTimer);
  }

  // Schedule clipboard clear
  _clearTimer = setTimeout(async () => {
    try {
      await Clipboard.setStringAsync('');
    } catch {}
    _clearTimer = null;
  }, delayMs);
}

/**
 * Immediately clear the clipboard.
 */
export async function clearClipboard(): Promise<void> {
  if (_clearTimer) {
    clearTimeout(_clearTimer);
    _clearTimer = null;
  }
  try {
    await Clipboard.setStringAsync('');
  } catch {}
}
