import type { ChatMessage } from './api';

// The assistant-bubble states for a turn whose connection failed. Recovery is
// automatic and quiet (see recoverPending in App): while it works, these read
// as "still thinking"; only a genuine dead end shows a button.
export default function RecoveryBubble({ m, onRetry }: { m: ChatMessage; onRetry: () => void }) {
  if (m.stalled) {
    // Recovery genuinely gave up — the only state with a button.
    return (
      <div className="msg-failed">
        <span>⚠️ {m.sent ? 'No reply came back.' : "This didn't go through."}</span>
        <button className="msg-retry" onClick={onRetry}>Try again</button>
      </div>
    );
  }
  if (m.offline) {
    return (
      <div className="msg-failed">
        <span>⚠️ You're offline — this will send when you're back.</span>
      </div>
    );
  }
  // Recovering quietly (the server is finishing it, or we're re-sending it) —
  // reads as still thinking, no plumbing shown.
  return <div className="gf-thinking" role="status">{m.sent ? 'Finishing up…' : 'Reconnecting…'}</div>;
}
