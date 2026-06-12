import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import type { Session } from '@supabase/supabase-js';
import { streamChat, sendTestPush, extractMemory, reachedServer, titleFor, type ChatMessage, type Attach } from './api';
import { supabase } from './supabase';
import { CONNECTORS, CONNECT_API } from './connectorData';
import Login from './Login';
import AssistantMessage from './AssistantMessage';
import type { EmailItem } from './EmailList';
import { IconMenu, IconCompose, IconConnectors, IconTrash, IconCamera, IconFiles, IconX, IconDoc, IconEdit, IconPin, IconCopy, IconCheck, IconMemory, IconWorkflow, IconWaveform, IconClock, IconMic, IconArrowUp, IconArrowDown, IconPlus, IconThumbUp, IconThumbDown, IconLogout } from './icons';
import { primeAudio, resumeAudio, audioState, closeAudio, listenOnce, transcribe, micSupported } from './voice';
import { sentSound, replySound, soundsOn, setSoundsOn, soundTheme, setSoundTheme, type SoundTheme } from './earcons';
import { ITEMS as WN_ITEMS, shouldShowWhatsNew, markWhatsNewSeen } from './whatsnew';
import { pickSuggestions } from './suggestions';
import { fetchUsage, summarize, fmtUsd, fmtTokens, fmtDuration, sourceLabel, loadBudget, saveBudget, type UsageSummary } from './usage';
import { MODEL_OPTIONS, type ModelChoice } from './models';
import { track } from './analytics';
import { useFocusTrap, radioArrowNav, isArrowSelecting } from './a11y';
import { listReminders, addReminder, updateReminder, deleteReminder, ensureNotifyPermission, scheduleReminder, cancelReminder, syncReminders, registerReminderActions, onReminderAction, snoozeNudge, cancelAllReminderNotifications, type Reminder, type RepeatKind } from './reminders';
import { listMemories, addMemory, updateMemory, deleteMemory, getMemoryEnabled, setMemoryEnabled, uploadMemoryFile, type Memory } from './memory';
import { loadReminderSound, saveReminderSound, previewReminderSound } from './reminderSounds';
import { App as CapApp } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { tap, bump, thud } from './haptics';
import { onPushTap, onPushReceived, isRemindersSync } from './push';
import { useDismiss } from './motion';
import ErrorBoundary from './ErrorBoundary';
import RecoveryBubble from './RecoveryBubble';
import SunOrb from './SunOrb';
import SettingsPage from './SettingsPage';
import LegalSheet from './LegalSheet';
import { PRIVACY_MD, TERMS_MD } from './legalDocs';
import SidebarNav from './SidebarNav';
import { loadChats, saveChats, loadPins, savePins, syncLoad, syncLoadOlder, syncSave, syncDelete, wipeStoredChats, loadDrafts, saveDrafts, loadChatModels, saveChatModels, loadQueuedMsg, saveQueuedMsg, MAX_CHATS, type Conversation } from './chatSync';
import { biometryAvailable, biometryStatus, unlock, type BiometryStatus } from './biometric';
import { registerPush, pushStatus } from './push';
import { fileToAttachment } from './attach';
import { getLocation } from './geo';
import { isNetworkError, serverIsMoreComplete, withoutPlaceholders, titleFrom, cleanForDisplay, modelShort, plainText, decideRetry, mergeQueued } from './chatUtils';
import { FORCE_UPDATE_EVENT, type ForceUpdateMode } from './ota';

// Heavy, on-demand screens are code-split: their JS downloads only when first
// opened, shrinking the initial bundle and speeding up launch.
const ConnectorsGraph = lazy(() => import('./ConnectorsGraph'));
const MemoryGraph = lazy(() => import('./MemoryGraph'));
const WorkflowsScreen = lazy(() => import('./WorkflowsScreen'));
const CallScreen = lazy(() => import('./CallScreen'));
const RemindersGraph = lazy(() => import('./RemindersGraph'));

// Compact fallback for a crashed overlay: the screen closes instead of the
// whole app white-screening (the root boundary stays as the last resort).
function OverlayCrash({ onClose }: { onClose: () => void }) {
  return (
    <div className="memg" role="alertdialog" aria-label="Screen error">
      <div className="overlay-crash">
        <span className="brand-orb" style={{ width: 40, height: 40 }} aria-hidden />
        <p>This screen hit a problem.</p>
        <button className="lock-btn" onClick={onClose}>Close</button>
      </div>
    </div>
  );
}

// Shown while a lazily-loaded screen's chunk downloads — a centered spinner over
// a full-screen scrim instead of a blank flash.
function RouteFallback() {
  return (
    <div className="route-fallback" role="status" aria-label="Loading">
      <span className="route-spin" />
    </div>
  );
}

type View = 'chat' | 'connectors' | 'settings';

// A message looks location-relevant → capture device location for it (see geo.ts).
const LOCATION_RE = /\b(here|near\s?me|nearby|around me|close by|closest|nearest|my (location|area|city|place|spot)|where am i|directions|commute|weather|forecast|temperature|raining|umbrella)\b/i;
// Backgrounded for longer than this → resume into a fresh chat instead of the
// old conversation. Shorter trips away keep you where you left off.
const NEW_CHAT_AFTER_MS = 30 * 60 * 1000; // 30 minutes

// Starter prompts shown on the home screen (tap to send).


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

// Relative label + date bucket for sidebar chat rows.
function dayStart(t: number): number {
  const d = new Date(t);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}
function chatGroup(ts: number): string {
  const diff = Math.round((dayStart(Date.now()) - dayStart(ts || Date.now())) / 86400000);
  if (diff <= 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  if (diff < 7) return 'Previous 7 days';
  return 'Older';
}

// ---- Cloud sync (conversations table, RLS-scoped to this user) ----
// Attachment conversion (size cap + image downscale) lives in ./attach, shared
// with the Memory composer.

// Render one attachment — image thumbnail, or a file chip (also the fallback for
// images whose base64 was stripped on persist).
function AttView({ a, onTap }: { a: Attach; onTap?: (src: string) => void }) {
  if (a.kind === 'image' && a.data) {
    const src = `data:${a.mediaType};base64,${a.data}`;
    if (onTap) {
      return (
        <button className="att-img-btn" onClick={() => onTap(src)} aria-label={`View image: ${a.name}`}>
          <img className="att-img" src={src} alt={a.name} />
        </button>
      );
    }
    return <img className="att-img" src={src} alt={a.name} />;
  }
  return (
    <span className="att-file">
      <IconDoc size={16} />
      <span className="att-file-name">{a.name}</span>
    </span>
  );
}

function cid(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }
}

