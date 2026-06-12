import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { useFocusTrap } from './a11y';
import { bump, chime } from './haptics';
import { listenOnce, transcribe, speak, speakable, stopSpeaking, micSupported } from './voice';
import { streamChat, type ChatMessage, type Attach } from './api';
import { IconPhoneOff, IconCamera } from './icons';
// Per-bar height weight for the voice wave (center-peaked, like a soundprint).
const WAVE_W = [0.45, 0.78, 1, 0.78, 0.45];

type Phase = 'connecting' | 'listening' | 'thinking' | 'speaking' | 'error';

const cid = () => Math.random().toString(36).slice(2) + Date.now().toString(36);

// Full-screen voice "call" with the assistant. Hands-free loop: greet → listen
// (ends on silence) → transcribe (Whisper) → ask Claude (the same chat backend,
// so all tools/memory still work) → speak the reply → listen again. The whole
// exchange lands in the chat thread via onTurn, so you can scroll it later.
export default function CallScreen({
  baseHistory, apps, conversationId, memoryOn, model, onTurn, onReminderSet, onClose,
}: {
  baseHistory: ChatMessage[];
  apps?: string[];
  conversationId?: string;
  memoryOn?: boolean;
  model?: string; // the conversation's model choice — voice turns honor it like typed ones
  onTurn: (history: ChatMessage[]) => void;
  onReminderSet?: () => void; // the assistant set a reminder this turn — re-arm the device notification
  onClose: () => void;
}) {
  const [phase, setPhase] = useState<Phase>('connecting');
  const [caption, setCaption] = useState('');  // live transcript / status line
  const [reply, setReply] = useState('');       // assistant's current spoken reply
  const [level, setLevel] = useState(0);        // mic level 0..1 for the voice wave
  const [err, setErr] = useState('');
  const [lensOn, setLensOn] = useState(false); // Live Lens: camera preview; each question carries the current frame

  const runningRef = useRef(true);
  const abortRef = useRef<AbortController | null>(null);
  const listenCtrlRef = useRef<AbortController | null>(null);
  const historyRef = useRef<ChatMessage[]>(baseHistory);
  const phaseRef = useRef<Phase>('connecting');
  const videoRef = useRef<HTMLVideoElement>(null);
  const lensStreamRef = useRef<MediaStream | null>(null);
  const lensOnRef = useRef(false); // the loop reads this (it's a long-lived closure)
  const setPhaseBoth = (p: Phase) => { phaseRef.current = p; setPhase(p); };

  useEffect(() => {
    if (!micSupported()) {
      setErr("This device can't capture audio in the app yet.");
      setPhaseBoth('error');
      return;
    }
    runningRef.current = true;
    void loop();
    return () => {
      runningRef.current = false;
      abortRef.current?.abort();
      listenCtrlRef.current?.abort();
      stopSpeaking();
      stopLens();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loop() {
    setPhaseBoth('speaking');
    void chime(); // "call connected"
    try { await speak('Hi, how can I help?'); } catch { /* */ }

    while (runningRef.current) {
      // 1) Listen until the user goes quiet.
      setPhaseBoth('listening');
      setCaption('');
      let audio: Blob | null = null;
      const lc = new AbortController();
      listenCtrlRef.current = lc;
      try {
        audio = await listenOnce({ signal: lc.signal, onLevel: setLevel });
      } catch {
        setErr('I couldn’t access the microphone — check the app’s mic permission in Settings.');
        setPhaseBoth('error');
        return;
      }
      setLevel(0);
      if (!runningRef.current) return;
      if (!audio) continue; // no speech detected — keep listening

      // Live Lens: capture the frame from the moment they finished speaking, so
      // "what am I looking at?" refers to what the camera saw right then.
      const liveFrame = lensOnRef.current ? grabFrame() : null;

      // 2) Transcribe.
      setPhaseBoth('thinking');
      let text = '';
      try {
        text = await transcribe(audio);
      } catch (e) {
        setErr(e instanceof Error ? e.message : 'Transcription failed.');
        setPhaseBoth('error');
        return;
      }
      if (!runningRef.current) return;
      text = text.trim();
      if (!text) { continue; } // nothing intelligible — listen again
      setCaption(text);

      // 3) Ask the assistant (same streaming backend → keeps all tools/memory).
      //    With Live Lens on, the current camera frame rides along, so
      //    "what's this?" is answered about what you're pointing at.
      const userMsg: ChatMessage = { role: 'user', content: text, id: cid(), ...(liveFrame ? { attachments: [liveFrame] } : {}) };
      historyRef.current = [...historyRef.current, userMsg];
      onTurn(historyRef.current);

      let full = '';
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      setReply('');
      try {
        await streamChat(
          historyRef.current,
          (tok) => { full += tok; setReply(speakable(full)); },
          ctrl.signal,
          apps,
          conversationId,
          undefined, // onModel
          memoryOn,
          undefined, // location
          model, // per-chat model choice applies to voice turns too
        );
      } catch (e) {
        if (!runningRef.current) return;
        setErr(e instanceof Error ? e.message : 'The assistant had a problem.');
        setPhaseBoth('error');
        return;
      }
      abortRef.current = null;
      if (!runningRef.current) return;

      // 4) Land the reply in the thread (strip transient status + sync markers).
      if (/\[\[gfsync:reminders\]\]/.test(full)) onReminderSet?.();
      const clean = full.replace(/\[\[gf(?:status|sync):[^\]]*\]\]/g, '');
      historyRef.current = [...historyRef.current, { role: 'assistant', content: clean, id: cid() }];
      onTurn(historyRef.current);

      // 5) Speak it.
      const toSay = speakable(full);
      setPhaseBoth('speaking');
      if (toSay) await speak(toSay);
      if (!runningRef.current) return;
    }
  }

  function hangUp() {
    void bump();
    runningRef.current = false;
    abortRef.current?.abort();
    listenCtrlRef.current?.abort();
    stopSpeaking();
    onClose();
  }

  // ---- Live Lens: a live camera preview on the call; every question you ask
  // automatically carries the current frame ("what am I looking at?"). ----
  async function toggleLens() {
    if (lensOnRef.current) { stopLens(); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
      lensStreamRef.current = stream;
      lensOnRef.current = true;
      setLensOn(true);
      // The <video> mounts on the state flip; attach the stream right after.
      requestAnimationFrame(() => {
        const v = videoRef.current;
        if (v) { v.srcObject = stream; v.play().catch(() => { /* autoplay quirk — preview still attaches */ }); }
      });
    } catch {
      setCaption('Couldn’t open the camera — check the app’s camera permission.');
    }
  }

  function stopLens() {
    lensOnRef.current = false;
    setLensOn(false);
    const s = lensStreamRef.current;
    lensStreamRef.current = null;
    if (s) for (const t of s.getTracks()) t.stop();
    const v = videoRef.current;
    if (v) v.srcObject = null;
  }

  // Downscaled JPEG of what the camera sees right now (same vision budget as a
  // composer photo). Null while the preview hasn't produced frames yet.
  function grabFrame(): Attach | null {
    const v = videoRef.current;
    if (!lensOnRef.current || !v || v.videoWidth === 0) return null;
    const MAX_EDGE = 1280;
    const scale = Math.min(1, MAX_EDGE / Math.max(v.videoWidth, v.videoHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(v.videoWidth * scale));
    canvas.height = Math.max(1, Math.round(v.videoHeight * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
    const data = dataUrl.slice(dataUrl.indexOf(',') + 1);
    return data ? { kind: 'image', mediaType: 'image/jpeg', data, name: 'live-lens.jpg' } : null;
  }

  // Tap the orb while it's talking to interrupt and start listening (barge-in):
  // cancelling speech resolves the loop's await, so it proceeds to listen.
  function onOrbTap() {
    if (phaseRef.current === 'speaking') stopSpeaking();
  }

  const statusLabel =
    phase === 'connecting' ? 'Starting…'
      : phase === 'listening' ? 'Listening'
        : phase === 'thinking' ? 'Thinking…'
          : phase === 'speaking' ? 'Speaking'
            : 'Something went wrong';

  // Full-screen dialog: focus moves in; Esc hangs up (same as the end button).
  const trapRef = useRef<HTMLDivElement>(null);
  useFocusTrap(true, trapRef, onClose);

  const bodyText = phase === 'error' ? err : phase === 'speaking' ? reply : caption;

  return (
    <div className={`call-screen ${lensOn ? 'lens-on' : ''}`} role="dialog" aria-label="Voice call with Go Farther" ref={trapRef} tabIndex={-1}>
      <div className="call-top">
        <div className="call-name">Go Farther</div>
        <div className="call-status">{statusLabel}</div>
      </div>

      {/* The voice wave: bars that move with YOUR mic level while listening
          (genuinely audio-reactive via --lvl), ripple while thinking, and dance
          while speaking. Tap to interrupt mid-speech, same as before. */}
      <button
        type="button"
        className={`call-wave call-${phase}`}
        style={{ '--lvl': level } as CSSProperties}
        onClick={onOrbTap}
        aria-label="Assistant"
      >
        {WAVE_W.map((w, i) => (
          <span key={i} className="call-wave-bar" style={{ '--i': i, '--w': w } as CSSProperties} />
        ))}
      </button>

      {lensOn && <video ref={videoRef} className="call-lens" autoPlay playsInline muted />}

      <div className="call-caption">{bodyText || ' '}</div>

      <div className="call-controls">
        <button
          type="button"
          className={`call-cam ${lensOn ? 'on' : ''}`}
          onClick={() => void toggleLens()}
          aria-label={lensOn ? 'Turn off Live Lens' : 'Turn on Live Lens'}
          aria-pressed={lensOn}
        >
          <IconCamera size={24} />
        </button>
        <button type="button" className="call-end" onClick={hangUp} aria-label="End call">
          <IconPhoneOff size={26} />
        </button>
      </div>
    </div>
  );
}
