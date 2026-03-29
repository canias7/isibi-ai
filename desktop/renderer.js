// ── ISIBI Control Center — Futuristic Renderer ─────────────────────────────

const APP_COLORS = [
  '#ec4899', '#8b5cf6', '#06b6d4', '#f59e0b',
  '#10b981', '#6366f1', '#14b8a6', '#f43f5e',
];

function colorFor(name) {
  const h = [...name].reduce((a, c) => a + c.charCodeAt(0), 0);
  return APP_COLORS[h % APP_COLORS.length];
}

function timeAgo(iso) {
  if (!iso) return 'Never';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function statusClass(status) {
  if (status === 'deployed') return 'online';
  if (status === 'generating' || status === 'building') return 'deploying';
  if (status === 'error') return 'error';
  return 'offline';
}

function statusLabel(status) {
  if (status === 'deployed') return 'Online';
  if (status === 'generating') return 'Generating';
  if (status === 'building') return 'Building';
  if (status === 'error') return 'Error';
  if (status === 'ready') return 'Ready';
  return 'Offline';
}

// ── Ambient particles ───────────────────────────────────────────────────────
function spawnParticles() {
  const container = document.getElementById('app');
  if (!container) return;
  for (let i = 0; i < 15; i++) {
    const p = document.createElement('div');
    p.className = 'particle';
    p.style.left = Math.random() * 100 + '%';
    p.style.animationDelay = Math.random() * 8 + 's';
    p.style.animationDuration = (6 + Math.random() * 6) + 's';
    const size = 1 + Math.random() * 2;
    p.style.width = size + 'px';
    p.style.height = size + 'px';
    container.appendChild(p);
  }
}

// ── State ───────────────────────────────────────────────────────────────────
let apps = [];
let uptimeData = {};
let notifications = [];
let unreadCount = 0;
let notifOpen = false;
let loading = {};

// ── Init ────────────────────────────────────────────────────────────────────
async function init() {
  const token = await window.isibi.getToken();
  if (token) {
    showDashboard();
    loadApps();
    loadUnreadCount();
  } else {
    showLogin();
  }

  window.isibi.onStatusUpdate((data) => {
    if (Array.isArray(data)) {
      apps = data;
      renderApps();
      renderStats();
    }
  });
}

// ── Login ───────────────────────────────────────────────────────────────────
function showLogin() {
  document.getElementById('app').innerHTML = `
    <div class="login-screen">
      <div class="login-card">
        <div class="logo-large">I</div>
        <h2>ISIBI Control Center</h2>
        <p class="subtitle">Sign in to manage your apps</p>
        <div id="login-error"></div>
        <div class="form-group">
          <label>Email</label>
          <input type="email" id="login-email" placeholder="you@example.com" autofocus>
        </div>
        <div class="form-group">
          <label>Password</label>
          <input type="password" id="login-password" placeholder="Your password">
        </div>
        <button class="btn-login" id="login-btn">Sign In</button>
      </div>
    </div>
  `;

  spawnParticles();

  document.getElementById('login-btn').addEventListener('click', handleLogin);
  document.getElementById('login-password').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') handleLogin();
  });
  document.getElementById('login-email').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') document.getElementById('login-password').focus();
  });
}

async function handleLogin() {
  const email = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;
  const btn = document.getElementById('login-btn');
  const errEl = document.getElementById('login-error');

  if (!email || !password) {
    errEl.innerHTML = '<div class="login-error">Please enter email and password</div>';
    return;
  }

  btn.disabled = true;
  btn.innerHTML = '<span class="spinner" style="width:16px;height:16px;border-width:2px"></span>';
  errEl.innerHTML = '';

  const result = await window.isibi.login(email, password);

  if (result && result.access_token) {
    showDashboard();
    loadApps();
    loadUnreadCount();
  } else {
    const msg = result?.detail || result?.error || 'Login failed';
    errEl.innerHTML = `<div class="login-error">${msg}</div>`;
    btn.disabled = false;
    btn.textContent = 'Sign In';
  }
}

