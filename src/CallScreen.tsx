import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { listenOnce, transcribe, speak, speakable, stopSpeaking, micSupported } from './voice';
import { streamChat, type ChatMessage } from './api';
import { IconPhoneOff } from './icons';

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

  const runningRef = useRef(true);
  const abortRef = useRef<AbortController | null>(null);
  const historyRef = useRef<ChatMessage[]>(baseHistory);
  const phaseRef = useRef<Phase>('connecting');
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
      stopSpeaking();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loop() {
    setPhaseBoth('speaking');
    try { await speak('Hi, how can I help?'); } catch { /* */ }

    while (runningRef.current) {
      // 1) Listen until the user goes quiet.
      setPhaseBoth('listening');
      setCaption('');
      let audio: Blob | null = null;
      try {
        audio = await listenOnce({ onLevel: setLevel });
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
      const userMsg: ChatMessage = { role: 'user', content: text, id: cid() };
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
    stopSpeaking();
    onClose();
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

      <div className="call-caption">{bodyText || ' '}</div>

      <button type="button" className="call-end" onClick={hangUp} aria-label="End call">
        <IconPhoneOff size={26} />
      </button>
    </div>
  );
}
