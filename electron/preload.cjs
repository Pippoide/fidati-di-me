'use strict';
const { contextBridge, ipcRenderer } = require('electron');

// Tutto ciò che l'interfaccia React può chiedere al sistema passa da qui.
contextBridge.exposeInMainWorld('fidati', {
  listDisks: () => ipcRenderer.invoke('fidati:disks'),
  listFolders: (diskId) => ipcRenderer.invoke('fidati:folders', diskId),
  setExcluded: (diskId, folder, excluded) => ipcRenderer.invoke('fidati:set-excluded', diskId, folder, excluded),
  pickExcluded: (diskId) => ipcRenderer.invoke('fidati:pick-excluded', diskId),
  scan: (diskId) => ipcRenderer.invoke('fidati:scan', diskId),
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
