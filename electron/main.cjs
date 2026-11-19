'use strict';
const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron');
const path = require('path');
const fsp = require('fs').promises;
const os = require('os');
const { scan, removeItem, runningAdobeApps } = require('./scanner.cjs');
const { listDisks, listFolders, cloudRoots, onDisk, capacity } = require('./disks.cjs');
const updater = require('./updater.cjs');
const T = require('./transfer.cjs');

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

// ── trasferimento ordinato ───────────────────────────────────────────────────
// La partenza si legge e basta: si copia verso l'arrivo, senza mai sovrascrivere.
const tr = { src: null, dest: null, depth: 0, roles: [], plan: new Map(), original: new Map(), running: false, stop: false };
const trSend = (p) => send('fidati:transfer-progress', p);
const label = (root) => path.basename(root) || root;

/** l'elemento come lo vede l'interfaccia: percorsi relativi alle due radici */
function pubEntry(e) {
  const rel = (root, p) => path.relative(root, p) || '.';
  return {
    id: e.id,
    kind: e.kind,
    name: e.name,
    role: e.role,
    src: rel(tr.src.root, e.srcDir),
    dest: rel(tr.dest.root, e.destDir),
    via: e.via,
    match: e.match,
    custom: !!e.custom,
    suggestions: e.suggestions.map((s, i) => ({ index: i, dest: rel(tr.dest.root, s.destDir), why: s.why })),
    files: e.files,
    size: e.size,
    skipped: e.skipped,
    skippedSize: e.skippedSize,
    selected: e.selected,
  };
}

async function realDir(p) {
  const real = await fsp.realpath(p);
  if (!(await fsp.stat(real)).isDirectory()) throw new Error('Scegli una cartella');
  return real;
}

ipcMain.handle('transfer:pick', async (_e, which, diskId) => {
  if (tr.running) throw new Error('Copia in corso');
  if (which !== 'src' && which !== 'dest') throw new Error('Scelta non valida');
  let root;
  if (diskId) {
    const disk = await findDisk(diskId);
    if (which === 'dest' && disk.disabled) throw new Error(`${disk.name}: ${disk.disabled}`);
    root = disk.root;
  } else {
    const res = await dialog.showOpenDialog(win, {
      title: which === 'src' ? 'Cartella di partenza' : 'Cartella di arrivo',
      buttonLabel: 'Scegli',
      properties: ['openDirectory', 'createDirectory'],
    });
    if (res.canceled || !res.filePaths[0]) return null;
    root = res.filePaths[0];
  }
  root = await realDir(root);
  if (which === 'dest') {
    try {
      await fsp.access(root, require('fs').constants.W_OK);
    } catch {
      throw new Error('Sulla cartella di arrivo non si può scrivere');
    }
  }
  tr[which] = { root, name: label(root) };
  tr.plan = new Map();
  return { root, name: label(root), ...(await capacity(root)) };
});

ipcMain.handle('transfer:analyze', async () => {
  if (!tr.src || !tr.dest) throw new Error('Scegli partenza e arrivo');
  if (T.inside(tr.dest.root, tr.src.root) || T.inside(tr.src.root, tr.dest.root)) {
    throw new Error('Partenza e arrivo non possono stare una dentro l’altra');
  }
  const read = async (side) => {
    const r = await T.readTree(tr[side].root, { onProgress: (p) => trSend({ phase: 'read', side, ...p }) });
    tr[side].tree = r.tree;
    const { levels, suggested } = T.detectLevels(r.tree);
    return { root: tr[side].root, name: tr[side].name, folders: r.folders, truncated: r.truncated, levels, suggested };
  };
  return { src: await read('src'), dest: await read('dest') };
});

ipcMain.handle('transfer:plan', async (_e, depth, roles) => {
  if (!tr.src?.tree || !tr.dest?.tree) throw new Error('Leggi prima la struttura');
  depth = Math.max(1, Math.min(8, parseInt(depth, 10) || 1));
  roles = (Array.isArray(roles) ? roles : []).slice(0, depth).map((r) => String(r).slice(0, 40));
  trSend({ phase: 'plan' });
  const plan = await T.buildPlan({ srcTree: tr.src.tree, destTree: tr.dest.tree, depth, roles });
  tr.depth = depth;
  tr.roles = roles;
  tr.plan = new Map(plan.map((e) => [e.id, e]));
  tr.original = new Map(plan.map((e) => [e.id, e]));
  return { entries: plan.map(pubEntry), dest: await capacity(tr.dest.root) };
});

const getEntry = (id) => {
  const e = tr.plan.get(id);
  if (!e) throw new Error('Elemento non valido: rifai il piano');
  if (tr.running) throw new Error('Copia in corso');
  return e;
};

