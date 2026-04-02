/**
 * Ghost Overlay — transparent window that renders the futuristic AI orb cursor.
 *
 * Creates a frameless, transparent, click-through BrowserWindow that sits
 * on top of everything. The orb follows the mouse with a particle trail,
 * shows click ripples, and typing indicators.
 */

import { BrowserWindow, screen } from 'electron';
import * as path from 'path';

let overlayWindow: BrowserWindow | null = null;

const OVERLAY_HTML = `<!DOCTYPE html>
<html>
<head>
<style>
* { margin: 0; padding: 0; }
body {
  background: transparent;
  overflow: hidden;
  cursor: none;
  user-select: none;
  -webkit-user-select: none;
}

#orb {
  position: fixed;
  width: 24px; height: 24px;
  border-radius: 50%;
  background: radial-gradient(circle at 40% 40%, #f472b6, #ec4899 40%, #a855f7 70%, #6366f1);
  box-shadow:
    0 0 15px rgba(236,72,153,.8),
    0 0 30px rgba(236,72,153,.5),
    0 0 60px rgba(139,92,246,.3),
    inset 0 0 8px rgba(255,255,255,.3);
  transition: left 0.3s cubic-bezier(.4,0,.2,1), top 0.3s cubic-bezier(.4,0,.2,1), transform 0.2s;
  pointer-events: none;
  z-index: 9999;
  opacity: 0;
}
#orb.visible { opacity: 1; }
#orb.clicking {
  transform: scale(0.7);
  box-shadow:
    0 0 25px rgba(236,72,153,1),
    0 0 50px rgba(236,72,153,.7),
    0 0 80px rgba(139,92,246,.5);
}
#orb.typing {
  animation: orb-pulse 0.6s ease-in-out infinite;
}

@keyframes orb-pulse {
  0%, 100% { transform: scale(1); box-shadow: 0 0 15px rgba(236,72,153,.8), 0 0 30px rgba(236,72,153,.5); }
  50% { transform: scale(1.15); box-shadow: 0 0 25px rgba(236,72,153,1), 0 0 50px rgba(236,72,153,.7), 0 0 80px rgba(139,92,246,.4); }
}

/* Particle trail */
.trail {
  position: fixed;
  width: 6px; height: 6px;
  border-radius: 50%;
  background: rgba(236,72,153,.6);
  pointer-events: none;
  animation: trail-fade 0.8s ease-out forwards;
}
@keyframes trail-fade {
  0% { opacity: .8; transform: scale(1); }
  100% { opacity: 0; transform: scale(0.2); }
}

/* Click ripple */
.ripple {
  position: fixed;
  width: 40px; height: 40px;
  border-radius: 50%;
  border: 2px solid rgba(236,72,153,.8);
  pointer-events: none;
  animation: ripple-expand 0.6s ease-out forwards;
}
@keyframes ripple-expand {
  0% { transform: translate(-50%,-50%) scale(0.3); opacity: 1; }
  100% { transform: translate(-50%,-50%) scale(2); opacity: 0; }
}

/* Status text */
#status {
  position: fixed;
  bottom: 40px;
  left: 50%;
  transform: translateX(-50%);
  background: rgba(10,0,21,.85);
  backdrop-filter: blur(16px);
  border: 1px solid rgba(236,72,153,.3);
  border-radius: 12px;
  padding: 10px 20px;
  color: #f0e6ff;
  font-family: -apple-system, system-ui, sans-serif;
  font-size: 13px;
  font-weight: 500;
  pointer-events: none;
  opacity: 0;
  transition: opacity 0.3s;
  white-space: nowrap;
  box-shadow: 0 0 20px rgba(236,72,153,.15);
}
#status.visible { opacity: 1; }
#status .step-num {
  color: #ec4899;
  font-weight: 700;
  margin-right: 6px;
}
</style>
</head>
<body>
<div id="orb"></div>
<div id="status"></div>

<script>
const orb = document.getElementById('orb');
const status = document.getElementById('status');
let trailInterval = null;

// IPC from main process
const { ipcRenderer } = require('electron');

ipcRenderer.on('orb-move', (_, x, y) => {
  orb.style.left = (x - 12) + 'px';
  orb.style.top = (y - 12) + 'px';
  orb.classList.add('visible');
  spawnTrail(x, y);
});

ipcRenderer.on('orb-click', (_, x, y) => {
  orb.classList.add('clicking');
  showRipple(x, y);
  setTimeout(() => orb.classList.remove('clicking'), 200);
});

ipcRenderer.on('orb-typing', () => {
  orb.classList.add('typing');
});

ipcRenderer.on('orb-stop-typing', () => {
  orb.classList.remove('typing');
});

ipcRenderer.on('orb-hide', () => {
  orb.classList.remove('visible');
  orb.classList.remove('typing');
  orb.classList.remove('clicking');
});

ipcRenderer.on('orb-status', (_, text, step) => {
  if (text) {
    status.innerHTML = step ? '<span class="step-num">Step ' + step + ':</span>' + text : text;
    status.classList.add('visible');
  } else {
    status.classList.remove('visible');
  }
});

function spawnTrail(x, y) {
  const t = document.createElement('div');
  t.className = 'trail';
  t.style.left = (x - 3 + (Math.random() - 0.5) * 8) + 'px';
  t.style.top = (y - 3 + (Math.random() - 0.5) * 8) + 'px';
  t.style.background = Math.random() > 0.5 ? 'rgba(236,72,153,.5)' : 'rgba(139,92,246,.5)';
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 800);
}

function showRipple(x, y) {
  const r = document.createElement('div');
  r.className = 'ripple';
  r.style.left = x + 'px';
  r.style.top = y + 'px';
  document.body.appendChild(r);
  setTimeout(() => r.remove(), 600);
}
</script>
</body>
</html>`;

// ── Overlay Management ──────────────────────────────────────────────────

export function createOverlay(): BrowserWindow | null {
  // Overlay disabled — was causing screen vibration
  return null;
}

export function destroyOverlay(): void {
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.close();
    overlayWindow = null;
  }
}

// ── Orb Commands ────────────────────────────────────────────────────────

export function moveOrb(x: number, y: number): void {
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.webContents.send('orb-move', x, y);
  }
}

export function clickOrb(x: number, y: number): void {
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.webContents.send('orb-click', x, y);
  }
}

export function startTyping(): void {
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.webContents.send('orb-typing');
  }
}

export function stopTyping(): void {
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.webContents.send('orb-stop-typing');
  }
}

export function hideOrb(): void {
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.webContents.send('orb-hide');
  }
}

export function showStatus(text: string, step?: number): void {
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.webContents.send('orb-status', text, step);
  }
}

export function hideStatus(): void {
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.webContents.send('orb-status', '', 0);
  }
}
