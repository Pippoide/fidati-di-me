'use strict';
/**
 * Analisi ed eliminazione su UN SOLO disco. Nessuna dipendenza da Electron:
 * si prova con `npm test`.
 *
 * Tutto riceve un "contesto" che descrive il disco scelto:
 *   { kind: 'system'|'external', root, home, tmp, exclude: [], cloudRoots: [], dev, uid }
 *   - system:   root = cartella Inizio; si analizzano Inizio, ~/Library e le app
 *   - external: root = /Volumes/NomeDisco; si analizza tutto il disco
 *   - exclude:  cartelle che non vengono né analizzate né toccate
 *   - dev:      identificativo del disco: tutto ciò che sta su un altro disco viene ignorato
 */
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { execFile } = require('child_process');
const C = require('./categories.cjs');
const { inside } = require('./disks.cjs');

const MAX_ITEMS = 300; // voci elencate per gruppo (le più grandi)

/** spazio realmente occupato su disco (i file solo-cloud contano 0) */
const sizeOf = (st) => (st.blocks != null ? st.blocks * 512 : st.size);

async function listDir(dir) {
  try {
    return await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

/** p è escluso, o contiene una cartella esclusa */
const touchesExcluded = (p, exclude) => exclude.some((x) => inside(p, x) || inside(x, p));

/** dimensione ricorsiva: non segue i link, non esce dal disco, salta ciò che `skip` indica */
async function dirSize(root, { tick = () => {}, skip = () => false, dev = null } = {}) {
  let size = 0;
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop();
    const entries = await listDir(dir);
    await Promise.all(
      entries.map(async (e) => {
        const p = path.join(dir, e.name);
        if (skip(p)) return;
        if (e.isDirectory()) {
          if (dev != null) {
            try {
              if ((await fsp.lstat(p)).dev !== dev) return;
            } catch {
              return;
            }
          }
          stack.push(p);
        } else if (e.isFile()) {
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

const trashDir = (ctx) => (ctx.kind === 'system' ? path.join(ctx.home, '.Trash') : path.join(ctx.root, '.Trashes', String(ctx.uid)));

// ─────────────────────────────────────────────────────────────────────────────
// Analisi
// ─────────────────────────────────────────────────────────────────────────────
async function scan(ctx, { onProgress = () => {} } = {}) {
  const { home, tmp, exclude = [], cloudRoots = [], dev } = ctx;
  const groups = new Map(C.GROUPS.map((g) => [g.id, { ...g, size: 0, totalCount: 0, items: [] }]));
  const isExcluded = (p) => exclude.some((x) => inside(p, x));
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
  const sizeOpts = { tick, dev, skip: isExcluded };

  const add = (groupId, p, size, opts = {}) => {
    if (size == null || (size <= 0 && !opts.keepEmpty)) return;
    const g = groups.get(groupId);
    g.size += size;
    g.totalCount++;
    g.items.push({
      name: opts.name || path.basename(p),
      path: p,
      size,
      mode: opts.mode,
      note: opts.note,
      cloud: cloudRoots.some((c) => inside(p, c)) || undefined,
    });
    if (g.items.length > MAX_ITEMS * 2) {
      g.items.sort((a, b) => b.size - a.size);
      g.items.length = MAX_ITEMS;
    }
  };

  /** voce "pulibile": di una cartella si svuota il contenuto, la cartella resta */
  const addCleanable = async (groupId, p, name) => {
    if (touchesExcluded(p, exclude)) return;
    let st;
    try {
      st = await fsp.lstat(p);
    } catch {
      return;
    }
    if (st.isSymbolicLink() || st.dev !== dev) return;
    if (st.isDirectory()) add(groupId, p, await dirSize(p, sizeOpts), { name, mode: 'contents' });
    else add(groupId, p, sizeOf(st), { name, mode: 'rm' });
  };

  /** file personali: classificati per tipo, mai fuori dal disco né nelle cartelle escluse */
  const walk = async (start, skipTop = new Set()) => {
    const stack = [start];
    while (stack.length) {
      const dir = stack.pop();
      const entries = await listDir(dir);
      await Promise.all(
        entries.map(async (e) => {
          if (e.name.startsWith('.') || e.isSymbolicLink()) return;
          if (dir === start && skipTop.has(e.name)) return;
          const p = path.join(dir, e.name);
          if (isExcluded(p)) return;
          const extension = path.extname(e.name).toLowerCase();
          if (e.isDirectory()) {
            try {
              if ((await fsp.lstat(p)).dev !== dev) return; // un altro disco montato qui dentro
            } catch {
              return;
            }
            const where = path.relative(start, dir) || path.basename(start);
            if (C.ADOBE_CACHE_DIRS.has(e.name)) {
              await addCleanable('adobe', p, `Adobe ${e.name} · ${where}`);
            } else if (e.name === 'node_modules') {
              if (!touchesExcluded(p, exclude)) add('node-modules', p, await dirSize(p, sizeOpts), { name: where, mode: 'rm' });
            } else if (C.PACKAGE_GROUP[extension]) {
              if (!touchesExcluded(p, exclude)) add(C.PACKAGE_GROUP[extension], p, await dirSize(p, sizeOpts), { mode: 'trash' });
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
  };

  /** cestino di questo disco soltanto */
  const addTrash = async (name) => {
    const t = trashDir(ctx);
    if (isExcluded(t)) return;
    try {
      const entries = await fsp.readdir(t);
      if (entries.length) add('trash', t, await dirSize(t, sizeOpts), { name, mode: 'emptyTrash' });
    } catch (err) {
      if (err.code === 'EPERM' || err.code === 'EACCES') {
        add('trash', t, 0, { name, mode: 'emptyTrash', keepEmpty: true, note: 'Dimensione non leggibile senza “Accesso completo al disco”' });
      }
    }
  };

  if (ctx.kind === 'external') {
    await addTrash('Cestino di questo disco');
    await walk(ctx.root, C.VOLUME_SYSTEM_TOP);
  } else {
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

    // 5 ── Cestino
    await addTrash('Cestino');

    // 6 ── Backup iOS
    const backups = lib('Application Support', 'MobileSync', 'Backup');
    for (const e of await listDir(backups)) {
      const p = path.join(backups, e.name);
      if (touchesExcluded(p, exclude)) continue;
      add('ios-backups', p, await dirSize(p, sizeOpts), { name: `Backup ${e.name.slice(0, 12)}…`, mode: 'rm' });
    }

    // 7 ── File personali: Inizio (tranne Library) + cartelle cloud incluse che stanno in Library
    await walk(home, new Set(['Library', 'Applications']));
    for (const c of cloudRoots) {
      if (inside(c, lib()) && !isExcluded(c)) await walk(c);
    }

    // 8 ── Protetti, solo in lettura (le cartelle cloud sono già contate sopra)
    const skipProtected = (p) => isExcluded(p) || cloudRoots.some((c) => inside(p, c));
    for (const e of await listDir(lib())) {
      if (e.name === 'Caches' || e.name === 'Logs' || e.name.startsWith('.') || !e.isDirectory()) continue;
      if (skipProtected(lib(e.name))) continue;
      add('app-data', lib(e.name), await dirSize(lib(e.name), { ...sizeOpts, skip: skipProtected }), { name: `Library/${e.name}` });
    }
    for (const appsDir of ['/Applications', path.join(home, 'Applications')]) {
      for (const e of await listDir(appsDir)) {
        if (e.name.startsWith('.') || !e.isDirectory()) continue;
        const p = path.join(appsDir, e.name);
        if (isExcluded(p)) continue;
        add('applications', p, await dirSize(p, { tick, skip: isExcluded }), { name: e.name.replace(/\.app$/, '') });
      }
    }
    for (const p of ['/System', '/Library', '/usr', '/bin', '/sbin', '/private']) {
      if (fs.existsSync(p)) add('system', p, 0, { keepEmpty: true, note: 'Protetto da macOS, non analizzato' });
    }
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
function assertDeletable(p, ctx, mode) {
  const r = path.resolve(p);
  if (!path.isAbsolute(p) || r !== p) throw new Error('Percorso non valido');
  if (touchesExcluded(r, ctx.exclude || [])) throw new Error('Cartella esclusa nelle impostazioni');
  const base = path.basename(r);

  if (ctx.kind === 'external') {
    if (!inside(r, ctx.root) || r === ctx.root) throw new Error('Fuori dal disco selezionato');
    const top = path.relative(ctx.root, r).split(path.sep)[0];
    if (top.startsWith('.') || C.VOLUME_SYSTEM_TOP.has(top)) throw new Error('Cartella di sistema del disco: protetta');
    if (mode === 'rm' && base !== 'node_modules') throw new Error('Operazione non ammessa');
    if (mode === 'contents' && !C.ADOBE_CACHE_DIRS.has(base)) throw new Error('Operazione non ammessa');
    return;
  }

  if (ctx.tmp && r.startsWith(ctx.tmp + path.sep)) {
    if (/^Photoshop Temp/i.test(base) && path.dirname(r) === ctx.tmp) return;
    throw new Error('File temporaneo non ammesso');
  }
  if (!inside(r, ctx.home) || r === ctx.home) throw new Error('Fuori dalla cartella utente: protetto');

  const cloud = (ctx.cloudRoots || []).find((c) => inside(r, c));
  if (cloud) {
    if (r === cloud) throw new Error('Cartella sincronizzata: protetta');
    if (mode === 'trash' || (mode === 'rm' && base === 'node_modules') || (mode === 'contents' && C.ADOBE_CACHE_DIRS.has(base))) return;
    throw new Error('Operazione non ammessa');
  }

  const rel = path.relative(ctx.home, r).split(path.sep).join('/');
  if (HOME_FORBIDDEN.includes(rel)) throw new Error('Cartella principale: protetta');
  if (rel === 'Library' || rel.startsWith('Library/')) {
    const inner = rel.slice('Library/'.length);
    const ok = LIBRARY_ALLOWED.some(([prefix, self]) => inner.startsWith(prefix + '/') || (self && inner === prefix));
    if (!ok) throw new Error('Dati di sistema o delle app: protetti');
  } else if (mode === 'contents' && !C.ADOBE_CACHE_DIRS.has(base) && !rel.startsWith('.')) {
    throw new Error('Operazione non ammessa');
  }
}

/** svuota una cartella lasciandola al suo posto */
async function clearContents(dir, size) {
  let failed = 0;
  for (const e of await fsp.readdir(dir)) {
    try {
      await fsp.rm(path.join(dir, e), { recursive: true, force: true });
    } catch {
      failed++;
    }
  }
  const left = failed ? await dirSize(dir) : 0;
  return { ok: true, freed: Math.max(0, size - left), error: failed ? `${failed} elementi in uso o protetti, saltati` : undefined };
}

/**
 * Elimina una voce del registro, solo se sta sul disco del contesto.
 * Ritorna { ok, freed, trashed?, error? }. trash(path) sposta nel Cestino (in Electron: shell.trashItem).
 */
async function removeItem(rec, ctx, { trash } = {}) {
  try {
    if (!rec || rec.level === 'protected' || !rec.mode) throw new Error('Elemento protetto');
    if (rec.mode === 'emptyTrash') {
      if (rec.path !== trashDir(ctx)) throw new Error('Percorso non valido');
      if (touchesExcluded(rec.path, ctx.exclude || [])) throw new Error('Cartella esclusa nelle impostazioni');
      return await clearContents(rec.path, rec.size);
    }
    assertDeletable(rec.path, ctx, rec.mode);
    if ((await fsp.lstat(rec.path)).dev !== ctx.dev) throw new Error('Non si trova sul disco selezionato');
    if (rec.mode === 'trash') {
      await trash(rec.path);
      return { ok: true, freed: 0, trashed: rec.size };
    }
    if (rec.mode === 'rm') {
      await fsp.rm(rec.path, { recursive: true, force: true });
      return { ok: true, freed: rec.size };
    }
    if (rec.mode === 'contents') return await clearContents(rec.path, rec.size);
    throw new Error('Modalità sconosciuta');
  } catch (err) {
    if (err.code === 'ENOENT') return { ok: false, freed: 0, error: 'Non esiste più: rifai l’analisi' };
    if (err.code === 'EPERM' || err.code === 'EACCES') return { ok: false, freed: 0, error: 'Permesso negato da macOS' };
    return { ok: false, freed: 0, error: err.message };
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

module.exports = { scan, removeItem, assertDeletable, runningAdobeApps, dirSize, trashDir };
