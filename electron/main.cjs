'use strict';
const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const fsp = require('fs').promises;
const os = require('os');
const { scan, removeItem, runningAdobeApps } = require('./scanner.cjs');
const updater = require('./updater.cjs');

const DEV = process.env.FIDATI_DEV === '1';
app.setName('Fidati');

let win;
let registry = new Map(); // id → voce dell'ultima analisi; il renderer non manda mai percorsi
let scanning = false;

function createWindow() {
  win = new BrowserWindow({
    width: 1080,
    height: 780,
    minWidth: 760,
    minHeight: 560,
    title: 'Fidati',
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#0c0c0e',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  if (DEV) win.loadURL('http://localhost:5173');
  else win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  // i link esterni si aprono nel browser, mai dentro l'app
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
}

async function diskInfo() {
  try {
    const s = await fsp.statfs(os.homedir());
    return { total: s.blocks * s.bsize, free: s.bavail * s.bsize };
  } catch {
    return null;
  }
}

ipcMain.handle('fidati:scan', async () => {
  if (scanning) throw new Error('Analisi già in corso');
  scanning = true;
  try {
    const result = await scan({
      onProgress: (p) => win && !win.isDestroyed() && win.webContents.send('fidati:progress', p),
    });
    registry = result.registry;
    return { groups: result.groups, scanned: result.scanned, disk: await diskInfo() };
  } finally {
    scanning = false;
  }
});

ipcMain.handle('fidati:adobe-running', () => runningAdobeApps());

ipcMain.handle('fidati:remove', async (_e, ids) => {
  if (!Array.isArray(ids)) return { results: [], disk: await diskInfo() };
  const adobeOpen = await runningAdobeApps();
  const results = [];
  for (const id of ids) {
    const rec = registry.get(id);
    if (!rec) {
      results.push({ id, ok: false, freed: 0, error: 'Elemento non più valido: rifai l’analisi' });
      continue;
    }
    // con un'app Adobe aperta la sua cache è in uso: non si tocca
    if (rec.groupId === 'adobe' && adobeOpen.length) {
      results.push({ id, ok: false, freed: 0, error: `Chiudi prima ${adobeOpen.join(', ')}` });
      continue;
    }
    const r = await removeItem(rec, { trash: (p) => shell.trashItem(p) });
    if (r.ok) registry.delete(id);
    results.push({ id, ...r });
  }
  return { results, disk: await diskInfo() };
});

ipcMain.handle('fidati:reveal', (_e, id) => {
  const rec = registry.get(id);
  if (rec) shell.showItemInFolder(rec.path);
});

ipcMain.handle('fidati:open-privacy', () =>
  shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles')
);

// ── aggiornamenti ────────────────────────────────────────────────────────────
let pendingUpdate = null;

ipcMain.handle('fidati:update-check', async () => {
  const current = app.getVersion();
  if (!app.isPackaged) return { current }; // in sviluppo non si aggiorna
  try {
    pendingUpdate = await updater.check({ current });
    const { latest, size, page } = pendingUpdate;
    return { current, latest, size, page };
  } catch {
    return { current }; // offline o GitHub non raggiungibile: si riprova al prossimo avvio
  }
});

ipcMain.handle('fidati:update-install', async () => {
  if (!pendingUpdate || !pendingUpdate.latest) throw new Error('Nessun aggiornamento disponibile');
  if (scanning) throw new Error('Aspetta la fine dell’analisi');
  const swapAndRelaunch = await updater.prepare(pendingUpdate, {
    tmpDir: app.getPath('temp'),
    onProgress: (p) => win && !win.isDestroyed() && win.webContents.send('fidati:update-progress', p),
  });
  swapAndRelaunch();
  app.quit();
});

app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());
