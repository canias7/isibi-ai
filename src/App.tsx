import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { Session } from '@supabase/supabase-js';
import { streamChat, type ChatMessage, type Attach } from './api';
import { supabase } from './supabase';
import { CONNECTORS, CONNECT_API, byId } from './connectorData';
import Connectors from './Connectors';
import Login from './Login';
import AssistantMessage from './AssistantMessage';
import type { EmailItem } from './EmailList';
import { IconMenu, IconCompose, IconChat, IconConnectors, IconSettings, IconLogout, IconTrash, IconCamera, IconPhotos, IconFiles, IconX, IconDoc, IconSearch, IconEdit, IconPin, IconCopy, IconCheck } from './icons';
import { App as CapApp } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { tap } from './haptics';
import { biometryAvailable, unlock } from './biometric';

type View = 'chat' | 'connectors' | 'settings';

interface Conversation {
  id: string;
  title: string;
  messages: ChatMessage[];
  updatedAt: number;
}

const MAX_CHATS = 50;
const chatsKey = (uid: string) => `gf_chats_${uid}`;
// Backgrounded for longer than this → resume into a fresh chat instead of the
// old conversation. Shorter trips away keep you where you left off.
const NEW_CHAT_AFTER_MS = 30 * 60 * 1000; // 30 minutes

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

// Drop heavy base64 from attachments (keep the meta so a chip still renders) —
// used before persisting locally and syncing, to avoid bloating storage/DB.
function slimMessages(messages: ChatMessage[]): ChatMessage[] {
  return messages.map((m) =>
    m.attachments?.length ? { ...m, attachments: m.attachments.map((a) => ({ ...a, data: '' })) } : m,
  );
}

function saveChats(uid: string, chats: Conversation[]) {
  try {
    const slim = chats.slice(0, MAX_CHATS).map((c) => ({ ...c, messages: slimMessages(c.messages) }));
    localStorage.setItem(chatsKey(uid), JSON.stringify(slim));
  } catch {
    /* storage full / unavailable */
  }
}

// Pinned chat ids (device-local — kept separate from the synced chat list so a
// cloud merge can't wipe them).
const pinsKey = (uid: string) => `gf_pins_${uid}`;
function loadPins(uid: string): Set<string> {
  try {
    const v = JSON.parse(localStorage.getItem(pinsKey(uid)) || '[]');
    return new Set(Array.isArray(v) ? v : []);
  } catch {
    return new Set();
  }
}
function savePins(uid: string, pins: Set<string>) {
  try { localStorage.setItem(pinsKey(uid), JSON.stringify([...pins])); } catch { /* ignore */ }
}

// Copy text to the clipboard, with a hidden-textarea fallback for older webviews.
async function copyText(s: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(s); return true; } catch { /* fall through */ }
  try {
    const ta = document.createElement('textarea');
    ta.value = s; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove();
    return true;
  } catch { return false; }
}

// A fetch/connectivity failure (vs. a real API/HTTP error) — used to queue a
// send for retry instead of showing a hard error.
function isNetworkError(e: unknown): boolean {
  if (e instanceof TypeError) return true; // fetch network failures are TypeErrors
  const m = (e instanceof Error ? e.message : String(e)).toLowerCase();
  return /network|failed to fetch|load failed|connection|offline|err_internet/.test(m);
}

