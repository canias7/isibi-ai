import { useState, useEffect, useCallback, useRef } from 'react';
import type { AppProject, UptimeData, NodePosition } from '../types';
import { AppNode } from './AppNode';
import { StatsBar } from './StatsBar';
import { ConnectionLines } from './ConnectionLines';
import { NotificationsPanel } from './NotificationsPanel';
import { SettingsPanel } from './SettingsPanel';

interface DashboardProps {
  onLogout: () => void;
}

// Persisted node positions
function loadPositions(): Record<string, NodePosition> {
  try { const s = localStorage.getItem('isibi-node-positions'); return s ? JSON.parse(s) : {}; } catch { return {}; }
}
function savePositions(pos: Record<string, NodePosition>) {
  localStorage.setItem('isibi-node-positions', JSON.stringify(pos));
}

export function Dashboard({ onLogout }: DashboardProps) {
  const [apps, setApps] = useState<AppProject[]>([]);
  const [uptimeData, setUptimeData] = useState<Record<string, UptimeData>>({});
  const [positions, setPositions] = useState<Record<string, NodePosition>>(loadPositions);
  const [loading, setLoading] = useState<Record<string, string>>({});
  const [unreadCount, setUnreadCount] = useState(0);
  const [notifOpen, setNotifOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const posRef = useRef(positions);
  posRef.current = positions;

  // Assign default positions for new apps
  const assignDefaults = useCallback((appList: AppProject[]) => {
    const current = posRef.current;
    const cols = Math.max(2, Math.floor(800 / 160));
    let changed = false;
    const updated = { ...current };
    appList.forEach((app, i) => {
      if (!updated[app.id]) {
        const col = i % cols;
        const row = Math.floor(i / cols);
        updated[app.id] = { x: 60 + col * 140 + (row % 2) * 40, y: 40 + row * 140 };
        changed = true;
      }
    });
    if (changed) {
      setPositions(updated);
      savePositions(updated);
    }
  }, []);

  // Load apps
  const loadApps = useCallback(async () => {
    const result = await window.isibi.getApps();
    if (Array.isArray(result)) {
      setApps(result);
      assignDefaults(result);
      // Load uptime for each
      for (const app of result) {
        window.isibi.getUptime(app.id).then((u) => {
          if (u && !('error' in u)) setUptimeData((prev) => ({ ...prev, [app.id]: u }));
        });
      }
    } else if ((result as { error: string })?.error === 'unauthorized') {
      onLogout();
    }
    setInitialLoading(false);
  }, [assignDefaults, onLogout]);

  // Load unread count
  const loadUnread = useCallback(async () => {
    const r = await window.isibi.getUnreadCount();
    if (r && typeof r.count === 'number') setUnreadCount(r.count);
  }, []);

  useEffect(() => {
    loadApps();
    loadUnread();
    // Listen for background polling updates
    window.isibi.onStatusUpdate((data) => {
      if (Array.isArray(data)) setApps(data);
    });
  }, [loadApps, loadUnread]);

  // Node drag end
  const handleDragEnd = useCallback((id: string, pos: NodePosition) => {
    setPositions((prev) => {
      const updated = { ...prev, [id]: pos };
      savePositions(updated);
      return updated;
    });
  }, []);

  // Listen for live drag updates from AppNode
  useEffect(() => {
    const handler = (e: Event) => {
      const { id, x, y } = (e as CustomEvent).detail;
      posRef.current = { ...posRef.current, [id]: { x, y } };
      // Force connection redraw by updating positions state
      setPositions((prev) => ({ ...prev, [id]: { x, y } }));
    };
    window.addEventListener('node-moved', handler);
    return () => window.removeEventListener('node-moved', handler);
  }, []);

  // Click node → open app
  const handleOpenApp = useCallback(async (id: string) => {
    const app = apps.find((a) => a.id === id);
    if (app && app.status !== 'deployed') {
      // Show warning briefly — handled by AppNode tooltip
      return;
    }
    const s = await window.isibi.getAppStatus(id);
    let url = s?.url || `https://isibi-backend.onrender.com/live/${id}`;
    url += (url.includes('?') ? '&' : '?') + 'skip_auth=1';
    window.isibi.openAppWindow(id, url);
  }, [apps]);

  const handleHealthCheck = useCallback(async (id: string) => {
    setLoading((prev) => ({ ...prev, [id]: 'health' }));
    await window.isibi.healthCheck(id);
    const u = await window.isibi.getUptime(id);
    if (u && !('error' in u)) setUptimeData((prev) => ({ ...prev, [id]: u }));
    setLoading((prev) => { const n = { ...prev }; delete n[id]; return n; });
  }, []);

  const handleRestart = useCallback(async (id: string) => {
    setLoading((prev) => ({ ...prev, [id]: 'restart' }));
    await window.isibi.restartApp(id);
    setLoading((prev) => { const n = { ...prev }; delete n[id]; return n; });
    loadApps();
  }, [loadApps]);

  const toggleNotif = () => { setNotifOpen((p) => !p); setSettingsOpen(false); };
  const toggleSettings = () => { setSettingsOpen((p) => !p); setNotifOpen(false); };

  return (
    <>
      <div className="titlebar">ISIBI Control Center</div>
      <div className="header">
        <div className="header-left">
          <div className="logo">I</div>
          <h1>Control Center</h1>
        </div>
        <div className="header-right">
          <button className="btn-icon" onClick={loadApps} title="Refresh">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M21 2v6h-6" /><path d="M3 12a9 9 0 0 1 15-6.7L21 8" /><path d="M3 22v-6h6" /><path d="M21 12a9 9 0 0 1-15 6.7L3 16" /></svg>
          </button>
          <button className="btn-icon" onClick={toggleNotif} title="Notifications">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.73 21a2 2 0 0 1-3.46 0" /></svg>
            {unreadCount > 0 && <span className="badge">{unreadCount > 9 ? '9+' : unreadCount}</span>}
          </button>
          <button className="btn-icon" onClick={toggleSettings} title="Settings">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></svg>
          </button>
          <button className="btn-logout" onClick={onLogout}>Sign Out</button>
        </div>
      </div>

      <StatsBar apps={apps} />

      <div className="content">
        <div className="workflow-canvas" id="workflow-canvas">
          <ConnectionLines positions={positions} appIds={apps.map((a) => a.id)} />
          <div id="nodes-container" style={{ position: 'relative', width: '100%', minHeight: 500 }}>
            {initialLoading ? (
              <div style={{ textAlign: 'center', padding: 80 }}><div className="spinner" /></div>
            ) : apps.length === 0 ? (
              <div className="empty-state"><p>No apps yet — create one on isibi.ai</p></div>
            ) : (
              apps.map((app) => (
                <AppNode
                  key={app.id}
                  app={app}
                  uptime={uptimeData[app.id]}
                  position={positions[app.id] || { x: 0, y: 0 }}
                  isLoading={loading[app.id]}
                  onDragEnd={handleDragEnd}
                  onClick={handleOpenApp}
                  onHealthCheck={handleHealthCheck}
                  onRestart={handleRestart}
                />
              ))
            )}
          </div>
        </div>
      </div>

      <NotificationsPanel open={notifOpen} onClose={toggleNotif} />
      <SettingsPanel open={settingsOpen} onClose={toggleSettings} />
    </>
  );
}
