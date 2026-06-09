import { useState, useRef, useEffect, type FormEvent } from 'react';
import { supabase } from './supabase';

// Passwordless auth: one unified flow for sign-in AND sign-up. Enter your email,
// we send a 6-digit code (the branded email goes out via the auth-email hook →
// Resend), type it in, you're in. New emails are auto-signed-up; existing ones
// sign in. No passwords.
type Step = 'email' | 'code';

export default function Login() {
  const [step, setStep] = useState<Step>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const codeRef = useRef<HTMLInputElement>(null);

  // Focus the code box when we move to that step.
  useEffect(() => { if (step === 'code') codeRef.current?.focus(); }, [step]);

  async function send(mail: string): Promise<boolean> {
    const { error } = await supabase.auth.signInWithOtp({ email: mail, options: { shouldCreateUser: true } });
    if (error) { setError(error.message); return false; }
    return true;
  }

  async function sendCode(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setError(null); setNotice(null);
    const mail = email.trim();
    if (!mail) { setError('Enter your email.'); return; }
    setBusy(true);
    const ok = await send(mail);
    setBusy(false);
    if (ok) { setStep('code'); setNotice(`We emailed a 6-digit code to ${mail}.`); }
  }

  async function verify(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setError(null);
    const token = code.trim();
    if (token.length < 6) { setError('Enter the 6-digit code.'); return; }
    setBusy(true);
    try {
      const { error } = await supabase.auth.verifyOtp({ email: email.trim(), token, type: 'email' });
      if (error) throw error;
      // onAuthStateChange (in App) picks up the new session and drops the login wall.
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That code didn’t work — try again.');
    } finally {
      setBusy(false);
    }
  }

  async function resend() {
    if (busy) return;
    setError(null); setNotice(null);
    setBusy(true);
    const ok = await send(email.trim());
    setBusy(false);
    if (ok) setNotice('Sent a new code.');
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
          {step === 'email' ? 'Sign in or create your account' : 'Enter the code we emailed you'}
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
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            {error && <div className="auth-error">⚠️ {error}</div>}
            {notice && <div className="auth-notice">✅ {notice}</div>}
            <button className="auth-btn" type="submit" disabled={busy}>
              {busy ? 'Sending…' : 'Send me a code'}
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
              placeholder="123456"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            />
            {error && <div className="auth-error">⚠️ {error}</div>}
            {notice && <div className="auth-notice">✅ {notice}</div>}
            <button className="auth-btn" type="submit" disabled={busy || code.length < 6}>
              {busy ? 'Verifying…' : 'Verify & continue'}
            </button>
            <div className="auth-row">
              <button type="button" className="auth-toggle" onClick={resend} disabled={busy}>Resend code</button>
              <button type="button" className="auth-toggle" onClick={restart} disabled={busy}>Use a different email</button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
