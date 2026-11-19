'use strict';
const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron');
const path = require('path');
const fsp = require('fs').promises;
const os = require('os');
const { scan, removeItem, runningAdobeApps, trashDir } = require('./scanner.cjs');
const { listDisks, listFolders, cloudRoots, onDisk, capacity, inside } = require('./disks.cjs');
const updater = require('./updater.cjs');
const { Journal, trashWithLog } = require('./journal.cjs');
const organizer = require('./organizer.cjs');
const ORG = require('./organizer-rules.cjs');

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
  if (scanning || organizing || restoring) throw new Error('Analisi già in corso');
  const disk = await findDisk(diskId);
  if (disk.disabled) throw new Error(`${disk.name}: ${disk.disabled}`);
  scanning = true;
  try {
    const ctx = {
      diskName: disk.name,
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
  // i file scelti a mano che vanno nel Cestino finiscono nella Cronologia (si possono riportare indietro);
  // cache e dati di sistema eliminati subito no
  const log = (await getJournals()).pulizia;
  let session = null;
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
    const trash = async (p) => {
      if (!session) session = await log.startSession({ kind: 'pulizia', label: `Nel Cestino da ${ctx.diskName}`, root: ctx.root });
      await trashWithLog(log, session, p, { trashFn: (q) => shell.trashItem(q), trashDir: trashDir(ctx), size: rec.size });
    };
    const r = await removeItem(rec, ctx, { trash });
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

// ── Cronologia (registro persistente degli spostamenti) ──────────────────────
let journals = null;
async function getJournals() {
  if (!journals) {
    const dir = path.join(app.getPath('userData'), 'log');
    journals = {
      riorganizza: await new Journal(path.join(dir, 'riorganizzazione.jsonl')).load(),
      pulizia: await new Journal(path.join(dir, 'pulizia.jsonl')).load(),
    };
  }
  return journals;
}
const journalOf = async (kind) => {
  const j = (await getJournals())[kind];
  if (!j) throw new Error('Cronologia sconosciuta');
  return j;
};
let restoring = false;

ipcMain.handle('log:list', async () => {
  const j = await getJournals();
  return { riorganizza: j.riorganizza.list(), pulizia: j.pulizia.list() };
});

ipcMain.handle('log:restore', async (_e, kind, ids, force) => {
  if (restoring || organizing) throw new Error('Aspetta la fine dell’operazione in corso');
  if (!Array.isArray(ids)) throw new Error('Richiesta non valida');
  restoring = true;
  try {
    const j = await journalOf(kind);
    const res = await j.restore(ids, { force: !!force });
    return { ...res, list: j.list() };
  } finally {
    restoring = false;
  }
});

ipcMain.handle('log:forget', async (_e, kind, sessionId) => {
  const j = await journalOf(kind);
  await j.forget(sessionId);
  return j.list();
});

ipcMain.handle('log:reveal', async (_e, kind, entryId) => {
  const e = (await journalOf(kind)).entries.get(entryId);
  if (!e) return;
  const p = e.state === 'restored' ? e.restoredTo : e.to;
  if (p) shell.showItemInFolder(p);
});

// ── Riorganizza ──────────────────────────────────────────────────────────────
let organizing = false;
let org = null; // ultima analisi: { ctx, clusters: Map, existing, sessionId }

const orgSettings = async () => {
  const s = await getSettings();
  s.organize = { threshold: ORG.DEFAULT_THRESHOLD, rename: true, dest: {}, ...(s.organize || {}) };
  return s.organize;
};

/** contesto di sicurezza per spostare file sul disco scelto */
async function orgContext(disk) {
  const exclude = [...(await getSettings()).excluded];
  return {
    kind: disk.kind,
    root: disk.root,
    home: os.homedir(),
    exclude,
    cloudRoots: disk.kind === 'system' ? await cloudRoots() : [],
    dev: (await fsp.lstat(disk.root)).dev,
  };
}

const defaultDest = (disk) => (disk.kind === 'system' ? path.join(os.homedir(), 'Documents', 'Clienti') : path.join(disk.root, 'Clienti'));

ipcMain.handle('org:options', async (_e, diskId) => {
  const disk = await findDisk(diskId);
  const o = await orgSettings();
  return { threshold: o.threshold, rename: o.rename, dest: o.dest[disk.id] || defaultDest(disk) };
});

ipcMain.handle('org:set-options', async (_e, { threshold, rename }) => {
  const o = await orgSettings();
  if (Number.isFinite(threshold)) o.threshold = Math.max(0, Math.min(100, Math.round(threshold)));
  if (typeof rename === 'boolean') {
    o.rename = rename;
    if (org) org.rename = rename;
  }
  await saveSettings();
  return { threshold: o.threshold, rename: o.rename };
});

async function pickFolder(disk, { title, buttonLabel, create }) {
  const res = await dialog.showOpenDialog(win, {
    title,
    buttonLabel,
    defaultPath: disk.root,
    properties: ['openDirectory', ...(create ? ['createDirectory'] : [])],
  });
  if (res.canceled || !res.filePaths[0]) return null;
  let folder = res.filePaths[0];
  try {
    folder = await fsp.realpath(folder);
  } catch {}
  if (folder !== disk.root && !onDisk(folder, disk)) throw new Error(`Scegli una cartella che si trova su “${disk.name}”`);
  return folder;
}

ipcMain.handle('org:pick-source', async (_e, diskId) => {
  const disk = await findDisk(diskId);
  return pickFolder(disk, { title: 'Cartella da riordinare', buttonLabel: 'Scegli' });
});

ipcMain.handle('org:pick-dest', async (_e, diskId) => {
  const disk = await findDisk(diskId);
  const folder = await pickFolder(disk, { title: 'Dove creare la cartella dei clienti', buttonLabel: 'Usa questa cartella', create: true });
  if (!folder) return null;
  organizer.assertDestination(folder, await orgContext(disk));
  const o = await orgSettings();
  o.dest[disk.id] = folder;
  await saveSettings();
  return folder;
});

/** cluster → dati per l'anteprima (con le destinazioni calcolate se cliente e progetto ci sono) */
function previewOf(c, client, project) {
  let moves = null;
  let error = null;
  if (client && project) {
    try {
      moves = organizer.materialize(c, { client, project, destRoot: org.ctx.destRoot, existing: org.existing, rename: org.rename }).moves;
    } catch (e) {
      error = e.message;
    }
  }
  return {
    id: c.id,
    client,
    project,
    confidence: c.confidence,
    reasons: c.reasons,
    size: c.items.reduce((s, i) => s + (i.size || 0), 0),
    count: c.items.reduce((s, i) => s + (i.count || 1), 0),
    hasLinks: c.items.some((i) => i.group),
    hasPackage: c.items.some((i) => i.kind === 'dir'),
    error,
    items: c.items.map((it, i) => ({
      from: it.from,
      name: it.name,
      kind: it.kind,
      size: it.size,
      sub: it.sub,
      linked: !!it.group,
      to: moves ? path.relative(org.ctx.destRoot, moves[i].to) : null,
      renamed: moves ? moves[i].renamed : false,
    })),
  };
}

ipcMain.handle('org:analyze', async (_e, diskId, source) => {
  if (organizing || scanning) throw new Error('Operazione già in corso');
  const disk = await findDisk(diskId);
  if (disk.disabled) throw new Error(`${disk.name}: ${disk.disabled}`);
  const o = await orgSettings();
  const ctx = { ...(await orgContext(disk)), destRoot: o.dest[disk.id] || defaultDest(disk) };
  organizer.assertDestination(ctx.destRoot, ctx);
  const whole = !source;
  const src = whole ? (disk.kind === 'system' ? os.homedir() : disk.root) : source;
  if (!whole && src !== disk.root && !onDisk(src, disk)) throw new Error('La cartella non è sul disco scelto');
  if (!whole) organizer.assertMovable(src, { ...ctx, destRoot: null });
  if (inside(src, ctx.destRoot)) throw new Error('Questa cartella è già dentro la cartella Clienti');
  organizing = true;
  try {
    const skipTop = whole ? (disk.kind === 'system' ? new Set(['Library', 'Applications']) : new Set(['System Volume Information', '$RECYCLE.BIN', 'Backups.backupdb', 'lost+found'])) : new Set();
    const res = await organizer.analyze({
      sources: [src],
      destRoot: ctx.destRoot,
      exclude: ctx.exclude,
      dev: ctx.dev,
      skipTop,
      isAllowed: (p) => {
        try {
          organizer.assertMovable(p, ctx);
          return true;
        } catch {
          return false;
        }
      },
      onProgress: (p) => send('org:progress', p),
    });
    org = { ctx: { ...ctx, sources: [src] }, clusters: new Map(res.clusters.map((c) => [c.id, c])), existing: res.existing, rename: o.rename, sessionId: null, diskName: disk.name };
    return {
      source: src,
      dest: ctx.destRoot,
      stats: res.stats,
      adobeOpen: await runningAdobeApps(),
      clusters: res.clusters.map((c) => previewOf(c, c.client, c.project)),
    };
  } finally {
    organizing = false;
  }
});

ipcMain.handle('org:preview', (_e, id, client, project) => {
  const c = org && org.clusters.get(id);
  if (!c) throw new Error('Rifai l’analisi');
  return previewOf(c, organizer.safeName(client), organizer.safeName(project));
});

/** sposta i progetti scelti. jobs: [{ id, client, project }] */
ipcMain.handle('org:apply', async (_e, jobs) => {
  if (!org) throw new Error('Rifai l’analisi');
  if (organizing || scanning || restoring) throw new Error('Operazione già in corso');
  if (!Array.isArray(jobs) || !jobs.length) return { moved: 0, failed: [], applied: [] };
  const list = jobs.map((j) => {
    const cluster = org.clusters.get(j.id);
    if (!cluster) throw new Error('Progetto non più valido: rifai l’analisi');
    const client = organizer.safeName(j.client);
    const project = organizer.safeName(j.project);
    if (!client || !project) throw new Error('Ogni progetto deve avere cliente e progetto');
    return { cluster, client, project };
  });
  // il disco deve essere ancora lo stesso; valgono anche le esclusioni aggiunte nel frattempo
  try {
    if ((await fsp.lstat(org.ctx.root)).dev !== org.ctx.dev) throw new Error();
  } catch {
    throw new Error('Il disco non è più collegato');
  }
  const ctx = { ...org.ctx, exclude: [...new Set([...org.ctx.exclude, ...(await getSettings()).excluded])] };
  organizing = true;
  try {
    const log = (await getJournals()).riorganizza;
    if (!org.sessionId) org.sessionId = await log.startSession({ kind: 'riorganizza', label: `Riorganizzazione su ${org.diskName}`, root: ctx.sources[0] });
    const res = await organizer.apply(list, {
      destRoot: ctx.destRoot,
      existing: org.existing,
      rename: org.rename,
      journal: log,
      sessionId: org.sessionId,
      sources: ctx.sources,
      assertMovable: (p) => organizer.assertMovable(p, ctx),
      onProgress: (p) => send('org:progress', p),
    });
    for (const j of list) org.clusters.delete(j.cluster.id);
    org.existing = await organizer.readExisting(ctx.destRoot);
    return {
      moved: res.moved,
      failed: res.failed.map((f) => ({ name: path.basename(f.from), path: f.from, error: f.error })),
      applied: jobs.map((j) => j.id),
    };
  } finally {
    organizing = false;
  }
});

ipcMain.handle('org:reveal', (_e, p) => {
  if (!org || typeof p !== 'string') return;
  // si mostrano solo percorsi dell'ultima analisi o della cartella Clienti
  const known = p === org.ctx.destRoot || inside(p, org.ctx.destRoot) || [...org.clusters.values()].some((c) => c.items.some((i) => i.from === p));
  if (!known) return;
  if (p === org.ctx.destRoot) shell.openPath(p);
  else shell.showItemInFolder(p);
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
  const swapAndRelaunch = await updater.prepare(pendingUpdate, {
    tmpDir: app.getPath('temp'),
    onProgress: (p) => win && !win.isDestroyed() && win.webContents.send('fidati:update-progress', p),
  });
  swapAndRelaunch();
  app.quit();
});

app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());
