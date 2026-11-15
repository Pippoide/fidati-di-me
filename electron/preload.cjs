'use strict';
const { contextBridge, ipcRenderer } = require('electron');

// Tutto ciò che l'interfaccia React può chiedere al sistema passa da qui.
contextBridge.exposeInMainWorld('fidati', {
  scan: () => ipcRenderer.invoke('fidati:scan'),
  remove: (ids) => ipcRenderer.invoke('fidati:remove', ids),
  reveal: (id) => ipcRenderer.invoke('fidati:reveal', id),
  adobeRunning: () => ipcRenderer.invoke('fidati:adobe-running'),
  openPrivacy: () => ipcRenderer.invoke('fidati:open-privacy'),
  checkUpdate: () => ipcRenderer.invoke('fidati:update-check'),
  installUpdate: () => ipcRenderer.invoke('fidati:update-install'),
  onUpdateProgress: (cb) => {
    const fn = (_e, p) => cb(p);
    ipcRenderer.on('fidati:update-progress', fn);
    return () => ipcRenderer.removeListener('fidati:update-progress', fn);
  },
  onProgress: (cb) => {
    const fn = (_e, p) => cb(p);
    ipcRenderer.on('fidati:progress', fn);
    return () => ipcRenderer.removeListener('fidati:progress', fn);
  },
});
