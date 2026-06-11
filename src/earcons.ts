import { getCtx } from './voice';

// Earcons — the app's tiny sound vocabulary, paired with the haptics:
//   sent  (soft rising blip)  — your message just went out
//   reply (gentle two notes)  — the assistant finished a reply
// Tones are synthesized through the shared Web Audio context (no audio assets
// to ship OTA), kept very quiet, and switchable off in Settings. The webview's
// ambient audio session respects the iPhone silent switch, so muting the phone
// mutes these too.

const KEY = 'gf_sounds';

export function soundsOn(): boolean {
  try { return localStorage.getItem(KEY) !== '0'; } catch { return true; }
}
export function setSoundsOn(on: boolean): void {
  try { localStorage.setItem(KEY, on ? '1' : '0'); } catch { /* private mode — fine */ }
}

// One short sine note with a click-free envelope (fast attack, exponential tail).
function note(ctx: AudioContext, freq: number, at: number, dur: number, peak: number): void {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.value = freq;
  const t = ctx.currentTime + at;
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.linearRampToValueAtTime(peak, t + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

// seq: [frequency Hz, start offset s, duration s][]
function play(seq: Array<[number, number, number]>, peak: number): void {
  if (!soundsOn()) return;
  try {
    const ctx = getCtx();
    const fire = () => { for (const [f, at, d] of seq) note(ctx, f, at, d, peak); };
    if (ctx.state === 'running') { fire(); return; }
    // Audio still locked (no gesture yet): try to resume, but never queue tones
    // against a suspended clock — they'd all burst out at once when something
    // else (e.g. starting a call) finally unlocks audio. The staleness check
    // drops the tone instead if the unlock comes late.
    const asked = Date.now();
    void getCtx().resume().then(() => {
      if (ctx.state === 'running' && Date.now() - asked < 2000) fire();
    }).catch(() => {});
  } catch { /* no Web Audio in this webview — earcons are a silent no-op */ }
}

// F#5 -> B5: a quick upward "off it goes".
export const sentSound = (): void => play([[740, 0, 0.1], [988, 0.05, 0.12]], 0.05);
// C5 -> G5: a soft, resolved "it's here".
export const replySound = (): void => play([[523.25, 0, 0.14], [783.99, 0.1, 0.22]], 0.055);
