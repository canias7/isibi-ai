const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('isibi', {
  // Auth
  login: (email, password) => ipcRenderer.invoke('login', email, password),
  getToken: () => ipcRenderer.invoke('get-token'),
  setToken: (token) => ipcRenderer.invoke('set-token', token),
  clearToken: () => ipcRenderer.invoke('clear-token'),

  // Apps
  getApps: () => ipcRenderer.invoke('get-apps'),
  getAppStatus: (id) => ipcRenderer.invoke('get-app-status', id),
  getUptime: (id) => ipcRenderer.invoke('get-uptime', id),
  healthCheck: (id) => ipcRenderer.invoke('health-check', id),
  restartApp: (id) => ipcRenderer.invoke('restart-app', id),
  deployApp: (id) => ipcRenderer.invoke('deploy-app', id),

  // Notifications
  getNotifications: () => ipcRenderer.invoke('get-notifications'),
  getUnreadCount: () => ipcRenderer.invoke('get-unread-count'),
  markRead: (id) => ipcRenderer.invoke('mark-read', id),
  markAllRead: () => ipcRenderer.invoke('mark-all-read'),

  // Utils
  openExternal: (url) => ipcRenderer.invoke('open-external', url),

  // Events from main process
  onStatusUpdate: (callback) => {
    ipcRenderer.on('status-update', (_, data) => callback(data));
  },

  // Desktop info
  isDesktop: true,
  platform: process.platform,
  version: '1.0.0',
});
