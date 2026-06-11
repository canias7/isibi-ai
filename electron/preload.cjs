// Preload runs before the page with contextIsolation on. Exposes the minimal
// desktop bridge the renderer can feature-detect (window.gfDesktop) — absent on
// web/mobile, so the app guards every use with optional chaining.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('gfDesktop', {
  // Tray → renderer: "New chat" was clicked. Returns an unsubscribe fn.
  onNewChat(cb) {
    const handler = () => cb();
    ipcRenderer.on('gf-new-chat', handler);
    return () => ipcRenderer.removeListener('gf-new-chat', handler);
  },
});
