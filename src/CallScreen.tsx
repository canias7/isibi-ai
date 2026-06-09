import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { listenOnce, transcribe, speak, speakable, stopSpeaking, micSupported } from './voice';
import { streamChat, type ChatMessage, type Attach } from './api';
import { fileToAttachment } from './attach';
import { IconPhoneOff, IconCamera } from './icons';

type Phase = 'connecting' | 'listening' | 'thinking' | 'speaking' | 'error';

const cid = () => Math.random().toString(36).slice(2) + Date.now().toString(36);

// Full-screen voice "call" with the assistant. Hands-free loop: greet → listen
// (ends on silence) → transcribe (Whisper) → ask Claude (the same chat backend,
// so all tools/memory still work) → speak the reply → listen again. The whole
// exchange lands in the chat thread via onTurn, so you can scroll it later.
export default function CallScreen({
  baseHistory, apps, conversationId, memoryOn, onTurn, onClose,
}: {
  baseHistory: ChatMessage[];
  apps?: string[];
  conversationId?: string;
  memoryOn?: boolean;
  onTurn: (history: ChatMessage[]) => void;
  onClose: () => void;
}) {
  const [phase, setPhase] = useState<Phase>('connecting');
  const [caption, setCaption] = useState('');  // live transcript / status line
  const [reply, setReply] = useState('');       // assistant's current spoken reply
  const [level, setLevel] = useState(0);        // mic level 0..1 for the orb
  const [err, setErr] = useState('');
  const [hasPhoto, setHasPhoto] = useState(false); // a snapped photo rides on the next thing you say

  const runningRef = useRef(true);
  const abortRef = useRef<AbortController | null>(null);
  const listenCtrlRef = useRef<AbortController | null>(null);
  const historyRef = useRef<ChatMessage[]>(baseHistory);
  const phaseRef = useRef<Phase>('connecting');
  const camRef = useRef<HTMLInputElement>(null);
  const pendingImageRef = useRef<Attach | null>(null);
  const capturingRef = useRef(false);
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
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loop() {
    setPhaseBoth('speaking');
    try { await speak('Hi, how can I help?'); } catch { /* */ }

    while (runningRef.current) {
      // Hold off listening while the camera is open for a photo.
      if (capturingRef.current) { await new Promise((r) => setTimeout(r, 150)); continue; }

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
      //    A photo snapped during the call rides along, so "what's this?" works.
      const photo = pendingImageRef.current;
      pendingImageRef.current = null;
      setHasPhoto(false);
      const userMsg: ChatMessage = { role: 'user', content: text, id: cid(), ...(photo ? { attachments: [photo] } : {}) };
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
          undefined,
          memoryOn,
        );
      } catch (e) {
        if (!runningRef.current) return;
        setErr(e instanceof Error ? e.message : 'The assistant had a problem.');
        setPhaseBoth('error');
        return;
      }
      abortRef.current = null;
      if (!runningRef.current) return;

      // 4) Land the reply in the thread (strip transient status markers).
      const clean = full.replace(/\[\[gfstatus:[^\]]*\]\]/g, '');
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
    runningRef.current = false;
    abortRef.current?.abort();
    listenCtrlRef.current?.abort();
    stopSpeaking();
    onClose();
  }

  // Snap a photo to ask about, hands-free: pause the loop, free the mic, open the
  // device camera. The shot attaches to the next thing you say (see the loop).
  function snapPhoto() {
    capturingRef.current = true;
    listenCtrlRef.current?.abort();
    stopSpeaking();
    const input = camRef.current;
    if (!input) { capturingRef.current = false; return; }
    input.value = '';
    // Cancelling the camera fires no `change` on some platforms, which would
    // leave the loop paused forever. Resume on the input's `cancel` event or
    // once the app regains focus after the camera sheet closes (slightly
    // delayed so a real `change` lands first — re-clearing is harmless).
    const resume = () => { cleanup(); setTimeout(() => { capturingRef.current = false; }, 400); };
    const onVis = () => { if (document.visibilityState === 'visible') resume(); };
    const cleanup = () => {
      input.removeEventListener('cancel', resume);
      window.removeEventListener('focus', resume);
      document.removeEventListener('visibilitychange', onVis);
    };
    input.addEventListener('cancel', resume, { once: true });
    window.addEventListener('focus', resume, { once: true });
    document.addEventListener('visibilitychange', onVis);
    input.click();
  }
  async function onPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (f) {
      const { attach } = await fileToAttachment(f);
      if (attach) { pendingImageRef.current = attach; setHasPhoto(true); }
    }
    capturingRef.current = false; // resume listening (the loop picks back up)
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
            : 'Problem';

  const bodyText = phase === 'error' ? err : phase === 'speaking' ? reply : caption;

  return (
    <div className="call-screen" role="dialog" aria-label="Voice call with Go Farther">
      <div className="call-top">
        <div className="call-name">Go Farther</div>
        <div className="call-status">{statusLabel}</div>
      </div>

      <button
        type="button"
        className={`call-orb call-${phase}`}
        style={{ '--lvl': level } as CSSProperties}
        onClick={onOrbTap}
        aria-label="Assistant"
      >
        <span className="call-orb-core" />
        <span className="call-orb-ring" />
      </button>

      {hasPhoto && <div className="call-photo-chip">📷 Photo attached — now ask about it</div>}

      <div className="call-caption">{bodyText || ' '}</div>

      <div className="call-controls">
        <button type="button" className="call-cam" onClick={snapPhoto} aria-label="Take a photo to ask about">
          <IconCamera size={24} />
        </button>
        <button type="button" className="call-end" onClick={hangUp} aria-label="End call">
          <IconPhoneOff size={26} />
        </button>
      </div>

      <input ref={camRef} type="file" accept="image/*" capture="environment" hidden onChange={onPhoto} />
    </div>
  );
}
