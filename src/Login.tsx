import { useState, useRef, useEffect, useMemo, type FormEvent } from 'react';
import { supabase } from './supabase';
import { friendlyAuthError } from './authErrors';

// Passwordless auth, with separate Sign in / Sign up screens. Both use an email
// code (sent branded via the auth-email → Resend hook): enter email → get a
// code → verify. The only real difference is shouldCreateUser — Sign up creates
// new accounts; Sign in only admits existing ones.
//
// On desktop (≥900px) the page is a split-screen: a cinematic brand panel on
// the left (flying AI-generated video cards over a drifting "wall of work",
// assets streamed from Supabase storage) and the auth card on the right. On
// phones only the auth card renders — the app keeps its original look.
type Mode = 'signin' | 'signup';
type Step = 'email' | 'code';

const ASSETS = 'https://lkpfeqrelvziltfwpuxi.supabase.co/storage/v1/object/public/email-assets/login';

// The five showcase generations: placement/motion personality lives in CSS (.lp-f1..5).
const FILMS = [
  { src: `${ASSETS}/v-headset.mp4`, cls: 'lp-f1', depth: 1.4, prompt: 'Ultra high-end commercial product shot, VR headset against deep navy, magenta and cyan accents, immaculate reflections.' },
  { src: `${ASSETS}/v-architect.mp4`, cls: 'lp-f2', depth: 0.8, prompt: 'Editorial photography, 8K — architect in a cream blazer, brutalist concrete stairwell, soft skylight, magazine cover quality.' },
  { src: `${ASSETS}/v-perfume.mp4`, cls: 'lp-f3', depth: 1.8, prompt: 'Crystal-cut perfume bottle catching prismatic light, slow orbit, hard sun through venetian blinds, warm sandstone wall.' },
  { src: `${ASSETS}/v-temple.mp4`, cls: 'lp-f4', depth: 1.0, prompt: 'Slow cinematic push-in through an ancient temple, fog in the valley, golden light catching dust between stone pillars.' },
  { src: `${ASSETS}/v-dragon.mp4`, cls: 'lp-f5', depth: 1.5, prompt: 'Torch-lit forest at dusk — a shaman with glowing markings, then an iridescent dragon descends, trees trembling.' },
];

const WALL_LABELS: [string, string][] = [
  ['Product Key Shots', 'Generating'], ['Brand Campaign Hero', 'Judging'],
  ['Studio Shots', 'Researching'], ['Social Posts', 'Drafting'],
  ['Billboard Mockups', 'Thinking'], ['Packaging Mockups', 'Rendering'],
  ['In-Store Visuals', 'Researching'], ['Print Posters', 'Judging'],
  ['Product Showcase Loop', 'Generating'], ['Email Hero Images', 'Compositing'],
  ['Storyboards', 'Generating'], ['Imagery Style', 'Thinking'],
  ['Product Pages', 'Writing'], ['Campaign Themes', 'Exploring'],
];
const WALL_SIZES = [4, 5, 3, 6, 4, 3, 5, 4, 6, 3, 5, 4, 3, 5, 4, 6, 3, 4];
const SPRITE_COLS = 10;
const SPRITE_TILES = 50;

