'use strict';
/**
 * Dischi collegati e cartelle proposte per l'esclusione.
 * Nessuna dipendenza da Electron: si prova con `npm test`.
 */
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const os = require('os');
const C = require('./categories.cjs');

/** p è uguale a base o sta dentro base */
const inside = (p, base) => p === base || p.startsWith(base.endsWith(path.sep) ? base : base + path.sep);

async function listDir(dir) {
  try {
    return await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

const exists = (p) => fsp.access(p).then(() => true, () => false);

async function capacity(p) {
  try {
    const s = await fsp.statfs(p);
    return { total: s.blocks * s.bsize, free: s.bavail * s.bsize };
  } catch {
    return { total: 0, free: 0 };
  }
}

/** motivo per cui un disco esterno non si può analizzare, o null */
async function whyNot(root) {
  if ((await exists(path.join(root, 'Backups.backupdb'))) || (await exists(path.join(root, '.timemachine')))) {
    return 'Disco di backup Time Machine';
  }
  if (await exists(path.join(root, 'System', 'Library', 'CoreServices', 'SystemVersion.plist'))) {
    return 'Contiene un’installazione di macOS';
  }
  try {
    await fsp.access(root, fs.constants.W_OK);
  } catch {
    return 'Disco di sola lettura';
  }
  return null;
}

/**
 * Il disco di sistema (si analizza la cartella Inizio) + i dischi in /Volumes.
 * → [{ id, name, kind: 'system'|'external', root, total, free, disabled? }]
 */
async function listDisks({ volumesDir = '/Volumes', home = os.homedir() } = {}) {
  let systemName = 'Macintosh HD';
  const others = [];
  for (const e of await listDir(volumesDir)) {
    if (e.name.startsWith('.')) continue;
    let real;
    try {
      real = await fsp.realpath(path.join(volumesDir, e.name));
    } catch {
      continue;
    }
    if (real === '/') {
      systemName = e.name; // /Volumes/Macintosh HD → /
      continue;
    }
    try {
      if (!(await fsp.stat(real)).isDirectory()) continue;
    } catch {
      continue;
    }
    const cap = await capacity(real);
    if (!cap.total) continue;
    others.push({ id: real, name: e.name, kind: 'external', root: real, ...cap, disabled: await whyNot(real) });
  }
  others.sort((a, b) => a.name.localeCompare(b.name, 'it'));
  return [{ id: 'system', name: systemName, kind: 'system', root: home, ...(await capacity(home)) }, ...others];
}

/** cartelle sincronizzate con un cloud nella cartella Inizio */
async function cloudRoots(home = os.homedir()) {
  const out = [];
  const storage = path.join(home, 'Library', 'CloudStorage');
  for (const e of await listDir(storage)) {
    if (e.isDirectory() && !e.name.startsWith('.')) out.push(path.join(storage, e.name));
  }
  const icloud = path.join(home, 'Library', 'Mobile Documents', 'com~apple~CloudDocs');
  if (await exists(icloud)) out.push(icloud);
  for (const e of await listDir(home)) {
    if (e.isDirectory() && C.CLOUD_NAME_RE.test(e.name)) out.push(path.join(home, e.name));
  }
  return out;
}

/** "Dropbox-Azienda Srl" → "Dropbox · Azienda Srl" */
function cloudLabel(p) {
  if (p.endsWith('com~apple~CloudDocs')) return 'iCloud Drive';
  const name = path.basename(p).replace(/^GoogleDrive/, 'Google Drive');
  const i = name.indexOf('-');
  return i > 0 ? `${name.slice(0, i)} · ${name.slice(i + 1)}` : name;
}

/**
 * Cartelle proposte per il disco scelto, con lo stato di esclusione.
 * → [{ path, name, cloud, custom, excluded }]
 */
async function listFolders(disk, { excluded = [], home = os.homedir() } = {}) {
  const list = [];
  if (disk.kind === 'system') {
    const clouds = await cloudRoots(home);
    for (const e of await listDir(home)) {
      if (!e.isDirectory() || e.name.startsWith('.') || e.name === 'Library' || e.name === 'Applications') continue;
      const p = path.join(home, e.name);
      list.push({ path: p, name: C.HOME_LABELS[e.name] || e.name, cloud: clouds.includes(p) });
    }
    list.sort((a, b) => a.name.localeCompare(b.name, 'it'));
    for (const p of clouds) if (!inside(p, home) || p.startsWith(path.join(home, 'Library') + path.sep)) {
      list.push({ path: p, name: cloudLabel(p), cloud: true });
    }
  } else {
    for (const e of await listDir(disk.root)) {
      if (!e.isDirectory() || e.name.startsWith('.') || C.VOLUME_SYSTEM_TOP.has(e.name)) continue;
      list.push({ path: path.join(disk.root, e.name), name: e.name, cloud: false });
    }
    list.sort((a, b) => a.name.localeCompare(b.name, 'it'));
  }
  // altre cartelle escluse a mano su questo disco
  const known = new Set(list.map((f) => f.path));
  for (const p of excluded) {
    if (known.has(p) || !onDisk(p, disk, home)) continue;
    const rel = path.relative(disk.root, p);
    list.push({ path: p, name: disk.kind === 'system' ? `~/${rel}` : rel, cloud: false, custom: true });
  }
  return list.map((f) => ({ ...f, custom: !!f.custom, excluded: excluded.includes(f.path) }));
}

/** la cartella appartiene al disco (e non è il disco stesso)? */
function onDisk(p, disk, home = os.homedir()) {
  const root = disk.kind === 'system' ? home : disk.root;
  return path.isAbsolute(p) && path.resolve(p) === p && inside(p, root) && p !== root;
}

module.exports = { listDisks, listFolders, cloudRoots, onDisk, capacity, inside };
