'use strict';
const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron');
const path = require('path');
const fsp = require('fs').promises;
const os = require('os');
const { scan, removeItem, runningAdobeApps } = require('./scanner.cjs');
const { listDisks, listFolders, cloudRoots, onDisk, capacity } = require('./disks.cjs');
const updater = require('./updater.cjs');

const DEV = process.env.FIDATI_DEV === '1';
app.setName('Fidati');

let win;
let registry = new Map(); // id → voce dell'ultima analisi; il renderer non manda mai percorsi
let scanCtx = null; // disco e regole dell'ultima analisi: l'eliminazione resta su quel disco
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

// ── impostazioni (cartelle escluse), salvate in ~/Library/Application Support/Fidati ──
const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');
let settings = null;

async function getSettings() {
  if (settings) return settings;
  try {
    settings = JSON.parse(await fsp.readFile(settingsFile(), 'utf8'));
    if (!Array.isArray(settings.excluded)) throw new Error();
  } catch {
    // primo avvio: le cartelle sincronizzate (Dropbox, iCloud Drive…) partono escluse
    settings = { excluded: await cloudRoots() };
    await saveSettings();
  }
  return settings;
}

async function saveSettings() {
  await fsp.mkdir(path.dirname(settingsFile()), { recursive: true });
  await fsp.writeFile(settingsFile(), JSON.stringify(settings, null, 2));
}

/** il disco richiesto dall'interfaccia, solo se è davvero collegato */
async function findDisk(diskId) {
  const disk = (await listDisks()).find((d) => d.id === diskId);
  if (!disk) throw new Error('Disco non trovato: è stato scollegato?');
  return disk;
}

const send = (channel, payload) => win && !win.isDestroyed() && win.webContents.send(channel, payload);

ipcMain.handle('fidati:disks', () => listDisks());

ipcMain.handle('fidati:folders', async (_e, diskId) =>
  listFolders(await findDisk(diskId), { excluded: (await getSettings()).excluded })
);

ipcMain.handle('fidati:set-excluded', async (_e, diskId, folder, excluded) => {
  const disk = await findDisk(diskId);
  const s = await getSettings();
  const known = (await listFolders(disk, { excluded: s.excluded })).some((f) => f.path === folder);
  if (!known) throw new Error('Cartella non valida');
  s.excluded = s.excluded.filter((p) => p !== folder);
  if (excluded) s.excluded.push(folder);
  await saveSettings();
  return listFolders(disk, { excluded: s.excluded });
});

ipcMain.handle('fidati:pick-excluded', async (_e, diskId) => {
  const disk = await findDisk(diskId);
  const res = await dialog.showOpenDialog(win, {
    title: 'Escludi una cartella',
    buttonLabel: 'Escludi',
    defaultPath: disk.root,
    properties: ['openDirectory'],
  });
  const s = await getSettings();
  if (!res.canceled && res.filePaths[0]) {
    let folder = res.filePaths[0];
    try {
      folder = await fsp.realpath(folder);
    } catch {}
    if (!onDisk(folder, disk)) throw new Error(`Scegli una cartella che si trova su “${disk.name}”`);
    if (!s.excluded.includes(folder)) s.excluded.push(folder);
    await saveSettings();
  }
  return listFolders(disk, { excluded: s.excluded });
});

ipcMain.handle('fidati:scan', async (_e, diskId) => {
  if (scanning) throw new Error('Analisi già in corso');
  const disk = await findDisk(diskId);
  if (disk.disabled) throw new Error(`${disk.name}: ${disk.disabled}`);
  scanning = true;
  try {
    const ctx = {
      kind: disk.kind,
      root: disk.root,
      home: os.homedir(),
      tmp: os.tmpdir(),
      exclude: [...(await getSettings()).excluded],
      cloudRoots: disk.kind === 'system' ? await cloudRoots() : [],
      dev: (await fsp.lstat(disk.root)).dev,
      uid: process.getuid(),
      diskId: disk.id,
    };
    registry = new Map();
    scanCtx = null;
    const result = await scan(ctx, { onProgress: (p) => send('fidati:progress', p) });
    registry = result.registry;
    scanCtx = ctx;
    return { groups: result.groups, scanned: result.scanned, disk: await capacity(disk.root) };
  } finally {
    scanning = false;
  }
});

ipcMain.handle('fidati:adobe-running', () => runningAdobeApps());

ipcMain.handle('fidati:remove', async (_e, ids) => {
  if (!scanCtx || !Array.isArray(ids)) return { results: [], disk: null };
  // il disco dell'analisi deve essere ancora lo stesso, e valgono anche le esclusioni aggiunte nel frattempo
  let sameDisk = false;
  try {
    sameDisk = (await fsp.lstat(scanCtx.root)).dev === scanCtx.dev;
  } catch {}
  const ctx = { ...scanCtx, exclude: [...new Set([...scanCtx.exclude, ...(await getSettings()).excluded])] };
  const adobeOpen = await runningAdobeApps();
  const results = [];
  for (const id of ids) {
    const rec = registry.get(id);
    if (!sameDisk) {
      results.push({ id, ok: false, freed: 0, error: 'Il disco non è più collegato' });
      continue;
    }
    if (!rec) {
      results.push({ id, ok: false, freed: 0, error: 'Elemento non più valido: rifai l’analisi' });
      continue;
    }
    // con un'app Adobe aperta la sua cache è in uso: non si tocca
    if (rec.groupId === 'adobe' && adobeOpen.length) {
      results.push({ id, ok: false, freed: 0, error: `Chiudi prima ${adobeOpen.join(', ')}` });
      continue;
    }
    const r = await removeItem(rec, ctx, { trash: (p) => shell.trashItem(p) });
    if (r.ok) registry.delete(id);
    results.push({ id, ...r });
  }
  return { results, disk: sameDisk ? await capacity(scanCtx.root) : null };
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