/** destinazione scelta dall'utente: deve stare dentro l'arrivo */
ipcMain.handle('transfer:choose-dest', async (_e, id) => {
  const e = getEntry(id);
  const res = await dialog.showOpenDialog(win, {
    title: `Dove copiare “${e.name}”?`,
    buttonLabel: 'Copia qui',
    defaultPath: path.dirname(e.destDir),
    properties: ['openDirectory', 'createDirectory'],
  });
  if (res.canceled || !res.filePaths[0]) return pubEntry(e);
  const chosen = await realDir(res.filePaths[0]);
  const destDir = e.only ? chosen : path.join(chosen, path.basename(e.srcDir));
  T.assertCopyTarget(destDir, { srcRoot: tr.src.root, destRoot: tr.dest.root });
  const next = { ...(await T.remeasure(e, destDir, { match: 'manual' })), custom: true };
  tr.plan.set(id, next);
  return pubEntry(next);
});

ipcMain.handle('transfer:use-suggestion', async (_e, id, index) => {
  const e = getEntry(id);
  const s = e.suggestions[index];
  if (!s) throw new Error('Suggerimento non valido');
  const next = { ...(await T.remeasure(e, s.destDir, { match: 'elsewhere' })), custom: true };
  tr.plan.set(id, next);
  return pubEntry(next);
});

ipcMain.handle('transfer:reset-dest', (_e, id) => {
  getEntry(id);
  const orig = tr.original.get(id);
  tr.plan.set(id, orig);
  return pubEntry(orig);
});

ipcMain.handle('transfer:stop', () => {
  tr.stop = true;
});

ipcMain.handle('transfer:run', async (_e, ids) => {
  if (tr.running) throw new Error('Copia già in corso');
  if (!Array.isArray(ids) || !ids.length) throw new Error('Nessun elemento selezionato');
  const entries = ids.map((id) => tr.plan.get(id)).filter((e) => e && e.kind !== 'present');
  const ctx = { srcRoot: tr.src.root, destRoot: tr.dest.root };
  const total = entries.reduce((s, e) => s + e.size, 0);
  const totalFiles = entries.reduce((s, e) => s + e.files, 0);
  const { free } = await capacity(tr.dest.root);
  if (free && total > free) throw new Error(`Spazio insufficiente all’arrivo: servono ${Math.ceil(total / 1e9)} GB`);
  tr.running = true;
  tr.stop = false;
  const results = [];
  let doneBytes = 0;
  let doneFiles = 0;
  const logFile = path.join(app.getPath('userData'), 'trasferimenti.log');
  try {
    for (const e of entries) {
      if (tr.stop) {
        results.push({ id: e.id, ok: false, error: 'Interrotto' });
        continue;
      }
      const base = doneBytes;
      try {
        const r = await T.copyEntry(e, ctx, {
          shouldStop: () => tr.stop,
          onFile: ({ file, bytes }) => {
            doneFiles++;
            trSend({ phase: 'copy', name: e.name, current: file, bytes: base + bytes, total, files: doneFiles, totalFiles });
          },
        });
        doneBytes += r.bytes;
        results.push({ id: e.id, ok: !r.errors.length, ...r });
        await fsp
          .appendFile(logFile, JSON.stringify({ at: new Date().toISOString(), from: e.srcDir, to: e.destDir, files: r.copied, bytes: r.bytes, skipped: r.skipped }) + '\n')
          .catch(() => {});
      } catch (err) {
        results.push({ id: e.id, ok: false, error: err.message, errors: err.partial?.errors || [] });
        if (/Spazio esaurito/.test(err.message)) tr.stop = true;
      }
      // a copia fatta l'elemento risulta "già presente"
      tr.plan.set(e.id, await T.remeasure(e, e.destDir, { kind: e.kind }));
    }
  } finally {
    tr.running = false;
  }
  return { results, entries: [...tr.plan.values()].map(pubEntry), dest: await capacity(tr.dest.root) };
});

ipcMain.handle('transfer:reveal', (_e, id, side) => {
  const e = tr.plan.get(id);
  if (!e) return;
  const p = side === 'src' ? e.srcDir : e.destDir;
  fsp.access(p).then(() => shell.showItemInFolder(p), () => shell.showItemInFolder(path.dirname(p)));
});

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
  if (tr.running) throw new Error('Aspetta la fine della copia');
  const swapAndRelaunch = await updater.prepare(pendingUpdate, {
    tmpDir: app.getPath('temp'),
    onProgress: (p) => win && !win.isDestroyed() && win.webContents.send('fidati:update-progress', p),
  });
  swapAndRelaunch();
  app.quit();
});

app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());
