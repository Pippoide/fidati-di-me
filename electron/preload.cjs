'use strict';
const { contextBridge, ipcRenderer } = require('electron');

// Tutto ciò che l'interfaccia React può chiedere al sistema passa da qui.
contextBridge.exposeInMainWorld('fidati', {
  listDisks: () => ipcRenderer.invoke('fidati:disks'),
  info: () => ipcRenderer.invoke('fidati:info'),
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
  transfer: {
    pick: (which, diskId) => ipcRenderer.invoke('transfer:pick', which, diskId),
    analyze: () => ipcRenderer.invoke('transfer:analyze'),
    plan: (depth, roles) => ipcRenderer.invoke('transfer:plan', depth, roles),
    chooseDest: (id) => ipcRenderer.invoke('transfer:choose-dest', id),
    useSuggestion: (id, index) => ipcRenderer.invoke('transfer:use-suggestion', id, index),
    resetDest: (id) => ipcRenderer.invoke('transfer:reset-dest', id),
    run: (ids) => ipcRenderer.invoke('transfer:run', ids),
    stop: () => ipcRenderer.invoke('transfer:stop'),
    reveal: (id, side) => ipcRenderer.invoke('transfer:reveal', id, side),
    onProgress: (cb) => {
      const fn = (_e, p) => cb(p);
      ipcRenderer.on('fidati:transfer-progress', fn);
      return () => ipcRenderer.removeListener('fidati:transfer-progress', fn);
    },
  },
  onProgress: (cb) => {
    const fn = (_e, p) => cb(p);
    ipcRenderer.on('fidati:progress', fn);
    return () => ipcRenderer.removeListener('fidati:progress', fn);
  },
});
