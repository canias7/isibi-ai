import { useState, useRef, useEffect, type FormEvent } from 'react';
import { supabase } from './supabase';
import { friendlyAuthError } from './authErrors';

// Passwordless auth, with separate Sign in / Sign up screens. Both use an email
// code (sent branded via the auth-email → Resend hook): enter email → get a
// code → verify. The only real difference is shouldCreateUser — Sign up creates
// new accounts; Sign in only admits existing ones.
type Mode = 'signin' | 'signup';
type Step = 'email' | 'code';

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
  );
}
