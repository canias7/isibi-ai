import { supabase, SUPABASE_ANON_KEY } from './supabase';

// Voice I/O for "call mode". Deliberately built on Web APIs only — getUserMedia
// (mic), AudioContext (capture + silence detection), and speechSynthesis (the
// voice) — so there's no native plugin to re-bump for each Capacitor release.
// The single native requirement is the microphone-permission string. Speech is
// transcribed by Whisper in the `transcribe` edge function (the OpenAI key lives
// only on the server); replies are spoken with the device's built-in voices.

const TRANSCRIBE_API =
  (import.meta.env.VITE_TRANSCRIBE_API as string | undefined) ??
  'https://lkpfeqrelvziltfwpuxi.supabase.co/functions/v1/transcribe';

// ---- Shared audio context (iOS "must start in a user gesture" rule) ----

let sharedCtx: AudioContext | null = null;
function audioCtxCtor(): typeof AudioContext {
  const w = window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext };
  return (w.AudioContext || w.webkitAudioContext) as typeof AudioContext;
}
// Exported because earcons.ts plays its tones through this same context — one
// AudioContext for the whole app means one iOS gesture-unlock covers both.
export function getCtx(): AudioContext {
  if (sharedCtx && sharedCtx.state !== 'closed') return sharedCtx;
  sharedCtx = new (audioCtxCtor())();
  return sharedCtx;
}

// Call this SYNCHRONOUSLY inside the tap that starts a call. iOS only lets audio
// (both mic capture and speech) begin from a user gesture, so we resume the
// context and prime speech here while the gesture is still "live".
export async function primeAudio(): Promise<void> {
  resumeAudio(); // unlock output (silent-buffer trick) inside the gesture
  try {
    const ctx = getCtx();
    if (ctx.state === 'suspended') await ctx.resume();
  } catch { /* best effort */ }
  try {
    const u = new SpeechSynthesisUtterance(' ');
    u.volume = 0;
    window.speechSynthesis.speak(u);
  } catch { /* best effort */ }
}

// Unlock + resume the shared context inside a user gesture. Calling resume()
// alone is NOT enough on iOS WKWebView — output stays muted until an actual
// source node has been started from a gesture. So we also start one 1-sample
// silent buffer (the canonical iOS unlock). Only runs while the context isn't
// already running, so it's cheap on the happy path and re-unlocks after a
// background/suspend. Must be called synchronously from the gesture.
export function resumeAudio(): void {
  try {
    const ctx = getCtx();
    if (ctx.state === 'running') return;
    void ctx.resume();
    const src = ctx.createBufferSource();
    src.buffer = ctx.createBuffer(1, 1, 22050);
    src.connect(ctx.destination);
    src.start(0);
  } catch { /* best effort */ }
}

// Current output state for a user-facing diagnostic: 'running' should be
// audible; 'suspended' = locked; 'unavailable' = no Web Audio in this webview.
export function audioState(): string {
  try {
    const w = window as unknown as { AudioContext?: unknown; webkitAudioContext?: unknown };
    if (!(w.AudioContext || w.webkitAudioContext)) return 'unavailable';
    return getCtx().state;
  } catch {
    return 'unavailable';
  }
}

export function closeAudio(): void {
  try { sharedCtx?.close(); } catch { /* */ }
  sharedCtx = null;
}

export function micSupported(): boolean {
  const w = window as unknown as { AudioContext?: unknown; webkitAudioContext?: unknown };
  const hasMic = !!navigator.mediaDevices && typeof navigator.mediaDevices.getUserMedia === 'function';
  return hasMic && !!(w.AudioContext || w.webkitAudioContext);
}

// ---- Recording one spoken turn, ending on silence (hands-free) ----

