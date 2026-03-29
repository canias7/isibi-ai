const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('isibiDesktop', {
  isDesktop: true,
  platform: process.platform,
  version: '1.0.0',
});
