import { Component, type ErrorInfo, type ReactNode } from 'react';
import { track } from './analytics';

interface Props {
  children: ReactNode;
  /** Compact inline fallback (used around overlays so a crash there doesn't
      take the whole app down). `reset` clears the boundary so React can retry
      rendering — pair it with closing the crashed overlay. */
  fallback?: (reset: () => void) => ReactNode;
}
interface State {
  error: Error | null;
}

// Catches render-time errors so a bug shows a recoverable screen instead of a
// blank white page. Crashes are also reported to app_events ("crash"), so
// they're visible in analytics instead of dying silently on a user's phone.
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[Go Farther] render error:', error, info);
    track('crash', { msg: String(error?.message ?? error).slice(0, 160) });
  }

  reset = () => this.setState({ error: null });

  render() {
    if (this.state.error) {
      if (this.props.fallback) return this.props.fallback(this.reset);
      return (
        <div className="auth">
          <div className="auth-card">
            <span className="brand-orb auth-orb" aria-hidden />
            <div className="auth-brand">Go Farther</div>
            <p className="auth-sub">Something went wrong.</p>
            <button className="auth-btn" onClick={() => window.location.reload()}>
              Reload
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
