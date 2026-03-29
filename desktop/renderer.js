// ── ISIBI Control Center — Draggable Workflow Nodes ─────────────────────────

const APP_COLORS = ['#ec4899','#8b5cf6','#06b6d4','#f59e0b','#10b981','#6366f1','#14b8a6','#f43f5e'];
function colorFor(n) { const h=[...n].reduce((a,c)=>a+c.charCodeAt(0),0); return APP_COLORS[h%APP_COLORS.length]; }
function timeAgo(iso) { if(!iso)return'Never'; const d=Date.now()-new Date(iso).getTime(),m=Math.floor(d/60000); if(m<1)return'Just now'; if(m<60)return m+'m ago'; const h=Math.floor(m/60); if(h<24)return h+'h ago'; return Math.floor(h/24)+'d ago'; }
function statusClass(s) { if(s==='deployed')return'online'; if(s==='generating'||s==='building')return'deploying'; if(s==='error')return'error'; return'offline'; }
function statusLabel(s) { if(s==='deployed')return'Online'; if(s==='generating')return'Generating'; if(s==='building')return'Building'; if(s==='error')return'Error'; if(s==='ready')return'Ready'; return'Offline'; }

function spawnParticles() {
  const c=document.getElementById('app'); if(!c)return;
  for(let i=0;i<10;i++){const p=document.createElement('div');p.className='particle';p.style.left=Math.random()*100+'%';p.style.animationDelay=Math.random()*8+'s';p.style.animationDuration=(6+Math.random()*6)+'s';const sz=1+Math.random()*2;p.style.width=sz+'px';p.style.height=sz+'px';c.appendChild(p);}
}

// ── State ───────────────────────────────────────────────────────────────────
let apps=[], uptimeData={}, notifications=[], unreadCount=0, notifOpen=false, loading={};
let nodePositions = {}; // {appId: {x, y}} — persisted positions
let dragging = null; // {id, offsetX, offsetY}

// Load saved positions
try { const saved = localStorage.getItem('isibi-node-positions'); if(saved) nodePositions = JSON.parse(saved); } catch(e){}
function savePositions() { try { localStorage.setItem('isibi-node-positions', JSON.stringify(nodePositions)); } catch(e){} }

// ── Init ────────────────────────────────────────────────────────────────────
async function init() {
  const token = await window.isibi.getToken();
  if(token){showDashboard();loadApps();loadUnreadCount();}else showLogin();
  window.isibi.onStatusUpdate(data=>{if(Array.isArray(data)){apps=data;renderNodes();renderStats();}});
}

// ── Login ───────────────────────────────────────────────────────────────────
function showLogin() {
  document.getElementById('app').innerHTML = `
    <div class="login-screen"><div class="login-card">
      <div class="logo-large">I</div><h2>ISIBI Control Center</h2><p class="subtitle">Sign in to manage your apps</p>
      <div id="login-error"></div>
      <div class="form-group"><label>Email</label><input type="email" id="login-email" placeholder="you@example.com" autofocus></div>
      <div class="form-group"><label>Password</label><input type="password" id="login-password" placeholder="Your password"></div>
      <button class="btn-login" id="login-btn">Sign In</button>
    </div></div>`;
  spawnParticles();
  document.getElementById('login-btn').addEventListener('click',handleLogin);
  document.getElementById('login-password').addEventListener('keydown',e=>{if(e.key==='Enter')handleLogin();});
  document.getElementById('login-email').addEventListener('keydown',e=>{if(e.key==='Enter')document.getElementById('login-password').focus();});
}

async function handleLogin() {
  const email=document.getElementById('login-email').value.trim(),password=document.getElementById('login-password').value;
  const btn=document.getElementById('login-btn'),errEl=document.getElementById('login-error');
  if(!email||!password){errEl.innerHTML='<div class="login-error">Please enter email and password</div>';return;}
  btn.disabled=true;btn.innerHTML='<span class="spinner" style="width:14px;height:14px"></span>';errEl.innerHTML='';
  const r=await window.isibi.login(email,password);
  if(r?.access_token){showDashboard();loadApps();loadUnreadCount();}
  else{errEl.innerHTML=`<div class="login-error">${r?.detail||r?.error||'Login failed'}</div>`;btn.disabled=false;btn.textContent='Sign In';}
}