export interface ListenOpts {
  signal?: AbortSignal;       // abort = CANCEL: discard whatever was captured
  finishSignal?: AbortSignal; // abort = STOP EARLY: keep + return what was captured
  silenceMs?: number;      // quiet (after speech) that ends the turn
  maxMs?: number;          // hard cap on one utterance
  startTimeoutMs?: number; // give up if no speech ever starts
  onLevel?: (level: number) => void; // 0..1 live mic level for the UI orb
}

// Capture one utterance as a 16 kHz mono WAV, or null if the user never spoke
// (so the caller can keep waiting). Ends automatically on a stretch of silence —
// no per-turn button press.
export async function listenOnce(opts: ListenOpts = {}): Promise<Blob | null> {
  const { signal, finishSignal, silenceMs = 1100, maxMs = 20000, startTimeoutMs = 8000, onLevel } = opts;
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  });
  const ctx = getCtx();
  if (ctx.state === 'suspended') { try { await ctx.resume(); } catch { /* */ } }

  const source = ctx.createMediaStreamSource(stream);
  const processor = ctx.createScriptProcessor(4096, 1, 1);
  // Route through a muted gain so onaudioprocess fires without playing the mic
  // back through the speaker (no echo/feedback).
  const mute = ctx.createGain();
  mute.gain.value = 0;

  const chunks: Float32Array[] = [];
  // Rolling pre-roll (~0.5s): kept while waiting so the first syllable isn't
  // clipped — speech is only DETECTED mid-word, but we prepend what came before.
  const preroll: Float32Array[] = [];
  const PREROLL_CHUNKS = 6;
  const inRate = ctx.sampleRate;
  const SPEECH = 0.015; // RMS above this counts as speech
  let started = false;
  let lastVoice = 0;
  const t0 = Date.now();

  return await new Promise<Blob | null>((resolve) => {
    let done = false;
    const cleanup = () => {
      if (done) return;
      done = true;
      processor.onaudioprocess = null;
      try { processor.disconnect(); } catch { /* */ }
      try { mute.disconnect(); } catch { /* */ }
      try { source.disconnect(); } catch { /* */ }
      for (const t of stream.getTracks()) t.stop(); // release the mic (don't close the shared ctx)
      if (signal) signal.removeEventListener('abort', onAbort);
      if (finishSignal) finishSignal.removeEventListener('abort', onFinishEarly);
    };
    const onAbort = () => { cleanup(); resolve(null); };
    if (signal) {
      if (signal.aborted) { cleanup(); resolve(null); return; }
      signal.addEventListener('abort', onAbort);
    }
    const finish = () => { const wav = encodeWav(mergeChunks(chunks), inRate, 16000); cleanup(); resolve(wav); };
    // Stop-early (composer mic's tap-to-stop): return what we have, or null if
    // the user never actually spoke.
    const onFinishEarly = () => { if (started && chunks.length) finish(); else { cleanup(); resolve(null); } };
    if (finishSignal) finishSignal.addEventListener('abort', onFinishEarly);

    processor.onaudioprocess = (e) => {
      const input = e.inputBuffer.getChannelData(0);
      let sum = 0;
      for (let i = 0; i < input.length; i++) sum += input[i] * input[i];
      const rms = Math.sqrt(sum / input.length);
      if (onLevel) onLevel(Math.min(1, rms * 8));
      const now = Date.now();
      if (rms > SPEECH) {
        if (!started) { started = true; chunks.push(...preroll); preroll.length = 0; }
        lastVoice = now;
      }
      if (started) {
        chunks.push(new Float32Array(input));
      } else {
        preroll.push(new Float32Array(input));
        if (preroll.length > PREROLL_CHUNKS) preroll.shift();
      }
      if (started && now - lastVoice > silenceMs) { finish(); return; }
      if (started && now - t0 > maxMs) { finish(); return; }
      if (!started && now - t0 > startTimeoutMs) { cleanup(); resolve(null); }
    };

    source.connect(processor);
    processor.connect(mute);
    mute.connect(ctx.destination);
  });
}