// ---- Cloud sync (conversations table, RLS-scoped to this user) ----
async function syncLoad(uid: string): Promise<Conversation[] | null> {
  try {
    const { data, error } = await supabase
      .from('conversations')
      .select('id,title,messages,updated_at')
      .eq('user_id', uid)
      .order('updated_at', { ascending: false })
      .limit(MAX_CHATS);
    if (error || !data) return null;
    return data.map((r: { id: string; title: string; messages: unknown; updated_at: string }) => ({
      id: r.id,
      title: r.title || 'New chat',
      messages: Array.isArray(r.messages) ? (r.messages as ChatMessage[]) : [],
      updatedAt: new Date(r.updated_at).getTime(),
    }));
  } catch {
    return null;
  }
}
async function syncSave(uid: string, c: Conversation) {
  try {
    await supabase.from('conversations').upsert({
      user_id: uid,
      id: c.id,
      title: c.title,
      messages: slimMessages(c.messages),
      updated_at: new Date(c.updatedAt || Date.now()).toISOString(),
    });
  } catch {
    /* offline — local copy still saved */
  }
}
async function syncDelete(uid: string, id: string) {
  try {
    await supabase.from('conversations').delete().eq('user_id', uid).eq('id', id);
  } catch {
    /* offline */
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

// The copyable plain text of an assistant reply — strips rich card blocks and
// the internal marker, so "Copy" yields readable text (and is hidden for a
// card-only reply where there's nothing to copy).
function plainText(s: string): string {
  return s.replace(/```gf[\s\S]*?```/g, '').replace(/\[\[gf(id|status):[^\]]*\]\]/g, '').trim();
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
  // Chat management (sidebar): search filter, pinned ids, inline rename, copy feedback.
  const [pinned, setPinned] = useState<Set<string>>(new Set());
  const [chatSearch, setChatSearch] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState('');
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const jumpRef = useRef(true);        // next scroll should jump instantly (chat opened/restored)
  const awaySinceRef = useRef(0);      // when the app was last backgrounded
  const busyRef = useRef(false);       // latest busy/messages for the resume listener (avoids stale closures)
  const msgLenRef = useRef(0);
  const dirtyRef = useRef(false);      // a real turn changed messages -> persist (not just open/restore)
  const [online, setOnline] = useState(true);                 // network status (drives the offline banner)
  const pendingTurnRef = useRef<ChatMessage[] | null>(null);  // a turn that failed offline, awaiting retry
  const retryRef = useRef<() => void>(() => {});              // latest retryPending, for the online listener
  // Face ID / biometric lock (opt-in; native-only; fails open).
  const [faceId, setFaceId] = useState(() => { try { return localStorage.getItem('gf_faceid') === '1'; } catch { return false; } });
  const [locked, setLocked] = useState(() => { try { return localStorage.getItem('gf_faceid') === '1' && Capacitor.getPlatform() !== 'web'; } catch { return false; } });
  const faceIdRef = useRef(faceId);
  faceIdRef.current = faceId;
  const lockRef = useRef<() => void>(() => {});

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
  const menuOpenedAt = useRef(0); // guards against the tap's ghost-click closing a just-opened menu
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
      // Capture the previously-seen ids BEFORE updating the ref: the setEnabled
      // updater runs later (during render), by which point seenRef would already
      // hold the new ids — so reading the ref inside it would treat every app as
      // "already seen" and enable nothing (leaving all connectors off on every
      // app restart). Closing over the old value avoids that race.
      const seen = seenRef.current;
      seenRef.current = ids;
      setEnabled((prev) => {
        const next = new Set<string>();
        for (const id of ids) {
          if (!seen.includes(id)) next.add(id); // newly connected -> on
          else if (prev.has(id)) next.add(id);  // keep the user's prior toggle
        }
        return next;
      });
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

  // Load this user's chats on login (local cache instantly, then cloud sync).
  useEffect(() => {
    if (!uid) {
      setChats([]);
      setMessages([]);
      setCurrentId(cid());
      setPinned(new Set());
      return;
    }
    setPinned(loadPins(uid));
    const loaded = loadChats(uid);
    setChats(loaded);
    setCurrentId(loaded[0]?.id ?? cid());
    jumpRef.current = true; // restored chat: land at the bottom, not the top
    setMessages(loaded[0]?.messages ?? []);
    // Pull synced conversations and merge them into the list (cloud is source of
    // truth; keep any local-only chats not yet synced). Doesn't disturb the open chat.
    let alive = true;
    (async () => {
      const remote = await syncLoad(uid);
      if (!alive || !remote) return;
      const byId = new Map<string, Conversation>();
      for (const c of remote) byId.set(c.id, c);
      for (const c of loadChats(uid)) if (!byId.has(c.id)) byId.set(c.id, c);
      const merged = [...byId.values()].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, MAX_CHATS);
      setChats(merged);
      saveChats(uid, merged);
    })();
    return () => { alive = false; };
  }, [uid]);

  // Auto-scroll to the latest message. When a conversation is opened or restored
  // (app reopen / chat switch) jump straight to the bottom with NO animation —
  // otherwise a saved chat lands scrolled to the top and you have to scroll down.
  // During a live turn, scroll smoothly as tokens stream in.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const jump = jumpRef.current;
    jumpRef.current = false;
    const toBottom = () => el.scrollTo({ top: el.scrollHeight, behavior: jump ? 'auto' : 'smooth' });
    toBottom();
    // Restored cards/markdown can grow the height a frame or two later — re-pin.
    if (jump) {
      requestAnimationFrame(toBottom);
      setTimeout(toBottom, 120);
    }
  }, [messages, busy]);

  // Keep the latest busy/length handy for the resume listener below (set up once,
  // so it would otherwise capture stale values).
  useEffect(() => { busyRef.current = busy; msgLenRef.current = messages.length; }, [busy, messages]);

  // Coming back after a while should feel fresh: if the app was backgrounded for
  // longer than NEW_CHAT_AFTER_MS, resume into a brand-new chat instead of the old
  // conversation. Short trips away keep you exactly where you were.
  useEffect(() => {
    let handle: { remove: () => void } | undefined;
    void CapApp.addListener('appStateChange', ({ isActive }) => {
      if (!isActive) { awaySinceRef.current = Date.now(); return; }
      void lockRef.current(); // re-prompt the biometric lock on resume (no-op unless on)
      const since = awaySinceRef.current;
      awaySinceRef.current = 0;
      const away = since ? Date.now() - since : 0;
      if (away >= NEW_CHAT_AFTER_MS && !busyRef.current && msgLenRef.current > 0) {
        abortRef.current?.abort();
        abortRef.current = null;
        jumpRef.current = true;
        setCurrentId(cid());
        setMessages([]);
        setView('chat');
        setSidebarOpen(false);
      }
    }).then((h) => { handle = h; });
    return () => { handle?.remove(); };
  }, []);

  // Auto-grow the composer textarea.
  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = `${Math.min(ta.scrollHeight, 200)}px`;
  }, [input]);

  // Network status: show the offline banner, and auto-retry a queued send the
  // moment connectivity returns.
  useEffect(() => {
    setOnline(navigator.onLine);
    const onOnline = () => { setOnline(true); retryRef.current(); };
    const onOffline = () => setOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  // Engage the biometric lock on launch (no-op unless Face ID is on + supported).
  useEffect(() => {
    if (faceIdRef.current) void lockRef.current();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist the active conversation once a turn finishes (not on every token).
  useEffect(() => {
    if (!uid || busy || messages.length === 0) return;
    if (!dirtyRef.current) return; // only persist after a real turn — not on mere open/restore
    dirtyRef.current = false;
    const convo: Conversation = { id: currentId, title: titleFrom(messages), messages, updatedAt: Date.now() };
    setChats((prev) => {
      const next = [convo, ...prev.filter((c) => c.id !== currentId)];
      saveChats(uid, next);
      return next;
    });
    void syncSave(uid, convo); // mirror to the cloud
  }, [messages, busy, currentId, uid]);

  // Run one chat turn for a message history (its last item = the user's new
  // message). An empty assistant bubble is appended for the streamed reply.
  async function runTurn(history: ChatMessage[]) {
    dirtyRef.current = true; // a real turn — the persist effect should save it
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
      // Clear transient tool-activity markers from the finished reply so storage,
      // copy, and search stay clean (they're only meant to show live).
      setMessages((m) => {
        const copy = m.slice();
        const last = copy[copy.length - 1];
        if (last && last.role === 'assistant' && last.content.includes('[[gfstatus:')) {
          copy[copy.length - 1] = { ...last, content: last.content.replace(/\[\[gfstatus:[^\]]*\]\]/g, '') };
        }
        return copy;
      });
    } catch (e) {
      // User pressed Stop (or navigated away) — keep whatever streamed so far,
      // but drop a trailing empty assistant bubble if nothing streamed at all.
      if (controller.signal.aborted && !timedOut) {
        setMessages((m) => {
          const last = m[m.length - 1];
          return last && last.role === 'assistant' && last.content === '' ? m.slice(0, -1) : m;
        });
        return;
      }
      // Offline / network failure → queue this turn and offer retry instead of a
      // hard error. It auto-retries when connectivity returns.
      if (!timedOut && (!navigator.onLine || isNetworkError(e))) {
        dirtyRef.current = false; // don't persist a failed placeholder turn
        pendingTurnRef.current = history;
        setMessages((m) => {
          const copy = m.slice();
          copy[copy.length - 1] = { role: 'assistant', content: '', failed: true };
          return copy;
        });
        return;
      }
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

  async function sendText(raw: string, atts: Attach[] = []) {
    const text = raw.trim();
    if ((!text && atts.length === 0) || busy) return;
    const userMsg: ChatMessage = { role: 'user', content: text, ...(atts.length ? { attachments: atts } : {}) };
    await runTurn([...messages, userMsg]);
  }

  // Re-run the turn that failed offline — manual tap, or auto when back online.
  function retryPending() {
    const hist = pendingTurnRef.current;
    if (!hist || busy) return;
    pendingTurnRef.current = null;
    void runTurn(hist);
  }
  retryRef.current = retryPending;

  // Biometric lock: engage if enabled AND available, otherwise fail open (we
  // never trap the user behind a lock we can't satisfy — e.g. plugin not yet in
  // this native build, no hardware, web).
  async function engageLock() {
    if (!faceIdRef.current || Capacitor.getPlatform() === 'web') { setLocked(false); return; }
    if (!(await biometryAvailable())) { setLocked(false); return; }
    setLocked(true);
    if (await unlock()) setLocked(false);
  }
  lockRef.current = engageLock;

  function toggleFaceId() {
    setFaceId((on) => {
      const next = !on;
      try { localStorage.setItem('gf_faceid', next ? '1' : '0'); } catch { /* ignore */ }
      return next;
    });
  }

  // Send from the composer (clears the input box + pending attachments).
  function send() {
    const text = input.trim();
    if ((!text && attachments.length === 0) || busy) return;
    void tap(); // light haptic on send (no-op until a native build includes the plugin)
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
        if (att) setAttachments((prev) => [...prev, att].slice(-6));
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
    jumpRef.current = true; // opened chat: land at the bottom
    setMessages(c.messages);
    go('chat');
  }

  function deleteChat(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    if (id === currentId) stopStream(); // abort any in-flight reply before dropping its chat
    setChats((prev) => {
      const next = prev.filter((c) => c.id !== id);
      if (uid) saveChats(uid, next);
      return next;
    });
    if (uid) void syncDelete(uid, id);
    if (id === currentId) {
      setCurrentId(cid());
      setMessages([]);
    }
  }

  function togglePin(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    setPinned((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      if (uid) savePins(uid, next);
      return next;
    });
  }

  function startRename(c: Conversation, e: React.MouseEvent) {
    e.stopPropagation();
    setEditingId(c.id);
    setEditingTitle(c.title || '');
  }
  function commitRename() {
    const id = editingId;
    if (!id) return;
    const title = editingTitle.trim() || 'New chat';
    setEditingId(null);
    setChats((prev) => {
      const next = prev.map((c) => (c.id === id ? { ...c, title } : c));
      if (uid) saveChats(uid, next);
      const c = next.find((x) => x.id === id);
      if (uid && c) void syncSave(uid, c);
      return next;
    });
  }

  async function copyMsg(i: number, text: string) {
    if (await copyText(text)) {
      setCopiedIdx(i);
      setTimeout(() => setCopiedIdx((cur) => (cur === i ? null : cur)), 1500);
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
  // Recent chats: pinned first, then newest. Filtered by the search box (title +
  // message text).
  const q = chatSearch.trim().toLowerCase();
  const recentChats = chats
    .filter((c) => !q || (c.title || '').toLowerCase().includes(q) || c.messages.some((m) => m.content.toLowerCase().includes(q)))
    .sort((a, b) => {
      const pa = pinned.has(a.id) ? 1 : 0;
      const pb = pinned.has(b.id) ? 1 : 0;
      if (pa !== pb) return pb - pa; // pinned to the top
      return (b.updatedAt || 0) - (a.updatedAt || 0);
    });

  return (
    <div className="app">
      {locked && (
        <div className="lock-screen">
          <div className="lock-brand">Go Farther</div>
          <button className="lock-btn" onClick={() => void lockRef.current()}>Unlock</button>
        </div>
      )}
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
            <div className="side-search">
              <IconSearch size={15} />
              <input
                value={chatSearch}
                onChange={(e) => setChatSearch(e.target.value)}
                placeholder="Search chats"
                aria-label="Search chats"
              />
              {chatSearch && (
                <button className="side-search-x" onClick={() => setChatSearch('')} aria-label="Clear search">
                  <IconX size={13} />
                </button>
              )}
            </div>
            <div className="side-label">{q ? 'Results' : 'Recent chats'}</div>
            {recentChats.length === 0 ? (
              <div className="side-empty">No chats match that.</div>
            ) : (
              recentChats.map((c) => {
                const isPinned = pinned.has(c.id);
                const isEditing = editingId === c.id;
                return (
                  <div
                    key={c.id}
                    className={`side-item chat-item ${view === 'chat' && c.id === currentId ? 'active' : ''}`}
                    onClick={() => { if (!isEditing) selectChat(c.id); }}
                    role="button"
                    tabIndex={0}
                  >
                    {isEditing ? (
                      <input
                        className="chat-rename"
                        value={editingTitle}
                        autoFocus
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => setEditingTitle(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') commitRename(); else if (e.key === 'Escape') setEditingId(null); }}
                        onBlur={commitRename}
                      />
                    ) : (
                      <span className="chat-title">{c.title || 'New chat'}</span>
                    )}
                    {!isEditing && (
                      <span className="chat-acts">
                        <span role="button" aria-label={isPinned ? 'Unpin chat' : 'Pin chat'} className={`chat-act ${isPinned ? 'on' : ''}`} onClick={(e) => togglePin(c.id, e)}>
                          <IconPin size={14} />
                        </span>
                        <span role="button" aria-label="Rename chat" className="chat-act" onClick={(e) => startRename(c, e)}>
                          <IconEdit size={14} />
                        </span>
                        <span role="button" aria-label="Delete chat" className="chat-act" onClick={(e) => deleteChat(c.id, e)}>
                          <IconTrash size={14} />
                        </span>
                      </span>
                    )}
                  </div>
                );
              })
            )}
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
            {Capacitor.getPlatform() !== 'web' && (
              <div className="set-row" onClick={toggleFaceId} role="button" tabIndex={0} aria-pressed={faceId}>
                <div className="set-row-text">
                  <div className="set-row-title">Require Face ID</div>
                  <div className="set-row-sub">Lock the app when you open or return to it.</div>
                </div>
                <span className={`tgl ${faceId ? 'on' : ''}`}><span className="tgl-knob" /></span>
              </div>
            )}
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
                  // While only a tool-activity marker is present, AssistantMessage shows
                  // its own spinner pill — don't also blink the cursor next to it.
                  const statusOnly = streamingHere && m.content.includes('[[gfstatus:')
                    && !m.content.replace(/\[\[gfstatus:[^\]]*\]\]/g, '').replace(/\[\[gfstatus[^\]]*$/, '').trim();
                  return (
                    <div key={i} className={`msg ${m.role}`}>
                      <div className="bubble">
                        {m.role === 'assistant' ? (
                          m.failed ? (
                            <div className="msg-failed">
                              <span>⚠️ You're offline — couldn't send.</span>
                              <button className="msg-retry" onClick={retryPending}>Retry</button>
                            </div>
                          ) : (
                            <AssistantMessage text={m.content} streaming={streamingHere} onOpen={openEmail} />
                          )
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
                        {streamingHere && !statusOnly && <span className="cursor" />}
                      </div>
                      {m.role === 'assistant' && !streamingHere && plainText(m.content) && (
                        <div className="msg-actions">
                          <button className="msg-act" aria-label="Copy message" onClick={() => copyMsg(i, plainText(m.content))}>
                            {copiedIdx === i ? <IconCheck size={14} /> : <IconCopy size={14} />}
                            <span className="msg-act-label">{copiedIdx === i ? 'Copied' : 'Copy'}</span>
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {!online && (
            <div className="net-banner">You're offline — messages will send when you reconnect.</div>
          )}
          <div className="composer-wrap">
            {(plusOpen || connMenu) && (
              <div
                className={`conn-pop-backdrop ${plusOpen ? 'radial-scrim' : ''}`}
                onClick={() => {
                  if (Date.now() - menuOpenedAt.current < 400) return; // ignore the tap's ghost-click
                  setPlusOpen(false);
                  setConnMenu(false);
                }}
              />
            )}

            {/* "+" radial menu: attach options rise up from the + as circles,
                staggered bottom-to-top; labels sit to the right (no overlap) */}
            {plusOpen && (
              <div className="radial" role="menu">
                <button className="radial-item" style={{ left: 0, bottom: 240, animationDelay: '150ms' }} onClick={() => openPicker('camera')}>
                  <IconCamera size={20} /><span className="radial-label">Camera</span>
                </button>
                <button className="radial-item" style={{ left: 24, bottom: 180, animationDelay: '100ms' }} onClick={() => openPicker('photos')}>
                  <IconPhotos size={20} /><span className="radial-label">Photos</span>
                </button>
                <button className="radial-item" style={{ left: 48, bottom: 120, animationDelay: '50ms' }} onClick={() => openPicker('files')}>
                  <IconFiles size={20} /><span className="radial-label">Files</span>
                </button>
                <button className="radial-item" style={{ left: 72, bottom: 60, animationDelay: '0ms' }} onClick={() => { menuOpenedAt.current = Date.now(); setPlusOpen(false); setConnMenu(true); }}>
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
                  onClick={() => { menuOpenedAt.current = Date.now(); setConnMenu(false); setPlusOpen((o) => !o); }}
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