// ── Dashboard ───────────────────────────────────────────────────────────────
function showDashboard() {
  document.getElementById('app').innerHTML = `
    <div class="titlebar">ISIBI Control Center</div>
    <div class="header">
      <div class="header-left"><div class="logo">I</div><h1>Control Center</h1></div>
      <div class="header-right">
        <button class="btn-icon" id="refresh-btn" title="Refresh"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 2v6h-6"/><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M3 22v-6h6"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/></svg></button>
        <button class="btn-icon" id="notif-btn" title="Notifications"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg><span class="badge" id="notif-badge" style="display:none">0</span></button>
        <button class="btn-logout" id="logout-btn">Sign Out</button>
      </div>
    </div>
    <div class="stats-bar" id="stats-bar"></div>
    <div class="content" id="content">
      <div class="workflow-canvas" id="workflow-canvas">
        <svg class="connections-svg" id="connections-svg">
          <defs><linearGradient id="neon-gradient" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" style="stop-color:#ec4899;stop-opacity:.5"/><stop offset="50%" style="stop-color:#8b5cf6;stop-opacity:.3"/><stop offset="100%" style="stop-color:#06b6d4;stop-opacity:.5"/>
          </linearGradient></defs>
        </svg>
        <div id="nodes-container" style="position:relative;width:100%;min-height:500px;"></div>
      </div>
    </div>
    <div class="notif-panel" id="notif-panel">
      <div class="notif-header"><h3>Notifications</h3><button class="btn-icon" id="close-notif"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button></div>
      <div style="padding:6px 16px"><button class="btn-secondary" style="width:100%;padding:7px" onclick="markAllRead()">Mark all read</button></div>
      <div class="notif-list" id="notif-list"></div>
    </div>`;
  spawnParticles();
  document.getElementById('refresh-btn').addEventListener('click',()=>loadApps());
  document.getElementById('notif-btn').addEventListener('click',toggleNotifications);
  document.getElementById('close-notif').addEventListener('click',toggleNotifications);
  document.getElementById('logout-btn').addEventListener('click',async()=>{await window.isibi.clearToken();showLogin();});

  // Global mouse handlers for dragging
  const content = document.getElementById('content');
  content.addEventListener('mousemove', onDragMove);
  content.addEventListener('mouseup', onDragEnd);
  content.addEventListener('mouseleave', onDragEnd);
}

// ── Load ────────────────────────────────────────────────────────────────────
async function loadApps() {
  const container=document.getElementById('nodes-container');
  if(!container)return;
  container.innerHTML='<div style="text-align:center;padding:80px"><div class="spinner"></div></div>';
  const result=await window.isibi.getApps();
  if(result?.error==='unauthorized'){showLogin();return;}
  if(Array.isArray(result)){
    apps=result;
    assignDefaultPositions();
    renderNodes();
    renderStats();
    for(const a of apps) loadUptime(a.id);
    requestAnimationFrame(drawConnections);
  } else {
    container.innerHTML='<div class="empty-state"><p>No apps yet — create one on isibi.ai</p></div>';
  }
}

function assignDefaultPositions() {
  const container = document.getElementById('nodes-container');
  if(!container) return;
  const w = container.clientWidth || 800;
  const cols = Math.max(2, Math.floor(w / 160));

  apps.forEach((app, i) => {
    if (!nodePositions[app.id]) {
      const col = i % cols;
      const row = Math.floor(i / cols);
      nodePositions[app.id] = {
        x: 60 + col * 140 + (row % 2) * 40, // stagger rows
        y: 40 + row * 140,
      };
    }
  });
  savePositions();
}

async function loadUptime(id){const r=await window.isibi.getUptime(id);if(r&&!r.error){uptimeData[id]=r;renderNodes();drawConnections();}}
async function loadUnreadCount(){const r=await window.isibi.getUnreadCount();if(r&&typeof r.count==='number'){unreadCount=r.count;updateBadge();}}
async function loadNotifications(){const r=await window.isibi.getNotifications();if(r?.data){notifications=r.data;renderNotifications();}}

// ── Drag handlers ───────────────────────────────────────────────────────────
function onDragStart(e, appId) {
  e.preventDefault();
  const node = document.querySelector(`[data-id="${appId}"]`);
  if (!node) return;
  const rect = node.getBoundingClientRect();
  const content = document.getElementById('content');
  const contentRect = content.getBoundingClientRect();
  dragging = {
    id: appId,
    offsetX: e.clientX - rect.left,
    offsetY: e.clientY - rect.top,
    contentLeft: contentRect.left,
    contentTop: contentRect.top,
    scrollTop: content.scrollTop,
  };
  node.style.zIndex = '10';
  node.classList.add('dragging');
}

