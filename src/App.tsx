import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './supabase';
import { CONNECTORS, CONNECT_API } from './connectorData';
import Login from './Login';
import { IconConnectors, IconSettings, IconTrash, IconX, IconLogout, IconArrowLeft } from './icons';
import { App as CapApp } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { tap, thud } from './haptics';
import { useDismiss } from './motion';
import ErrorBoundary from './ErrorBoundary';
import SunOrb from './SunOrb';
import SettingsPage from './SettingsPage';
import LegalSheet from './LegalSheet';
import { PRIVACY_MD, TERMS_MD } from './legalDocs';
import { biometryAvailable, biometryStatus, unlock, type BiometryStatus } from './biometric';
import { track } from './analytics';
import { useFocusTrap } from './a11y';
import { SENDRA_LOGO } from './sendraLogo';
import { ASSETS, FILMS, Wall, attachParallax } from './loginScene';
import { SENDRA_TOOLS, type MktNavRequest } from './marketingNav';
import { FORCE_UPDATE_EVENT, type ForceUpdateMode } from './ota';

// Heavy, on-demand screens are code-split: their JS downloads only when first
// opened, shrinking the initial bundle and speeding up launch.
const ConnectorsGraph = lazy(() => import('./ConnectorsGraph'));
const AgentsScreen = lazy(() => import('./AgentsScreen'));

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

type View = 'home' | 'connectors' | 'settings';

