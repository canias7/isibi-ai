import { useEffect } from "react";

interface Shortcut {
  key: string;
  ctrl?: boolean;
  meta?: boolean; // Cmd on Mac
  shift?: boolean;
  action: () => void;
  description: string;
}

export function useKeyboardShortcuts(shortcuts: Shortcut[]) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Don't trigger shortcuts when typing in inputs (except for meta/ctrl combos)
      const target = e.target as HTMLElement;
      const isInput = target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT";

      for (const s of shortcuts) {
        const metaMatch = s.meta ? e.metaKey : !e.metaKey;
        const ctrlMatch = s.ctrl ? e.ctrlKey : !e.ctrlKey;
        const shiftMatch = s.shift ? e.shiftKey : !e.shiftKey;

        if (e.key.toLowerCase() === s.key.toLowerCase() && metaMatch && ctrlMatch && shiftMatch) {
          // Allow meta/ctrl combos even in inputs, but block plain keys in inputs
          if (isInput && !s.meta && !s.ctrl) continue;
          e.preventDefault();
          s.action();
          break;
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [shortcuts]);
}
