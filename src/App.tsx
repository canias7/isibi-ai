import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { Session } from '@supabase/supabase-js';
import { streamChat, type ChatMessage, type Attach } from './api';
import { supabase } from './supabase';
import { CONNECTORS, CONNECT_API, byId } from './connectorData';
import Connectors from './Connectors';
import Login from './Login';
import AssistantMessage from './AssistantMessage';
import type { EmailItem } from './EmailList';
import { IconMenu, IconCompose, IconChat, IconConnectors, IconSettings, IconLogout, IconTrash, IconCamera, IconPhotos, IconFiles, IconX, IconDoc } from './icons';

type View = 'chat' | 'connectors' | 'settings';

interface Conversation {
  id: string;
  title: string;
  messages: ChatMessage[];
  updatedAt: number;
}

const MAX_CHATS = 50;
const chatsKey = (uid: string) => `gf_chats_${uid}`;

// Starter prompts shown on the home screen (tap to send).
const SUGGESTIONS = ['Summarize my inbox', 'What’s on my calendar?'];

function loadChats(uid: string): Conversation[] {
  try {
    const v = JSON.parse(localStorage.getItem(chatsKey(uid)) || '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

function saveChats(uid: string, chats: Conversation[]) {
  try {
    // Drop heavy base64 from attachments before persisting (keep the meta so the
    // bubble still shows a chip) — avoids blowing the localStorage quota.
    const slim = chats.slice(0, MAX_CHATS).map((c) => ({
      ...c,
      messages: c.messages.map((m) =>
        m.attachments?.length ? { ...m, attachments: m.attachments.map((a) => ({ ...a, data: '' })) } : m,
      ),
    }));
    localStorage.setItem(chatsKey(uid), JSON.stringify(slim));
  } catch {
    /* storage full / unavailable */
  }
}

// ---- Attachment helpers (client-side image normalization) ----
function stripPrefix(dataUrl: string): string {
  const i = dataUrl.indexOf(',');
  return i >= 0 ? dataUrl.slice(i + 1) : dataUrl;
}
function readAsDataUrl(f: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error('read failed'));
    r.readAsDataURL(f);
  });
}
// Decode (incl. iOS HEIC) and re-encode to a downscaled JPEG so payloads stay
// small and the media type is one Claude's vision accepts.
function imageToJpeg(f: File): Promise<{ data: string; mediaType: string }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(f);
    const img = new Image();
    img.onload = () => {
      const max = 1568;
      const scale = Math.min(1, max / Math.max(img.width, img.height));
      const w = Math.max(1, Math.round(img.width * scale));
      const h = Math.max(1, Math.round(img.height * scale));
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      URL.revokeObjectURL(url);
      if (!ctx) return reject(new Error('no canvas'));
      ctx.drawImage(img, 0, 0, w, h);
      resolve({ data: stripPrefix(canvas.toDataURL('image/jpeg', 0.85)), mediaType: 'image/jpeg' });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('image decode failed'));
    };
    img.src = url;
  });
}
async function fileToAttachment(f: File): Promise<Attach | null> {
  if (f.type === 'application/pdf') {
    return { kind: 'pdf', mediaType: 'application/pdf', data: stripPrefix(await readAsDataUrl(f)), name: f.name || 'document.pdf' };
  }
  if (f.type.startsWith('image/')) {
    const { data, mediaType } = await imageToJpeg(f);
    return { kind: 'image', mediaType, data, name: f.name || 'image.jpg' };
  }
  return null; // unsupported type
}

// Render one attachment — image thumbnail, or a file chip (also the fallback for
// images whose base64 was stripped on persist).
function AttView({ a }: { a: Attach }) {
  if (a.kind === 'image' && a.data) {
    return <img className="att-img" src={`data:${a.mediaType};base64,${a.data}`} alt={a.name} />;
  }
  return (
    <span className="att-file">
      <IconDoc size={16} />
      <span className="att-file-name">{a.name}</span>
    </span>
  );
}

function titleFrom(messages: ChatMessage[]): string {
  const first = messages.find((m) => m.role === 'user');
  const t = (first?.content ?? '').trim().replace(/\s+/g, ' ');
  return t ? (t.length > 42 ? t.slice(0, 42) + '…' : t) : 'New chat';
}

