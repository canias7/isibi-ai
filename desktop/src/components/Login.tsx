import { useState, type KeyboardEvent } from 'react';

interface LoginProps {
  onSuccess: () => void;
}

export function Login({ onSuccess }: LoginProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleLogin = async () => {
    if (!email.trim() || !password) {
      setError('Please enter email and password');
      return;
    }
    setLoading(true);
    setError('');

    const result = await window.isibi.login(email.trim(), password);
    if (result?.access_token) {
      onSuccess();
    } else {
      setError(result?.detail || result?.error || 'Login failed');
      setLoading(false);
    }
  };

  const onKeyDown = (e: KeyboardEvent, action: 'next' | 'submit') => {
    if (e.key !== 'Enter') return;
    if (action === 'next') document.getElementById('login-password')?.focus();
    else handleLogin();
  };

  return (
    <div className="login-screen">
      <div className="login-card">
        <div className="logo-large">I</div>
        <h2>ISIBI Control Center</h2>
        <p className="subtitle">Sign in to manage your apps</p>

        {error && <div className="login-error">{error}</div>}

        <div className="form-group">
          <label>Email</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => onKeyDown(e, 'next')}
            placeholder="you@example.com"
            autoFocus
          />
        </div>

        <div className="form-group">
          <label>Password</label>
          <input
            id="login-password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => onKeyDown(e, 'submit')}
            placeholder="Your password"
          />
        </div>

        <button className="btn-login" onClick={handleLogin} disabled={loading}>
          {loading ? <span className="spinner" style={{ width: 14, height: 14 }} /> : 'Sign In'}
        </button>
      </div>
    </div>
  );
}