// ── Dashboard ───────────────────────────────────────────────────────────────
function showDashboard() {
  document.getElementById('app').innerHTML = `
    <div class="titlebar">ISIBI Control Center</div>
    <div class="header">
      <div class="header-left">
        <div class="logo">I</div>
        <h1>Control Center</h1>
      </div>
      <div class="header-right">
        <button class="btn-icon" id="refresh-btn" title="Refresh">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 2v6h-6"/><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M3 22v-6h6"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/></svg>
        </button>
        <button class="btn-icon" id="notif-btn" title="Notifications">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
          <span class="badge" id="notif-badge" style="display:none">0</span>
        </button>
        <button class="btn-logout" id="logout-btn">Sign Out</button>
      </div>
    </div>
    <div class="stats-bar" id="stats-bar"></div>
    <div class="content" id="content">
      <div class="node-canvas" id="node-canvas">
        <svg class="connections-svg" id="connections-svg">
          <defs>
            <linearGradient id="neon-gradient" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" style="stop-color:#ec4899;stop-opacity:.6" />
              <stop offset="50%" style="stop-color:#8b5cf6;stop-opacity:.4" />
              <stop offset="100%" style="stop-color:#06b6d4;stop-opacity:.6" />
            </linearGradient>
          </defs>
        </svg>
        <div class="app-grid" id="app-grid"></div>
      </div>
    </div>
    <div class="notif-panel" id="notif-panel">
      <div class="notif-header">
        <h3>Notifications</h3>
        <button class="btn-icon" id="close-notif">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
      <div style="padding:8px 20px">
        <button class="btn btn-secondary" style="width:100%" onclick="markAllRead()">Mark all as read</button>
      </div>
      <div class="notif-list" id="notif-list"></div>
    </div>
  `;

  spawnParticles();

  document.getElementById('refresh-btn').addEventListener('click', () => loadApps());
  document.getElementById('notif-btn').addEventListener('click', toggleNotifications);
  document.getElementById('close-notif').addEventListener('click', toggleNotifications);
  document.getElementById('logout-btn').addEventListener('click', handleLogout);
}

async function handleLogout() {
  await window.isibi.clearToken();
  showLogin();
}

// ── Load Data ───────────────────────────────────────────────────────────────
async function loadApps() {
  const grid = document.getElementById('app-grid');
  if (!grid) return;

  grid.innerHTML = '<div style="text-align:center;padding:60px"><div class="spinner"></div></div>';

  const result = await window.isibi.getApps();

  if (result?.error === 'unauthorized') { showLogin(); return; }

  if (Array.isArray(result)) {
    apps = result;
    renderApps();
    renderStats();
    for (const app of apps) { loadUptime(app.id); }
    // Draw connections after cards render
    requestAnimationFrame(() => setTimeout(drawConnections, 100));
  } else {
    grid.innerHTML = '<div class="empty-state"><div class="empty-icon">&#9632;</div><p>No apps yet — create one on isibi.ai</p></div>';
  }
}

async function loadUptime(projectId) {
  const result = await window.isibi.getUptime(projectId);
  if (result && !result.error) {
    uptimeData[projectId] = result;
    renderApps();
  }
}

async function loadUnreadCount() {
  const result = await window.isibi.getUnreadCount();
  if (result && typeof result.count === 'number') {
    unreadCount = result.count;
    updateBadge();
  }
}

async function loadNotifications() {
  const result = await window.isibi.getNotifications();
  if (result && result.data) {
    notifications = result.data;
    renderNotifications();
  }
}