function onDragMove(e) {
  if (!dragging) return;
  const content = document.getElementById('content');
  const canvas = document.getElementById('workflow-canvas');
  if (!content || !canvas) return;

  const canvasRect = canvas.getBoundingClientRect();
  const x = e.clientX - canvasRect.left - dragging.offsetX;
  const y = e.clientY - canvasRect.top - dragging.offsetY;

  nodePositions[dragging.id] = { x: Math.max(0, x), y: Math.max(0, y) };

  const node = document.querySelector(`[data-id="${dragging.id}"]`);
  if (node) {
    node.style.left = nodePositions[dragging.id].x + 'px';
    node.style.top = nodePositions[dragging.id].y + 'px';
  }

  drawConnections();
}

function onDragEnd() {
  if (!dragging) return;
  const node = document.querySelector(`[data-id="${dragging.id}"]`);
  if (node) { node.style.zIndex = ''; node.classList.remove('dragging'); }
  savePositions();
  dragging = null;
}

// ── Draw connections ────────────────────────────────────────────────────────
function drawConnections() {
  const svg = document.getElementById('connections-svg');
  const canvas = document.getElementById('workflow-canvas');
  if (!svg || !canvas || apps.length < 2) return;

  // Remove old
  svg.querySelectorAll('.connection-line,.connection-dot').forEach(el => el.remove());

  // Get centers from positions
  const centers = apps.map(app => {
    const pos = nodePositions[app.id];
    if (!pos) return null;
    return { x: pos.x + 36, y: pos.y + 36, id: app.id }; // +36 = half of 72px square
  }).filter(Boolean);

  if (centers.length < 2) return;

  // Connect each node to the next
  for (let i = 0; i < centers.length - 1; i++) {
    drawLine(svg, centers[i], centers[i + 1], 0.4);
  }
  // Cross connections
  for (let i = 0; i < centers.length - 2; i++) {
    drawLine(svg, centers[i], centers[i + 2], 0.12);
  }
  // Loop
  if (centers.length > 3) {
    drawLine(svg, centers[0], centers[centers.length - 1], 0.1);
  }
}

function drawLine(svg, from, to, opacity) {
  const dx = to.x - from.x, dy = to.y - from.y;
  const dist = Math.sqrt(dx*dx + dy*dy);
  const bend = Math.min(dist * 0.3, 50);
  // Perpendicular offset for curve
  const mx = (from.x+to.x)/2 - (dy/dist)*bend;
  const my = (from.y+to.y)/2 + (dx/dist)*bend;
  const d = `M ${from.x} ${from.y} Q ${mx} ${my} ${to.x} ${to.y}`;

  const path = document.createElementNS('http://www.w3.org/2000/svg','path');
  path.setAttribute('d',d);
  path.setAttribute('class','connection-line');
  path.style.opacity = opacity;
  svg.appendChild(path);

  // Traveling dot
  const dot = document.createElementNS('http://www.w3.org/2000/svg','circle');
  dot.setAttribute('r','2.5');
  dot.setAttribute('class','connection-dot');
  dot.style.opacity = Math.min(opacity * 2, 0.6);
  const am = document.createElementNS('http://www.w3.org/2000/svg','animateMotion');
  am.setAttribute('dur',(3+Math.random()*4)+'s');
  am.setAttribute('repeatCount','indefinite');
  am.setAttribute('path',d);
  dot.appendChild(am);
  svg.appendChild(dot);
}

// ── Render nodes ────────────────────────────────────────────────────────────
function renderStats() {
  const el=document.getElementById('stats-bar');if(!el)return;
  const total=apps.length,online=apps.filter(a=>a.status==='deployed').length,errors=apps.filter(a=>a.status==='error').length;
  el.innerHTML=`<div class="stat-card blue"><div class="stat-value">${total}</div><div class="stat-label">Total Apps</div></div>
    <div class="stat-card green"><div class="stat-value">${online}</div><div class="stat-label">Online</div></div>
    <div class="stat-card red"><div class="stat-value">${errors}</div><div class="stat-label">Errors</div></div>`;
}

