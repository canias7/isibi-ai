import { useEffect, useRef, useState } from 'react';
import { reducedMotion } from './motion';

// Split the pool into sets of 3; pad a short final set by wrapping from the
// start so every set is full.
function chunk3(pool: string[]): string[][] {
  if (!pool.length) return [['', '', '']];
  const out: string[][] = [];
  for (let i = 0; i < pool.length; i += 3) {
    const g = pool.slice(i, i + 3);
    while (g.length < 3) g.push(pool[g.length % pool.length] ?? '');
    out.push(g);
  }
  return out;
}

export interface TypedSuggestions {
  typed: string[]; // what to display per chip (partial while typing)
  full: string[];  // the complete prompt per chip (what a tap should send)
  cursor: number;  // chip index currently animating (for the caret), or -1
}

// Home suggestions that feel alive: each chip types in letter-by-letter, one
// after another; the set holds for 5s; then erases and the next set of 3 types
// in. Static (full text, no caret) under prefers-reduced-motion or when the home
// isn't visible. A chip is only shown by the caller once it has content, so they
// genuinely come and go one at a time.
export function useTypedSuggestions(pool: string[], active: boolean): TypedSuggestions {
  const key = pool.join('|');
  const setsRef = useRef<string[][]>([['', '', '']]);
  setsRef.current = chunk3(pool);
  const [full, setFull] = useState<string[]>(() => setsRef.current[0]);
  const [typed, setTyped] = useState<string[]>(() => setsRef.current[0]);
  const [cursor, setCursor] = useState(-1);

  useEffect(() => {
    const sets = setsRef.current;
    if (!active || reducedMotion()) {
      setFull(sets[0]); setTyped(sets[0]); setCursor(-1);
      return;
    }
    let cancelled = false;
    let timer: number | undefined;
    const st = { set: 0, chip: 0, len: 0, mode: 'type' as 'type' | 'hold' | 'erase' };
    setFull(sets[0]); setTyped(['', '', '']); setCursor(0);
    const after = (ms: number, fn: () => void) => { timer = window.setTimeout(() => { if (!cancelled) fn(); }, ms); };

    function tick() {
      const all = setsRef.current;
      const cur = all[st.set % all.length] ?? ['', '', ''];
      if (st.mode === 'type') {
        const target = cur[st.chip] ?? '';
        setCursor(st.chip);
        if (st.len < target.length) {
          st.len += 1;
          setTyped((t) => { const n = [...t]; n[st.chip] = target.slice(0, st.len); return n; });
          after(34, tick); // ~30 chars/sec
        } else if (st.chip < 2) {
          st.chip += 1; st.len = 0; after(180, tick); // brief beat, then the next chip
        } else {
          st.mode = 'hold'; setCursor(-1); after(5000, tick); // all 3 in → wait 5s
        }
      } else if (st.mode === 'hold') {
        st.mode = 'erase'; st.chip = 2; st.len = (cur[2] ?? '').length; after(60, tick);
      } else { // erase last → first, then advance to the next set
        if (st.len > 0) {
          setCursor(st.chip);
          st.len -= 1;
          setTyped((t) => { const n = [...t]; n[st.chip] = (cur[st.chip] ?? '').slice(0, st.len); return n; });
          after(15, tick); // erase faster than typing
        } else if (st.chip > 0) {
          st.chip -= 1; st.len = (cur[st.chip] ?? '').length; setCursor(st.chip); after(50, tick);
        } else {
          st.set += 1; st.chip = 0; st.len = 0; st.mode = 'type';
          setFull(all[st.set % all.length] ?? ['', '', '']);
          setCursor(0);
          after(220, tick);
        }
      }
    }
    after(450, tick);
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, [key, active]);

  return { typed, full, cursor };
}