// The hub's living background (desktop only): the login page's atmosphere —
// drifting wall of work + flying showcase cards — wrapped around the screen
// edges, leaving the centre clear for the Marketing word.
function HubScene() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    return attachParallax(el);
  }, []);
  return (
    <div className="hub-scene" ref={ref} aria-hidden="true">
      <Wall quiet />
      {FILMS.map((f, i) => (
        <div className={`lp-fly hub-f${i + 1}`} data-depth={f.depth} key={f.cls}>
          <div className="lp-orbit">
            {/* Unlike the login showcase, the hub is visited constantly — the
                poster carries the card and the video only streams on hover. */}
            <div
              className="lp-card"
              onMouseEnter={(e) => { void e.currentTarget.querySelector('video')?.play()?.catch(() => {}); }}
              onMouseLeave={(e) => { e.currentTarget.querySelector('video')?.pause(); }}
            >
              <video src={f.src} poster={f.poster} muted playsInline loop preload="none" />
              <span className="lp-wm">gofarther.dev</span>
              <div className="lp-cap"><div className="lp-lbl">✦ PROMPT</div><p>{f.prompt}</p></div>
            </div>
          </div>
        </div>
      ))}
      <div className="lp-fly hub-f6" data-depth={0.9}>
        <div className="lp-orbit">
          <div className="lp-card lp-email">
            <img className="lp-scroller" src={`${ASSETS}/email-nova.jpg`} alt="" loading="lazy" />
            <span className="lp-wm">gofarther.dev</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// Flip to `true` to show the email/password login screen. When `false`, the app
// skips the login UI and uses a silent anonymous "guest" session, so identity
// (per-user connectors) still works without a sign-in wall.
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
      if (s) {
        // Keep object identity when the token didn't change: the client
        // re-emits SIGNED_IN on every tab focus, and a fresh object would
        // re-render the whole signed-in tree for nothing.
        setSession((prev) => (prev && prev.access_token === s.access_token ? prev : s));
        return;
      }
      // A null here is either a real sign-out or a transient blip while the
      // client refreshes an expired token on tab focus. Dropping straight to
      // <Login /> unmounts and remounts the entire app (hub replays its
      // entrance, the Marketing page reloads) — so re-check in a beat and
      // only tear down when the session is really gone.
      window.setTimeout(() => {
        void supabase.auth.getSession().then(({ data }) => {
          if (active && !data.session) setSession(null);
        });
      }, 400);
      // Login is deactivated: if the session ever goes away (sign-out/expiry),
      // silently re-establish a guest one instead of showing a login wall.
      if (!REQUIRE_LOGIN) supabase.auth.signInAnonymously().catch(() => {});
    });
    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  const uid = session?.user.id ?? null;

  const [view, setView] = useState<View>('home');
  // The Marketing agent: one overlay around the email engine (Sendra).
  const [mktOpen, setMktOpen] = useState(false);
  // The unified sidebar steers this; `id`+`n` deep-link into the engine.
  const [mktNav, setMktNav] = useState<MktNavRequest>({ area: 'email', id: 'emails', n: 0 });
  const mktGo = (area: 'email' | 'social', id: string) => {
    void tap();
    setMktNav((p) => ({ area, id, n: p.n + 1 }));
  };
  // Desktop-only hub scene gate: checked once at mount so phones never mount
  // (or download) the showcase videos.
  const [wideViewport] = useState(() => typeof window !== 'undefined' && window.matchMedia('(min-width: 900px)').matches);
  const [noteMsg, setNoteMsg] = useState(''); // transient Settings note (e.g. why a toggle didn't stick)

  // Face ID / biometric lock (opt-in; native-only; fails open).
  const [faceId, setFaceId] = useState(() => { try { return localStorage.getItem('gf_faceid') === '1'; } catch { return false; } });
  const [locked, setLocked] = useState(() => { try { return localStorage.getItem('gf_faceid') === '1' && Capacitor.getPlatform() !== 'web'; } catch { return false; } });
  const faceIdRef = useRef(faceId);
  faceIdRef.current = faceId;
  const [bioStatus, setBioStatus] = useState<BiometryStatus | 'unknown'>('unknown'); // gates the Face ID row
  const [confirmDelete, setConfirmDelete] = useState(false); // delete-account confirm sheet
  const [confirmSignOut, setConfirmSignOut] = useState(false); // sign-out confirm sheet
  const [deleting, setDeleting] = useState(false);
  const [forceUpdate, setForceUpdate] = useState<ForceUpdateMode | null>(null); // hard update gate (from ota.ts)
  const [legalDoc, setLegalDoc] = useState<'privacy' | 'terms' | null>(null); // in-app Privacy/Terms reader
  const lockRef = useRef<() => void>(() => {});
  const unlockingRef = useRef(false); // a biometric prompt is mid-flight — never stack a second one
  const lastUnlockRef = useRef(0);    // the prompt's own dismiss fires an `active` event — don't re-engage off it
  const appShellRef = useRef<HTMLDivElement | null>(null); // made `inert` while locked

  // ---- Per-session connectors ----
  // Which apps are connected (from the backend) and whether any have a dead
  // OAuth that needs reconnecting (surfaced as a banner on the home screen).
  const [connApps, setConnApps] = useState<string[]>([]);
  const [brokenApps, setBrokenApps] = useState<string[]>([]); // connected apps whose OAuth died
  const [brokenDismissed, setBrokenDismissed] = useState(false);

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
      // Healthy connections drive the connected list; broken ones (expired OAuth)
      // surface as a "reconnect" banner instead of failing silently.
      const ids = CONNECTORS.map((c) => c.id).filter((id) => conn[id] && !conn[id].broken);
      setBrokenApps(CONNECTORS.filter((c) => conn[c.id]?.broken).map((c) => c.name));
      setConnApps(ids);
    } catch {
      /* offline — leave as-is */
    }
  }

  useEffect(() => {
    if (!uid) {
      setConnApps([]);
      return;
    }
    void loadConnectors();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid]);

  // Product analytics: one app_open per signed-in launch/login (counts, no content).
  useEffect(() => {
    if (uid) track('app_open');
  }, [uid]);

  // Focus traps: while a sheet/menu is open, Tab stays inside it, Escape
  // closes it, and focus returns to the control that opened it.
  const confirmSheetRef = useRef<HTMLDivElement>(null);
  const signOutSheetRef = useRef<HTMLDivElement>(null);
  const legalRef = useRef<HTMLDivElement>(null);
  useFocusTrap(confirmDelete, confirmSheetRef, () => { if (!deleting) setConfirmDelete(false); });
  useFocusTrap(confirmSignOut, signOutSheetRef, () => setConfirmSignOut(false));
  useFocusTrap(!!legalDoc, legalRef, () => setLegalDoc(null));

  // Animated dismissal for every sheet/overlay this component mounts — the
  // element stays for one exit beat with a `.closing`/`.gf-out` class (motion.ts).
  const confirmUi = useDismiss(confirmDelete);
  const signOutUi = useDismiss(confirmSignOut);
  const mktUi = useDismiss(mktOpen);
  // Legal reader: latch the doc so the sheet doesn't blank out during its exit beat.
  const legalUi = useDismiss(!!legalDoc);
  const lastLegal = useRef(legalDoc);
  if (legalDoc) lastLegal.current = legalDoc;
  const shownLegal = legalDoc ?? lastLegal.current;

  // A short-lived note in Settings (auto-clears) — used to explain why a toggle
  // didn't turn on (no biometrics, …).
  function flashNote(msg: string, ms = 4500) {
    setNoteMsg(msg);
    setTimeout(() => setNoteMsg((m) => (m === msg ? '' : m)), ms);
  }

  // Lock the moment we background (Face ID on): the iOS app-switcher snapshot
  // then shows the lock screen, not the user's last screen. A real backgrounding
  // also invalidates the just-unlocked grace.
  useEffect(() => {
    let handle: { remove: () => void } | undefined;
    void CapApp.addListener('appStateChange', ({ isActive }) => {
      if (!isActive) {
        if (faceIdRef.current && Capacitor.getPlatform() !== 'web') {
          lastUnlockRef.current = 0;
          setLocked(true);
        }
        return;
      }
      void lockRef.current(); // re-prompt the biometric lock on resume (no-op unless on)
    }).then((h) => { handle = h; });
    return () => { handle?.remove(); };
  }, []);

  // Engage the biometric lock on launch (no-op unless Face ID is on + supported).
  useEffect(() => {
    if (faceIdRef.current) void lockRef.current();
  }, []);

  // While locked, the app shell must be a REAL lock, not just opaque pixels on
  // top: `inert` makes everything behind the lock unfocusable, unclickable and
  // invisible to screen readers. Focus lands on Unlock. The full-screen overlays
  // (Connectors/Agents) portal onto document.body — OUTSIDE the shell — so they
  // must be inerted separately, and one mounting WHILE locked is caught by the
  // observer.
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

  // Biometric lock: engage if enabled AND available, otherwise fail open (we
  // never trap the user behind a lock we can't satisfy — e.g. plugin not yet in
  // this native build, no hardware, web).
  async function engageLock() {
    if (!faceIdRef.current || Capacitor.getPlatform() === 'web') { setLocked(false); return; }
    if (unlockingRef.current) return; // a prompt is already up
    if (Date.now() - lastUnlockRef.current < 1500) return; // `active` fired by our own prompt dismissing
    // Cover the content BEFORE any async check.
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

  function go(v: View) {
    setView(v);
    if (v === 'home') void loadConnectors(); // pick up anything connected meanwhile
  }

  // Wipe this account's local cache off the device — connector snapshot + node
  // positions must not survive a sign-out (esp. on a shared phone). Device-only
  // prefs (Face ID) are kept.
  function wipeLocalData() {
    // Drop the cached connectors snapshot + node positions so a shared device
    // doesn't flash the previous user's apps on the next Connectors open.
    try {
      localStorage.removeItem('gf_connstatus'); localStorage.removeItem('gf_connpos');
      localStorage.removeItem('gf_pending_send'); // any in-flight compose draft
    } catch { /* ignore */ }
    setConnApps([]);
    setBrokenApps([]);
  }

  async function signOut() {
    wipeLocalData();
    await supabase.auth.signOut();
    // Full reload: module-level in-memory caches (inbox, contacts, telegram in
    // AgentsScreen) survive React unmount, so without this the next user on a
    // shared device could see the previous user's mail/contacts.
    try { window.location.reload(); } catch { /* ignore */ }
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
      setConfirmDelete(false);
      wipeLocalData();
      await supabase.auth.signOut();
      try { window.location.reload(); } catch { /* ignore */ }
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

  return (<>
    {/* The lock lives OUTSIDE the app shell: while locked, the shell below is
        `inert`, so the content can't be reached at all — not by tap, not by a
        hardware keyboard's Tab, not by VoiceOver. */}
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
      {/* Transient toast for flashNote() messages outside Settings. */}
      {noteMsg && view !== 'settings' && (
        <div className="gf-note-toast" role="status" aria-live="polite">{noteMsg}</div>
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
      {/* Sign-out confirmation */}
      {signOutUi.mounted && (
        <>
          <div className={`sheet-scrim${signOutUi.closing ? ' closing' : ''}`} onClick={() => setConfirmSignOut(false)} />
          <div className={`chat-sheet${signOutUi.closing ? ' closing' : ''}`} role="alertdialog" aria-label="Sign out" ref={signOutSheetRef} tabIndex={-1}>
            <div className="chat-sheet-title">Sign out?</div>
            <p className="confirm-body">You’ll need to sign in again to use your connected apps on this device.</p>
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
            <p className="confirm-body">This permanently erases your connected-app links and bank connections. It can’t be undone.</p>
            <button className="chat-sheet-row danger" disabled={deleting} onClick={() => { void thud(); void deleteAccount(); }}>
              <IconTrash size={16} /> {deleting ? 'Deleting…' : 'Delete everything'}
            </button>
            <button className="chat-sheet-row cancel" disabled={deleting} onClick={() => setConfirmDelete(false)}>Cancel</button>
          </div>
        </>
      )}

      <header className="topbar">
        {view === 'home' ? (
          <button className="icon-btn" onClick={() => { void tap(); go('connectors'); }} aria-label="Connectors">
            <IconConnectors size={21} />
          </button>
        ) : (
          <button className="icon-btn" onClick={() => { void tap(); go('home'); }} aria-label="Back">
            <IconArrowLeft size={22} />
          </button>
        )}
        <span className="title">{title}</span>
        {view === 'home' ? (
          <button className="icon-btn" onClick={() => { void tap(); go('settings'); }} aria-label="Settings">
            <IconSettings size={21} />
          </button>
        ) : (
          <span className="icon-btn" aria-hidden />
        )}
      </header>

      {view === 'connectors' ? (
        <Suspense fallback={<RouteFallback />}><ErrorBoundary fallback={(reset) => <OverlayCrash onClose={() => { reset(); go('home'); }} />}><ConnectorsGraph onClose={() => go('home')} /></ErrorBoundary></Suspense>
      ) : view === 'settings' ? (
        <SettingsPage
          session={session}
          isGuest={isGuest}
          bioStatus={bioStatus}
          faceId={faceId}
          noteMsg={noteMsg}
          onToggleFaceId={() => void toggleFaceId()}
          onSignOut={() => setConfirmSignOut(true)}
          onDeleteAccount={() => setConfirmDelete(true)}
          onOpenLegal={(d) => setLegalDoc(d)}
        />
      ) : (
        <>
          {/* Pure-black hub: the .live-bg keeps its black backdrop but carries
              no orbs here — the word IS the interface. On desktop the login
              page's living scene wraps the edges (mounted only on wide
              viewports so phones never load the videos). */}
          <div className="live-bg" aria-hidden="true" />
          {wideViewport && <HubScene />}
          <div className="home agents-home">
            <button className="mkt-word" onClick={() => { void tap(); void loadConnectors(); setMktOpen(true); }}>
              Marketing
            </button>
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
          </div>
        </>
      )}

      {/* Full-screen overlays: the display:contents wrapper carries .gf-out for
          the exit beat — no box of its own, so layout is untouched. */}
      {mktUi.mounted && (
        <Suspense fallback={<RouteFallback />}>
          <div style={{ display: 'contents' }} className={mktUi.closing ? 'mkt-wrap gf-out' : 'mkt-wrap'}>
            <ErrorBoundary fallback={(reset) => <OverlayCrash onClose={() => { reset(); setMktOpen(false); }} />}>
            {/* The stage owns the enter/exit beat for the whole Marketing page.
                The screens' own memgIn is suppressed inside it — re-showing a
                display:none element restarts CSS animations, so per-screen
                entrances would replay (a hub-revealing cross-fade) on every
                area flip. */}
            <div className="mkt-stage">
            <div className="mkt-area">
              <AgentsScreen connApps={connApps} onClose={() => setMktOpen(false)} navRequest={mktNav} active />
            </div>
            {/* One Marketing sidebar (desktop). Social (Wingup) retired —
                Marketing is the email engine now. */}
            <nav className="mkt-side" aria-label="Marketing">
              <div className="mkt-side-brand">Marketing</div>
              <div className="mkt-side-scroll">
                <div className="mkt-side-grp"><img src={SENDRA_LOGO} alt="" aria-hidden /> Email &amp; SMS</div>
                {SENDRA_TOOLS.map((t) => (
                  <button
                    key={t.id}
                    className={`mkt-side-link${mktNav.id === t.id ? ' on' : ''}`}
                    onClick={() => mktGo('email', t.id)}
                  >
                    <t.Icon size={18} /> {t.name}
                  </button>
                ))}
              </div>
              <button className="mkt-side-exit" onClick={() => { void tap(); setMktOpen(false); }}>
                <IconArrowLeft size={16} /> Close
              </button>
            </nav>
            </div>
            </ErrorBoundary>
          </div>
        </Suspense>
      )}
    </div>
  </>);
}
