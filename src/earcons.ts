import { getCtx } from './voice';

// Earcons — the app's tiny sound vocabulary, paired with the haptics:
//   sent  — your message just went out
//   reply — the assistant finished a reply
// Four selectable styles (Settings → Sound style), all synthesized through the
// shared Web Audio context — no audio assets to ship OTA. Kept quiet; the
// webview's ambient audio session respects the iPhone silent switch.

const KEY = 'gf_sounds';
const THEME_KEY = 'gf_sound_theme';

export function soundsOn(): boolean {
  try { return localStorage.getItem(KEY) !== '0'; } catch { return true; }
}
export function setSoundsOn(on: boolean): void {
  try { localStorage.setItem(KEY, on ? '1' : '0'); } catch { /* private mode — fine */ }
}

export type SoundTheme = 'chime' | 'pop' | 'glass' | 'drop';
export const THEMES: Array<{ id: SoundTheme; label: string }> = [
  { id: 'chime', label: 'Chime' },
  { id: 'pop', label: 'Pop' },
  { id: 'glass', label: 'Glass' },
  { id: 'drop', label: 'Drop' },
];

export function soundTheme(): SoundTheme {
  try {
    const t = localStorage.getItem(THEME_KEY);
    return THEMES.some((x) => x.id === t) ? (t as SoundTheme) : 'chime';
  } catch {
    return 'chime';
  }
}
export function setSoundTheme(t: SoundTheme): void {
  try { localStorage.setItem(THEME_KEY, t); } catch { /* private mode — fine */ }
}

// One note with a click-free envelope (fast attack, exponential tail), an
// optional downward/upward pitch glide, and an optional overtone partial —
// enough vocabulary for bells, pops, and woody hits without any samples.
interface Tone {
  f: number;       // start frequency (Hz)
  at: number;      // start offset (s)
  dur: number;     // length (s)
  type?: OscillatorType;
  glideTo?: number;     // glide to this frequency over the duration
  partial?: number;     // overtone multiplier (e.g. 2 = octave, 2.76 = bell)
  partialGain?: number; // overtone level relative to the main tone
}

function note(ctx: AudioContext, t: Tone, peak: number): void {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = t.type ?? 'sine';
  const start = ctx.currentTime + t.at;
  osc.frequency.setValueAtTime(t.f, start);
  if (t.glideTo) osc.frequency.exponentialRampToValueAtTime(t.glideTo, start + t.dur);
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.linearRampToValueAtTime(peak, start + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + t.dur);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(start);
  osc.stop(start + t.dur + 0.02);
  if (t.partial && t.partialGain) {
    note(ctx, { ...t, f: t.f * t.partial, glideTo: t.glideTo ? t.glideTo * t.partial : undefined, partial: undefined }, peak * t.partialGain);
  }
}

// Each style's sent/reply sequences, tuned to feel like one family per style.
const BANK: Record<SoundTheme, { sent: Tone[]; reply: Tone[]; peak: number }> = {
  // Soft two-note bell — a fifth up to "send", a warm resolve on reply.
  chime: {
    sent: [{ f: 784, at: 0, dur: 0.16, partial: 2, partialGain: 0.22 }, { f: 1174.7, at: 0.07, dur: 0.2, partial: 2, partialGain: 0.18 }],
    reply: [{ f: 659.25, at: 0, dur: 0.2, partial: 2, partialGain: 0.2 }, { f: 987.77, at: 0.12, dur: 0.3, partial: 2, partialGain: 0.16 }],
    peak: 0.1,
  },
  // Quick percussive blips with a downward glide — playful, very short.
  pop: {
    sent: [{ f: 640, at: 0, dur: 0.07, type: 'triangle', glideTo: 340 }],
    reply: [{ f: 520, at: 0, dur: 0.07, type: 'triangle', glideTo: 280 }, { f: 740, at: 0.09, dur: 0.09, type: 'triangle', glideTo: 420 }],
    peak: 0.16,
  },
  // Glassy strikes with a bell-like inharmonic overtone and long tails.
  glass: {
    sent: [{ f: 1318.5, at: 0, dur: 0.28, partial: 2.76, partialGain: 0.12 }],
    reply: [{ f: 1046.5, at: 0, dur: 0.3, partial: 2.76, partialGain: 0.12 }, { f: 1568, at: 0.14, dur: 0.38, partial: 2.76, partialGain: 0.1 }],
    peak: 0.09,
  },
  // Low, woody taps — marimba-ish, unobtrusive.
  drop: {
    sent: [{ f: 392, at: 0, dur: 0.12, partial: 4, partialGain: 0.08 }],
    reply: [{ f: 392, at: 0, dur: 0.12, partial: 4, partialGain: 0.08 }, { f: 587.33, at: 0.1, dur: 0.16, partial: 4, partialGain: 0.07 }],
    peak: 0.13,
  },
};

function play(kind: 'sent' | 'reply'): void {
  if (!soundsOn()) return;
  try {
    const { [kind]: seq, peak } = BANK[soundTheme()];
    const ctx = getCtx();
    const fire = () => { for (const t of seq) note(ctx, t, peak); };
    if (ctx.state === 'running') { fire(); return; }
    // Audio still locked (no gesture yet): try to resume, but never queue tones
    // against a suspended clock — they'd all burst out at once when something
    // else (e.g. starting a call) finally unlocks audio. The staleness check
    // drops the tone instead if the unlock comes late.
    const asked = Date.now();
    void ctx.resume().then(() => {
      if (ctx.state === 'running' && Date.now() - asked < 2000) fire();
    }).catch(() => {});
  } catch { /* no Web Audio in this webview — earcons are a silent no-op */ }
}

export const sentSound = (): void => play('sent');
export const replySound = (): void => play('reply');
