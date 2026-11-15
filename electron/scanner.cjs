'use strict';
/**
 * Analisi del disco ed eliminazione. Nessuna dipendenza da Electron:
 * si può provare con `npm test`.
 */
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const os = require('os');
const { execFile } = require('child_process');
const C = require('./categories.cjs');

const MAX_ITEMS = 300; // voci elencate per gruppo (le più grandi)

/** spazio realmente occupato su disco (i file solo-iCloud contano 0) */
const sizeOf = (st) => (st.blocks != null ? st.blocks * 512 : st.size);

async function listDir(dir) {
  try {
    return await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

/** dimensione ricorsiva di una cartella, senza seguire i link simbolici */
async function dirSize(root, tick = () => {}) {
  let size = 0;
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop();
    const entries = await listDir(dir);
    await Promise.all(
      entries.map(async (e) => {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) stack.push(p);
        else if (e.isFile()) {
          try {
            size += sizeOf(await fsp.lstat(p));
            tick(p);
          } catch {}
        }
      })
    );
  }
  return size;
}

async function measure(p, tick) {
  try {
    const st = await fsp.lstat(p);
    if (st.isSymbolicLink()) return null;
    if (st.isDirectory()) return { size: await dirSize(p, tick), isDir: true };
    return { size: sizeOf(st), isDir: false };
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Analisi
// ─────────────────────────────────────────────────────────────────────────────
async function scan({ home = os.homedir(), tmp = os.tmpdir(), onProgress = () => {} } = {}) {
  const groups = new Map(C.GROUPS.map((g) => [g.id, { ...g, size: 0, totalCount: 0, items: [] }]));
  let scanned = 0;
  let lastEmit = 0;
  const tick = (p) => {
    scanned++;
    const now = Date.now();
    if (now - lastEmit > 120) {
      lastEmit = now;
      onProgress({ scanned, current: p });
    }
  };

  const add = (groupId, p, size, opts = {}) => {
    if (size == null || (size <= 0 && !opts.keepEmpty)) return;
    const g = groups.get(groupId);
    g.size += size;
    g.totalCount++;
    g.items.push({ name: opts.name || path.basename(p), path: p, size, mode: opts.mode, note: opts.note });
    if (g.items.length > MAX_ITEMS * 2) {
      g.items.sort((a, b) => b.size - a.size);
      g.items.length = MAX_ITEMS;
    }
  };

  /** aggiunge una voce "pulibile": delle cartelle si svuota il contenuto, la cartella resta */
  const addCleanable = async (groupId, p, name) => {
    const m = await measure(p, tick);
    if (m) add(groupId, p, m.size, { name, mode: m.isDir ? 'contents' : 'rm' });
  };

  const lib = (...parts) => path.join(home, 'Library', ...parts);

  // 1 ── ~/Library/Caches: una voce per app, smistata per tipo
  for (const e of await listDir(lib('Caches'))) {
    if (/^fidati$/i.test(e.name) || e.name.startsWith('.')) continue;
    const group = C.ADOBE_RE.test(e.name)
      ? 'adobe'
      : C.BROWSER_RE.test(e.name)
        ? 'browser-cache'
        : C.DEV_RE.test(e.name)
          ? 'dev-cache'
          : 'app-cache';
    await addCleanable(group, lib('Caches', e.name));
  }

  // 2 ── Adobe: cache multimediali fuori da ~/Library/Caches
  const adobeCommon = lib('Application Support', 'Adobe', 'Common');
  for (const name of ['Media Cache Files', 'Media Cache', 'Peak Files']) {
    await addCleanable('adobe', path.join(adobeCommon, name), `Adobe ${name}`);
  }
  for (const e of await listDir(tmp)) {
    if (/^Photoshop Temp/i.test(e.name)) await addCleanable('adobe', path.join(tmp, e.name));
  }

  // 3 ── Log
  for (const e of await listDir(lib('Logs'))) {
    if (e.name.startsWith('.')) continue;
    await addCleanable(C.ADOBE_LOG_RE.test(e.name) ? 'adobe' : 'logs', lib('Logs', e.name), `Log · ${e.name}`);
  }

  // 4 ── Cache di sviluppo
  const devDirs = [
    [lib('Developer', 'Xcode', 'DerivedData'), 'Xcode DerivedData'],
    [lib('Developer', 'Xcode', 'iOS DeviceSupport'), 'Xcode iOS DeviceSupport'],
    [lib('Developer', 'CoreSimulator', 'Caches'), 'Cache del Simulatore'],
    [path.join(home, '.npm', '_cacache'), 'Cache di npm'],
    [path.join(home, '.yarn', 'berry', 'cache'), 'Cache di Yarn'],
    [path.join(home, '.gradle', 'caches'), 'Cache di Gradle'],
  ];
  for (const [p, name] of devDirs) await addCleanable('dev-cache', p, name);

  // 5 ── Cestino (senza "Accesso completo al disco" macOS non lo lascia leggere)
  const trash = path.join(home, '.Trash');
  try {
    const entries = await fsp.readdir(trash);
    if (entries.length) add('trash', trash, await dirSize(trash, tick), { name: 'Cestino', mode: 'emptyTrash' });
  } catch (err) {
    if (err.code === 'EPERM' || err.code === 'EACCES') {
      add('trash', trash, 0, {
        name: 'Cestino',
        mode: 'emptyTrash',
        keepEmpty: true,
        note: 'Dimensione non leggibile senza “Accesso completo al disco”',
      });
    }
  }

  // 6 ── Backup iOS
  const backups = lib('Application Support', 'MobileSync', 'Backup');
  for (const e of await listDir(backups)) {
    const m = await measure(path.join(backups, e.name), tick);
    if (m) add('ios-backups', path.join(backups, e.name), m.size, { name: `Backup ${e.name.slice(0, 12)}…`, mode: 'rm' });
  }

  // 7 ── File personali: tutta la cartella Inizio tranne Library e le cartelle nascoste
  const stack = [home];
  while (stack.length) {
    const dir = stack.pop();
    const entries = await listDir(dir);
    await Promise.all(
      entries.map(async (e) => {
        if (e.name.startsWith('.') || e.isSymbolicLink()) return;
        const p = path.join(dir, e.name);
        if (dir === home && (e.name === 'Library' || e.name === 'Applications')) return;
        const extension = path.extname(e.name).toLowerCase();
        if (e.isDirectory()) {
          if (e.name === 'node_modules') {
            add('node-modules', p, await dirSize(p, tick), { name: path.relative(home, dir) || 'node_modules', mode: 'rm' });
          } else if (C.PACKAGE_GROUP[extension]) {
            add(C.PACKAGE_GROUP[extension], p, await dirSize(p, tick), { mode: 'trash' });
          } else {
            stack.push(p);
          }
        } else if (e.isFile()) {
          try {
            add(C.EXT_GROUP[extension] || 'other', p, sizeOf(await fsp.lstat(p)), { mode: 'trash' });
            tick(p);
          } catch {}
        }
      })
    );
  }

  // 8 ── Protetti: solo informativi
  for (const e of await listDir(lib())) {
    if (e.name === 'Caches' || e.name === 'Logs' || e.name.startsWith('.') || !e.isDirectory()) continue;
    add('app-data', lib(e.name), await dirSize(lib(e.name), tick), { name: `Library/${e.name}` });
  }
  for (const appsDir of ['/Applications', path.join(home, 'Applications')]) {
    for (const e of await listDir(appsDir)) {
      if (e.name.startsWith('.') || !e.isDirectory()) continue;
      add('applications', path.join(appsDir, e.name), await dirSize(path.join(appsDir, e.name), tick), {
        name: e.name.replace(/\.app$/, ''),
      });
    }
  }
  for (const p of ['/System', '/Library', '/usr', '/bin', '/sbin', '/private']) {
    if (fs.existsSync(p)) add('system', p, 0, { keepEmpty: true, note: 'Protetto da macOS, non analizzato' });
  }

  // ── risultato: id stabili + registro lato "main" (il renderer manda solo gli id)
  const registry = new Map();
  let seq = 0;
  const out = [];
  for (const g of groups.values()) {
    if (!g.items.length) continue;
    g.items.sort((a, b) => b.size - a.size);
    g.items.length = Math.min(g.items.length, MAX_ITEMS);
    for (const it of g.items) {
      it.id = `i${++seq}`;
      registry.set(it.id, { ...it, groupId: g.id, level: g.level });
      delete it.mode;
    }
    out.push(g);
  }
  onProgress({ scanned, current: '', done: true });
  return { groups: out, registry, scanned };
}

// ─────────────────────────────────────────────────────────────────────────────
// Eliminazione
// ─────────────────────────────────────────────────────────────────────────────

/** dentro ~/Library si può toccare SOLO ciò che sta qui sotto */
const LIBRARY_ALLOWED = [
  ['Caches', false], // false = solo i figli, non la cartella stessa
  ['Logs', false],
  ['Developer/Xcode/DerivedData', true],
  ['Developer/Xcode/iOS DeviceSupport', true],
  ['Developer/CoreSimulator/Caches', true],
  ['Application Support/Adobe/Common/Media Cache Files', true],
  ['Application Support/Adobe/Common/Media Cache', true],
  ['Application Support/Adobe/Common/Peak Files', true],
  ['Application Support/MobileSync/Backup', false],
];

/** cartelle dell'utente che non si eliminano mai per intero */
const HOME_FORBIDDEN = ['Desktop', 'Documents', 'Downloads', 'Movies', 'Music', 'Pictures', 'Public', 'Applications', 'Library'];

/** ultima barriera prima di cancellare: lancia un errore se il percorso non è ammesso */
function assertDeletable(p, home, tmp) {
  const r = path.resolve(p);
  if (r !== p || !path.isAbsolute(p)) throw new Error('Percorso non valido');
  if (r.startsWith(tmp + path.sep)) {
    if (/^Photoshop Temp/i.test(path.basename(r)) && path.dirname(r) === tmp) return;
    throw new Error('File temporaneo non ammesso');
  }
  if (!r.startsWith(home + path.sep)) throw new Error('Fuori dalla cartella utente: protetto');
  const rel = path.relative(home, r).split(path.sep).join('/');
  if (HOME_FORBIDDEN.includes(rel)) throw new Error('Cartella principale: protetta');
  if (rel === 'Library' || rel.startsWith('Library/')) {
    const inner = rel.slice('Library/'.length);
    const ok = LIBRARY_ALLOWED.some(([prefix, self]) => inner.startsWith(prefix + '/') || (self && inner === prefix));
    if (!ok) throw new Error('Dati di sistema o delle app: protetti');
  }
}

const emptyTrash = () =>
  new Promise((resolve, reject) =>
    execFile('osascript', ['-e', 'tell application "Finder" to empty trash'], { timeout: 120000 }, (err) =>
      err ? reject(new Error('Il Finder non ha svuotato il Cestino')) : resolve()
    )
  );

/**
 * Elimina una voce del registro. Ritorna { ok, freed, error? }.
 * trash(path) sposta nel Cestino (in Electron: shell.trashItem).
 */
async function removeItem(rec, { home = os.homedir(), tmp = os.tmpdir(), trash } = {}) {
  try {
    if (!rec || rec.level === 'protected' || !rec.mode) throw new Error('Elemento protetto');
    if (rec.mode === 'emptyTrash') {
      if (rec.path !== path.join(home, '.Trash')) throw new Error('Percorso non valido');
      await emptyTrash();
      return { ok: true, freed: rec.size };
    }
    assertDeletable(rec.path, home, tmp);
    if (rec.mode === 'trash') {
      await trash(rec.path);
      return { ok: true, freed: 0, trashed: rec.size };
    }
    if (rec.mode === 'rm') {
      await fsp.rm(rec.path, { recursive: true, force: true });
      return { ok: true, freed: rec.size };
    }
    if (rec.mode === 'contents') {
      let failed = 0;
      for (const e of await fsp.readdir(rec.path)) {
        try {
          await fsp.rm(path.join(rec.path, e), { recursive: true, force: true });
        } catch {
          failed++;
        }
      }
      const left = failed ? await dirSize(rec.path) : 0;
      return {
        ok: true,
        freed: Math.max(0, rec.size - left),
        error: failed ? `${failed} elementi in uso o protetti, saltati` : undefined,
      };
    }
    throw new Error('Modalità sconosciuta');
  } catch (err) {
    return { ok: false, freed: 0, error: err.code === 'EPERM' || err.code === 'EACCES' ? 'Permesso negato da macOS' : err.message };
  }
}

/** nomi delle app Adobe aperte (es. ["Adobe Photoshop 2026"]) */
function runningAdobeApps() {
  return new Promise((resolve) =>
    execFile('ps', ['-axo', 'comm='], { maxBuffer: 8 * 1024 * 1024 }, (err, stdout) => {
      if (err) return resolve([]);
      const names = new Set();
      for (const line of stdout.split('\n')) {
        const m = line.match(C.ADOBE_APP_RE);
        if (m && !C.ADOBE_BACKGROUND_RE.test(m[1])) names.add(m[1]);
      }
      resolve([...names]);
    })
  );
}

module.exports = { scan, removeItem, assertDeletable, runningAdobeApps, dirSize };