function cid(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }
}

// Hide the internal "open email" marker from the user's chat bubble.
function cleanForDisplay(s: string): string {
  return s.replace(/\s*\[\[gfid:[^\]]*\]\]/g, '');
}

// Flip to `true` to show the email/password login screen. When `false`, the app
// skips the login UI and uses a silent anonymous "guest" session, so identity
// (per-user connectors + history) still works without a sign-in wall.
// Requires "Allow anonymous sign-ins" enabled in Supabase → Authentication.
const REQUIRE_LOGIN = false;

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [authReady, setAuthReady] = useState(false);

  // ---- Auth bootstrap ----
  useEffect(() => {
    let active = true;
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (data.session) {
        if (active) {
          setSession(data.session);
          setAuthReady(true);
        }
        return;
      }
      // No session: skip the login screen with a silent guest sign-in (unless
      // login is required). If anonymous sign-ins are disabled, we fall through
      // to the Login screen instead of bricking.
      if (!REQUIRE_LOGIN) {
        const { data: anon } = await supabase.auth.signInAnonymously();
        if (active && anon?.session) setSession(anon.session);
      }
      if (active) setAuthReady(true);
    })();
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  const uid = session?.user.id ?? null;

  const [chats, setChats] = useState<Conversation[]>([]);
  const [currentId, setCurrentId] = useState<string>(cid);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [view, setView] = useState<View>('chat');
  const scrollRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // ---- Per-session connectors ----
  // Which apps are connected (from the backend), which are enabled for THIS
  // session (toggles), and whether we've loaded yet. Disabling a connector here
  // only scopes it out of this chat — it stays connected globally.
  const [connApps, setConnApps] = useState<string[]>([]);
  const [enabled, setEnabled] = useState<Set<string>>(new Set());
  const [connLoaded, setConnLoaded] = useState(false);
  const [connMenu, setConnMenu] = useState(false);
  const [plusOpen, setPlusOpen] = useState(false);
  const [attachments, setAttachments] = useState<Attach[]>([]);
  const [attachErr, setAttachErr] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const seenRef = useRef<string[]>([]);

  async function loadConnectors() {
    if (!uid) return;
    try {
      const { data } = await supabase.auth.getSession();
      const t = data.session?.access_token;
      if (!t) return;
      const r = await fetch(`${CONNECT_API}/list`, { headers: { authorization: `Bearer ${t}` } });
      if (!r.ok) return;
      const j = await r.json();
      const ids = CONNECTORS.map((c) => c.id).filter((id) => (j.connected ?? {})[id]);
      setConnApps(ids);
      // Keep existing toggles; auto-enable newly connected apps; drop gone ones.
      setEnabled((prev) => {
        const next = new Set<string>();
        for (const id of ids) {
          if (!seenRef.current.includes(id)) next.add(id); // new -> on
          else if (prev.has(id)) next.add(id); // keep prior toggle
        }
        return next;
      });
      seenRef.current = ids;
      setConnLoaded(true);
    } catch {
      /* offline — leave as-is */
    }
  }

  useEffect(() => {
    if (!uid) {
      setConnApps([]);
      setEnabled(new Set());
      setConnLoaded(false);
      seenRef.current = [];
      return;
    }
    void loadConnectors();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid]);

  function toggleApp(id: string) {
    setEnabled((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  // Load this user's chats on login (and clear on logout).
  useEffect(() => {
    if (!uid) {
      setChats([]);
      setMessages([]);
      setCurrentId(cid());
      return;
    }
    const loaded = loadChats(uid);
    setChats(loaded);
    setCurrentId(loaded[0]?.id ?? cid());
    setMessages(loaded[0]?.messages ?? []);
  }, [uid]);

  // Auto-scroll to the latest message.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, busy]);

  // Auto-grow the composer textarea.
  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = `${Math.min(ta.scrollHeight, 200)}px`;
  }, [input]);

  // Persist the active conversation once a turn finishes (not on every token).
  useEffect(() => {
    if (!uid || busy || messages.length === 0) return;
    setChats((prev) => {
      const convo: Conversation = { id: currentId, title: titleFrom(messages), messages, updatedAt: Date.now() };
      const next = [convo, ...prev.filter((c) => c.id !== currentId)];
      saveChats(uid, next);
      return next;
    });
  }, [messages, busy, currentId, uid]);

  async function sendText(raw: string, atts: Attach[] = []) {
    const text = raw.trim();
    if ((!text && atts.length === 0) || busy) return;

    const userMsg: ChatMessage = { role: 'user', content: text, ...(atts.length ? { attachments: atts } : {}) };
    const history = [...messages, userMsg];
    setMessages([...history, { role: 'assistant', content: '' }]);
    setBusy(true);

    const controller = new AbortController();
    abortRef.current = controller;
    // Safety net: if the network stalls mid-reply, abort after 2 min so the
    // composer never locks forever. Generous enough for multi-tool workflows.
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, 120000);
    // Tell the backend which connectors are active this session. Undefined until
    // loaded so the first message still gets all connected apps.
    const apps = connLoaded ? [...enabled] : undefined;
    try {
      await streamChat(
        history,
        (tok) => {
          setMessages((m) => {
            const copy = m.slice();
            const last = copy[copy.length - 1];
            copy[copy.length - 1] = { role: 'assistant', content: last.content + tok };
            return copy;
          });
        },
        controller.signal,
        apps,
      );
    } catch (e) {
      // User pressed Stop (or navigated away) — keep whatever streamed so far.
      if (controller.signal.aborted && !timedOut) return;
      const msg = timedOut ? 'Timed out — please try again.' : e instanceof Error ? e.message : 'Something went wrong';
      setMessages((m) => {
        const copy = m.slice();
        copy[copy.length - 1] = { role: 'assistant', content: `⚠️ ${msg}` };
        return copy;
      });
    } finally {
      clearTimeout(timeout);
      if (abortRef.current === controller) abortRef.current = null;
      setBusy(false);
    }
  }

  // Send from the composer (clears the input box + pending attachments).
  function send() {
    const text = input.trim();
    if ((!text && attachments.length === 0) || busy) return;
    const atts = attachments;
    setInput('');
    setAttachments([]);
    void sendText(text, atts);
  }

  // ---- Attachments ("+" menu) ----
  function openPicker(mode: 'camera' | 'photos' | 'files') {
    setPlusOpen(false);
    const input = fileRef.current;
    if (!input) return;
    input.value = '';
    input.multiple = mode !== 'camera';
    if (mode === 'camera') {
      input.accept = 'image/*';
      input.setAttribute('capture', 'environment');
    } else {
      input.accept = mode === 'photos' ? 'image/*' : 'image/*,application/pdf';
      input.removeAttribute('capture');
    }
    input.click();
  }
  async function onFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = '';
    let bad = false;
    for (const f of files) {
      try {
        const att = await fileToAttachment(f);
        if (att) setAttachments((prev) => [...prev, att].slice(0, 6));
        else bad = true;
      } catch {
        bad = true;
      }
    }
    if (bad) {
      setAttachErr(true);
      setTimeout(() => setAttachErr(false), 3500);
    }
  }
  function removeAttachment(i: number) {
    setAttachments((prev) => prev.filter((_, idx) => idx !== i));
  }

  // Tapping an email card opens it: send a hidden "open by id" instruction so the
  // assistant fetches that exact message and renders the reader card.
  function openEmail(item: EmailItem) {
    if (busy) return;
    const label = (item.subject || '').trim() || item.from || 'this email';
    const marker = item.id ? ` [[gfid:${item.id}]]` : '';
    void sendText(`Open this email: ${label}${marker}`);
  }

  // Stop any in-flight reply before changing/leaving the conversation, so its
  // streamed tokens can't land in a different chat.
  function stopStream() {
    abortRef.current?.abort();
    abortRef.current = null;
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  }

  function go(v: View) {
    setView(v);
    setSidebarOpen(false);
    if (v === 'chat') void loadConnectors(); // pick up anything connected meanwhile
  }

  function newChat() {
    stopStream();
    setCurrentId(cid());
    setMessages([]);
    go('chat');
  }

  function selectChat(id: string) {
    const c = chats.find((x) => x.id === id);
    if (!c) return;
    stopStream();
    setCurrentId(id);
    setMessages(c.messages);
    go('chat');
  }

  function deleteChat(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    setChats((prev) => {
      const next = prev.filter((c) => c.id !== id);
      if (uid) saveChats(uid, next);
      return next;
    });
    if (id === currentId) {
      setCurrentId(cid());
      setMessages([]);
    }
  }

  async function signOut() {
    stopStream();
    setSidebarOpen(false);
    await supabase.auth.signOut();
  }

  // ---- Gate on auth ----
  if (!authReady) {
    return (
      <div className="auth">
        <div className="auth-brand">Go Farther</div>
      </div>
    );
  }
  if (!session) return <Login />;

  const isGuest = !!session.user.is_anonymous;
  const title = view === 'connectors' ? 'Connectors' : view === 'settings' ? 'Settings' : 'Go Farther';

  return (
    <div className="app">
      {/* Sidebar + backdrop */}
      <div className={`backdrop ${sidebarOpen ? 'show' : ''}`} onClick={() => setSidebarOpen(false)} />
      <aside className={`sidebar ${sidebarOpen ? 'open' : ''}`}>
        <div className="side-head">Go Farther</div>
        <button className="side-item primary" onClick={newChat}>
          <span className="ico"><IconCompose size={18} /></span> New chat
        </button>
        <nav className="side-nav">
          <button className={`side-item ${view === 'chat' ? 'active' : ''}`} onClick={() => go('chat')}>
            <span className="ico"><IconChat size={18} /></span> Chat
          </button>
          <button className={`side-item ${view === 'connectors' ? 'active' : ''}`} onClick={() => go('connectors')}>
            <span className="ico"><IconConnectors size={18} /></span> Connectors
          </button>
          <button className={`side-item ${view === 'settings' ? 'active' : ''}`} onClick={() => go('settings')}>
            <span className="ico"><IconSettings size={18} /></span> Settings
          </button>
        </nav>

        {chats.length > 0 && (
          <div className="side-chats">
            <div className="side-label">Recent chats</div>
            {chats.map((c) => (
              <button
                key={c.id}
                className={`side-item chat-item ${view === 'chat' && c.id === currentId ? 'active' : ''}`}
                onClick={() => selectChat(c.id)}
              >
                <span className="chat-title">{c.title || 'New chat'}</span>
                <span className="chat-del" role="button" aria-label="Delete chat" onClick={(e) => deleteChat(c.id, e)}>
                  <IconTrash size={15} />
                </span>
              </button>
            ))}
          </div>
        )}

        <div className="side-foot">
          <div className="side-user" title={session.user.email ?? ''}>{session.user.email ?? 'Guest'}</div>
          {!isGuest && (
            <button className="side-item" onClick={signOut}>
              <span className="ico"><IconLogout size={18} /></span> Sign out
            </button>
          )}
        </div>
      </aside>

      <header className="topbar">
        <button className="icon-btn" onClick={() => setSidebarOpen(true)} aria-label="Open menu">
          <IconMenu />
        </button>
        <span className="title">{view === 'chat' && messages.length === 0 ? '' : title}</span>
        <button className="icon-btn" onClick={newChat} aria-label="New chat">
          <IconCompose size={21} />
        </button>
      </header>

      {view === 'connectors' ? (
        <Connectors />
      ) : view === 'settings' ? (
        <div className="page">
          <div className="page-inner">
            <h1 className="page-title">Settings</h1>
            <p className="page-sub">
              {isGuest ? 'Using a guest session on this device.' : `Signed in as ${session.user.email}.`}
            </p>
            {!isGuest && <button className="conn-btn" onClick={signOut}>Sign out</button>}
          </div>
        </div>
      ) : (
        <>
          <div className="live-bg" aria-hidden="true">
            <span className="orb orb1" />
            <span className="orb orb2" />
            <span className="orb orb3" />
            <span className="orb orb4" />
          </div>
          <div className="messages" ref={scrollRef}>
            {messages.length === 0 ? (
              <div className="home">
                <div className="home-hero">
                  <h1 className="home-mark">Go Farther</h1>
                  <p className="home-tag">One chat for all your apps.</p>
                </div>
                <div className="home-suggest">
                  {SUGGESTIONS.map((s) => (
                    <button key={s} className="sug" onClick={() => void sendText(s)}>
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="thread">
                {messages.map((m, i) => {
                  const streamingHere = busy && i === messages.length - 1 && m.role === 'assistant';
                  return (
                    <div key={i} className={`msg ${m.role}`}>
                      <div className="bubble">
                        {m.role === 'assistant' ? (
                          <AssistantMessage text={m.content} streaming={streamingHere} onOpen={openEmail} />
                        ) : (
                          <>
                            {m.attachments && m.attachments.length > 0 && (
                              <div className="msg-atts">
                                {m.attachments.map((a, ai) => <AttView key={ai} a={a} />)}
                              </div>
                            )}
                            {cleanForDisplay(m.content)}
                          </>
                        )}
                        {streamingHere && <span className="cursor" />}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="composer-wrap">
            {(plusOpen || connMenu) && (
              <div className="conn-pop-backdrop" onClick={() => { setPlusOpen(false); setConnMenu(false); }} />
            )}

            {/* "+" radial menu: attach options fan up from the + as circles */}
            {plusOpen && (
              <div className="radial" role="menu">
                <button className="radial-item" style={{ left: 0, bottom: 150, animationDelay: '0ms' }} onClick={() => openPicker('camera')}>
                  <IconCamera size={20} /><span className="radial-label">Camera</span>
                </button>
                <button className="radial-item" style={{ left: 56, bottom: 139, animationDelay: '40ms' }} onClick={() => openPicker('photos')}>
                  <IconPhotos size={20} /><span className="radial-label">Photos</span>
                </button>
                <button className="radial-item" style={{ left: 104, bottom: 108, animationDelay: '80ms' }} onClick={() => openPicker('files')}>
                  <IconFiles size={20} /><span className="radial-label">Files</span>
                </button>
                <button className="radial-item" style={{ left: 137, bottom: 61, animationDelay: '120ms' }} onClick={() => { setPlusOpen(false); setConnMenu(true); }}>
                  <IconConnectors size={20} /><span className="radial-label">Connectors</span>
                </button>
              </div>
            )}

            {/* Per-chat connectors toggle (opened from the "+" sheet) */}
            {connMenu && (
              <div className="conn-pop" role="menu">
                <div className="conn-pop-head">Connectors · this chat</div>
                {connApps.length === 0 ? (
                  <button className="conn-pop-empty" onClick={() => { setConnMenu(false); go('connectors'); }}>
                    No apps connected — open Connectors →
                  </button>
                ) : (
                  connApps.map((id) => {
                    const c = byId(id);
                    if (!c) return null;
                    const on = enabled.has(id);
                    return (
                      <button key={id} className="conn-pop-row" onClick={() => toggleApp(id)} aria-pressed={on}>
                        <img className="conn-pop-logo" src={c.logo} alt="" loading="lazy" />
                        <span className="conn-pop-name">{c.name}</span>
                        <span className={`tgl ${on ? 'on' : ''}`}><span className="tgl-knob" /></span>
                      </button>
                    );
                  })
                )}
              </div>
            )}

            <div className="composer">
              {attachments.length > 0 && (
                <div className="att-row">
                  {attachments.map((a, i) => (
                    <span key={i} className="att-chip">
                      <AttView a={a} />
                      <button className="att-x" onClick={() => removeAttachment(i)} aria-label="Remove attachment">
                        <IconX size={12} />
                      </button>
                    </span>
                  ))}
                </div>
              )}
              {attachErr && <div className="att-err">That file type isn't supported — try an image or PDF.</div>}
              <div className="composer-row">
                <button
                  className={`plus-btn ${plusOpen ? 'open' : ''}`}
                  onClick={() => { setConnMenu(false); setPlusOpen((o) => !o); }}
                  aria-label="Add attachment or connectors"
                >
                  +
                </button>
                <textarea
                  ref={taRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={onKeyDown}
                  placeholder="Message Go Farther…"
                  rows={1}
                />
                <button
                  className="send"
                  onClick={() => (busy ? stopStream() : void send())}
                  disabled={!busy && !input.trim() && attachments.length === 0}
                  aria-label={busy ? 'Stop generating' : 'Send'}
                >
                  {busy ? <span className="stop-sq" /> : '↑'}
                </button>
              </div>
            </div>
            <input ref={fileRef} type="file" hidden onChange={onFiles} />
            <p className="hint">Go Farther can make mistakes — double-check important info.</p>
          </div>
        </>
      )}
    </div>
  );
}
