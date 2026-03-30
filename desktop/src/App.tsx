import { useState, useEffect } from 'react';
import { Login } from './components/Login';
import { Dashboard } from './components/Dashboard';
import { Particles } from './components/Particles';

export function App() {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);

  useEffect(() => {
    window.isibi.getToken().then((token) => {
      setAuthenticated(!!token);
    });
  }, []);

  const handleLogin = () => setAuthenticated(true);
  const handleLogout = async () => {
    await window.isibi.clearToken();
    setAuthenticated(false);
  };

  // Loading state
  if (authenticated === null) {
    return (
      <div className="login-screen">
        <div style={{ textAlign: 'center' }}>
          <div className="spinner" />
          <p style={{ marginTop: 16, color: 'var(--text-muted)', fontSize: 13 }}>Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div id="app">
      <Particles />
      {authenticated ? (
        <Dashboard onLogout={handleLogout} />
      ) : (
        <Login onSuccess={handleLogin} />
      )}
    </div>
  );
}
