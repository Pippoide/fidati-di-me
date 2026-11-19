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

/**
 * Tutti i file system montati, letti da `mount`. Serve per i dischi virtuali
 * (Disk Drill "Monta come disco", immagini aperte da Disk Drill, NFS/FUSE…) che
 * possono stare anche fuori da /Volumes.
 * → [{ source, point, type, readOnly }]
 */
function parseMount(text) {
  const out = [];
  for (const line of String(text).split('\n')) {
    const m = line.match(/^(.+?) on (\/.*) \(([^,)]+)(.*)\)\s*$/);
    if (!m) continue;
    out.push({ source: m[1], point: m[2], type: m[3].trim().toLowerCase(), readOnly: /\bread-only\b|\brdonly\b/.test(m[4]) });
  }
  return out;
}

function readMounts() {
  return new Promise((resolve) => {
    require('child_process').execFile('/sbin/mount', [], { timeout: 4000 }, (err, stdout) => resolve(err ? [] : parseMount(stdout)));
  });
}

/** punti di montaggio di sistema che non sono dischi da mostrare */
// (le cartelle temporanee /private/var/folders restano: Disk Drill può montare lì i suoi dischi;
//  si saltano solo le copie "AppTranslocation" che macOS crea all'avvio delle app scaricate)
const SYSTEM_MOUNT = /^\/(System\/Volumes|dev|private\/var\/vm|Library\/Developer|nix)(\/|$)|\/AppTranslocation\//;
const LOCAL_TYPES = new Set(['apfs', 'hfs', 'msdos', 'exfat', 'ntfs', 'ufsd_ntfs', 'tuxera_ntfs', 'udf', 'cd9660']);

/** etichetta per i dischi non "normali" */
function mountNote(mnt, name) {
  if (!mnt) return null;
  if (/disk ?drill|cleverfiles|recoverable|kfs/i.test(`${mnt.source} ${mnt.type} ${name}`)) return 'Disk Drill';
  if (/fuse/i.test(mnt.type)) return 'Disco virtuale';
  if (!LOCAL_TYPES.has(mnt.type) && !/^\/dev\//.test(mnt.source)) return 'Disco virtuale';
  return null;
}

async function capacity(p) {
  try {
    const s = await fsp.statfs(p);
    return { total: s.blocks * s.bsize, free: s.bavail * s.bsize };
  } catch {
    return { total: 0, free: 0 };
  }
}

/** motivo per cui un disco esterno non si può pulire, o null (leggere e copiare si può comunque) */
async function whyNot(root, readOnly) {
  if ((await exists(path.join(root, 'Backups.backupdb'))) || (await exists(path.join(root, '.timemachine')))) {
    return 'Disco di backup Time Machine';
  }
  if (await exists(path.join(root, 'System', 'Library', 'CoreServices', 'SystemVersion.plist'))) {
    return 'Contiene un’installazione di macOS';
  }
  if (readOnly) return 'Disco di sola lettura';
  try {
    await fsp.access(root, fs.constants.W_OK);
  } catch {
    return 'Disco di sola lettura';
  }
  return null;
}

/**
 * Il disco di sistema (si analizza la cartella Inizio) + i dischi in /Volumes
 * + gli altri file system montati altrove (dischi virtuali come quelli di Disk Drill).
 * → [{ id, name, kind: 'system'|'external', root, total, free, readOnly, note?, disabled? }]
 *   disabled = non si può pulire; per leggere (partenza del trasferimento) va bene lo stesso.
 */
async function listDisks({ volumesDir = '/Volumes', home = os.homedir(), mounts } = {}) {
  let systemName = 'Macintosh HD';
  const others = [];
  const seen = new Set();
  if (!mounts) mounts = await readMounts();
  const mountAt = new Map(mounts.map((m) => [m.point, m]));

  const add = async (name, p) => {
    let real;
    try {
      real = await fsp.realpath(p);
    } catch {
      return;
    }
    if (real === '/') {
      systemName = name; // /Volumes/Macintosh HD → /
      return;
    }
    if (seen.has(real)) return;
    try {
      if (!(await fsp.stat(real)).isDirectory()) return;
    } catch {
      return;
    }
    const mnt = mountAt.get(p) || mountAt.get(real);
    const note = mountNote(mnt, name);
    const cap = await capacity(real);
    // i dischi virtuali spesso non dichiarano la capacità: si tengono lo stesso
    if (!cap.total && !mnt) return;
    seen.add(real);
    const readOnly = !!mnt?.readOnly;
    others.push({
      id: real,
      name,
      kind: 'external',
      root: real,
      ...cap,
      readOnly,
      note,
      disabled: await whyNot(real, readOnly),
    });
  };

  for (const e of await listDir(volumesDir)) {
    if (!e.name.startsWith('.')) await add(e.name, path.join(volumesDir, e.name));
  }
  for (const m of mounts) {
    if (m.point === '/' || SYSTEM_MOUNT.test(m.point) || m.point.startsWith(volumesDir + '/')) continue;
    if (m.type === 'devfs' || m.type === 'autofs' || m.type === 'nullfs') continue;
    await add(path.basename(m.point) || m.point, m.point);
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

module.exports = { listDisks, listFolders, cloudRoots, onDisk, capacity, inside, parseMount };
