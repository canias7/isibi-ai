import { useEffect, useRef, useState } from 'react';

// Does this user prefer no animation? (Live check — cheap, and Settings-level
// changes mid-session are rare enough not to warrant a listener.)
export function reducedMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

// Animated dismissal for conditionally-rendered dialogs/sheets/screens.
// React unmounts immediately on close, which is why nothing in the app used to
// animate OUT. This keeps the element mounted for one exit beat:
//
//   const sheet = useDismiss(open);
//   {sheet.mounted && <div className={`sheet ${sheet.closing ? 'closing' : ''}`}>…
//
// CSS pairs an entrance animation with a `.closing` exit animation (fill:
// forwards, so the final frame holds until the unmount). The exit beat is
// skipped entirely for Reduce Motion users — close stays instant for them.
// `ms` should be a touch longer than the exit animation so its last frame
// isn't clipped (default pairs with --dur-exit: 170ms).
export function useDismiss(open: boolean, ms = 200): { mounted: boolean; closing: boolean } {
  const [state, setState] = useState<'open' | 'closing' | 'closed'>(open ? 'open' : 'closed');
  const timer = useRef<number | null>(null);
  useEffect(() => {
    if (open) {
      if (timer.current) { clearTimeout(timer.current); timer.current = null; }
      setState('open');
      return;
    }
    setState((s) => (s === 'open' ? 'closing' : s));
    const wait = reducedMotion() ? 0 : ms;
    timer.current = window.setTimeout(() => { timer.current = null; setState('closed'); }, wait);
    return () => { if (timer.current) { clearTimeout(timer.current); timer.current = null; } };
  }, [open, ms]);
  return { mounted: state !== 'closed', closing: state === 'closing' };
}