// ── Draw neon connections between cards ──────────────────────────────────────
function drawConnections() {
  const svg = document.getElementById('connections-svg');
  if (!svg || apps.length < 2) return;

  const cards = document.querySelectorAll('.app-card');
  if (cards.length < 2) return;

  // Clear existing lines
  svg.querySelectorAll('.connection-line, .connection-dot').forEach(el => el.remove());

  const canvas = document.getElementById('node-canvas');
  const canvasRect = canvas.getBoundingClientRect();

  // Get center points of each card
  const centers = [];
  cards.forEach((card) => {
    const rect = card.getBoundingClientRect();
    centers.push({
      x: rect.left - canvasRect.left + rect.width / 2,
      y: rect.top - canvasRect.top + rect.height / 2,
    });
  });

  // Connect each card to the next one + some cross connections
  for (let i = 0; i < centers.length - 1; i++) {
    const from = centers[i];
    const to = centers[i + 1];
    drawLine(svg, from, to);
  }

  // Add some cross connections for the mesh look
  if (centers.length > 2) {
    for (let i = 0; i < centers.length - 2; i++) {
      const from = centers[i];
      const to = centers[i + 2];
      drawLine(svg, from, to, 0.15);
    }
  }

  // Connect last to first for a loop feel
  if (centers.length > 3) {
    drawLine(svg, centers[0], centers[centers.length - 1], 0.1);
  }
}

function drawLine(svg, from, to, opacity = 0.3) {
  // Curved line
  const midX = (from.x + to.x) / 2;
  const midY = (from.y + to.y) / 2 - 30;

  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', `M ${from.x} ${from.y} Q ${midX} ${midY} ${to.x} ${to.y}`);
  path.setAttribute('class', 'connection-line');
  path.style.opacity = opacity;
  svg.appendChild(path);

  // Animated dot traveling along the line
  const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  dot.setAttribute('r', '2');
  dot.setAttribute('class', 'connection-dot');
  dot.style.opacity = opacity * 2;

  const animMotion = document.createElementNS('http://www.w3.org/2000/svg', 'animateMotion');
  animMotion.setAttribute('dur', (4 + Math.random() * 4) + 's');
  animMotion.setAttribute('repeatCount', 'indefinite');
  animMotion.setAttribute('path', `M ${from.x} ${from.y} Q ${midX} ${midY} ${to.x} ${to.y}`);
  dot.appendChild(animMotion);
  svg.appendChild(dot);
}

// ── Render ───────────────────────────────────────────────────────────────────
function renderStats() {
  const el = document.getElementById('stats-bar');
  if (!el) return;

  const total = apps.length;
  const online = apps.filter(a => a.status === 'deployed').length;
  const errors = apps.filter(a => a.status === 'error').length;

  el.innerHTML = `
    <div class="stat-card blue">
      <div class="stat-value">${total}</div>
      <div class="stat-label">Total Apps</div>
    </div>
    <div class="stat-card green">
      <div class="stat-value">${online}</div>
      <div class="stat-label">Online</div>
    </div>
    <div class="stat-card red">
      <div class="stat-value">${errors}</div>
      <div class="stat-label">Errors</div>
    </div>
  `;
}