function mergeChunks(chunks: Float32Array[]): Float32Array {
  let len = 0;
  for (const c of chunks) len += c.length;
  const out = new Float32Array(len);
  let off = 0;
  for (const c of chunks) { out.set(c, off); off += c.length; }
  return out;
}

// Downsample to `outRate` mono and write a 16-bit PCM WAV (Whisper-friendly).
function encodeWav(samples: Float32Array, inRate: number, outRate: number): Blob {
  const data = inRate === outRate ? samples : downsample(samples, inRate, outRate);
  const buffer = new ArrayBuffer(44 + data.length * 2);
  const view = new DataView(buffer);
  const writeStr = (off: number, s: string) => { for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i)); };
  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + data.length * 2, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);            // PCM
  view.setUint16(22, 1, true);            // mono
  view.setUint32(24, outRate, true);
  view.setUint32(28, outRate * 2, true);  // byte rate
  view.setUint16(32, 2, true);            // block align
  view.setUint16(34, 16, true);           // bits/sample
  writeStr(36, 'data');
  view.setUint32(40, data.length * 2, true);
  let off = 44;
  for (let i = 0; i < data.length; i++) {
    const s = Math.max(-1, Math.min(1, data[i]));
    view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    off += 2;
  }
  return new Blob([view], { type: 'audio/wav' });
}

function downsample(samples: Float32Array, inRate: number, outRate: number): Float32Array {
  if (outRate >= inRate) return samples;
  const ratio = inRate / outRate;
  const outLen = Math.floor(samples.length / ratio);
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const start = Math.floor(i * ratio);
    const end = Math.min(samples.length, Math.floor((i + 1) * ratio));
    let sum = 0, n = 0;
    for (let j = start; j < end; j++) { sum += samples[j]; n++; }
    out[i] = n ? sum / n : 0;
  }
  return out;
}

// ---- Transcription (Whisper, server-side) ----

async function blobToB64(blob: Blob): Promise<string> {
  const buf = new Uint8Array(await blob.arrayBuffer());
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < buf.length; i += CHUNK) bin += String.fromCharCode(...buf.subarray(i, i + CHUNK));
  return btoa(bin);
}

export async function transcribe(blob: Blob): Promise<string> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token ?? SUPABASE_ANON_KEY;
  const audio = await blobToB64(blob);
  const res = await fetch(TRANSCRIBE_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, apikey: SUPABASE_ANON_KEY },
    body: JSON.stringify({ audio, mime: 'audio/wav', filename: 'turn.wav' }),
  });
  if (!res.ok) {
    const j = await res.json().catch(() => ({}));
    throw new Error(j.error || `Transcription failed: ${res.status}`);
  }
  const j = await res.json();
  return typeof j.text === 'string' ? j.text.trim() : '';
}

// ---- Speaking (device voices) ----

// Strip card/code blocks and markdown so the voice reads natural prose, not JSON
// or syntax. (The thread still renders the rich cards visually.)
export function speakable(s: string): string {
  return s
    .replace(/\[\[gf(id|status):[^\]]*\]\]/g, '')
    .replace(/```[\s\S]*?```/g, '. ')        // fenced blocks (cards, code)
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')     // images
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')  // links -> their text
    .replace(/[*_#`>~|]/g, '')                // markdown punctuation
    .replace(/\s+/g, ' ')
    .trim();
}

export function speak(text: string): Promise<void> {
  return new Promise((resolve) => {
    const synth = window.speechSynthesis;
    if (!synth || !text) { resolve(); return; }
    try { synth.cancel(); } catch { /* */ }
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 1.0;
    u.pitch = 1.0;
    u.lang = 'en-US';
    u.onend = () => resolve();
    u.onerror = () => resolve();
    synth.speak(u);
  });
}

export function stopSpeaking(): void {
  try { window.speechSynthesis?.cancel(); } catch { /* */ }
}
