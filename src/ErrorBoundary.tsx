import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}
interface State {
  error: Error | null;
}

// Catches render-time errors so a bug shows a recoverable screen instead of a
// blank white page.
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[Go Farther] render error:', error, info);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="auth">
          <div className="auth-card">
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