function renderApps() {
  const grid = document.getElementById('app-grid');
  if (!grid) return;

  if (apps.length === 0) {
    grid.innerHTML = '<div class="empty-state"><div class="empty-icon">&#9632;</div><p>No apps yet — create one on isibi.ai</p></div>';
    return;
  }

  grid.innerHTML = apps.map(app => {
    const color = colorFor(app.name || 'A');
    const initial = (app.name || 'A')[0].toUpperCase();
    const cls = statusClass(app.status);
    const label = statusLabel(app.status);
    const uptime = uptimeData[app.id];
    const uptimePct = uptime?.uptime_pct != null ? `${uptime.uptime_pct.toFixed(1)}%` : '--';
    const responseMs = uptime?.response_time_ms != null ? `${uptime.response_time_ms}ms` : '--';
    const lastCheck = uptime?.last_check ? timeAgo(uptime.last_check) : 'Never';
    const isLoading = loading[app.id];

    return `
      <div class="app-card ${cls}" data-app-id="${app.id}">
        <div class="app-card-header">
          <div class="app-icon" style="background:${color}">${initial}</div>
          <div class="app-info">
            <div class="app-name">${app.name || 'Untitled'}</div>
            <span class="status-badge ${cls}"><span class="dot"></span>${label}</span>
          </div>
        </div>
        <div class="app-metrics">
          <div class="metric">
            <div class="metric-value" style="color:${uptime?.uptime_pct >= 99 ? 'var(--green)' : uptime?.uptime_pct >= 95 ? 'var(--yellow)' : 'var(--text-primary)'}">${uptimePct}</div>
            <div class="metric-label">Uptime</div>
          </div>
          <div class="metric">
            <div class="metric-value">${responseMs}</div>
            <div class="metric-label">Response</div>
          </div>
          <div class="metric">
            <div class="metric-value">${lastCheck}</div>
            <div class="metric-label">Last Check</div>
          </div>
        </div>
        <div class="app-actions">
          <button class="btn btn-primary" onclick="openApp('${app.id}')">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
            Open
          </button>
          <button class="btn btn-secondary" onclick="doHealthCheck('${app.id}')" ${isLoading ? 'disabled' : ''}>
            ${isLoading === 'health' ? '<span class="spinner" style="width:12px;height:12px"></span>' : '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>'}
            Check
          </button>
          <button class="btn btn-danger" onclick="doRestart('${app.id}')" ${isLoading ? 'disabled' : ''}>
            ${isLoading === 'restart' ? '<span class="spinner" style="width:12px;height:12px"></span>' : '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 2v6h-6"/><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/></svg>'}
            Restart
          </button>
        </div>
      </div>
    `;
  }).join('');
}

function renderNotifications() {
  const list = document.getElementById('notif-list');
  if (!list) return;

  if (notifications.length === 0) {
    list.innerHTML = '<div class="empty-state" style="padding:30px"><p>No notifications</p></div>';
    return;
  }

  list.innerHTML = notifications.map(n => `
    <div class="notif-item ${n.is_read ? '' : 'unread'}" onclick="readNotification('${n.id}')">
      <div class="notif-title">${n.title || 'Notification'}</div>
      <div class="notif-body">${n.body || ''}</div>
      <div class="notif-time">${timeAgo(n.created_at)}</div>
    </div>
  `).join('');
}

function updateBadge() {
  const badge = document.getElementById('notif-badge');
  if (!badge) return;
  if (unreadCount > 0) {
    badge.style.display = 'flex';
    badge.textContent = unreadCount > 9 ? '9+' : unreadCount;
  } else {
    badge.style.display = 'none';
  }
}

// ── Actions ─────────────────────────────────────────────────────────────────
async function openApp(projectId) {
  const status = await window.isibi.getAppStatus(projectId);
  if (status?.url) {
    window.isibi.openExternal(status.url);
  } else {
    window.isibi.openExternal(`https://isibi-backend.onrender.com/live/${projectId}`);
  }
}

async function doHealthCheck(projectId) {
  loading[projectId] = 'health';
  renderApps();
  await window.isibi.healthCheck(projectId);
  delete loading[projectId];
  await loadUptime(projectId);
}

async function doRestart(projectId) {
  loading[projectId] = 'restart';
  renderApps();
  await window.isibi.restartApp(projectId);
  delete loading[projectId];
  await loadApps();
}

function toggleNotifications() {
  notifOpen = !notifOpen;
  const panel = document.getElementById('notif-panel');
  if (panel) {
    panel.classList.toggle('open', notifOpen);
    if (notifOpen) loadNotifications();
  }
}

async function readNotification(id) {
  await window.isibi.markRead(id);
  notifications = notifications.map(n => n.id === id ? { ...n, is_read: true } : n);
  renderNotifications();
  unreadCount = Math.max(0, unreadCount - 1);
  updateBadge();
}

async function markAllRead() {
  await window.isibi.markAllRead();
  notifications = notifications.map(n => ({ ...n, is_read: true }));
  renderNotifications();
  unreadCount = 0;
  updateBadge();
}

// Redraw connections on resize
window.addEventListener('resize', () => { requestAnimationFrame(drawConnections); });

// ── Boot ────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', init);