function renderNodes() {
  const container = document.getElementById('nodes-container');
  if (!container) return;
  if (!apps.length) { container.innerHTML = '<div class="empty-state"><p>No apps yet</p></div>'; return; }

  container.innerHTML = apps.map(app => {
    const color = colorFor(app.name || 'A');
    const initial = (app.name||'A')[0].toUpperCase();
    const cls = statusClass(app.status);
    const label = statusLabel(app.status);
    const up = uptimeData[app.id];
    const uptimePct = up?.uptime_pct!=null ? up.uptime_pct.toFixed(1)+'%' : '--';
    const ms = up?.response_time_ms!=null ? up.response_time_ms+'ms' : '--';
    const lc = up?.last_check ? timeAgo(up.last_check) : 'Never';
    const il = loading[app.id];
    const pos = nodePositions[app.id] || {x:0,y:0};

    return `
      <div class="app-node ${cls}" data-id="${app.id}" style="position:absolute;left:${pos.x}px;top:${pos.y}px;">
        <div class="node-square" style="background:${color}" onmousedown="onDragStart(event,'${app.id}')">
          <div class="status-ring"></div>
          ${initial}
          <div class="node-dot"></div>
        </div>
        <div class="node-label">${app.name||'Untitled'}</div>
        <div class="node-status-text">${label}</div>
        <div class="node-tooltip">
          <div class="tt-name">${app.name||'Untitled'}</div>
          <div class="tt-metrics">
            <div><div class="tt-metric-value">${uptimePct}</div><div class="tt-metric-label">Uptime</div></div>
            <div><div class="tt-metric-value">${ms}</div><div class="tt-metric-label">Response</div></div>
            <div><div class="tt-metric-value">${lc}</div><div class="tt-metric-label">Checked</div></div>
          </div>
          <div class="tt-actions">
            <button class="tt-btn tt-btn-primary" onmousedown="event.stopPropagation()" onclick="openApp('${app.id}')">Open</button>
            <button class="tt-btn tt-btn-secondary" onmousedown="event.stopPropagation()" onclick="doHealthCheck('${app.id}')" ${il?'disabled':''}>
              ${il==='health'?'<span class="spinner" style="width:10px;height:10px"></span>':'Check'}
            </button>
            <button class="tt-btn tt-btn-warn" onmousedown="event.stopPropagation()" onclick="doRestart('${app.id}')" ${il?'disabled':''}>
              ${il==='restart'?'<span class="spinner" style="width:10px;height:10px"></span>':'Restart'}
            </button>
          </div>
        </div>
      </div>`;
  }).join('');

  // Update canvas min-height based on node positions
  let maxY = 500;
  apps.forEach(app => {
    const pos = nodePositions[app.id];
    if (pos && pos.y + 160 > maxY) maxY = pos.y + 160;
  });
  container.style.minHeight = maxY + 'px';

  requestAnimationFrame(drawConnections);
}

function renderNotifications() {
  const list=document.getElementById('notif-list');if(!list)return;
  if(!notifications.length){list.innerHTML='<div class="empty-state" style="padding:30px"><p>No notifications</p></div>';return;}
  list.innerHTML=notifications.map(n=>`<div class="notif-item ${n.is_read?'':'unread'}" onclick="readNotification('${n.id}')"><div class="notif-title">${n.title||'Notification'}</div><div class="notif-body">${n.body||''}</div><div class="notif-time">${timeAgo(n.created_at)}</div></div>`).join('');
}
function updateBadge(){const b=document.getElementById('notif-badge');if(!b)return;if(unreadCount>0){b.style.display='flex';b.textContent=unreadCount>9?'9+':unreadCount;}else b.style.display='none';}

// ── Actions ─────────────────────────────────────────────────────────────────
async function openApp(id){const s=await window.isibi.getAppStatus(id);window.isibi.openExternal(s?.url||`https://isibi-backend.onrender.com/live/${id}`);}
async function doHealthCheck(id){loading[id]='health';renderNodes();await window.isibi.healthCheck(id);delete loading[id];await loadUptime(id);}
async function doRestart(id){loading[id]='restart';renderNodes();await window.isibi.restartApp(id);delete loading[id];await loadApps();}
function toggleNotifications(){notifOpen=!notifOpen;const p=document.getElementById('notif-panel');if(p){p.classList.toggle('open',notifOpen);if(notifOpen)loadNotifications();}}
async function readNotification(id){await window.isibi.markRead(id);notifications=notifications.map(n=>n.id===id?{...n,is_read:true}:n);renderNotifications();unreadCount=Math.max(0,unreadCount-1);updateBadge();}
async function markAllRead(){await window.isibi.markAllRead();notifications=notifications.map(n=>({...n,is_read:true}));renderNotifications();unreadCount=0;updateBadge();}

document.addEventListener('DOMContentLoaded', init);