// The drifting "wall of work" behind the cards: clusters of tiny generations
// sliced from one sprite sheet, each with a working label.
function Wall() {
  const clusters = useMemo(() => {
    let t = 0;
    return WALL_SIZES.map((n, ci) => {
      const [name, verb] = WALL_LABELS[ci % WALL_LABELS.length];
      const tiles = Array.from({ length: n }, (_, k) => {
        const idx = t % SPRITE_TILES;
        t += 7; // stride so neighbouring tiles come from different videos
        return { idx, big: (ci + k) % 5 === 0, fresh: (ci * 3 + k) % 6 === 0, delay: (ci * 1.7 + k * 2.3) % 6 };
      });
      return { name, verb, dotDelay: (ci * 0.7) % 2.4, tiles };
    });
  }, []);
  return (
    <div className="lp-wall" aria-hidden="true">
      {clusters.map((c, i) => (
        <div className="lp-cluster" key={i}>
          <span className="lp-clabel"><b>{c.name}</b> · {c.verb} <span className="lp-cdot" style={{ animationDelay: `${c.dotDelay}s` }} /></span>
          <div className="lp-crow">
            {c.tiles.map((tl, k) => (
              <span
                key={k}
                className={`lp-tile${tl.big ? ' big' : ''}${tl.fresh ? ' fresh' : ''}`}
                style={{
                  backgroundPosition: `${-(tl.idx % SPRITE_COLS) * 100}% ${-Math.floor(tl.idx / SPRITE_COLS) * 100}%`,
                  animationDelay: tl.fresh ? `${tl.delay}s` : undefined,
                }}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// The cinematic left panel (desktop only; CSS hides it on phones).
function BrandPanel() {
  const panelRef = useRef<HTMLDivElement>(null);

  // Mouse parallax: cards shift by depth so the cluster feels 3D.
  useEffect(() => {
    const panel = panelRef.current;
    if (!panel || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const flies = [...panel.querySelectorAll<HTMLElement>('.lp-fly')];
    let tx = 0, ty = 0, cx = 0, cy = 0, raf = 0;
    const onMove = (ev: MouseEvent) => {
      const r = panel.getBoundingClientRect();
      tx = ((ev.clientX - r.left) / r.width - 0.5) * 2;
      ty = ((ev.clientY - r.top) / r.height - 0.5) * 2;
    };
    const onLeave = () => { tx = 0; ty = 0; };
    const tick = () => {
      cx += (tx - cx) * 0.06; cy += (ty - cy) * 0.06;
      for (const f of flies) {
        const d = parseFloat(f.dataset.depth || '1');
        f.style.marginLeft = `${-cx * 14 * d}px`;
        f.style.marginTop = `${-cy * 10 * d}px`;
      }
      raf = requestAnimationFrame(tick);
    };
    panel.addEventListener('mousemove', onMove);
    panel.addEventListener('mouseleave', onLeave);
    raf = requestAnimationFrame(tick);
    return () => {
      panel.removeEventListener('mousemove', onMove);
      panel.removeEventListener('mouseleave', onLeave);
      cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <div className="lp-panel" ref={panelRef}>
      <Wall />
      <div className="lp-scrim" aria-hidden="true" />
      <div className="lp-wordmark">Go Farther<span className="lp-amber">.</span></div>
      <div className="lp-copy">
        <h1 className="lp-tagline">Your AI team,<br />working while you <em>sleep</em>.</h1>
        <div className="lp-drops">
          <span className="lp-new">NEW</span>
          <span className="lp-roll">
            <span><b>Seedance&nbsp;2.0</b> <em>4K</em> — available now</span>
            <span><b>Kling&nbsp;3.0</b> — now available</span>
            <span><b>Sonnet&nbsp;5</b> — now available</span>
          </span>
        </div>
      </div>
      {FILMS.map((f) => (
        <div className={`lp-fly ${f.cls}`} data-depth={f.depth} key={f.cls}>
          <div className="lp-orbit">
            <div className="lp-card">
              <video src={f.src} muted playsInline loop autoPlay preload="metadata" />
              <span className="lp-wm">gofarther.dev</span>
              <div className="lp-cap"><div className="lp-lbl">✦ PROMPT</div><p>{f.prompt}</p></div>
            </div>
          </div>
        </div>
      ))}
      <div className="lp-fly lp-f6" data-depth={0.9}>
        <div className="lp-orbit">
          <div className="lp-card lp-email">
            <img className="lp-scroller" src={`${ASSETS}/email-nova.jpg`} alt="" loading="lazy" />
            <span className="lp-wm">gofarther.dev</span>
            <div className="lp-cap"><div className="lp-lbl">✉ CAMPAIGN</div><p>Product-drop email — designed, written and sent from your own domain.</p></div>
          </div>
        </div>
      </div>
      <div className="lp-footnote">gofarther.dev</div>
    </div>
  );
}

export default function Login() {
  const [mode, setMode] = useState<Mode>('signin');
  const [step, setStep] = useState<Step>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // Resend cooldown: GoTrue rate-limits OTP sends (~60s); counting down in the
  // button beats letting the user tap into a raw "try after N seconds" error.
  const [cooldown, setCooldown] = useState(0);
  const codeRef = useRef<HTMLInputElement>(null);

  useEffect(() => { if (step === 'code') codeRef.current?.focus(); }, [step]);
  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  // 'new' = code sent to a fresh account; 'existing' = the email already had an
  // account (Sign up told the truth and sent a sign-in code); 'fail' = error shown.
  type SendResult = 'new' | 'existing' | 'fail';

  async function requestCode(mail: string): Promise<SendResult> {
    if (mode === 'signup') {
      // Probe with creation disabled: success means the email already has an
      // account (and the code it just sent signs them in). The "signups not
      // allowed" error means it's genuinely new — fall through and create it.
      const { error: probe } = await supabase.auth.signInWithOtp({ email: mail, options: { shouldCreateUser: false } });
      if (!probe) return 'existing';
      if (!/signup|sign-up|not allowed/i.test(probe.message)) { setError(friendlyAuthError(probe.message, navigator.onLine)); return 'fail'; }
    }
    const { error } = await supabase.auth.signInWithOtp({
      email: mail,
      options: { shouldCreateUser: mode === 'signup' },
    });
    if (error) {
      const m = error.message.toLowerCase();
      // GoTrue answers "Signups not allowed for otp" when the email has no
      // account and shouldCreateUser is false — map only THAT to a friendly
      // hint; every other error (rate limit, network) shows as-is.
      if (mode === 'signin' && /signup|sign-up|not allowed/.test(m)) {
        setError('No account found for that email — tap “Sign up” below to create one.');
      } else {
        setError(friendlyAuthError(error.message, navigator.onLine));
      }
      return 'fail';
    }
    return 'new';
  }

  async function sendCode(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setError(null); setNotice(null);
    const mail = email.trim();
    if (!mail) { setError('Enter your email.'); return; }
    setBusy(true);
    const r = await requestCode(mail);
    setBusy(false);
    if (r === 'fail') return;
    setCooldown(60);
    setStep('code');
    setNotice(r === 'existing'
      ? `You already have an account — we sent a sign-in code to ${mail}.`
      : `We emailed a code to ${mail}.`);
  }

  async function doVerify(token: string) {
    if (busy || token.length < 6) return;
    setError(null);
    codeRef.current?.blur(); // drop the keyboard so the result isn't hidden under it
    setBusy(true);
    try {
      const { error } = await supabase.auth.verifyOtp({ email: email.trim(), token, type: 'email' });
      if (error) throw error;
      // onAuthStateChange (in App) picks up the new session and drops the login wall.
    } catch (err) {
      setError(friendlyAuthError(err instanceof Error ? err.message : 'That code didn’t work — try again.', navigator.onLine));
    } finally {
      setBusy(false);
    }
  }
  function verify(e: FormEvent) {
    e.preventDefault();
    if (code.trim().length < 6) { setError('Enter the 6-digit code from the email.'); return; }
    void doVerify(code.trim());
  }

  async function resend() {
    if (busy || cooldown > 0) return;
    setError(null); setNotice(null);
    setBusy(true);
    const r = await requestCode(email.trim());
    setBusy(false);
    if (r !== 'fail') { setCooldown(60); setNotice('Sent a new code.'); }
  }

  function switchMode() {
    setMode((m) => (m === 'signin' ? 'signup' : 'signin'));
    setStep('email'); setCode(''); setError(null); setNotice(null);
  }
  function restart() {
    setStep('email'); setCode(''); setError(null); setNotice(null);
  }

  return (
    <div className="auth">
      <div className="live-bg" aria-hidden="true">
        <span className="orb orb1" />
        <span className="orb orb2" />
        <span className="orb orb3" />
        <span className="orb orb4" />
      </div>
      <BrandPanel />
      <div className="auth-side">
        <div className="auth-card">
          <div className="auth-brand">Go Farther</div>
          <p className="auth-sub">
            {step === 'code'
              ? 'Enter the code we emailed you'
              : mode === 'signin' ? 'Sign in to continue' : 'Create your account'}
          </p>

          {step === 'email' ? (
            <form onSubmit={sendCode} className="auth-form">
              <input
                className="auth-input"
                type="email"
                inputMode="email"
                autoComplete="email"
                autoCapitalize="none"
                placeholder="Email"
                aria-label="Email address"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
              {error && <div className="auth-error">{error}</div>}
              {notice && <div className="auth-notice">{notice}</div>}
              <button className="auth-btn" type="submit" disabled={busy}>
                {busy ? 'Sending…' : mode === 'signin' ? 'Sign in' : 'Create account'}
              </button>
            </form>
          ) : (
            <form onSubmit={verify} className="auth-form">
              <input
                ref={codeRef}
                className="auth-input auth-code"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="6-digit code"
                aria-label="Verification code"
                maxLength={6}
                value={code}
                onChange={(e) => {
                  const v = e.target.value.replace(/\D/g, '').slice(0, 6);
                  setCode(v);
                  if (v.length === 6) void doVerify(v); // all six digits in — verify without an extra tap
                }}
              />
              {error && <div className="auth-error">{error}</div>}
              {notice && <div className="auth-notice">{notice}</div>}
              <button className="auth-btn" type="submit" disabled={busy || code.length < 6}>
                {busy ? 'Verifying…' : 'Verify & continue'}
              </button>
              <div className="auth-row">
                <button type="button" className="auth-toggle" onClick={resend} disabled={busy || cooldown > 0}>
                  {cooldown > 0 ? `Resend code (${cooldown}s)` : 'Resend code'}
                </button>
                <button type="button" className="auth-toggle" onClick={restart} disabled={busy}>Use a different email</button>
              </div>
            </form>
          )}

          {step === 'email' && (
            <button className="auth-toggle" onClick={switchMode}>
              {mode === 'signin' ? "Don't have an account? Sign up" : 'Already have an account? Sign in'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