// Flip to `true` to show the email/password login screen. When `false`, the app
// skips the login UI and uses a silent anonymous "guest" session, so identity
// (per-user connectors + history) still works without a sign-in wall.
// Requires "Allow anonymous sign-ins" enabled in Supabase → Authentication.
const REQUIRE_LOGIN = true;

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
  const [menuChat, setMenuChat] = useState<Conversation | null>(null); // long-press chat actions sheet
  const pressTimer = useRef<number | null>(null);
  const pressFired = useRef(false); // swallow the click that follows a long-press
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);
  const [noteMsg, setNoteMsg] = useState(''); // transient Settings note (e.g. why a toggle didn't stick)
  // App-level memory (manual; global across chats). Loaded when the Memory screen opens.
  const [memories, setMemories] = useState<Memory[]>([]);
  const [memLoaded, setMemLoaded] = useState(false);
  const [memErr, setMemErr] = useState(false); // last load FAILED — show retry, not "no memories yet"
  const [memOpen, setMemOpen] = useState(false);
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [remLoaded, setRemLoaded] = useState(false);
  const [remErr, setRemErr] = useState(false);
  const [remOpen, setRemOpen] = useState(false);
  // Whole-feature on/off (paused = not fed into chats and the save tool is dropped).
  const [memEnabled, setMemEnabled] = useState(() => { try { return localStorage.getItem('gf_memory_on') !== '0'; } catch { return true; } });
  const [wfOpen, setWfOpen] = useState(false); // Workflows screen (placeholder for now)
  const [callOpen, setCallOpen] = useState(false); // voice "call mode" overlay
  const scrollRef = useRef<HTMLDivElement>(null);
  // Scroll anchoring: only auto-follow the stream while the user is AT the
  // bottom. Scrolled up to re-read? The chat stays put and a "jump to latest"
  // pill appears (with a dot once new reply text lands out of view).
  const [atBottom, setAtBottom] = useState(true);
  const atBottomRef = useRef(true);
  const [unseen, setUnseen] = useState(false);
  function onThreadScroll() {
    const el = scrollRef.current;
    if (!el) return;
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    if (near !== atBottomRef.current) {
      atBottomRef.current = near;
      setAtBottom(near);
      if (near) setUnseen(false);
    }
  }
  // Per-chat drafts: saved as you type (debounced), restored when a chat opens.
  const draftsRef = useRef<Record<string, string>>({});
  const draftTimer = useRef<number | null>(null);
  function setDraft(id: string, text: string) {
    if (text.trim()) draftsRef.current[id] = text; else delete draftsRef.current[id];
    if (draftTimer.current) clearTimeout(draftTimer.current);
    if (uid) draftTimer.current = window.setTimeout(() => saveDrafts(uid, draftsRef.current), 400);
  }

  // Full-screen viewer for images in chat bubbles (same dialog the email
  // reader uses): trap + animated dismissal + latched src.
  const [lightbox, setLightbox] = useState<string | null>(null);
  const lightboxRef = useRef<HTMLDivElement>(null);
  useFocusTrap(!!lightbox, lightboxRef, () => setLightbox(null));
  const lightboxUi = useDismiss(!!lightbox);
  const lastLightbox = useRef(lightbox);
  if (lightbox) lastLightbox.current = lightbox;
  const lightboxSrc = lightbox ?? lastLightbox.current;

  // Long threads render only their tail (windowing): the DOM stays small no
  // matter how long a conversation gets. "Show earlier" pages upward, holding
  // the scroll position so nothing jumps.
  const [visCount, setVisCount] = useState(60);
  const prevHeightRef = useRef<number | null>(null);
  function showEarlier() {
    prevHeightRef.current = scrollRef.current?.scrollHeight ?? null;
    setVisCount((c) => c + 100);
  }
  useLayoutEffect(() => {
    const el = scrollRef.current;
    const prev = prevHeightRef.current;
    prevHeightRef.current = null;
    if (el && prev != null) el.scrollTop += el.scrollHeight - prev;
  }, [visCount]);

  function jumpToLatest() {
    const el = scrollRef.current;
    if (!el) return;
    setUnseen(false);
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }
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
  // A turn whose connection failed, awaiting recovery. `sent` records whether the
  // request reached the server: if it did, the server finishes the turn and we may
  // only ADOPT its saved reply (re-sending could run an action twice); if it never
  // got out, re-sending is safe and is done automatically.
  const pendingTurnRef = useRef<{ msgs: ChatMessage[]; sent: boolean } | null>(null);
  const retryingRef = useRef(false);                          // a retry is mid-flight (serializes online + manual taps)
  const retryRef = useRef<(force?: boolean) => void>(() => {}); // latest retryPending, for the online listener
  const resumeRef = useRef<() => void>(() => {});             // refresh current chat on resume (server-finished turn)
  const bgWaitRef = useRef<{ convId: string; msgs: ChatMessage[] } | null>(null); // a turn the SERVER is still finishing after we backgrounded — adopt its reply, never re-run it
  const bgPollSeqRef = useRef(0);                             // newest pollServerTurn loop wins (no stacked timers)
  const bgPollRef = useRef<(firstDelay?: number) => void>(() => {}); // latest pollServerTurn, for the resume listener
  // Face ID / biometric lock (opt-in; native-only; fails open).
  const [faceId, setFaceId] = useState(() => { try { return localStorage.getItem('gf_faceid') === '1'; } catch { return false; } });
  const [locked, setLocked] = useState(() => { try { return localStorage.getItem('gf_faceid') === '1' && Capacitor.getPlatform() !== 'web'; } catch { return false; } });
  const faceIdRef = useRef(faceId);
  faceIdRef.current = faceId;
  const [bioStatus, setBioStatus] = useState<BiometryStatus | 'unknown'>('unknown'); // gates the Face ID row
  const [confirmDelete, setConfirmDelete] = useState(false); // delete-account confirm sheet
  const [confirmSignOut, setConfirmSignOut] = useState(false); // sign-out confirm sheet (one tap drops local data)
  const [deleting, setDeleting] = useState(false);
  const [forceUpdate, setForceUpdate] = useState<ForceUpdateMode | null>(null); // hard update gate (from ota.ts)
  const [wnOpen, setWnOpen] = useState(false); // "What's new" sheet (once per announced edition)
  const [legalDoc, setLegalDoc] = useState<'privacy' | 'terms' | null>(null); // in-app Privacy/Terms reader
  const [usageOpen, setUsageOpen] = useState(false);             // AI-usage sheet (the ≈$ chip bottom-right)
  const [usageSum, setUsageSum] = useState<UsageSummary | null>(null);
  const [budget, setBudget] = useState(loadBudget);              // self-set monthly ceiling for the spend bar
  const [editBudget, setEditBudget] = useState(false);
  const [model, setModel] = useState<ModelChoice>('auto');       // open chat's model choice (auto = backend routes)
  const [modelOpen, setModelOpen] = useState(false);             // model-picker sheet
  const modelRef = useRef<ModelChoice>(model);
  modelRef.current = model;
  // Per-chat model choices (device-local map, like drafts): each conversation
  // remembers the model you picked for it; a fresh chat starts back on 'auto'.
  const modelsRef = useRef<Record<string, ModelChoice>>({});
  const [micState, setMicState] = useState<'idle' | 'rec' | 'tx'>('idle'); // composer dictation
  const micFinishRef = useRef<AbortController | null>(null);
  const lockRef = useRef<() => void>(() => {});
  const unlockingRef = useRef(false); // a biometric prompt is mid-flight — never stack a second one
  const lastUnlockRef = useRef(0);    // the prompt's own dismiss fires an `active` event — don't re-engage off it
  const appShellRef = useRef<HTMLDivElement | null>(null); // made `inert` while locked
  const sendTextRef = useRef<(raw: string, atts?: Attach[]) => Promise<void>>(async () => {}); // latest sendText, for the stable openEmail callback
  const [notif, setNotif] = useState(() => { try { return localStorage.getItem('gf_notif') === '1'; } catch { return false; } });
  const [sounds, setSounds] = useState(soundsOn);
  const [sndTheme, setSndTheme] = useState<SoundTheme>(soundTheme);
  const [reminderSound, setReminderSound] = useState(loadReminderSound); // notification sound for reminders

  // ---- Per-session connectors ----
  // Which apps are connected (from the backend), which are enabled for THIS
  // session (toggles), and whether we've loaded yet. Disabling a connector here
  // only scopes it out of this chat — it stays connected globally.
  const [connApps, setConnApps] = useState<string[]>([]);
  const [brokenApps, setBrokenApps] = useState<string[]>([]); // connected apps whose OAuth died
  const [brokenDismissed, setBrokenDismissed] = useState(false);
  // Older conversations exist past the first 50 — paged in on demand.
  const [hasMoreChats, setHasMoreChats] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  async function loadOlderChats() {
    if (!uid || loadingOlder) return;
    setLoadingOlder(true);
    try {
      const oldest = Math.min(...chats.map((c) => c.updatedAt || Date.now()));
      const page = await syncLoadOlder(uid, oldest);
      if (!page) return;
      setChats((prev) => {
        const seen = new Set(prev.map((c) => c.id));
        return [...prev, ...page.filter((c) => !seen.has(c.id))];
      });
      setHasMoreChats(page.length >= MAX_CHATS);
    } finally {
      setLoadingOlder(false);
    }
  }
  const [enabled, setEnabled] = useState<Set<string>>(new Set());
  const [connLoaded, setConnLoaded] = useState(false);
  // Home-screen prompts: rotate per visit, weighted toward connected apps and
  // the time of day (see suggestions.ts). Keyed on currentId so a fresh chat
  // reshuffles them.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const homeSugs = useMemo(() => pickSuggestions(connApps, new Date().getHours()), [connApps, currentId]);
  // "Pick up where you left off" — the most recent real conversation.
  const lastChat = useMemo(
    () => chats.filter((c) => c.id !== currentId && c.messages.length > 0).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))[0],
    [chats, currentId],
  );
  const [plusOpen, setPlusOpen] = useState(false);
  const [attachments, setAttachments] = useState<Attach[]>([]);
  const [attachErr, setAttachErr] = useState('');
  // A message composed WHILE the assistant is replying — sent automatically the
  // moment the current turn finishes, so thinking time is never dead time.
  const [queued, setQueued] = useState<{ text: string; atts: Attach[] } | null>(null);
  const queuedRef = useRef(queued);          // latest queued, for the chat-switch fold below
  queuedRef.current = queued;
  const prevChatIdRef = useRef<string | null>(null); // which chat a queued message belonged to
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
      const conn = (j.connected ?? {}) as Record<string, { email?: string | null; broken?: boolean }>;
      // Healthy connections drive the session toggles; broken ones (expired
      // OAuth) surface as a "reconnect" banner instead of failing silently.
      const ids = CONNECTORS.map((c) => c.id).filter((id) => conn[id] && !conn[id].broken);
      setBrokenApps(CONNECTORS.filter((c) => conn[c.id]?.broken).map((c) => c.name));
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

  // Product analytics: one app_open per signed-in launch/login (counts, no content).
  useEffect(() => {
    if (uid) track('app_open');
  }, [uid]);

  // ---- Screen-reader narration of the streaming reply -----------------------
  // VoiceOver users otherwise hear nothing while the assistant streams. A
  // visually-hidden live region is fed complete SENTENCES (announcing every
  // token would make the screen reader stutter unusably); when the turn ends,
  // any unterminated tail is read out. Only turns we actually watched stream
  // are narrated — restoring an old chat stays silent.
  const [liveMsg, setLiveMsg] = useState('');
  const liveCursorRef = useRef(0);  // chars of the current reply already announced
  const liveTurnRef = useRef('');   // which turn the cursor belongs to
  const liveArmedRef = useRef(false);
  useEffect(() => {
    const last = messages[messages.length - 1];
    if (!last || last.role !== 'assistant') return;
    const turnKey = `${currentId}:${messages.length}`;
    if (liveTurnRef.current !== turnKey) {
      liveTurnRef.current = turnKey;
      liveCursorRef.current = 0;
      liveArmedRef.current = false;
    }
    const text = plainText(last.content);
    if (busy) {
      liveArmedRef.current = true;
      const fresh = text.slice(liveCursorRef.current);
      const m = fresh.match(/^[\s\S]*?[.!?…](?=\s|$)/);
      if (m && m[0].trim()) {
        liveCursorRef.current += m[0].length;
        setLiveMsg(m[0].trim());
      }
    } else {
      const tail = text.slice(liveCursorRef.current).trim();
      liveCursorRef.current = text.length;
      if (liveArmedRef.current && tail) setLiveMsg(tail.slice(0, 500));
      liveArmedRef.current = false;
    }
  }, [messages, busy, currentId]);

  // Focus traps: while a sheet/menu is open, Tab stays inside it, Escape
  // closes it, and focus returns to the control that opened it.
  const menuSheetRef = useRef<HTMLDivElement>(null);
  const confirmSheetRef = useRef<HTMLDivElement>(null);
  const signOutSheetRef = useRef<HTMLDivElement>(null);
  const radialRef = useRef<HTMLDivElement>(null);
  const wnRef = useRef<HTMLDivElement>(null);
  const legalRef = useRef<HTMLDivElement>(null);
  const usageRef = useRef<HTMLDivElement>(null);
  const modelSheetRef = useRef<HTMLDivElement>(null);
  useFocusTrap(usageOpen, usageRef, () => setUsageOpen(false));
  useFocusTrap(modelOpen, modelSheetRef, () => setModelOpen(false));
  useFocusTrap(!!menuChat, menuSheetRef, () => setMenuChat(null));
  useFocusTrap(confirmDelete, confirmSheetRef, () => { if (!deleting) setConfirmDelete(false); });
  useFocusTrap(confirmSignOut, signOutSheetRef, () => setConfirmSignOut(false));
  useFocusTrap(plusOpen, radialRef, () => setPlusOpen(false));
  useFocusTrap(wnOpen, wnRef, () => closeWhatsNew());
  useFocusTrap(!!legalDoc, legalRef, () => setLegalDoc(null));

  // Animated dismissal for every sheet/menu/overlay this component mounts —
  // the element stays for one exit beat with a `.closing`/`.gf-out` class
  // (see motion.ts). `lastMenuChat` latches the sheet's content so it doesn't
  // blank out mid-exit.
  const menuSheetUi = useDismiss(!!menuChat);
  const lastMenuChat = useRef(menuChat);
  if (menuChat) lastMenuChat.current = menuChat;
  const menuSheetChat = menuChat ?? lastMenuChat.current;
  const confirmUi = useDismiss(confirmDelete);
  const signOutUi = useDismiss(confirmSignOut);
  const wnUi = useDismiss(wnOpen);
  const usageUi = useDismiss(usageOpen);
  const modelUi = useDismiss(modelOpen);
  // Legal reader: latch the doc so the sheet doesn't blank out during its exit beat.
  const legalUi = useDismiss(!!legalDoc);
  const lastLegal = useRef(legalDoc);
  if (legalDoc) lastLegal.current = legalDoc;
  const shownLegal = legalDoc ?? lastLegal.current;

  function closeWhatsNew() {
    markWhatsNewSeen();
    setWnOpen(false);
  }

  // AI-usage meter: load once per sign-in (drives the ≈$ chip), refresh on open.
  useEffect(() => {
    if (!uid) { setUsageSum(null); return; }
    void fetchUsage().then((rows) => { if (rows) setUsageSum(summarize(rows)); });
  }, [uid]);
  function openUsage() {
    void tap();
    setUsageOpen(true);
    void fetchUsage().then((rows) => { if (rows) setUsageSum(summarize(rows)); });
  }

  // Announce a worth-mentioning OTA release once per edition (see whatsnew.ts),
  // after launch settles. A Face-ID-locked launch just waits: the effect re-runs
  // on unlock rather than popping a sheet over the lock screen.
  useEffect(() => {
    if (!uid || locked) return;
    const t = setTimeout(() => {
      if (shouldShowWhatsNew(loadChats(uid).length > 0)) {
        void bump();
        setWnOpen(true);
      }
    }, 1200);
    return () => clearTimeout(t);
  }, [uid, locked]);
  const radialUi = useDismiss(plusOpen);
  const memUi = useDismiss(memOpen);
  const remUi = useDismiss(remOpen);
  const wfUi = useDismiss(wfOpen);
  const callUi = useDismiss(callOpen);

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
    draftsRef.current = loadDrafts(uid);
    modelsRef.current = loadChatModels(uid);
    // A message queued mid-reply that a crash left orphaned: fold it back into its
    // chat's draft so it's waiting in the composer (never silently re-sent).
    const orphan = loadQueuedMsg(uid);
    if (orphan?.text) {
      const prev = draftsRef.current[orphan.convId];
      draftsRef.current[orphan.convId] = prev ? `${prev}\n${orphan.text}`.trim() : orphan.text;
      saveDrafts(uid, draftsRef.current);
      saveQueuedMsg(uid, null);
    }
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
      setHasMoreChats(remote.length >= MAX_CHATS); // a full first page → probably more in the cloud
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
    // Reading back while a reply streams? Don't yank — light the pill instead.
    if (!jump && !atBottomRef.current) {
      if (busy) setUnseen(true);
      return;
    }
    const toBottom = () => el.scrollTo({ top: el.scrollHeight, behavior: jump ? 'auto' : 'smooth' });
    toBottom();
    // Restored cards/markdown can grow the height a frame or two later — re-pin.
    if (jump) {
      requestAnimationFrame(toBottom);
      setTimeout(toBottom, 120);
      atBottomRef.current = true;
      setAtBottom(true);
    }
  }, [messages, busy]);

  // Keep the latest busy/length handy for the resume listener below (set up once,
  // so it would otherwise capture stale values).
  useEffect(() => { busyRef.current = busy; msgLenRef.current = messages.length; messagesRef.current = messages; }, [busy, messages]);

  // Switching to a different chat (or a fresh one on resume) abandons any retry
  // queued for the previous chat — otherwise the next online event / Retry tap
  // would replay that old turn into the chat now open. The failed bubble doesn't
  // survive a chat switch either, so this just matches what's on screen.
  useEffect(() => {
    pendingTurnRef.current = null; retryingRef.current = false; setCopiedIdx(null);
    // A message queued for the PREVIOUS chat must not vanish on switch — fold it
    // into that chat's draft (mirrors the crash-recovery path); never auto-send.
    const prevId = prevChatIdRef.current;
    prevChatIdRef.current = currentId;
    const q = queuedRef.current;
    if (q?.text && prevId && prevId !== currentId) {
      const prevDraft = draftsRef.current[prevId];
      draftsRef.current[prevId] = prevDraft ? `${prevDraft}\n${q.text}`.trim() : q.text;
      if (uid) saveDrafts(uid, draftsRef.current);
    }
    setQueued(null);
    setInput(draftsRef.current[currentId] ?? ''); // each chat keeps its own draft
    // …and its own model choice. Opening counts as USE: refresh the entry's
    // LRU position (delete-then-set), or an actively-read old chat gets evicted
    // from the 50-entry cap by newer picks and silently reverts to 'auto'.
    const chatModel = modelsRef.current[currentId];
    if (chatModel) {
      delete modelsRef.current[currentId];
      modelsRef.current[currentId] = chatModel;
      if (uid) saveChatModels(uid, modelsRef.current);
    }
    setModel(chatModel ?? 'auto');
    setVisCount(60); // windowed thread: a freshly opened chat renders its tail
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentId]);

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
        // Lock the moment we background (Face ID on): the iOS app-switcher
        // snapshot then shows the lock screen, not the user's last chat. A real
        // backgrounding also invalidates the just-unlocked grace — without this,
        // background+return inside 1.5s of an unlock stranded the user on the
        // lock screen with even the Unlock button dead until the window lapsed.
        // (The prompt's own resign fires BEFORE success stamps the grace, so
        // zeroing here can never clobber the guard it exists for.)
        if (faceIdRef.current && Capacitor.getPlatform() !== 'web') {
          lastUnlockRef.current = 0;
          setLocked(true);
        }
        // Leaving mid-reply: close the connection so the server notices we're gone
        // and pushes when it's done. (iOS otherwise just suspends the socket, so
        // the server never sees the disconnect and never sends the "ready" push.)
        if (busyRef.current && abortRef.current) { bgAbortRef.current = true; abortRef.current.abort(); }
        return;
      }
      void lockRef.current(); // re-prompt the biometric lock on resume (no-op unless on)
      reArmRemindersRef.current(); // arm reminders set while away (workflows, interrupted turns)
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
        bgPollRef.current(); // a turn left finishing still lands in its (now background) chat
      } else {
        void resumeRef.current(); // pick up a turn that finished server-side while away
        bgPollRef.current();      // and keep watching for one that's still running
      }
      // A send that never got out (queued while the radio was down) — try it again
      // once the connection has had a moment to come back after foregrounding.
      // iOS networking is flaky for the first second or two after resume, which is
      // also why retryPending never re-sends blind when its server check fails.
      if (pendingTurnRef.current) window.setTimeout(() => retryRef.current(), 1500);
    }).then((h) => { handle = h; });
    return () => { handle?.remove(); };
  }, []);

  // Deep link: gofarther://call opens voice call mode straight away — that's what
  // the Action Button / Back Tap (iOS) or a home-screen shortcut (Android) map to
  // via a one-time Shortcut. Only the "call" link is claimed here, so any auth
  // redirects on the same scheme are left untouched.
  useEffect(() => {
    let handle: { remove: () => void } | undefined;
    const isCallLink = (url: string) => {
      try {
        const u = new URL(url);
        if (u.protocol !== 'gofarther:') return false;
        return (u.host || u.pathname.replace(/^\/+/, '')).toLowerCase() === 'call';
      } catch { return false; }
    };
    const openFromLink = (url: string) => {
      if (!isCallLink(url)) return;
      void primeAudio(); // best-effort audio unlock (cold launch isn't a gesture)
      setCallOpen(true);
    };
    void CapApp.getLaunchUrl().then((res) => { if (res?.url) openFromLink(res.url); }).catch(() => {});
    void CapApp.addListener('appUrlOpen', ({ url }) => openFromLink(url)).then((h) => { handle = h; });
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
  }, []);

  // While locked, the app shell must be a REAL lock, not just opaque pixels on
  // top: `inert` makes everything behind the lock unfocusable, unclickable and
  // invisible to screen readers (a Bluetooth keyboard's Tab or a VoiceOver swipe
  // used to reach the chat behind the black screen). Focus lands on Unlock.
  // The full-screen overlays (Memory/Reminders/Workflows/Connectors) portal onto
  // document.body — OUTSIDE the shell — so they must be inerted separately, and
  // one mounting WHILE locked is caught by the observer.
  useEffect(() => {
    const root = document.getElementById('root');
    const setInert = (on: boolean) => {
      appShellRef.current?.toggleAttribute('inert', on);
      for (const el of Array.from(document.body.children)) {
        if (el === root || el.tagName === 'SCRIPT' || el.tagName === 'STYLE') continue;
        el.toggleAttribute('inert', on);
      }
    };
    setInert(locked);
    if (!locked) return;
    document.querySelector<HTMLButtonElement>('.lock-btn')?.focus();
    const mo = new MutationObserver(() => setInert(true));
    mo.observe(document.body, { childList: true });
    return () => mo.disconnect();
  }, [locked]);

  // The OTA layer fires this when the running bundle is below a required floor.
  useEffect(() => {
    const onForce = (e: Event) => {
      const mode = (e as CustomEvent<{ mode: ForceUpdateMode }>).detail?.mode;
      // 'clear' = a forced download failed; drop the gate instead of bricking.
      setForceUpdate(mode === 'clear' ? null : mode === 'appstore' ? 'appstore' : 'updating');
    };
    window.addEventListener(FORCE_UPDATE_EVENT, onForce);
    return () => window.removeEventListener(FORCE_UPDATE_EVENT, onForce);
  }, []);

  // Resolve real biometric availability once, so Settings can show a working
  // toggle, an "enroll it" hint, or hide the row — never a toggle that errors.
  useEffect(() => {
    let alive = true;
    void biometryStatus().then((s) => {
      if (!alive) return;
      setBioStatus(s);
      // A stale "on" pref on a device that can no longer do biometrics would trap
      // the user behind a lock we can't satisfy — clear it.
      if (s !== 'ready' && faceIdRef.current) {
        setFaceId(false);
        try { localStorage.setItem('gf_faceid', '0'); } catch { /* ignore */ }
      }
    });
    return () => { alive = false; };
  }, []);

  // Refresh the push registration on launch if notifications are enabled.
  useEffect(() => {
    if (notif) void registerPush();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-arm reminder notifications so the device's schedule matches the table —
  // on launch AND on resume/adoption (covers edits from another device, an OS
  // purge, reminders a WORKFLOW set while the app was closed, and one set during
  // a turn we backgrounded out of, whose sync marker never reached us). Keeps
  // the list state too, so lock-screen Snooze knows titles after a cold launch.
  const reArmReminders = () => {
    if (!uid) return;
    void listReminders().then((list) => { if (!list) return; setReminders(list); return syncReminders(list); });
  };
  const reArmRemindersRef = useRef(reArmReminders);
  reArmRemindersRef.current = reArmReminders;
  useEffect(() => {
    reArmRemindersRef.current();
  }, [uid]);

  // Persist the active conversation once a turn finishes (not on every token).
  useEffect(() => {
    if (!uid || busy || messages.length === 0) return;
    if (!dirtyRef.current) return; // only persist after a real turn — not on mere open/restore
    dirtyRef.current = false;
    setChats((prev) => {
      // Keep a title that was renamed or AI-generated; otherwise derive one.
      const existing = prev.find((c) => c.id === currentId);
      const title = existing?.title ? existing.title : titleFrom(messages);
      const convo: Conversation = { id: currentId, title, messages, updatedAt: Date.now() };
      const next = [convo, ...prev.filter((c) => c.id !== currentId)];
      saveChats(uid, next);
      void syncSave(uid, convo); // mirror to the cloud
      return next;
    });
  }, [messages, busy, currentId, uid]);

  // Notification routing: a push tap lands in ITS conversation; reminder-nudge
  // actions work from the lock screen (Done disables a one-off, Snooze re-nudges
  // in 10 minutes, a plain tap opens the Reminders screen). Listeners attach
  // once; latest handlers are read through refs.
  const notifRoutesRef = useRef({
    openChat: (id: string) => { selectChat(id); },
    openReminders: () => { openReminders(); },
    done: (id: string) => { toggleRem(id, false); },
    title: (id: string) => remindersRef.current.find((r) => r.id === id)?.title ?? 'Reminder',
  });
  notifRoutesRef.current = {
    openChat: (id) => { selectChat(id); },
    openReminders: () => { openReminders(); },
    done: (id) => { toggleRem(id, false); },
    title: (id) => remindersRef.current.find((r) => r.id === id)?.title ?? 'Reminder',
  };
  const remindersRef = useRef<Reminder[]>([]);
  remindersRef.current = reminders;
  useEffect(() => {
    void registerReminderActions();
    const subs: { remove: () => void }[] = [];
    void onPushTap((data) => {
      // A reminder push is a silent SYNC signal, never its own alert — tapping
      // one (or its arrival) just re-arms local notifications + opens Reminders.
      if (isRemindersSync(data)) { reArmRemindersRef.current(); notifRoutesRef.current.openReminders(); return; }
      const id = (data as Record<string, unknown>).convId;
      if (typeof id === 'string' && id) notifRoutesRef.current.openChat(id);
    }).then((h) => { if (h) subs.push(h); });
    // Silent "reminders changed" push (e.g. a workflow set one while the app was
    // backgrounded): re-arm the LOCAL notifications. The push shows no banner, so
    // the device — not the server — is the single source of the visible alert,
    // which is what makes turning on APNs safe (no double-fire).
    void onPushReceived((data) => {
      if (isRemindersSync(data)) reArmRemindersRef.current();
    }).then((h) => { if (h) subs.push(h); });
    void onReminderAction((actionId, reminderId, title) => {
      if (actionId === 'done' && reminderId) notifRoutesRef.current.done(reminderId);
      // Prefer the title carried on the fired notification — on a cold start the
      // reminders list hasn't loaded yet, so the ref lookup would be generic.
      else if (actionId === 'snooze') void snoozeNudge(title ?? (reminderId ? notifRoutesRef.current.title(reminderId) : 'Reminder'), reminderId ?? undefined);
      else notifRoutesRef.current.openReminders();
    }).then((h) => { if (h) subs.push(h); });
    return () => { for (const s of subs) s.remove(); };

  }, []);

  // Desktop (Electron) tray: "New chat" — bridge injected by the preload, absent
  // everywhere else. Ref so the handler always calls the latest newChat.
  const newChatRef = useRef<() => void>(() => {});
  useEffect(() => window.gfDesktop?.onNewChat(() => newChatRef.current()), []);

  // AI title: once a new chat has its first real reply, generate a 3-5 word
  // title to replace the raw first-message truncation in the sidebar. Once per
  // chat; never fights a manual rename (only replaces the derived title).
  const titledRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (busy || !uid) return;
    const ms = messagesRef.current;
    if (ms.length < 2 || ms.length > 6) return; // only early in a chat
    const id = currentIdRef.current;
    if (titledRef.current.has(id)) return;
    const first = ms.find((m) => m.role === 'user');
    const reply = ms.find((m) => m.role === 'assistant' && m.content.trim() && !m.failed);
    if (!first || !reply) return;
    titledRef.current.add(id);
    void titleFor(first.content, plainText(reply.content) || reply.content).then((t) => {
      if (!t || t.split(/\s+/).length > 8) return;
      setChats((prev) => {
        const cur = prev.find((c) => c.id === id);
        if (!cur) return prev;
        if (cur.title !== titleFrom(cur.messages)) return prev; // renamed — leave it
        const next = prev.map((c) => (c.id === id ? { ...c, title: t } : c));
        saveChats(uid, next);
        void syncSave(uid, { ...cur, title: t });
        return next;
      });
    });
     
  }, [busy, uid]);

  // Run one chat turn for a message history (its last item = the user's new
  // message). An empty assistant bubble is appended for the streamed reply.
  async function runTurn(rawHistory: ChatMessage[]) {
    dirtyRef.current = true; // a real turn — the persist effect should save it
    if (bgWaitRef.current?.convId === currentId) bgWaitRef.current = null; // a new turn here supersedes the awaited one
    // A new send supersedes any turn still queued for retry: its unanswered
    // question rides along as a user message in THIS history (so the model can
    // still address it), while the dead recovery bubble disappears — re-sending
    // a superseded snapshot later would rewind the conversation.
    pendingTurnRef.current = null;
    jumpRef.current = true; // your own message always comes into view
    const history = withoutPlaceholders(rawHistory);
    setMessages([...history, { role: 'assistant', content: '', id: cid() }]);
    setBusy(true);
    track('message_sent');

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
    // Only fetch device location when the message looks location-relevant, so the
    // permission prompt appears in context and we never send whereabouts unasked.
    const lastUserText = [...history].reverse().find((m) => m.role === 'user')?.content ?? '';
    const location = LOCATION_RE.test(lastUserText) ? ((await getLocation()) ?? undefined) : undefined;
    let streamed = ''; // full streamed text — scanned for the reminder-sync signal after the turn
    try {
      await streamChat(
        history, // already placeholder-free (cleaned at the top of runTurn)
        (tok) => {
          streamed += tok;
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
        location,
        modelRef.current, // user's model choice ('auto' = backend routes)
      );
      // Clear transient tool-activity markers from the finished reply so storage,
      // copy, and search stay clean (they're only meant to show live).
      setMessages((m) => {
        const copy = m.slice();
        const last = copy[copy.length - 1];
        if (last && last.role === 'assistant') {
          copy[copy.length - 1] = {
            ...last,
            content: /\[\[gf(?:status|sync):/.test(last.content) ? last.content.replace(/\[\[gf(?:status|sync):[^\]]*\]\]/g, '') : last.content,
            ts: Date.now(), // freshness stamp — "as of 9:41 PM" on data answers
          };
        }
        return copy;
      });
      // The assistant set a reminder this turn — schedule its device notification now.
      if (/\[\[gfsync:reminders\]\]/.test(streamed)) void syncRemindersFromChat();
      replySound(); // the reply landed — a soft audible cue to glance back
    } catch (e) {
      // Backgrounded mid-reply: we closed the connection on purpose so the server
      // finishes the turn and pushes "ready". Don't show an error — keep whatever
      // streamed (or a calm "finishing" line); the resume refresh swaps in the
      // server's complete reply when we return (and the push tells us when).
      if (bgAbortRef.current) {
        bgAbortRef.current = false;
        dirtyRef.current = false;
        bgWaitRef.current = { convId: currentId, msgs: history }; // the server owes this chat a reply — watch for it on resume
        setMessages((m) => {
          const copy = m.slice();
          const l = copy[copy.length - 1];
          if (l && l.role === 'assistant' && l.content === '' && !l.failed) {
            copy[copy.length - 1] = { role: 'assistant', content: '', failed: true, offline: false, sent: true };
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
      // Offline / network failure → queue this turn and recover instead of a hard
      // error. Two very different cases, told apart by whether the request got out:
      //  - sent: the server HAS the turn and will finish + save it — adopt-only
      //    (re-sending could run an action twice). Poll for its saved reply.
      //  - not sent: the server never saw it (radio flake, just-resumed iOS) —
      //    auto re-send it; nothing exists server-side to wait for.
      if (!timedOut && (!navigator.onLine || isNetworkError(e))) {
        dirtyRef.current = false; // don't persist a failed placeholder turn
        const sent = reachedServer(e);
        const pend = { msgs: history, sent };
        pendingTurnRef.current = pend;
        const wasOffline = !navigator.onLine;
        setMessages((m) => {
          const copy = m.slice();
          copy[copy.length - 1] = { role: 'assistant', content: '', failed: true, offline: wasOffline, sent };
          return copy;
        });
        recoverPending(pend);
        return;
      }
      // Server-sent errors are written for people (daily-limit text etc.) and
      // pass through; raw runtime errors ("TypeError: Load failed", "status
      // 502") are developer-speak — translate those.
      const raw = e instanceof Error ? e.message : '';
      const technical = !raw || /TypeError|NetworkError|Load failed|Failed to fetch|status \d|^\d{3}\b|aborted/i.test(raw);
      const msg = timedOut ? 'Timed out — please try again.'
        : technical ? 'That didn’t go through — check your connection and try again.'
        : raw;
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
    if (soundsOn()) resumeAudio(); // resume audio at the earliest in-gesture point so the reply tone (async) isn't silent on iOS
    sentSound(); // here (not in the composer) so queued messages blip when they actually go out
    const userMsg: ChatMessage = { role: 'user', content: text, id: cid(), ...(atts.length ? { attachments: atts } : {}) };
    await runTurn([...messages, userMsg]);
  }
  sendTextRef.current = sendText;

  // Adopt the server's copy of a chat (a turn it finished while we were
  // disconnected). Always updates the saved list; only swaps the visible
  // messages when we're actually looking at that chat. Stands down any pending
  // retry so the turn is never re-run (which would duplicate its action).
  function adoptConversation(cur: Conversation) {
    if (!uid) return;
    pendingTurnRef.current = null;
    if (bgWaitRef.current?.convId === cur.id) bgWaitRef.current = null; // the awaited reply arrived
    // The adopted (server-finished) turn may have set a reminder; its sync
    // marker never reached this device, so re-arm from the table.
    reArmRemindersRef.current();
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
  async function retryPending(force = false) {
    if (retryingRef.current || busyRef.current) return; // already retrying, or a turn is in flight
    const pend = pendingTurnRef.current;
    if (!pend) return;
    retryingRef.current = true; // claim it so a concurrent online event + manual tap can't both re-run the turn
    try {
      if (uid) {
        const remote = await syncLoad(uid);
        if (pendingTurnRef.current !== pend) return; // adopted/replaced while we loaded
        const cur = remote?.find((c) => c.id === currentId);
        const serverMoreComplete = !!(cur && serverIsMoreComplete(messagesRef.current, cur.messages));
        // Decision (adopt / wait / resend) lives in chatUtils so it's unit-tested —
        // this is the line that must never re-run a turn the server already did.
        const action = decideRetry({ sent: pend.sent, hasRemote: !!remote, serverMoreComplete, force });
        if (action === 'adopt') { adoptConversation(cur!); return; }
        if (action === 'wait') return;
      }
      if (busyRef.current || pendingTurnRef.current !== pend) return; // a new turn started meanwhile — leave it queued
      pendingTurnRef.current = null;
      void runTurn(pend.msgs);
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

  // The pending bubble's recovery gave up — stop spinning and say so, with the
  // honest options (Refresh checks the server; Send again re-runs the turn).
  function markPendingStalled(pend: { msgs: ChatMessage[]; sent: boolean }) {
    if (pendingTurnRef.current !== pend) return;
    setMessages((m) => {
      const copy = m.slice();
      const l = copy[copy.length - 1];
      if (l && l.role === 'assistant' && l.failed && !l.stalled) copy[copy.length - 1] = { ...l, stalled: true };
      return copy;
    });
  }

  // Recover a failed turn on its own — quietly; the bubble just reads as still
  // thinking while this runs. Sent turns: the server is finishing them — poll
  // for the saved reply (~3 min; tool/file turns can be slow) and adopt it.
  // Unsent turns: nothing exists server-side — re-send automatically, with a few
  // spaced attempts (just-resumed radios usually wake within seconds). Only when
  // recovery truly runs out does the bubble flip to a terminal state with a
  // button. Stops the moment the turn is adopted, retried, or replaced.
  function recoverPending(pend: { msgs: ChatMessage[]; sent: boolean }) {
    if (pend.sent) {
      let n = 0;
      const tick = async () => {
        if (pendingTurnRef.current !== pend) return;
        await refreshCurrent();
        if (pendingTurnRef.current !== pend) return;
        if (++n < 30) window.setTimeout(tick, 6000);
        else markPendingStalled(pend);
      };
      window.setTimeout(tick, 4000);
      return;
    }
    const attempts = [2500, 8000, 18000];
    for (const at of attempts) {
      window.setTimeout(() => { if (pendingTurnRef.current === pend && navigator.onLine) retryRef.current(); }, at);
    }
    // While offline, never stall — the offline bubble explains itself and the
    // reconnect listener re-sends the turn the moment the network returns.
    window.setTimeout(() => { if (navigator.onLine) markPendingStalled(pend); }, 26000);
  }

  // A turn we backgrounded out of is finished by the SERVER (it completes and
  // saves the reply even though our connection is gone). On resume, keep checking
  // until that reply lands — file/code turns can take a couple of minutes — then
  // adopt it: into the open chat, or just the saved list if the user moved on.
  // Unlike retry, this NEVER re-runs the turn (that could duplicate its action).
  function pollServerTurn(firstDelay = 1500) {
    const wait = bgWaitRef.current;
    if (!wait || !uid) return;
    const seq = ++bgPollSeqRef.current;
    let n = 0;
    const tick = async () => {
      if (seq !== bgPollSeqRef.current || bgWaitRef.current !== wait) return; // adopted / superseded / re-polled
      const remote = await syncLoad(uid);
      if (seq !== bgPollSeqRef.current || bgWaitRef.current !== wait) return;
      const cur = remote?.find((c) => c.id === wait.convId);
      const local = wait.convId === currentIdRef.current ? messagesRef.current : wait.msgs;
      if (cur && serverIsMoreComplete(local, cur.messages)) { adoptConversation(cur); return; }
      if (++n < 30) { window.setTimeout(tick, 5000); return; } // keep watching ~2.5 min
      // Ran out of patience — if the waiting bubble is on screen, stop the
      // spinner and offer Refresh / Send again instead of spinning forever.
      if (wait.convId !== currentIdRef.current) return;
      setMessages((m) => {
        const copy = m.slice();
        const l = copy[copy.length - 1];
        if (l && l.role === 'assistant' && l.failed && !l.stalled) copy[copy.length - 1] = { ...l, stalled: true };
        return copy;
      });
      // Let a manual "Send again" work from here: the bgWait turn becomes an
      // explicit pending one (sent: the server did receive it).
      if (!pendingTurnRef.current) pendingTurnRef.current = { msgs: wait.msgs, sent: true };
    };
    window.setTimeout(tick, firstDelay);
  }
  bgPollRef.current = pollServerTurn;

  // Biometric lock: engage if enabled AND available, otherwise fail open (we
  // never trap the user behind a lock we can't satisfy — e.g. plugin not yet in
  // this native build, no hardware, web).
  async function engageLock() {
    if (!faceIdRef.current || Capacitor.getPlatform() === 'web') { setLocked(false); return; }
    if (unlockingRef.current) return; // a prompt is already up
    if (Date.now() - lastUnlockRef.current < 1500) return; // `active` fired by our own prompt dismissing
    // Cover the content BEFORE any async check — the old order awaited a native
    // round-trip first, leaving the last screen visible and tappable on resume.
    setLocked(true);
    unlockingRef.current = true;
    try {
      // One transient native hiccup must not silently drop the lock — re-check
      // once before concluding the device genuinely can't do biometrics.
      let avail = await biometryAvailable();
      if (!avail) { await new Promise((r) => setTimeout(r, 350)); avail = await biometryAvailable(); }
      if (!avail) { setLocked(false); return; } // truly unsupported → fail open, never trap
      if (await unlock()) { lastUnlockRef.current = Date.now(); setLocked(false); }
    } finally {
      unlockingRef.current = false;
    }
  }
  lockRef.current = engageLock;

  // Turning Face ID on only sticks if the device can actually do biometrics —
  // otherwise the toggle would read "on" while the lock silently never engages.
  async function toggleFaceId() {
    void tap();
    const next = !faceIdRef.current;
    if (next) {
      const s = await biometryStatus();
      setBioStatus(s);
      if (s === 'unenrolled') {
        flashNote('Turn on Face ID / Touch ID in iOS Settings, then come back to enable this.');
        return;
      }
      if (s !== 'ready') {
        flashNote('Face ID isn’t available in this version yet — it arrives in the next app update.');
        return;
      }
    }
    try { localStorage.setItem('gf_faceid', next ? '1' : '0'); } catch { /* ignore */ }
    setFaceId(next);
  }

  // Same for notifications: only show "on" if permission was actually granted, so
  // the toggle never lies about whether pushes will arrive.
  async function toggleNotif() {
    void tap();
    const next = !notif;
    if (next && !(await registerPush())) {
      flashNote('Allow notifications for Go Farther in iOS Settings to turn this on.');
      return;
    }
    try { localStorage.setItem('gf_notif', next ? '1' : '0'); } catch { /* ignore */ }
    setNotif(next);
  }

  function toggleSounds() {
    void tap();
    const next = !sounds;
    setSoundsOn(next);
    setSounds(next);
    if (next) {
      resumeAudio();  // full unlock (silent-buffer trick) in this tap
      sentSound();    // instant preview
      const st = audioState();
      flashNote(st === 'running'
        ? 'Sounds on. No blip? Check the ring/silent switch and turn up the volume.'
        : `Sounds on, but audio is “${st}”. Flip the ring/silent switch off, turn up volume, then toggle again.`);
    }
  }
  // Pick a sound style — previews the "sent" tone in the same tap.
  function pickSoundTheme(t: SoundTheme) {
    void tap();
    setSoundTheme(t);
    setSndTheme(t);
    resumeAudio();
    sentSound();
  }

  // Pick the reminder notification sound — previews it in-app, and re-arms
  // existing reminders so the new sound applies now, not only on next launch.
  const reArmTimer = useRef<number | null>(null);
  function pickReminderSound(id: string) {
    void tap();
    setReminderSound(id);
    saveReminderSound(id);
    previewReminderSound(id); // immediate
    // Debounce the heavier device re-arm (refetch + cancel/reschedule every
    // reminder + createChannel) so auditioning sounds doesn't thrash on each tap.
    if (reArmTimer.current) clearTimeout(reArmTimer.current);
    reArmTimer.current = window.setTimeout(() => { void listReminders().then((l) => l && syncReminders(l)); }, 700);
  }

  // Choose the model for THIS conversation — remembered per chat (device-local),
  // so each one reopens on the model you picked for it. 'auto' = the backend
  // routes (and is the default), so we drop the entry rather than store it.
  function pickChatModel(m: ModelChoice) {
    void tap();
    setModel(m);
    // LRU refresh: delete-then-set moves the key to the end of insertion order,
    // so saveChatModels' size cap evicts stale entries, not the one just picked.
    delete modelsRef.current[currentId];
    if (m !== 'auto') modelsRef.current[currentId] = m;
    if (uid) saveChatModels(uid, modelsRef.current);
    // Arrow-key navigation selects without dismissing; only a tap/Enter closes.
    if (!isArrowSelecting()) setModelOpen(false);
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
      // "APNs rejected it (403)" is developer-speak; log the detail, say it plainly.
      console.warn('test push rejected:', d.status, why);
      flashNote('The test push couldn’t be delivered — check notifications are allowed for Go Farther in iOS Settings.', 12000);
    } catch {
      flashNote('Couldn’t reach the server — try again.');
    }
  }

  // Composer mic: record one utterance (ends on silence, or tap again to stop),
  // transcribe it server-side, and drop the text into the input for review.
  async function dictate() {
    if (micState === 'rec') { micFinishRef.current?.abort(); return; } // tap-to-stop
    if (micState === 'tx') return;
    if (!micSupported()) {
      setAttachErr('Voice input isn\u2019t available on this device.');
      setTimeout(() => setAttachErr(''), 4000);
      return;
    }
    void tap();
    void primeAudio(); // iOS: audio must start inside the tap gesture
    track('voice_dictate');
    const fin = new AbortController();
    micFinishRef.current = fin;
    setMicState('rec');
    try {
      // Longer pauses allowed than call mode \u2014 dictation has thinking gaps.
      const audio = await listenOnce({ finishSignal: fin.signal, silenceMs: 1600, maxMs: 30000, startTimeoutMs: 6000 });
      if (!audio) return; // never spoke \u2014 just go back to idle
      setMicState('tx');
      const text = await transcribe(audio);
      if (text) setInput((cur) => {
        const next = cur.trim() ? cur.replace(/\s+$/, '') + ' ' + text : text;
        setDraft(currentId, next);
        return next;
      });
      taRef.current?.focus();
    } catch (e) {
      const m = e instanceof Error ? e.message : '';
      setAttachErr(/denied|permission|notallowed/i.test(m)
        ? 'Allow microphone access for Go Farther in iOS Settings to dictate.'
        : 'Couldn\u2019t transcribe that \u2014 please try again.');
      setTimeout(() => setAttachErr(''), 5000);
    } finally {
      micFinishRef.current = null;
      setMicState('idle');
    }
  }

  // Send from the composer (clears the input box + pending attachments).
  // Mid-reply, the message is QUEUED instead and goes out the moment the current
  // turn finishes — you can keep talking while it thinks.
  function send() {
    const text = input.trim();
    if (!text && attachments.length === 0) return;
    void tap(); // light haptic on send (no-op until a native build includes the plugin)
    const atts = attachments;
    setInput('');
    setDraft(currentId, '');
    setAttachments([]);
    if (busy) {
      setQueued((q) => mergeQueued(q, text, atts));
      return;
    }
    void sendText(text, atts);
  }

  // Flush the queued message once the assistant finishes (or fails) the turn.
  useEffect(() => {
    if (busy || !queued) return;
    const q = queued;
    setQueued(null);
    void sendTextRef.current(q.text, q.atts);
  }, [busy, queued]);

  // Mirror the queued message to storage so a crash mid-reply can't lose it
  // (text only — attachments stay in memory). Cleared the moment it flushes or is
  // cancelled. currentId via ref so this tracks `queued`, not every chat switch.
  useEffect(() => {
    if (!uid) return;
    saveQueuedMsg(uid, queued ? { convId: currentIdRef.current, text: queued.text } : null);
  }, [queued, uid]);

  // ---- Attachments ("+" menu) ----
  // Camera jumps straight into the device camera (Take Photo); Attachments offers
  // the photo library + files. Both go through the hidden file input -> onFiles
  // (which downsizes images). The file-input camera is the one that reliably
  // opens in the iOS webview, so the Camera button uses it directly.
  function openPicker(mode: 'camera' | 'attachments') {
    setPlusOpen(false);
    const input = fileRef.current;
    if (!input) return;
    input.value = '';
    if (mode === 'camera') {
      input.multiple = false;
      input.accept = 'image/*';
      input.setAttribute('capture', 'environment'); // open the camera, not the menu
    } else {
      input.multiple = true;
      input.accept = 'image/*,application/pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv,text/plain';
      input.removeAttribute('capture');
    }
    input.click();
  }
  // Paste an image straight into the composer (screenshots, copied photos).
  async function onPaste(e: React.ClipboardEvent<HTMLTextAreaElement>) {
    const files = Array.from(e.clipboardData?.items ?? [])
      .filter((it) => it.kind === 'file' && it.type.startsWith('image/'))
      .map((it) => it.getAsFile())
      .filter((f): f is File => !!f);
    if (!files.length) return;
    e.preventDefault(); // image paste, not text
    for (const f of files) {
      const { attach, error } = await fileToAttachment(f);
      if (attach) setAttachments((prev) => {
        if (prev.length >= 6) { flagAttachCap(); return prev; }
        return [...prev, attach];
      });
      else if (error) { setAttachErr(error); setTimeout(() => setAttachErr(''), 4000); }
    }
  }

  function flagAttachCap() {
    setAttachErr("Up to 6 attachments per message — the extras weren't added.");
    setTimeout(() => setAttachErr(''), 4000);
  }
  async function onFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = '';
    let err = '';
    for (const f of files) {
      const { attach, error } = await fileToAttachment(f);
      if (attach) setAttachments((prev) => {
        if (prev.length >= 6) { flagAttachCap(); return prev; }
        return [...prev, attach];
      });
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
  // Stable identity (empty deps) so memo(AssistantMessage) can skip re-renders
  // on unrelated state changes (e.g. every composer keystroke); reads the latest
  // busy/sendText via refs to avoid a stale closure.
  const openEmail = useCallback((item: EmailItem) => {
    if (busyRef.current) return;
    const label = (item.subject || '').trim() || item.from || 'this email';
    const marker = item.id ? ` [[gfid:${item.id}]]` : '';
    void sendTextRef.current(`Open this email: ${label}${marker}`);
  }, []);

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
    if (list) setMemories(list);
    setMemErr(!list);
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

  // ---- Reminders ----
  function openReminders() {
    setRemOpen(true);
    setSidebarOpen(false);
    void loadRems();
  }
  function closeReminders() { setRemOpen(false); }

  async function loadRems() {
    if (!uid) return;
    setRemLoaded(false);
    const list = await listReminders();
    if (list) setReminders(list);
    setRemErr(!list);
    setRemLoaded(true);
  }

  // The assistant set a reminder this turn (server-side, via the chat tool).
  // Re-fetch and re-arm so the device schedules its local notification now —
  // not only on next launch — asking for notification permission in-context.
  async function syncRemindersFromChat() {
    if (!uid) return;
    const granted = await ensureNotifyPermission();
    const list = await listReminders();
    if (!list) return; // fetch failed — keep what's armed; the next sync re-tries
    setReminders(list);
    await syncReminders(list);
    // Don't let a saved reminder silently never fire: if notifications are off,
    // say so instead of the assistant claiming "I'll remind you" with no alert.
    if (!granted) flashNote('Reminder saved — turn on notifications to get the alert.');
  }

  async function addRem(title: string, remind_at: string, repeat: RepeatKind): Promise<boolean> {
    const granted = await ensureNotifyPermission(); // ask for notification permission in context
    const r = await addReminder(title.trim(), remind_at, repeat);
    if (r) {
      setReminders((prev) => [...prev, r]);
      void scheduleReminder(r);
      // Don't let it save silently with no alert — mirror the chat path's hint.
      if (!granted) flashNote('Reminder saved — turn on notifications to get the alert.');
      return true;
    }
    flashNote("Couldn't save that reminder — try again.");
    return false;
  }

  async function updateRem(id: string, fields: { title: string; remind_at: string; repeat: RepeatKind }): Promise<boolean> {
    const existing = reminders.find((r) => r.id === id);
    const ok = await updateReminder(id, fields);
    if (ok) {
      setReminders((prev) => prev.map((r) => (r.id === id ? { ...r, ...fields } : r)));
      const enabled = existing?.enabled ?? true;
      await cancelReminder(id);
      if (enabled) void scheduleReminder({ id, enabled, created_at: existing?.created_at ?? new Date().toISOString(), ...fields });
    } else {
      flashNote("Couldn't update that reminder — try again.");
    }
    return ok;
  }

  function delRem(id: string) {
    setReminders((prev) => prev.filter((r) => r.id !== id)); // optimistic
    void cancelReminder(id);
    void deleteReminder(id).then((okay) => { if (!okay) void loadRems(); }); // restore on failure
  }

  function toggleRem(id: string, enabled: boolean) {
    const r = reminders.find((x) => x.id === id);
    setReminders((prev) => prev.map((x) => (x.id === id ? { ...x, enabled } : x)));
    void updateReminder(id, { enabled });
    if (enabled && r) void scheduleReminder({ ...r, enabled: true });
    else void cancelReminder(id);
  }

  function newChat() {
    stopStream();
    setCurrentId(cid());
    setMessages([]);
    go('chat');
  }
  newChatRef.current = newChat;

  function selectChat(id: string) {
    const c = chats.find((x) => x.id === id);
    if (!c) return;
    stopStream();
    setCurrentId(id);
    jumpRef.current = true; // opened chat: land at the bottom
    setMessages(c.messages);
    go('chat');
  }

  function deleteChat(id: string, e?: React.MouseEvent) {
    e?.stopPropagation();
    if (id === currentId) stopStream(); // abort any in-flight reply before dropping its chat
    delete draftsRef.current[id];
    if (uid) saveDrafts(uid, draftsRef.current);
    if (modelsRef.current[id]) { delete modelsRef.current[id]; if (uid) saveChatModels(uid, modelsRef.current); }
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

  function togglePin(id: string, e?: React.MouseEvent) {
    e?.stopPropagation();
    setPinned((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      if (uid) savePins(uid, next);
      return next;
    });
  }

  function startRename(c: Conversation, e?: React.MouseEvent) {
    e?.stopPropagation();
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

  // Long-press a chat row (or right-click on web) opens the actions sheet.
  function rowPressStart(c: Conversation) {
    pressFired.current = false;
    pressTimer.current = window.setTimeout(() => {
      pressTimer.current = null;
      pressFired.current = true;
      void bump(); // medium: a menu is opening under your finger
      setMenuChat(c);
    }, 450);
  }
  function rowPressCancel() {
    if (pressTimer.current) { clearTimeout(pressTimer.current); pressTimer.current = null; }
  }

  // Thumbs feedback on a reply: stored on the message (survives locally) and
  // tracked in analytics, so bad replies become findable instead of folklore.
  function voteMsg(i: number, vote: 'up' | 'down') {
    void tap();
    setMessages((m) => {
      const copy = m.slice();
      const msg = copy[i];
      if (!msg || msg.role !== 'assistant') return m;
      const next = msg.fb === vote ? undefined : vote;
      copy[i] = { ...msg, fb: next };
      if (next) track('feedback', { vote: next, model: msg.model ?? '', chars: msg.content.length });
      return copy;
    });
    dirtyRef.current = true; // persist the vote with the chat
  }

  async function copyMsg(i: number, text: string) {
    void tap();
    if (await copyText(text)) {
      setCopiedIdx(i);
      setTimeout(() => setCopiedIdx((cur) => (cur === i ? null : cur)), 1500);
    }
  }

  // Wipe this account's data off the device — chats and pins can contain bank /
  // email content, so they must not survive a sign-out (esp. on a shared phone).
  // Device-only prefs (Face ID, notifications, graph positions) are kept.
  function wipeLocalData() {
    try {
      if (uid) wipeStoredChats(uid);
    } catch { /* ignore */ }
    // Kill pending debounce timers and in-memory maps too — a draft timer firing
    // ~400ms after the wipe would write the old user's drafts straight back.
    if (draftTimer.current) { clearTimeout(draftTimer.current); draftTimer.current = null; }
    if (reArmTimer.current) { clearTimeout(reArmTimer.current); reArmTimer.current = null; }
    draftsRef.current = {};
    modelsRef.current = {};
    // Drop the cached connectors snapshot + node positions so a shared device
    // doesn't flash the previous user's apps on the next Connectors open.
    try { localStorage.removeItem('gf_connstatus'); localStorage.removeItem('gf_connpos'); } catch { /* ignore */ }
    // And un-arm the signed-out user's reminder notifications: a shared device
    // must not keep firing their titles on the lock screen.
    void cancelAllReminderNotifications();
    setReminders([]);
    setChats([]);
    setPinned(new Set());
    setMessages([]);
    setCurrentId(cid());
    setChatSearch('');
  }

  async function signOut() {
    stopStream();
    setSidebarOpen(false);
    wipeLocalData();
    await supabase.auth.signOut();
  }

  // Permanently delete the account: server wipes every row this user owns and
  // removes the auth user; then we clear the device and drop to the login screen.
  async function deleteAccount() {
    if (deleting) return;
    setDeleting(true);
    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      const res = await fetch(`${CONNECT_API.replace('/gmail-oauth', '')}/delete-account`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token ?? ''}`, 'content-type': 'application/json' },
      });
      if (!res.ok) throw new Error(`server returned ${res.status}`);
      stopStream();
      setConfirmDelete(false);
      setSidebarOpen(false);
      wipeLocalData();
      await supabase.auth.signOut();
    } catch (e) {
      flashNote(`Couldn't delete your account: ${e instanceof Error ? e.message : 'please try again'}.`, 7000);
    } finally {
      setDeleting(false);
    }
  }

  // ---- Hard update gate (overrides everything, incl. auth) ----
  if (forceUpdate) {
    return (
      <div className="lock-screen update-gate">
        <SunOrb size={46} className="lock-orb" />
        <div className="lock-brand">Go Farther</div>
        {forceUpdate === 'updating' ? (
          <>
            <span className="gf-status-spin" aria-hidden />
            <p className="update-msg">Updating to the latest version…</p>
          </>
        ) : (
          <p className="update-msg">A new version of Go Farther is required. Please update it in the App Store to continue.</p>
        )}
      </div>
    );
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
  const curModel = MODEL_OPTIONS.find((o) => o.id === model) ?? MODEL_OPTIONS[0]; // this chat's model (for the composer chip)
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
  // Sidebar display groups: Pinned first, then recency buckets (search stays flat).
  const chatSections: { label: string; items: Conversation[] }[] = [];
  if (q) {
    if (recentChats.length) chatSections.push({ label: 'Results', items: recentChats });
  } else {
    const pinnedItems = recentChats.filter((c) => pinned.has(c.id));
    if (pinnedItems.length) chatSections.push({ label: 'Pinned', items: pinnedItems });
    for (const c of recentChats.filter((c) => !pinned.has(c.id))) {
      const g = chatGroup(c.updatedAt || 0);
      const last = chatSections[chatSections.length - 1];
      if (last && last.label === g) last.items.push(c);
      else chatSections.push({ label: g, items: [c] });
    }
  }

  return (<>
    {/* The lock lives OUTSIDE the app shell: while locked, the shell below is
        `inert`, so the content can't be reached at all — not by tap, not by a
        hardware keyboard's Tab, not by VoiceOver. (It used to be an opaque
        overlay with the whole app still live underneath it.) */}
    {locked && (
      <div className="lock-screen">
        <SunOrb size={46} className="lock-orb" />
        <div className="lock-brand">Go Farther</div>
        <button className="lock-btn" onClick={() => void lockRef.current()}>Unlock</button>
      </div>
    )}
    <div
      className="app"
      // Callback ref (not a plain ref): if the shell remounts while locked —
      // force-update gate clearing, session loss — the fresh element must come
      // back already inert, not wait for the next lock/unlock transition.
      ref={(el) => { appShellRef.current = el; el?.toggleAttribute('inert', locked); }}
    >
      {/* flashNote() messages used to render ONLY inside Settings — invisible to
          the chat view they often concern (e.g. "turn on notifications to get
          reminders"). Outside Settings, show them as a transient toast. */}
      {noteMsg && view !== 'settings' && (
        <div className="gf-note-toast" role="status" aria-live="polite">{noteMsg}</div>
      )}
      <SidebarNav
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        session={session}
        isGuest={isGuest}
        view={view}
        currentId={currentId}
        chatSearch={chatSearch}
        setChatSearch={setChatSearch}
        q={q}
        chatSections={chatSections}
        editingId={editingId}
        editingTitle={editingTitle}
        setEditingTitle={setEditingTitle}
        setEditingId={setEditingId}
        commitRename={commitRename}
        selectChat={selectChat}
        newChat={newChat}
        go={go}
        signOut={() => setConfirmSignOut(true)}
        hasMore={hasMoreChats}
        loadingOlder={loadingOlder}
        onLoadOlder={() => void loadOlderChats()}
        rowPressStart={rowPressStart}
        rowPressCancel={rowPressCancel}
        pressFired={pressFired}
        onMenuChat={setMenuChat}
      />
      {/* Long-press chat actions sheet (content latched so it doesn't blank mid-exit) */}
      {menuSheetUi.mounted && menuSheetChat && (
        <>
          <div className={`sheet-scrim${menuSheetUi.closing ? ' closing' : ''}`} onClick={() => setMenuChat(null)} />
          <div className={`chat-sheet${menuSheetUi.closing ? ' closing' : ''}`} role="menu" aria-label="Chat actions" ref={menuSheetRef} tabIndex={-1}>
            <div className="chat-sheet-title">{menuSheetChat.title || 'New chat'}</div>
            <button className="chat-sheet-row" onClick={() => { togglePin(menuSheetChat.id); setMenuChat(null); }}>
              <IconPin size={16} /> {pinned.has(menuSheetChat.id) ? 'Unpin' : 'Pin'}
            </button>
            <button className="chat-sheet-row" onClick={() => { startRename(menuSheetChat); setMenuChat(null); }}>
              <IconEdit size={16} /> Rename
            </button>
            <button className="chat-sheet-row danger" onClick={() => { void thud(); deleteChat(menuSheetChat.id); setMenuChat(null); }}>
              <IconTrash size={16} /> Delete
            </button>
            <button className="chat-sheet-row cancel" onClick={() => setMenuChat(null)}>Cancel</button>
          </div>
        </>
      )}
      {/* "What's new" — shown once per announced edition (see whatsnew.ts) */}
      {wnUi.mounted && (
        <>
          <div className={`sheet-scrim${wnUi.closing ? ' closing' : ''}`} onClick={closeWhatsNew} />
          <div className={`chat-sheet wn-sheet${wnUi.closing ? ' closing' : ''}`} role="dialog" aria-label="What’s new" ref={wnRef} tabIndex={-1}>
            <div className="wn-eyebrow">What’s new</div>
            {WN_ITEMS.map((it) => (
              <div className="wn-item" key={it.title}>
                <div className="wn-item-title">{it.title}</div>
                <div className="wn-item-sub">{it.sub}</div>
              </div>
            ))}
            <button className="chat-sheet-row cancel" onClick={closeWhatsNew}>Nice</button>
          </div>
        </>
      )}
      {/* AI usage sheet — the ≈$ chip's detail view (estimates, not invoices) */}
      {usageUi.mounted && (
        <>
          <div className={`sheet-scrim${usageUi.closing ? ' closing' : ''}`} onClick={() => setUsageOpen(false)} />
          <div className={`chat-sheet usage-sheet${usageUi.closing ? ' closing' : ''}`} role="dialog" aria-label="AI usage" ref={usageRef} tabIndex={-1}>
            <div className="wn-eyebrow">AI usage · estimates</div>
            {usageSum ? (
              <>
                {/* Monthly budget bar (your own ceiling — tap the figure to change it) */}
                <div className="usage-budget">
                  <div className="usage-budget-top">
                    <span>This month</span>
                    {editBudget ? (
                      <input
                        className="usage-budget-input" type="number" inputMode="decimal" defaultValue={budget} autoFocus aria-label="Monthly budget"
                        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                        onBlur={(e) => { const v = Number(e.target.value); if (v > 0) { setBudget(v); saveBudget(v); } setEditBudget(false); }}
                      />
                    ) : (
                      <button className="usage-budget-val" onClick={() => setEditBudget(true)}>
                        {fmtUsd(usageSum.month.cost)} of {fmtUsd(budget)} ✎
                      </button>
                    )}
                  </div>
                  <div className="usage-bar">
                    <span className={`usage-bar-fill${usageSum.month.cost > budget ? ' over' : ''}`} style={{ width: `${Math.min(100, (usageSum.month.cost / budget) * 100)}%` }} />
                  </div>
                </div>
                {/* 5-hour burst window: spend in the last 5h vs a day's-budget pace. */}
                {(() => {
                  const cap = budget / 30; // a day's budget as the 5h ceiling (pace guard)
                  const pct = cap > 0 ? (usageSum.fiveHour.cost / cap) * 100 : 0;
                  return (
                    <div className="usage-src">
                      <div className="usage-src-top">
                        <span>5-hour limit</span>
                        <span>{Math.round(pct)}%{usageSum.fiveHour.resetsInMs > 0 ? ` · resets ${fmtDuration(usageSum.fiveHour.resetsInMs)}` : ''}</span>
                      </div>
                      <div className="usage-bar"><span className={`usage-bar-fill${pct > 100 ? ' over' : ''}`} style={{ width: `${Math.min(100, pct)}%` }} /></div>
                    </div>
                  );
                })()}
                <div className="usage-row"><span>Today</span><span>{fmtUsd(usageSum.today.cost)} · {fmtTokens(usageSum.today.tokens)} tokens</span></div>
                <div className="usage-row"><span>Last 7 days</span><span>{fmtUsd(usageSum.week.cost)} · {fmtTokens(usageSum.week.tokens)} tokens</span></div>
                {usageSum.bySource.length > 0 && (
                  <div className="usage-srcs">
                    {usageSum.bySource.slice(0, 4).map((s) => (
                      <div className="usage-src" key={s.source}>
                        <div className="usage-src-top"><span>{sourceLabel(s.source)}</span><span>{fmtUsd(s.cost)}</span></div>
                        <div className="usage-bar"><span className="usage-bar-fill alt" style={{ width: `${usageSum.bySource[0].cost > 0 ? (s.cost / usageSum.bySource[0].cost) * 100 : 0}%` }} /></div>
                      </div>
                    ))}
                  </div>
                )}
                <div className="usage-note">Token counts × list prices — actual billing can differ.</div>
              </>
            ) : (
              <div className="usage-note">Loading…</div>
            )}
            <button className="chat-sheet-row cancel" onClick={() => setUsageOpen(false)}>Done</button>
          </div>
        </>
      )}
      {/* Model picker — per chat. 'Auto' lets the backend route; an explicit pick
          makes the model (and its cost) the user's deliberate choice. */}
      {modelUi.mounted && (
        <>
          <div className={`sheet-scrim${modelUi.closing ? ' closing' : ''}`} onClick={() => setModelOpen(false)} />
          <div className={`chat-sheet model-sheet${modelUi.closing ? ' closing' : ''}`} role="dialog" aria-label="Choose model for this chat" ref={modelSheetRef} tabIndex={-1} onKeyDown={radioArrowNav}>
            <div className="wn-eyebrow">Model · this chat</div>
            {MODEL_OPTIONS.map((o) => (
              <button
                key={o.id}
                className={`model-opt${o.id === model ? ' on' : ''}`}
                role="menuitemradio"
                aria-checked={o.id === model}
                onClick={() => pickChatModel(o.id)}
              >
                <span className="model-opt-text">
                  <span className="model-opt-label">{o.label}</span>
                  <span className="model-opt-sub">{o.sub}</span>
                </span>
                <span className={`model-meter d${o.dots}`} aria-label={`cost: ${o.dots === 1 ? 'low' : o.dots === 2 ? 'medium' : 'high'}`}>
                  <span className={`model-bar${o.dots >= 1 ? ' on' : ''}`} />
                  <span className={`model-bar${o.dots >= 2 ? ' on' : ''}`} />
                  <span className={`model-bar${o.dots >= 3 ? ' on' : ''}`} />
                </span>
                <span className="model-check">{o.id === model && <IconCheck size={16} />}</span>
              </button>
            ))}
            <button className="chat-sheet-row cancel" onClick={() => setModelOpen(false)}>Done</button>
          </div>
        </>
      )}
      {/* In-app legal reader (Privacy / Terms) */}
      {legalUi.mounted && shownLegal && (
        <LegalSheet
          title={shownLegal === 'privacy' ? 'Privacy Policy' : 'Terms of Service'}
          body={shownLegal === 'privacy' ? PRIVACY_MD : TERMS_MD}
          closing={legalUi.closing}
          onClose={() => setLegalDoc(null)}
          panelRef={legalRef}
        />
      )}
      {/* Sign-out confirmation (signing out clears local chats/drafts/pins on this device) */}
      {signOutUi.mounted && (
        <>
          <div className={`sheet-scrim${signOutUi.closing ? ' closing' : ''}`} onClick={() => setConfirmSignOut(false)} />
          <div className={`chat-sheet${signOutUi.closing ? ' closing' : ''}`} role="alertdialog" aria-label="Sign out" ref={signOutSheetRef} tabIndex={-1}>
            <div className="chat-sheet-title">Sign out?</div>
            <p className="confirm-body">This clears your chats, drafts, and pins from this device. They’ll sync back when you sign in again.</p>
            <button className="chat-sheet-row danger" onClick={() => { setConfirmSignOut(false); void signOut(); }}>
              <IconLogout size={16} /> Sign out
            </button>
            <button className="chat-sheet-row cancel" onClick={() => setConfirmSignOut(false)}>Cancel</button>
          </div>
        </>
      )}
      {/* Delete-account confirmation */}
      {confirmUi.mounted && (
        <>
          <div className={`sheet-scrim${confirmUi.closing ? ' closing' : ''}`} onClick={() => !deleting && setConfirmDelete(false)} />
          <div className={`chat-sheet${confirmUi.closing ? ' closing' : ''}`} role="alertdialog" aria-label="Delete account" ref={confirmSheetRef} tabIndex={-1}>
            <div className="chat-sheet-title">Delete account?</div>
            <p className="confirm-body">This permanently erases your chats, memories, connected-app links, and bank connections. It can’t be undone.</p>
            <button className="chat-sheet-row danger" disabled={deleting} onClick={() => { void thud(); void deleteAccount(); }}>
              <IconTrash size={16} /> {deleting ? 'Deleting…' : 'Delete everything'}
            </button>
            <button className="chat-sheet-row cancel" disabled={deleting} onClick={() => setConfirmDelete(false)}>Cancel</button>
          </div>
        </>
      )}

      <header className="topbar">
        <button className="icon-btn menu-btn" onClick={() => { void tap(); setSidebarOpen(true); }} aria-label="Open menu">
          <IconMenu />
        </button>
        <span className="title">{view === 'chat' && messages.length === 0 ? '' : title}</span>
        <button className="icon-btn" onClick={newChat} aria-label="New chat">
          <IconCompose size={21} />
        </button>
      </header>

      {view === 'connectors' ? (
        <Suspense fallback={<RouteFallback />}><ErrorBoundary fallback={(reset) => <OverlayCrash onClose={() => { reset(); go('chat'); }} />}><ConnectorsGraph onClose={() => go('chat')} /></ErrorBoundary></Suspense>
      ) : view === 'settings' ? (
        <SettingsPage
          session={session}
          isGuest={isGuest}
          bioStatus={bioStatus}
          faceId={faceId}
          notif={notif}
          sounds={sounds}
          noteMsg={noteMsg}
          onToggleFaceId={() => void toggleFaceId()}
          onToggleNotif={() => void toggleNotif()}
          onToggleSounds={toggleSounds}
          soundTheme={sndTheme}
          reminderSound={reminderSound}
          onPickSoundTheme={pickSoundTheme}
          onPickReminderSound={pickReminderSound}
          onTestPush={() => void testPush()}
          onSignOut={() => setConfirmSignOut(true)}
          onDeleteAccount={() => setConfirmDelete(true)}
          onOpenLegal={(d) => setLegalDoc(d)}
        />
      ) : (
        <>
          <div className="live-bg" aria-hidden="true">
            <span className="orb orb1" />
            <span className="orb orb2" />
            <span className="orb orb3" />
            <span className="orb orb4" />
          </div>
          {/* Hidden live region: narrates the streaming reply to screen readers. */}
          <div className="sr-only" aria-live="polite">{liveMsg}</div>
          <div className="messages" ref={scrollRef} onScroll={onThreadScroll} aria-label="Conversation">
            {messages.length === 0 ? (
              <div className="home">
                <div className="home-hero">
                  <SunOrb size={88} className="home-orb" />
                  <h1 className="home-mark">Go Farther</h1>
                  <p className="home-tag">One chat for all your apps.</p>
                </div>
                <div className="home-suggest">
                  {homeSugs.map((s) => (
                    <button key={s} className="sug" onClick={() => { void tap(); void sendText(s); }}>
                      {s}
                    </button>
                  ))}
                  {lastChat && (
                    <button className="home-continue" onClick={() => { void tap(); selectChat(lastChat.id); }}>
                      Continue “{lastChat.title || 'Last chat'}”
                    </button>
                  )}
                </div>
              </div>
            ) : (
              <div className="thread">
                {messages.length > visCount && (
                  <button className="thread-earlier" onClick={showEarlier}>
                    Show earlier messages ({messages.length - visCount} more)
                  </button>
                )}
                {messages.slice(Math.max(0, messages.length - visCount)).map((m, j) => {
                  const i = Math.max(0, messages.length - visCount) + j;
                  const streamingHere = busy && i === messages.length - 1 && m.role === 'assistant';
                  // No visible text yet → AssistantMessage shows its own "thinking"
                  // (or tool-activity) indicator, so don't also blink the bare cursor.
                  const thinking = streamingHere
                    && !m.content.replace(/\[\[gf(?:status|sync):[^\]]*\]\]/g, '').replace(/\[\[gf\w*(?::[^\]]*)?\]?$/, '').trim();
                  return (
                    <div key={m.id ?? i} className={`msg ${m.role}`}>
                      <div className="bubble">
                        {m.role === 'assistant' ? (
                          m.failed ? (
                            <RecoveryBubble m={m} onRetry={() => void retryPending(true)} />
                          ) : (
                            <AssistantMessage text={m.content} streaming={streamingHere} onOpen={openEmail} />
                          )
                        ) : (
                          <>
                            {m.attachments && m.attachments.length > 0 && (
                              <div className="msg-atts">
                                {m.attachments.map((a, ai) => <AttView key={ai} a={a} onTap={setLightbox} />)}
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
                          <button className={`msg-act fb${m.fb === 'up' ? ' on' : ''}`} aria-label="Good reply" aria-pressed={m.fb === 'up'} onClick={() => voteMsg(i, 'up')}>
                            <IconThumbUp size={14} />
                          </button>
                          <button className={`msg-act fb${m.fb === 'down' ? ' on' : ''}`} aria-label="Bad reply" aria-pressed={m.fb === 'down'} onClick={() => voteMsg(i, 'down')}>
                            <IconThumbDown size={14} />
                          </button>
                          {m.model && <span className="msg-model" title={m.model}>{modelShort(m.model)}</span>}
                          {m.ts && <span className="msg-time-stamp">{new Date(m.ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span>}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {!online && (
            <div className="net-banner" role="status" aria-live="polite">You're offline — messages will send when you reconnect.</div>
          )}
          {brokenApps.length > 0 && !brokenDismissed && (
            <div className="conn-warn" role="status">
              <button className="conn-warn-main" onClick={() => go('connectors')}>
                ⚠️ {brokenApps.join(', ')} {brokenApps.length === 1 ? 'needs' : 'need'} reconnecting — tap to fix
              </button>
              <button className="conn-warn-x" onClick={() => setBrokenDismissed(true)} aria-label="Dismiss">
                <IconX size={13} />
              </button>
            </div>
          )}
          <div className="composer-wrap">
            {!atBottom && messages.length > 0 && (
              <button className={`scroll-latest${unseen ? ' unseen' : ''}`} onClick={jumpToLatest} aria-label="Jump to latest message">
                <IconArrowDown size={16} />
              </button>
            )}
            {usageSum && (
              <button className="usage-chip" onClick={openUsage} aria-label="AI usage this month">
                ≈{fmtUsd(usageSum.month.cost)}
              </button>
            )}
            {radialUi.mounted && (
              <div
                className={`conn-pop-backdrop radial-scrim${radialUi.closing ? ' closing' : ''}`}
                onClick={() => {
                  if (Date.now() - menuOpenedAt.current < 400) return; // ignore the tap's ghost-click
                  setPlusOpen(false);
                }}
              />
            )}

            {/* "+" radial menu: attach options rise up from the + as circles,
                staggered bottom-to-top; labels sit to the right (no overlap) */}
            {radialUi.mounted && (
              <div className={`radial${radialUi.closing ? ' closing' : ''}`} role="menu" aria-label="Attach and tools" ref={radialRef} tabIndex={-1}>
                <button className="radial-item" style={{ left: 0, bottom: 388, animationDelay: '250ms' }} onClick={() => { setPlusOpen(false); openMemory(); }}>
                  <IconMemory size={20} /><span className="radial-label">Memory</span>
                </button>
                <button className="radial-item" style={{ left: 17, bottom: 330, animationDelay: '210ms' }} onClick={() => { setPlusOpen(false); openReminders(); }}>
                  <IconClock size={20} /><span className="radial-label">Reminders</span>
                </button>
                <button className="radial-item" style={{ left: 34, bottom: 272, animationDelay: '170ms' }} onClick={() => openPicker('camera')}>
                  <IconCamera size={20} /><span className="radial-label">Camera</span>
                </button>
                <button className="radial-item" style={{ left: 50, bottom: 214, animationDelay: '130ms' }} onClick={() => openPicker('attachments')}>
                  <IconFiles size={20} /><span className="radial-label">Attachments</span>
                </button>
                <button className="radial-item" style={{ left: 65, bottom: 156, animationDelay: '90ms' }} onClick={() => { setPlusOpen(false); void loadConnectors(); setWfOpen(true); }}>
                  <IconWorkflow size={20} /><span className="radial-label">Workflows</span>
                </button>
                <button className="radial-item" style={{ left: 79, bottom: 98, animationDelay: '50ms' }} onClick={() => { setPlusOpen(false); go('connectors'); }}>
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
              {queued && (
                <div className="queued-chip" role="status">
                  <span className="gf-status-spin" aria-hidden />
                  <span className="queued-text">
                    Sends when this reply finishes — “{queued.text.length > 56 ? `${queued.text.slice(0, 56)}…` : queued.text}”
                  </span>
                  <button
                    className="att-x"
                    onClick={() => { setInput(queued.text); setDraft(currentId, queued.text); setAttachments(queued.atts); setQueued(null); taRef.current?.focus(); }}
                    aria-label="Cancel queued message and edit it"
                  >
                    <IconX size={12} />
                  </button>
                </div>
              )}
              <div className="composer-tools">
                <button
                  className="model-chip"
                  onClick={() => { void tap(); setModelOpen(true); }}
                  aria-label={`Model for this chat: ${curModel.label}. Tap to change.`}
                >
                  <span className={`model-dot d${curModel.dots}`} aria-hidden />
                  {curModel.chip}
                </button>
              </div>
              <div className="composer-row">
                <button
                  className={`plus-btn ${plusOpen ? 'open' : ''}`}
                  onClick={() => { void tap(); menuOpenedAt.current = Date.now(); setPlusOpen((o) => !o); }}
                  aria-label="Add attachment or connectors"
                >
                  <IconPlus size={20} />
                </button>
                <button
                  className="call-btn"
                  onClick={() => { tap(); void primeAudio(); setPlusOpen(false); setCallOpen(true); track('voice_call'); }}
                  disabled={busy}
                  aria-label="Talk to Go Farther"
                >
                  <IconWaveform size={20} />
                </button>
                <textarea
                  ref={taRef}
                  value={input}
                  onChange={(e) => { setInput(e.target.value); setDraft(currentId, e.target.value); }}
                  onKeyDown={onKeyDown}
                  onPaste={(e) => void onPaste(e)}
                  placeholder="Message Go Farther…"
                  aria-label="Message Go Farther"
                  rows={1}
                />
                {!busy && (micState !== 'idle' || (!input.trim() && attachments.length === 0)) ? (
                  <button
                    className={`send mic ${micState}`}
                    onClick={() => void dictate()}
                    aria-label={micState === 'rec' ? 'Stop recording' : micState === 'tx' ? 'Transcribing' : 'Dictate a message'}
                  >
                    {micState === 'tx' ? <span className="gf-status-spin" aria-hidden /> : <IconMic size={20} />}
                  </button>
                ) : (
                  // Mid-reply with text typed, the button sends (queues) instead of
                  // stopping — clear the box to get Stop back.
                  <button
                    className="send"
                    onClick={() => { if (busy && !input.trim() && attachments.length === 0) { void tap(); stopStream(); } else void send(); }}
                    disabled={!busy && !input.trim() && attachments.length === 0}
                    aria-label={busy ? (input.trim() || attachments.length > 0 ? 'Send when this reply finishes' : 'Stop generating') : 'Send'}
                  >
                    {busy && !input.trim() && attachments.length === 0 ? <span className="stop-sq" /> : <IconArrowUp size={20} />}
                  </button>
                )}
              </div>
            </div>
            <input ref={fileRef} type="file" hidden onChange={onFiles} />
            <p className="hint">Go Farther can make mistakes — double-check important info.</p>
          </div>
        </>
      )}

      {lightboxUi.mounted && lightboxSrc && (
        <div className={`gf-lightbox${lightboxUi.closing ? ' closing' : ''}`} role="dialog" aria-label="Image preview" ref={lightboxRef} tabIndex={-1} onClick={() => setLightbox(null)}>
          <button className="sr-only" onClick={() => setLightbox(null)}>Close preview</button>
          <img src={lightboxSrc} alt="Attachment, enlarged" />
        </div>
      )}

      {/* Full-screen overlays: the display:contents wrapper carries .gf-out for
          the exit beat — no box of its own, so layout is untouched. */}
      {memUi.mounted && (
        <Suspense fallback={<RouteFallback />}>
          <div style={{ display: 'contents' }} className={memUi.closing ? 'gf-out' : undefined}>
            <ErrorBoundary fallback={(reset) => <OverlayCrash onClose={() => { reset(); closeMemory(); }} />}>
            <MemoryGraph
              memories={memories}
              loaded={memLoaded}
              loadErr={memErr}
              onRetry={() => void loadMems()}
              enabled={memEnabled}
              onAdd={addMem}
              onAddFile={addMemFile}
              onUpdate={updateMem}
              onDelete={delMem}
              onToggle={toggleMem}
              onClose={closeMemory}
            />
            </ErrorBoundary>
          </div>
        </Suspense>
      )}

      {remUi.mounted && (
        <Suspense fallback={<RouteFallback />}>
          <div style={{ display: 'contents' }} className={remUi.closing ? 'gf-out' : undefined}>
            <ErrorBoundary fallback={(reset) => <OverlayCrash onClose={() => { reset(); closeReminders(); }} />}>
            <RemindersGraph
              reminders={reminders}
              loaded={remLoaded}
              loadErr={remErr}
              onRetry={() => void loadRems()}
              onAdd={addRem}
              onUpdate={updateRem}
              onDelete={delRem}
              onToggle={toggleRem}
              onClose={closeReminders}
            />
            </ErrorBoundary>
          </div>
        </Suspense>
      )}

      {wfUi.mounted && (
        <Suspense fallback={<RouteFallback />}>
          <div style={{ display: 'contents' }} className={wfUi.closing ? 'gf-out' : undefined}>
            <ErrorBoundary fallback={(reset) => <OverlayCrash onClose={() => { reset(); setWfOpen(false); }} />}>
            <WorkflowsScreen connApps={connApps} onClose={() => setWfOpen(false)} />
            </ErrorBoundary>
          </div>
        </Suspense>
      )}

      {callUi.mounted && (
        <Suspense fallback={<RouteFallback />}>
          <div style={{ display: 'contents' }} className={callUi.closing ? 'gf-out' : undefined}>
            <ErrorBoundary fallback={(reset) => <OverlayCrash onClose={() => { reset(); setCallOpen(false); closeAudio(); }} />}>
            <CallScreen
              baseHistory={messages}
              apps={connLoaded ? [...enabled] : undefined}
              conversationId={currentId}
              memoryOn={memEnabled}
              model={model}
              onTurn={(h) => { dirtyRef.current = true; setMessages(h); }}
              onReminderSet={() => void syncRemindersFromChat()}
              onClose={() => { setCallOpen(false); closeAudio(); }}
            />
            </ErrorBoundary>
          </div>
        </Suspense>
      )}
    </div>
  </>);
}
