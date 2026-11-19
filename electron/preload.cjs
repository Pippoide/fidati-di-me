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
  // Riorganizza
  orgOptions: (diskId) => ipcRenderer.invoke('org:options', diskId),
  orgSetOptions: (opts) => ipcRenderer.invoke('org:set-options', opts),
  orgPickSource: (diskId) => ipcRenderer.invoke('org:pick-source', diskId),
  orgPickDest: (diskId) => ipcRenderer.invoke('org:pick-dest', diskId),
  orgAnalyze: (diskId, source) => ipcRenderer.invoke('org:analyze', diskId, source),
  orgPreview: (id, client, project) => ipcRenderer.invoke('org:preview', id, client, project),
  orgApply: (jobs) => ipcRenderer.invoke('org:apply', jobs),
  orgReveal: (p) => ipcRenderer.invoke('org:reveal', p),
  onOrgProgress: (cb) => {
    const fn = (_e, p) => cb(p);
    ipcRenderer.on('org:progress', fn);
    return () => ipcRenderer.removeListener('org:progress', fn);
  },
  // Cronologia
  logList: () => ipcRenderer.invoke('log:list'),
  logRestore: (kind, ids, force) => ipcRenderer.invoke('log:restore', kind, ids, force),
  logForget: (kind, sessionId) => ipcRenderer.invoke('log:forget', kind, sessionId),
  logReveal: (kind, entryId) => ipcRenderer.invoke('log:reveal', kind, entryId),
  onProgress: (cb) => {
    const fn = (_e, p) => cb(p);
    ipcRenderer.on('fidati:progress', fn);
    return () => ipcRenderer.removeListener('fidati:progress', fn);
  },
});
