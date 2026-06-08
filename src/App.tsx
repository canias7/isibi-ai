import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { Session } from '@supabase/supabase-js';
import { streamChat, sendTestPush, extractMemory, type ChatMessage, type Attach } from './api';
import { supabase } from './supabase';
import { CONNECTORS, CONNECT_API } from './connectorData';
import ConnectorsGraph from './ConnectorsGraph';
import AssistantMessage from './AssistantMessage';
import type { EmailItem } from './EmailList';
import { IconMenu, IconCompose, IconChat, IconConnectors, IconSettings, IconLogout, IconTrash, IconCamera, IconFiles, IconX, IconDoc, IconSearch, IconEdit, IconPin, IconCopy, IconCheck, IconMemory, IconWorkflow } from './icons';
import { listMemories, addMemory, updateMemory, deleteMemory, getMemoryEnabled, setMemoryEnabled, uploadMemoryFile, type Memory } from './memory';
import MemoryGraph from './MemoryGraph';
import WorkflowsScreen from './WorkflowsScreen';
import { App as CapApp } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { tap } from './haptics';
import { biometryAvailable, unlock } from './biometric';
import { registerPush, pushStatus } from './push';
import { capturePhoto } from './camera';
import { fileToAttachment } from './attach';

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

// Is the server's copy of a conversation a *more complete* version of what we
// hold locally? True when it has more messages, or the same turns but a finished
// assistant reply where ours is still empty/failed. This lets resume + retry
// adopt a turn the backend completed while we were disconnected — instead of
// re-running it, which would duplicate any action it performed (a second send, a
// second delete). A shorter or empty server copy is never "more complete".
function serverIsMoreComplete(local: ChatMessage[], remote: ChatMessage[]): boolean {
  if (remote.length === 0) return false;
  if (remote.length > local.length) return true;
  if (remote.length < local.length) return false;
  const ours = local[local.length - 1];
  const theirs = remote[remote.length - 1];
  if (!theirs || theirs.role !== 'assistant' || theirs.content.trim() === '') return false; // server has no real reply yet
  if (!ours || ours.role !== 'assistant' || ours.failed) return true; // ours is missing/failed
  // Same turn, both assistant: adopt if the server's reply is more complete than
  // ours — ours was empty, or only partially streamed before we disconnected.
  return theirs.content.trim().length > ours.content.trim().length;
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

// Attachment conversion (size cap + image downscale) lives in ./attach, shared
// with the Memory composer.

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

// Short label for the model that answered (from the x-gf-model header).
function modelShort(m: string): string {
  if (/haiku/i.test(m)) return 'haiku';
  if (/sonnet/i.test(m)) return 'sonnet';
  if (/opus/i.test(m)) return 'opus';
  return m.replace(/^claude-/, '');
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
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s);
      // Login is deactivated: if the session ever goes away (sign-out/expiry),
      // silently re-establish a guest one instead of showing a login wall.
      if (!s && !REQUIRE_LOGIN) supabase.auth.signInAnonymously().catch(() => {});
    });
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
  const [noteMsg, setNoteMsg] = useState(''); // transient Settings note (e.g. why a toggle didn't stick)
  // App-level memory (manual; global across chats). Loaded when the Memory screen opens.
  const [memories, setMemories] = useState<Memory[]>([]);
  const [memLoaded, setMemLoaded] = useState(false);
  const [memOpen, setMemOpen] = useState(false);
  // Whole-feature on/off (paused = not fed into chats and the save tool is dropped).
  const [memEnabled, setMemEnabled] = useState(() => { try { return localStorage.getItem('gf_memory_on') !== '0'; } catch { return true; } });
  const [wfOpen, setWfOpen] = useState(false); // Workflows screen (placeholder for now)
  const scrollRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const bgAbortRef = useRef(false);    // the in-flight turn was aborted by backgrounding (vs. the Stop button)
  const jumpRef = useRef(true);        // next scroll should jump instantly (chat opened/restored)
  const awaySinceRef = useRef(0);      // when the app was last backgrounded
  const busyRef = useRef(false);       // latest busy/messages for the resume listener (avoids stale closures)
  const msgLenRef = useRef(0);
  const messagesRef = useRef<ChatMessage[]>([]); // latest messages, for content-based resume/retry checks
  const currentIdRef = useRef(currentId);        // latest open chat id, for async adopt/poll guards
  currentIdRef.current = currentId;
  const dirtyRef = useRef(false);      // a real turn changed messages -> persist (not just open/restore)
  const [online, setOnline] = useState(true);                 // network status (drives the offline banner)
  const pendingTurnRef = useRef<ChatMessage[] | null>(null);  // a turn that failed offline, awaiting retry
  const retryingRef = useRef(false);                          // a retry is mid-flight (serializes online + manual taps)
  const retryRef = useRef<() => void>(() => {});              // latest retryPending, for the online listener
  const resumeRef = useRef<() => void>(() => {});             // refresh current chat on resume (server-finished turn)
  // Face ID / biometric lock (opt-in; native-only; fails open).
  const [faceId, setFaceId] = useState(() => { try { return localStorage.getItem('gf_faceid') === '1'; } catch { return false; } });
  const [locked, setLocked] = useState(() => { try { return localStorage.getItem('gf_faceid') === '1' && Capacitor.getPlatform() !== 'web'; } catch { return false; } });
  const faceIdRef = useRef(faceId);
  faceIdRef.current = faceId;
  const lockRef = useRef<() => void>(() => {});
  const [notif, setNotif] = useState(() => { try { return localStorage.getItem('gf_notif') === '1'; } catch { return false; } });

  // ---- Per-session connectors ----
  // Which apps are connected (from the backend), which are enabled for THIS
  // session (toggles), and whether we've loaded yet. Disabling a connector here
  // only scopes it out of this chat — it stays connected globally.
  const [connApps, setConnApps] = useState<string[]>([]);
  const [enabled, setEnabled] = useState<Set<string>>(new Set());
  const [connLoaded, setConnLoaded] = useState(false);
  const [plusOpen, setPlusOpen] = useState(false);
  const [attachments, setAttachments] = useState<Attach[]>([]);
  const [attachErr, setAttachErr] = useState('');
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
  useEffect(() => { busyRef.current = busy; msgLenRef.current = messages.length; messagesRef.current = messages; }, [busy, messages]);

  // Switching to a different chat (or a fresh one on resume) abandons any retry
  // queued for the previous chat — otherwise the next online event / Retry tap
  // would replay that old turn into the chat now open. The failed bubble doesn't
  // survive a chat switch either, so this just matches what's on screen.
  useEffect(() => { pendingTurnRef.current = null; retryingRef.current = false; setCopiedIdx(null); }, [currentId]);

  // A short-lived note in Settings (auto-clears) — used to explain why a toggle
  // didn't turn on (no biometrics, notifications denied, …).
  function flashNote(msg: string, ms = 4500) {
    setNoteMsg(msg);
    setTimeout(() => setNoteMsg((m) => (m === msg ? '' : m)), ms);
  }

  // Coming back after a while should feel fresh: if the app was backgrounded for
  // longer than NEW_CHAT_AFTER_MS, resume into a brand-new chat instead of the old
  // conversation. Short trips away keep you exactly where you were.
  useEffect(() => {
    let handle: { remove: () => void } | undefined;
    void CapApp.addListener('appStateChange', ({ isActive }) => {
      if (!isActive) {
        awaySinceRef.current = Date.now();
        // Leaving mid-reply: close the connection so the server notices we're gone
        // and pushes when it's done. (iOS otherwise just suspends the socket, so
        // the server never sees the disconnect and never sends the "ready" push.)
        if (busyRef.current && abortRef.current) { bgAbortRef.current = true; abortRef.current.abort(); }
        return;
      }
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
      } else {
        void resumeRef.current(); // pick up a turn that finished server-side while away
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

  // Refresh the push registration on launch if notifications are enabled.
  useEffect(() => {
    if (notif) void registerPush();
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
            copy[copy.length - 1] = { ...last, role: 'assistant', content: last.content + tok };
            return copy;
          });
        },
        controller.signal,
        apps,
        currentId,
        (mdl) => {
          setMessages((m) => {
            const copy = m.slice();
            const last = copy[copy.length - 1];
            if (last && last.role === 'assistant') copy[copy.length - 1] = { ...last, model: mdl };
            return copy;
          });
        },
        memEnabled,
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
      // Backgrounded mid-reply: we closed the connection on purpose so the server
      // finishes the turn and pushes "ready". Don't show an error — keep whatever
      // streamed (or a calm "finishing" line); the resume refresh swaps in the
      // server's complete reply when we return (and the push tells us when).
      if (bgAbortRef.current) {
        bgAbortRef.current = false;
        dirtyRef.current = false;
        setMessages((m) => {
          const copy = m.slice();
          const l = copy[copy.length - 1];
          if (l && l.role === 'assistant' && l.content === '' && !l.failed) {
            copy[copy.length - 1] = { role: 'assistant', content: '', failed: true, offline: false };
          }
          return copy;
        });
        return;
      }
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
      // hard error. It auto-retries when connectivity returns. The backend may
      // still finish the turn (it keeps running after we disconnect), so we also
      // poll briefly to adopt a completed reply without a manual retry.
      if (!timedOut && (!navigator.onLine || isNetworkError(e))) {
        dirtyRef.current = false; // don't persist a failed placeholder turn
        pendingTurnRef.current = history;
        // Genuinely offline vs. just backgrounded mid-reply (still online, server
        // keeps finishing + will push). The bubble wording differs accordingly.
        const wasOffline = !navigator.onLine;
        setMessages((m) => {
          const copy = m.slice();
          copy[copy.length - 1] = { role: 'assistant', content: '', failed: true, offline: wasOffline };
          return copy;
        });
        pollForCompletion(history);
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

  // Adopt the server's copy of a chat (a turn it finished while we were
  // disconnected). Always updates the saved list; only swaps the visible
  // messages when we're actually looking at that chat. Stands down any pending
  // retry so the turn is never re-run (which would duplicate its action).
  function adoptConversation(cur: Conversation) {
    if (!uid) return;
    pendingTurnRef.current = null;
    setChats((prev) => { const next = [cur, ...prev.filter((c) => c.id !== cur.id)]; saveChats(uid, next); return next; });
    if (cur.id !== currentIdRef.current) return; // not the open chat — list updated, don't disturb the view
    jumpRef.current = true;
    abortRef.current?.abort(); // stop a dying fetch from clobbering the adopted reply
    setMessages(cur.messages);
  }

  // Re-run the turn that failed offline — manual tap, or auto when back online.
  // First check whether the backend already finished it: re-running a completed
  // action would duplicate it (send the same email twice, delete twice), so if
  // the server already holds the reply we adopt that instead of sending again.
  async function retryPending() {
    if (retryingRef.current || busyRef.current) return; // already retrying, or a turn is in flight
    const hist = pendingTurnRef.current;
    if (!hist) return;
    retryingRef.current = true; // claim it so a concurrent online event + manual tap can't both re-run the turn
    try {
      if (uid) {
        const remote = await syncLoad(uid);
        if (pendingTurnRef.current !== hist) return; // adopted/replaced while we loaded
        const cur = remote?.find((c) => c.id === currentId);
        if (cur && serverIsMoreComplete(messagesRef.current, cur.messages)) { adoptConversation(cur); return; }
      }
      if (busyRef.current || pendingTurnRef.current !== hist) return; // a new turn started meanwhile — leave it queued
      pendingTurnRef.current = null;
      void runTurn(hist);
    } finally {
      retryingRef.current = false;
    }
  }
  retryRef.current = retryPending;

  // On resume (and while a failed turn is pending), pull any turn that finished
  // server-side while we were away — the backend completes + saves a turn even if
  // the app was backgrounded or the connection dropped mid-reply. Content-aware:
  // it adopts when the server has a real reply where ours is still empty/failed,
  // even when the message counts match.
  async function refreshCurrent() {
    if (!uid) return;
    const remote = await syncLoad(uid);
    const cur = remote?.find((c) => c.id === currentId);
    if (cur && serverIsMoreComplete(messagesRef.current, cur.messages)) adoptConversation(cur);
  }
  resumeRef.current = refreshCurrent;

  // After an offline failure, poll a few times (~30s) so a turn the backend is
  // still finishing shows up on its own — the eventual reply replaces the
  // "failed" bubble without the user having to tap Retry. Stops as soon as it
  // adopts, gets retried, or is superseded by a newer turn.
  function pollForCompletion(history: ChatMessage[]) {
    let n = 0;
    const tick = async () => {
      if (pendingTurnRef.current !== history) return;
      await refreshCurrent();
      if (pendingTurnRef.current !== history) return;
      if (++n < 6) window.setTimeout(tick, 5000);
    };
    window.setTimeout(tick, 4000);
  }

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

  // Turning Face ID on only sticks if the device can actually do biometrics —
  // otherwise the toggle would read "on" while the lock silently never engages.
  async function toggleFaceId() {
    const next = !faceIdRef.current;
    if (next && !(await biometryAvailable())) {
      flashNote('Face ID / Touch ID isn’t set up on this device.');
      return;
    }
    try { localStorage.setItem('gf_faceid', next ? '1' : '0'); } catch { /* ignore */ }
    setFaceId(next);
  }

  // Same for notifications: only show "on" if permission was actually granted, so
  // the toggle never lies about whether pushes will arrive.
  async function toggleNotif() {
    const next = !notif;
    if (next && !(await registerPush())) {
      flashNote('Allow notifications for Go Farther in iOS Settings to turn this on.');
      return;
    }
    try { localStorage.setItem('gf_notif', next ? '1' : '0'); } catch { /* ignore */ }
    setNotif(next);
  }

  // One-tap end-to-end check: ask the backend to push us a test notification.
  async function testPush() {
    flashNote('Sending a test notification…');
    try {
      const r = await sendTestPush();
      if (!r.ok) {
        if (r.error === 'no registered devices') {
          flashNote(`No device registered. ${pushStatus() || 'Toggle Notifications off/on and tap Allow.'}`, 9000);
        } else {
          flashNote(`Couldn’t send: ${r.error || 'unknown error'}`, 9000);
        }
        return;
      }
      // Server accepted it — report what APNs actually said (200 = delivered).
      const d = r.sent?.[0];
      if (!d) { flashNote('Sent — check your lock screen.'); return; }
      if (d.status === 200) { flashNote('Sent ✓ — check your lock screen.'); return; }
      const why = (d.reason || '').replace(/[{}"]/g, '').trim().slice(0, 90);
      flashNote(`APNs rejected it (${d.status}): ${why || 'unknown'}`, 12000);
    } catch {
      flashNote('Couldn’t reach the server — try again.');
    }
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
  async function openPicker(mode: 'camera' | 'attachments') {
    setPlusOpen(false);
    // Camera: real in-app capture via the native plugin. Only fall back to the
    // HTML file input when it's unavailable (web / no plugin) — not on cancel.
    if (mode === 'camera') {
      const r = await capturePhoto('camera');
      if (r.status === 'ok') { setAttachments((prev) => [...prev, r.attach].slice(-6)); return; }
      if (r.status === 'cancel') return;
    }
    // Attachments: one picker for photos AND files — the OS sheet offers Photo
    // Library / Take Photo / Choose File, so both live under a single entry.
    const input = fileRef.current;
    if (!input) return;
    input.value = '';
    if (mode === 'camera') {
      input.multiple = false;
      input.accept = 'image/*';
      input.setAttribute('capture', 'environment');
    } else {
      input.multiple = true;
      input.accept = 'image/*,application/pdf';
      input.removeAttribute('capture');
    }
    input.click();
  }
  async function onFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = '';
    let err = '';
    for (const f of files) {
      const { attach, error } = await fileToAttachment(f);
      if (attach) setAttachments((prev) => [...prev, attach].slice(-6));
      else if (error) err = error;
    }
    if (err) {
      setAttachErr(err);
      setTimeout(() => setAttachErr(''), 4000);
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

  function openMemory() {
    setMemOpen(true);
    setSidebarOpen(false);
    void loadMems();
    // Sync the on/off state from the server (source of truth across devices).
    void getMemoryEnabled().then((on) => {
      setMemEnabled(on);
      try { localStorage.setItem('gf_memory_on', on ? '1' : '0'); } catch { /* ignore */ }
    });
  }

  function closeMemory() {
    setMemOpen(false);
  }


  async function loadMems() {
    if (!uid) return;
    setMemLoaded(false);
    const list = await listMemories();
    setMemories(list);
    setMemLoaded(true);
  }

  async function addMem(content: string): Promise<boolean> {
    const c = content.trim();
    if (!c) return false;
    const m = await addMemory(c);
    if (m) { setMemories((prev) => [m, ...prev]); return true; }
    flashNote("Couldn't save that memory — try again.");
    return false;
  }

  // Add a memory from an attachment: read its contents into text (vision) AND
  // keep the original file in storage, in parallel.
  async function addMemFile(note: string, attach: Attach): Promise<boolean> {
    const [text, path] = await Promise.all([
      extractMemory(attach, note).catch(() => ''),
      uploadMemoryFile(attach),
    ]);
    const content = (text || note || attach.name || 'Attachment').trim();
    const m = await addMemory(content, path ? { path, type: attach.kind, name: attach.name } : undefined);
    if (m) { setMemories((prev) => [m, ...prev]); return true; }
    flashNote("Couldn't save that attachment — try again.");
    return false;
  }

  async function updateMem(id: string, content: string): Promise<boolean> {
    const c = content.trim();
    if (!c) return false;
    const ok = await updateMemory(id, c);
    if (ok) setMemories((prev) => prev.map((m) => (m.id === id ? { ...m, content: c } : m)));
    else flashNote("Couldn't update that memory — try again.");
    return ok;
  }

  function delMem(id: string) {
    setMemories((prev) => prev.filter((m) => m.id !== id)); // optimistic
    void deleteMemory(id).then((ok) => { if (!ok) void loadMems(); }); // restore on failure
  }

  function toggleMem(next: boolean) {
    setMemEnabled(next);
    try { localStorage.setItem('gf_memory_on', next ? '1' : '0'); } catch { /* ignore */ }
    void setMemoryEnabled(next); // persist server-side so workflows respect it too
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
  // Login screen deactivated for now — show the neutral splash while the silent
  // (persisted or guest) session establishes, never a sign-in wall.
  if (!session) {
    return (
      <div className="auth">
        <div className="auth-brand">Go Farther</div>
      </div>
    );
  }

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
          <button className={`side-item ${memOpen ? 'active' : ''}`} onClick={openMemory}>
            <span className="ico"><IconMemory size={18} /></span> Memory
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
        <ConnectorsGraph onClose={() => go('chat')} />
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
            {Capacitor.getPlatform() !== 'web' && (
              <div className="set-row" onClick={toggleNotif} role="button" tabIndex={0} aria-pressed={notif}>
                <div className="set-row-text">
                  <div className="set-row-title">Notifications</div>
                  <div className="set-row-sub">Get push alerts from Go Farther.</div>
                </div>
                <span className={`tgl ${notif ? 'on' : ''}`}><span className="tgl-knob" /></span>
              </div>
            )}
            {Capacitor.getPlatform() !== 'web' && notif && (
              <button className="set-test-btn" onClick={testPush}>Send a test notification</button>
            )}
            {noteMsg && <p className="set-note">{noteMsg}</p>}
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
                  // No visible text yet → AssistantMessage shows its own "thinking"
                  // (or tool-activity) indicator, so don't also blink the bare cursor.
                  const thinking = streamingHere
                    && !m.content.replace(/\[\[gfstatus:[^\]]*\]\]/g, '').replace(/\[\[gfstatus[^\]]*$/, '').trim();
                  return (
                    <div key={i} className={`msg ${m.role}`}>
                      <div className="bubble">
                        {m.role === 'assistant' ? (
                          m.failed ? (
                            m.offline ? (
                              <div className="msg-failed">
                                <span>⚠️ You're offline — couldn't send.</span>
                                <button className="msg-retry" onClick={retryPending}>Retry</button>
                              </div>
                            ) : (
                              <div className="msg-working">
                                <span className="gf-status-spin" aria-hidden />
                                <span>Finishing in the background — I'll notify you when it's ready.</span>
                                <button className="msg-retry" onClick={retryPending}>Refresh</button>
                              </div>
                            )
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
                        {streamingHere && !thinking && <span className="cursor" />}
                      </div>
                      {m.role === 'assistant' && !streamingHere && (plainText(m.content) || m.model) && (
                        <div className="msg-actions">
                          {plainText(m.content) && (
                            <button className="msg-act" aria-label="Copy message" onClick={() => copyMsg(i, plainText(m.content))}>
                              {copiedIdx === i ? <IconCheck size={14} /> : <IconCopy size={14} />}
                              <span className="msg-act-label">{copiedIdx === i ? 'Copied' : 'Copy'}</span>
                            </button>
                          )}
                          {m.model && <span className="msg-model" title={m.model}>{modelShort(m.model)}</span>}
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
            {plusOpen && (
              <div
                className="conn-pop-backdrop radial-scrim"
                onClick={() => {
                  if (Date.now() - menuOpenedAt.current < 400) return; // ignore the tap's ghost-click
                  setPlusOpen(false);
                }}
              />
            )}

            {/* "+" radial menu: attach options rise up from the + as circles,
                staggered bottom-to-top; labels sit to the right (no overlap) */}
            {plusOpen && (
              <div className="radial" role="menu">
                <button className="radial-item" style={{ left: 0, bottom: 300, animationDelay: '200ms' }} onClick={() => { setPlusOpen(false); openMemory(); }}>
                  <IconMemory size={20} /><span className="radial-label">Memory</span>
                </button>
                <button className="radial-item" style={{ left: 24, bottom: 240, animationDelay: '150ms' }} onClick={() => openPicker('camera')}>
                  <IconCamera size={20} /><span className="radial-label">Camera</span>
                </button>
                <button className="radial-item" style={{ left: 48, bottom: 180, animationDelay: '100ms' }} onClick={() => openPicker('attachments')}>
                  <IconFiles size={20} /><span className="radial-label">Attachments</span>
                </button>
                <button className="radial-item" style={{ left: 72, bottom: 120, animationDelay: '50ms' }} onClick={() => { setPlusOpen(false); void loadConnectors(); setWfOpen(true); }}>
                  <IconWorkflow size={20} /><span className="radial-label">Workflows</span>
                </button>
                <button className="radial-item" style={{ left: 96, bottom: 60, animationDelay: '0ms' }} onClick={() => { setPlusOpen(false); go('connectors'); }}>
                  <IconConnectors size={20} /><span className="radial-label">Connectors</span>
                </button>
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
              {attachErr && <div className="att-err">{attachErr}</div>}
              <div className="composer-row">
                <button
                  className={`plus-btn ${plusOpen ? 'open' : ''}`}
                  onClick={() => { menuOpenedAt.current = Date.now(); setPlusOpen((o) => !o); }}
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

      {memOpen && (
        <MemoryGraph
          memories={memories}
          loaded={memLoaded}
          enabled={memEnabled}
          onAdd={addMem}
          onAddFile={addMemFile}
          onUpdate={updateMem}
          onDelete={delMem}
          onToggle={toggleMem}
          onClose={closeMemory}
        />
      )}

      {wfOpen && <WorkflowsScreen connApps={connApps} onClose={() => setWfOpen(false)} />}
    </div>
  );
}
