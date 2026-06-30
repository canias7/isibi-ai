import { useState, type FormEvent } from 'react';
import { IconArrowUp } from './icons';

// The logged-out website landing: a chatbox hero with a top-right "Sign in".
// Typing a prompt (or tapping Sign in) drops into the existing Login flow; the
// draft is stashed so it can be picked up after auth later.
const EXAMPLES = [
  'Write a launch email for my new product',
  'Make a 15-second promo video for Instagram',
  'Plan a week of social posts',
];

export default function Landing({ onSignIn }: { onSignIn: () => void }) {
  const [msg, setMsg] = useState('');

  function submit(e: FormEvent) {
    e.preventDefault();
    const text = msg.trim();
    try { if (text) localStorage.setItem('gf_landing_draft', text); } catch { /* ignore */ }
    onSignIn();
  }

  return (
    <div className="landing">
      <div className="live-bg" aria-hidden="true">
        <span className="orb orb1" />
        <span className="orb orb2" />
        <span className="orb orb3" />
        <span className="orb orb4" />
      </div>

      <header className="landing-top">
        <div className="landing-brand">Go Farther</div>
        <button type="button" className="landing-signin" onClick={onSignIn}>Sign in</button>
      </header>

      <main className="landing-hero">
        <h1 className="landing-h1">What do you want to get done?</h1>
        <p className="landing-tag">Your AI agents for email, social media, and more.</p>

        <form className="landing-chat" onSubmit={submit}>
          <input
            className="landing-chat-input"
            type="text"
            placeholder="Ask Go Farther anything…"
            aria-label="Ask Go Farther anything"
            value={msg}
            onChange={(e) => setMsg(e.target.value)}
            autoFocus
          />
          <button className="landing-chat-send" type="submit" aria-label="Send" disabled={!msg.trim()}>
            <IconArrowUp size={20} />
          </button>
        </form>

        <div className="landing-examples">
          {EXAMPLES.map((x) => (
            <button key={x} type="button" className="landing-chip" onClick={() => setMsg(x)}>{x}</button>
          ))}
        </div>
      </main>
    </div>
  );
}
