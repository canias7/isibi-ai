import { useState } from 'react';

interface SettingsPanelProps {
  open: boolean;
  onClose: () => void;
}

export function SettingsPanel({ open, onClose }: SettingsPanelProps) {
  const [ghostCursor, setGhostCursor] = useState(() => {
    try {
      const s = localStorage.getItem('isibi-settings');
      return s ? JSON.parse(s).ghostCursor !== false : true;
    } catch { return true; }
  });

  const toggle = (val: boolean) => {
    setGhostCursor(val);
    const settings = { ghostCursor: val };
    localStorage.setItem('isibi-settings', JSON.stringify(settings));
    window.isibi.setSetting('ghostCursor', val);
  };

  return (
    <div className={`notif-panel ${open ? 'open' : ''}`}>
      <div className="notif-header">
        <h3>Settings</h3>
        <button className="btn-icon" onClick={onClose}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>
      <div style={{ padding: '16px 20px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 0', borderBottom: '1px solid var(--border)' }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>Ghost Cursor AI</div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>Animate form filling when creating records via voice</div>
          </div>
          <button
            onClick={() => toggle(!ghostCursor)}
            style={{
              width: 44, height: 24, borderRadius: 12, border: 'none', cursor: 'pointer', position: 'relative',
              background: ghostCursor ? 'var(--pink)' : 'rgba(255,255,255,.15)', transition: 'all .2s',
            }}
          >
            <span style={{
              position: 'absolute', top: 3, left: ghostCursor ? 23 : 3,
              width: 18, height: 18, background: 'white', borderRadius: '50%', transition: 'all .2s',
            }} />
          </button>
        </div>
      </div>
    </div>
  );
}
