'use strict';
/**
 * "Riorganizza": riconosce i file di progetto (soprattutto Adobe) e li sposta in
 *   <Clienti>/<Cliente>/<AAAA-MM_Progetto>/00_Brief, 01_Asset/…, 02_Lavorazione, 03_Export/…, 99_Archivio
 *
 * Nessuna dipendenza da Electron: si prova con `npm test`.
 *
 * Flusso:
 *   1. analyze()      legge le cartelle, trova i collegamenti (InDesign, Illustrator,
 *                     After Effects, Premiere), raggruppa i file in progetti e dà a ogni
 *                     progetto un punteggio di sicurezza (0–100).
 *   2. materialize()  calcola dove va ogni file con il cliente e il progetto scelti
 *                     (anche modificati a mano nell'anteprima).
 *   3. apply()        sposta i file, registrando ogni spostamento nel Journal PRIMA di farlo.
 *
 * Regole "mista": i file collegati restano accanto al file che li usa, nella stessa
 * disposizione, dentro 02_Lavorazione/<nome>/. Le cartelle pacchetto (Links, Document fonts,
 * (Footage)) si spostano intere senza toccarne il contenuto. Se un gruppo con collegamenti
 * viene rinominato o spostato, accanto c'è un .txt con vecchi e nuovi nomi per ricollegarli.
 */
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const zlib = require('zlib');
const R = require('./organizer-rules.cjs');
const { inside } = require('./disks.cjs');
const { removeIfEmpty } = require('./journal.cjs');

const MAX_FILES = 30000; // oltre, l'analisi si ferma e lo dice
const MAX_LINK_READ = 400 * 1024 * 1024; // byte letti al massimo da ogni file con collegamenti
const LINKS_TXT = 'Fidati - collegamenti e nomi cambiati.txt';

// ─────────────────────────────────────────────────────────────────────────────
// Nomi e parole
// ─────────────────────────────────────────────────────────────────────────────
const nfc = (s) => s.normalize('NFC');
const plain = (s) => nfc(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** "Bivio_Totebag v3 (def).ai" → ['Bivio','Totebag','v3','def'] */
const pieces = (stem) =>
  nfc(stem)
    .split(/[\s_\-.()[\],+&]+/)
    .filter(Boolean);

const VERSION_RE = /^(?:v|ver|rev|r)(\d{1,3})$/i;
const isDateish = (t) => /^\d{4,8}$/.test(t) || /^\d{1,2}$/.test(t);

/** parole significative per riconoscere cliente e progetto */
const keyTokens = (text) =>
  pieces(text)
    .map(plain)
    .filter((t) => t.length >= 2 && !isDateish(t) && !VERSION_RE.test(t) && !R.NOISE.has(t) && !/^\d+$/.test(t));

/** tutte le parole, comprese quelle "di servizio" (def, stampa…), per decidere la sottocartella */
const allTokens = (text) => pieces(text).map(plain);

const isGenericDir = (name) => {
  const p = plain(name).replace(/^\d{2}[_\s-]+/, ''); // "02_Lavorazione" → "lavorazione"
  return R.GENERIC_DIRS.has(p) || R.GENERIC_DIRS.has(p.replace(/[_-]+/g, ' ')) || keyTokens(name).length === 0;
};

/** nome di cartella o file sicuro: niente / : \ e niente nomi nascosti */
function safeName(s) {
  const out = nfc(String(s || ''))
    .replace(/[/:\\\u0000-\u001f]+/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '')
    .slice(0, 80)
    .trim();
  return out === '.' || out === '..' ? '' : out;
}
const slug = (s) => safeName(s).replace(/\s+/g, '_');
const capital = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);

/** "Restyling sito" ⇄ "2026-11_Restyling_sito": stesse parole? */
const sameWords = (a, b) => {
  const x = keyTokens(a.replace(/^\d{4}(-\d{2})?[_\s-]+/, ''));
  const y = keyTokens(b.replace(/^\d{4}(-\d{2})?[_\s-]+/, ''));
  return x.length > 0 && x.length === y.length && x.every((t, i) => t === y[i]);
};

function versionOf(stem) {
  let ver = 0;
  let final = false;
  for (const p of pieces(stem)) {
    const m = p.match(VERSION_RE);
    if (m) ver = Math.max(ver, Number(m[1]));
    if (R.WORDS.final.has(plain(p))) final = true;
  }
  return { ver, final };
}

/** parti del nome che restano dopo aver tolto cliente, progetto e versione */
const descrPieces = (stem, drop) =>
  pieces(stem).filter((p) => {
    const t = plain(p);
    return !drop.has(t) && !VERSION_RE.test(p) && !R.WORDS.final.has(t) && !R.WORDS.old.has(t);
  });

// ─────────────────────────────────────────────────────────────────────────────
// Lettura delle cartelle
// ─────────────────────────────────────────────────────────────────────────────
async function listDir(dir) {
  try {
    return await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

/**
 * Raccoglie i file delle cartelle da riordinare.
 * → { files:[{path,name,ext,size,mtimeMs,ino,source}], packages:[{path,size,mtimeMs,ino,files,source}], skipped, truncated }
 */
async function collect({ sources, destRoot, exclude = [], dev, skipTop = new Set(), isAllowed = () => true }) {
  const files = [];
  const packages = [];
  let skipped = 0;
  let truncated = false;
  const excluded = (p) => exclude.some((x) => inside(p, x)) || (destRoot && inside(p, destRoot));

  const sizeOfTree = async (dir) => {
    let size = 0;
    let count = 0;
    let latest = 0;
    const stack = [dir];
    while (stack.length) {
      const d = stack.pop();
      for (const e of await listDir(d)) {
        const p = path.join(d, e.name);
        if (e.isSymbolicLink()) continue;
        if (e.isDirectory()) stack.push(p);
        else if (e.isFile()) {
          try {
            const st = await fsp.lstat(p);
            size += st.size;
            count++;
            latest = Math.max(latest, st.mtimeMs);
          } catch {}
        }
      }
    }
    return { size, count, latest };
  };

  for (const source of sources) {
    const stack = [source];
    while (stack.length) {
      if (files.length >= MAX_FILES) {
        truncated = true;
        break;
      }
      const dir = stack.pop();
      const entries = await listDir(dir);
      const names = new Set(entries.map((e) => e.name));
      if (dir !== source && R.SKIP_DIR_MARKERS.some((m) => names.has(m))) {
        skipped++;
        continue; // progetto di codice: non si tocca
      }
      // cartella pacchetto: un file di lavoro + Links / Document fonts / (Footage)
      if (dir !== source) {
        // solo un pacchetto "puro": dentro ci sono soltanto il file di lavoro, le sue cartelle
        // (Links, Document fonts, (Footage)) e i file che il pacchetto crea (pdf, idml, istruzioni)
        const visible = entries.filter((e) => !e.name.startsWith('.'));
        const hasWork = visible.some((e) => e.isFile() && R.LINKERS.has(path.extname(e.name).toLowerCase()));
        const hasPkgDir = visible.some((e) => e.isDirectory() && R.PACKAGE_SUBDIR_RE.test(e.name));
        const pure = visible.every((e) =>
          e.isDirectory()
            ? R.PACKAGE_SUBDIR_RE.test(e.name)
            : R.LINKERS.has(path.extname(e.name).toLowerCase()) || /\.(idml|pdf|txt|rtf)$/i.test(e.name),
        );
        if (hasWork && hasPkgDir && pure) {
          try {
            const st = await fsp.lstat(dir);
            const t = await sizeOfTree(dir);
            packages.push({
              path: dir,
              size: t.size,
              mtimeMs: t.latest || st.mtimeMs,
              ino: st.ino,
              count: t.count,
              source,
              linkers: entries.filter((e) => e.isFile() && R.LINKERS.has(path.extname(e.name).toLowerCase())).map((e) => e.name),
            });
          } catch {}
          continue;
        }
      }
      for (const e of entries) {
        if (e.name.startsWith('.') || e.isSymbolicLink()) continue;
        if (dir === source && skipTop.has(e.name)) continue;
        const p = path.join(dir, e.name);
        if (excluded(p) || !isAllowed(p)) continue;
        const ext = path.extname(e.name).toLowerCase();
        if (e.isDirectory()) {
          if (R.SKIP_DIR_EXT.has(ext) || (R.PACKAGE_SUBDIR_RE.test(e.name) && dir === source)) {
            skipped++;
            continue;
          }
          try {
            if (dev != null && (await fsp.lstat(p)).dev !== dev) continue; // altro disco montato qui dentro
          } catch {
            continue;
          }
          stack.push(p);
        } else if (e.isFile()) {
          if (R.IGNORE_EXT.has(ext) || /^icon\r?$/i.test(e.name)) continue;
          try {
            const st = await fsp.lstat(p);
            files.push({ path: p, name: nfc(e.name), ext, size: st.size, mtimeMs: st.mtimeMs, ino: st.ino, source });
          } catch {}
        }
      }
    }
  }
  return { files, packages, skipped, truncated };
}

// ─────────────────────────────────────────────────────────────────────────────
// Collegamenti: quali file usa un .indd / .ai / .aep / .prproj
// ─────────────────────────────────────────────────────────────────────────────

/** forme del nome come compaiono nei byte (UTF-8 letto come latin1), minuscole */
const byteForms = (name) => {
  const out = new Set();
  for (const form of [name.normalize('NFC'), name.normalize('NFD')]) out.add(Buffer.from(form, 'utf8').toString('latin1').toLowerCase());
  return out;
};

/**
 * Nomi di file (fra quelli in `known`) citati dentro `file`.
 * known: Map(forma minuscola → nome). Legge al massimo MAX_LINK_READ byte.
 */
async function linkedNames(file, ext, known, extList) {
  const found = new Set();
  if (!known.size || !extList.length) return found;
  const re = new RegExp(
    `[^\\x00-\\x1f/\\\\:"<>|*?]{1,200}\\.(?:${extList.map((e) => e.slice(1).replace(/[^a-z0-9]/g, '')).join('|')})(?![a-z0-9])`,
    'gi',
  );
  const check = (cand) => {
    const tries = [cand];
    if (cand.includes('%')) {
      try {
        tries.push(Buffer.from(decodeURIComponent(cand), 'utf8').toString('latin1'));
      } catch {}
    }
    for (const t of tries) {
      const low = t.toLowerCase();
      if (known.has(low)) found.add(known.get(low));
      // "Link foto 1.jpg" → prova anche "foto 1.jpg", "1.jpg"
      for (let i = low.indexOf(' '); i !== -1; i = low.indexOf(' ', i + 1)) {
        const tail = low.slice(i + 1);
        if (known.has(tail)) found.add(known.get(tail));
      }
    }
  };
  const scanText = (s) => {
    for (const m of s.matchAll(re)) check(m[0]);
  };

  await new Promise((resolve) => {
    let read = 0;
    let carry = '';
    const raw = fs.createReadStream(file, { highWaterMark: 4 * 1024 * 1024 });
    const stream = ext === '.prproj' ? raw.pipe(zlib.createGunzip()) : raw;
    const finish = () => {
      raw.destroy();
      resolve();
    };
    stream.on('data', (chunk) => {
      read += chunk.length;
      const s = carry + chunk.toString('latin1');
      scanText(s);
      scanText(s.replace(/\x00/g, '')); // testo UTF-16 (InDesign)
      carry = s.slice(-600);
      if (read > MAX_LINK_READ) finish();
    });
    stream.on('end', finish);
    stream.on('error', finish);
    raw.on('error', finish);
  });
  return found;
}

const commonDir = (paths) => {
  let parts = path.dirname(paths[0]).split(path.sep);
  for (const p of paths.slice(1)) {
    const q = path.dirname(p).split(path.sep);
    let i = 0;
    while (i < parts.length && i < q.length && parts[i] === q[i]) i++;
    parts = parts.slice(0, i);
  }
  return parts.join(path.sep) || path.sep;
};
const sharedPrefix = (a, b) => {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return i;
};

/** gruppi "file di lavoro + file collegati". → [{ main, files:[file] }] */
async function findLinkGroups(files, onProgress = () => {}) {
  const byName = new Map(); // nome minuscolo → [file]
  const known = new Map(); // forma nei byte → nome minuscolo
  for (const f of files) {
    if (path.basename(f.name, f.ext).length < 3) continue; // "1.jpg" darebbe falsi collegamenti
    const low = f.name.toLowerCase();
    if (!byName.has(low)) byName.set(low, []);
    byName.get(low).push(f);
    for (const form of byteForms(f.name)) known.set(form, low);
  }
  const extList = [...new Set(files.map((f) => f.ext).filter(Boolean))];
  const linkers = files.filter((f) => R.LINKERS.has(f.ext));

  // unione dei gruppi
  const parent = new Map();
  const find = (x) => {
    while (parent.get(x) !== x) x = parent.get(x);
    return x;
  };
  const union = (a, b) => {
    if (!parent.has(a)) parent.set(a, a);
    if (!parent.has(b)) parent.set(b, b);
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(rb, ra);
  };
  const owner = new Map(); // file collegato → file di lavoro più vicino (un asset sta in un solo gruppo)
  const refs = new Map(); // file di lavoro → [file collegati] (anche quelli finiti in un altro gruppo)

  let i = 0;
  for (const l of linkers) {
    onProgress({ phase: 'links', done: ++i, total: linkers.length, current: l.path });
    const names = await linkedNames(l.path, l.ext, known, extList);
    const linked = [];
    for (const low of names) {
      const cands = (byName.get(low) || []).filter((f) => f !== l);
      if (!cands.length) continue;
      const lp = l.path.split(path.sep);
      cands.sort((a, b) => sharedPrefix(b.path.split(path.sep), lp) - sharedPrefix(a.path.split(path.sep), lp));
      linked.push(cands[0]);
    }
    refs.set(l, linked);
    if (!parent.has(l)) parent.set(l, l);
    for (const f of linked) {
      const prev = owner.get(f);
      const lp = l.path.split(path.sep);
      if (!prev || sharedPrefix(f.path.split(path.sep), lp) > sharedPrefix(f.path.split(path.sep), prev.path.split(path.sep)))
        owner.set(f, l);
    }
  }
  for (const [f, l] of owner) union(l, f);

  const groups = new Map();
  for (const x of parent.keys()) {
    const r = find(x);
    if (!groups.has(r)) groups.set(r, new Set());
    groups.get(r).add(x);
  }
  const out = [];
  for (const members of groups.values()) {
    if (members.size < 2) continue;
    const list = [...members];
    const mains = list.filter((f) => R.LINKERS.has(f.ext));
    mains.sort((a, b) => (refs.get(b)?.length || 0) - (refs.get(a)?.length || 0));
    out.push({ main: mains[0], files: list, refs: list.flatMap((f) => (refs.get(f) || []).map((t) => [f, t])) });
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Dove va un file dentro il progetto
// ─────────────────────────────────────────────────────────────────────────────
function subfolderFor(file, { innerDirs = [], workStems = new Set(), mediaWorkStems = new Set(), hasLayout = false }) {
  const ext = file.ext;
  const stem = path.basename(file.name, ext);
  const tokens = new Set([...allTokens(stem), ...innerDirs.flatMap(allTokens)]);
  const has = (w) => [...tokens].some((t) => w.has(t));
  const inner = innerDirs.map((d) => plain(d).replace(/^\d{2}[_\s-]+/, ''));
  const innerHas = (w) => inner.some((d) => w.has(d) || d.split(/[\s_-]+/).some((t) => w.has(t)));
  const base = keyTokens(stem).join(' ');

  if (has(R.WORDS.old) && !R.EXT.fonts.has(ext)) return 'archive';
  if (R.EXT.work.has(ext)) return 'work';
  if (R.EXT.fonts.has(ext)) return 'fonts';
  if (R.EXT.archives.has(ext)) return 'archive';
  if (R.EXT.docs.has(ext)) return 'brief';
  if (R.EXT.vector.has(ext)) return 'logos';
  if (R.EXT.pdf.has(ext)) {
    if (has(R.WORDS.brief) || innerHas(R.WORDS.brief)) return 'brief';
    if (has(R.WORDS.print) || innerHas(R.WORDS.print)) return 'print';
    if (has(R.WORDS.export) || innerHas(R.WORDS.export)) return 'digital';
    return hasLayout ? 'print' : 'digital';
  }
  if (R.EXT.images.has(ext)) {
    if (has(R.WORDS.logo) || innerHas(R.WORDS.logo)) return 'logos';
    if ((has(R.WORDS.print) || innerHas(R.WORDS.print)) && /^\.tiff?$/.test(ext)) return 'print';
    if (has(R.WORDS.export) || innerHas(R.WORDS.export) || (base && workStems.has(base))) return 'digital';
    if (has(R.WORDS.brief) || innerHas(R.WORDS.brief)) return 'brief';
    return 'images';
  }
  if (R.EXT.media.has(ext)) {
    if (has(R.WORDS.export) || innerHas(R.WORDS.export) || (base && mediaWorkStems.has(base))) return 'digital';
    return 'media';
  }
  return null; // tipo sconosciuto → "Da smistare"
}

// ─────────────────────────────────────────────────────────────────────────────
// Analisi
// ─────────────────────────────────────────────────────────────────────────────

/** clienti e progetti già presenti nella cartella di destinazione */
async function readExisting(destRoot) {
  const clients = [];
  for (const e of await listDir(destRoot)) {
    if (!e.isDirectory() || e.name.startsWith('.')) continue;
    const projects = (await listDir(path.join(destRoot, e.name)))
      .filter((p) => p.isDirectory() && !p.name.startsWith('.'))
      .map((p) => nfc(p.name));
    clients.push({ name: nfc(e.name), tokens: keyTokens(e.name), projects });
  }
  return clients;
}

const ym = (ms) => {
  const d = new Date(ms || Date.now());
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

/**
 * Analizza le cartelle e propone i progetti.
 * opts: { sources:[dir], destRoot, exclude, dev, skipTop, isAllowed, onProgress }
 * → { clusters:[…], stats }
 */
async function analyze(opts) {
  const onProgress = opts.onProgress || (() => {});
  onProgress({ phase: 'scan', done: 0, total: 0, current: opts.sources[0] });
  const { files, packages, skipped, truncated } = await collect(opts);
  const existing = await readExisting(opts.destRoot);

  const linkGroups = await findLinkGroups(files, onProgress);
  const inGroup = new Map(); // file → gruppo
  for (const g of linkGroups) for (const f of g.files) inGroup.set(f, g);

  // ── unità: pacchetto, gruppo collegato o file singolo ──
  const units = [];
  for (const p of packages) {
    units.push({
      kind: 'package',
      dir: path.dirname(p.path),
      source: p.source,
      name: path.basename(p.path).replace(/\s+(folder|cartella)$/i, ''),
      pkg: p,
      files: [],
      mtimeMs: p.mtimeMs,
    });
  }
  for (const g of linkGroups) {
    const all = g.files.map((f) => f.path);
    units.push({
      kind: 'linked',
      dir: commonDir(all),
      source: g.main.source,
      name: path.basename(g.main.name, g.main.ext),
      group: g,
      files: g.files,
      mtimeMs: Math.min(...g.files.map((f) => f.mtimeMs)),
    });
  }
  for (const f of files) {
    if (inGroup.has(f)) continue;
    units.push({
      kind: 'file',
      dir: path.dirname(f.path),
      source: f.source,
      name: path.basename(f.name, f.ext),
      files: [f],
      mtimeMs: f.mtimeMs,
    });
  }

  // ── cartella di progetto di ogni unità: la più profonda con un nome "vero" ──
  for (const u of units) {
    const rel = path.relative(u.source, u.dir);
    const chain = rel && !rel.startsWith('..') ? rel.split(path.sep) : [];
    u.chain = chain;
    let idx = -1;
    for (let i = chain.length - 1; i >= 0; i--) {
      if (!isGenericDir(chain[i])) {
        idx = i;
        break;
      }
    }
    u.projectDir = idx >= 0 ? path.join(u.source, ...chain.slice(0, idx + 1)) : null;
    u.projectDirName = idx >= 0 ? nfc(chain[idx]) : null;
    u.clientDirName = null;
    for (let i = idx - 1; i >= 0; i--) {
      if (!isGenericDir(chain[i])) {
        u.clientDirName = nfc(chain[i]);
        break;
      }
    }
    if (u.kind === 'package' && !u.projectDir) {
      u.projectDirName = u.name; // pacchetto direttamente nella cartella: il progetto è il pacchetto
    }
    const kt = keyTokens(u.name);
    u.nameKey = kt.length >= 2 ? kt.slice(0, 2).join(' ') : kt.length === 1 && kt[0].length >= 3 ? kt[0] : null;
  }

  // ── raggruppamento in progetti ──
  const clusters = new Map();
  const byFolderKey = new Map(); // parole della cartella → cluster (per agganciare file sparsi con lo stesso nome)
  let anon = 0;
  for (const u of units.filter((x) => x.projectDir)) {
    const key = 'dir:' + u.projectDir;
    if (!clusters.has(key)) {
      const c = {
        key,
        units: [],
        projectDir: u.projectDir,
        projectDirName: u.projectDirName,
        clientDirName: u.clientDirName,
        source: u.source,
      };
      clusters.set(key, c);
      const fk = keyTokens(u.projectDirName);
      if (fk.length) byFolderKey.set(fk.slice(0, 2).join(' '), c);
    }
    clusters.get(key).units.push(u);
  }
  for (const u of units.filter((x) => !x.projectDir)) {
    let c = u.nameKey && byFolderKey.get(u.nameKey);
    if (!c) {
      const key = u.nameKey ? 'name:' + u.nameKey : 'solo:' + ++anon;
      if (!clusters.has(key))
        clusters.set(key, {
          key,
          units: [],
          nameKey: u.nameKey,
          source: u.source,
          projectDirName: u.kind === 'package' ? u.projectDirName : null,
        });
      c = clusters.get(key);
    }
    c.units.push(u);
  }

  // ── nomi proposti e punteggio ──
  const out = [];
  let cid = 0;
  for (const c of clusters.values()) {
    const unitNames = c.units.map((u) => u.name);
    const chainTokens = new Set([
      ...(c.projectDirName ? keyTokens(c.projectDirName) : []),
      ...(c.clientDirName ? keyTokens(c.clientDirName) : []),
    ]);
    const nameTokenCount = new Map();
    for (const n of unitNames) for (const t of new Set(keyTokens(n))) nameTokenCount.set(t, (nameTokenCount.get(t) || 0) + 1);
    const majority = new Set([...nameTokenCount].filter(([, n]) => n >= Math.max(1, Math.ceil(c.units.length / 2))).map(([t]) => t));
    const reasons = [];
    let score = 0;

    // cliente già presente nella cartella Clienti?
    // completo: tutte le parole del cliente; parziale: almeno metà, con una parola lunga (es. "arianne" per "Arianne e Bea")
    let match = null;
    let partial = false;
    for (const cl of existing) {
      if (!cl.tokens.length) continue;
      const pool = (t) => chainTokens.has(t) || majority.has(t);
      const hits = cl.tokens.filter(pool);
      const full = cl.tokens.every((t) => chainTokens.has(t)) || cl.tokens.every((t) => majority.has(t));
      const half = hits.length * 2 >= cl.tokens.length && hits.some((t) => t.length >= 4);
      if (!full && !half) continue;
      const better = !match || (full && partial) || (full === !partial && hits.length > match.hits);
      if (better) {
        match = { ...cl, hits: hits.length };
        partial = !full;
      }
    }

    const first = c.units[0];
    const firstPieces = pieces(first.name).filter((p) => keyTokens(p).length);
    let client = null;
    let project = null;
    let clientHow = null;
    if (c.projectDirName) {
      project = c.projectDirName;
      if (c.clientDirName) {
        client = c.clientDirName;
        clientHow = 'parent';
      } else if (/[_]|\s-\s/.test(c.projectDirName)) {
        const [a, ...rest] = c.projectDirName.split(/_|\s-\s/);
        if (rest.length && keyTokens(a).length) {
          client = a.trim();
          project = rest.join(' ').trim();
          clientHow = 'split';
        }
      }
    } else if (c.nameKey) {
      // file sparsi "cliente_progetto_…": le prime due parole significative
      const keyPieces = firstPieces.filter((p) => c.nameKey.split(' ').includes(plain(p)));
      if (keyPieces.length >= 2) {
        client = capital(keyPieces[0]);
        project = capital(keyPieces[1]);
        clientHow = 'split';
      } else if (keyPieces.length) {
        project = capital(keyPieces[0]);
      }
    }
    if (match) {
      const matchTok = new Set(match.tokens);
      const notClient = (list) => list.filter((p) => keyTokens(p).length && !keyTokens(p).every((t) => matchTok.has(t)));
      if (!project || keyTokens(project).every((t) => matchTok.has(t))) {
        // la cartella (o il nome) è il cliente stesso: il progetto lo dicono le parole più frequenti dei file
        const freq = new Map();
        for (const n of unitNames) for (const p of new Set(notClient(pieces(n)))) freq.set(capital(p), (freq.get(capital(p)) || 0) + 1);
        const top = [...freq].filter(([, n]) => n >= Math.max(1, Math.ceil(c.units.length / 2))).sort((a, b) => b[1] - a[1]);
        project = top.length
          ? top
              .slice(0, 2)
              .map(([p]) => p)
              .join(' ')
          : null;
      } else if (!c.projectDirName) {
        const rest = notClient(firstPieces.filter((p) => !c.nameKey || c.nameKey.split(' ').includes(plain(p))));
        if (rest.length) project = capital(rest[0]);
      }
      client = match.name;
      clientHow = 'existing';
    }

    if (c.units.some((u) => u.kind === 'package')) {
      score += 45;
      reasons.push('Cartella pacchetto (Links / Document fonts)');
    } else if (c.units.some((u) => u.kind === 'linked')) {
      score += 35;
      reasons.push('File collegati fra loro (InDesign, Illustrator, After Effects, Premiere)');
    }
    if (c.key.startsWith('dir:')) {
      score += 40;
      reasons.push(`Cartella di progetto “${c.projectDirName}”`);
    } else if (c.units.length >= 2 && c.nameKey) {
      score += 20;
      reasons.push('Nomi dei file simili');
    }
    if (clientHow === 'existing') {
      score += partial ? 25 : 35;
      reasons.push(`Cliente già presente: “${client}”`);
    } else if (clientHow === 'parent') {
      score += 20;
      reasons.push(`Cliente dalla cartella “${client}”`);
    } else if (clientHow === 'split') {
      score += 15;
      reasons.push('Cliente dedotto dal nome');
    }
    if (!c.key.startsWith('dir:') && keyTokens(first.name).length >= 2) score += 20;
    const clientEntry = existing.find((e) => e.name === client);
    if (clientEntry && project && clientEntry.projects.some((p) => sameWords(p, project))) {
      score += 15;
      reasons.push('Progetto già presente');
    }
    if (c.units.length >= 3) score += 10;
    if (!client) {
      score = Math.min(score, 50);
      reasons.push('Cliente non riconosciuto');
    }
    if (!project) {
      score = Math.min(score, 50);
      reasons.push('Progetto non riconosciuto');
    }
    score = Math.min(100, score);

    // ── voci (file e pacchetti) con la sottocartella ──
    const items = [];
    const groupRefs = {};
    const allFiles = c.units.flatMap((u) => u.files);
    const workStems = new Set(allFiles.filter((f) => R.EXT.work.has(f.ext)).map((f) => keyTokens(path.basename(f.name, f.ext)).join(' ')));
    const mediaWorkStems = new Set(
      allFiles.filter((f) => /^\.(aep|aet|prproj)$/.test(f.ext)).map((f) => keyTokens(path.basename(f.name, f.ext)).join(' ')),
    );
    const hasLayout = allFiles.some((f) => /^\.(indd|idml|ai)$/.test(f.ext)) || c.units.some((u) => u.kind === 'package');
    const loose = [];
    const minTime = Math.min(...c.units.map((u) => u.mtimeMs || Date.now()));
    for (const u of c.units) {
      if (u.kind === 'package') {
        items.push({
          kind: 'dir',
          from: u.pkg.path,
          size: u.pkg.size,
          ino: u.pkg.ino,
          count: u.pkg.count,
          sub: 'work',
          name: nfc(path.basename(u.pkg.path)),
        });
      } else if (u.kind === 'linked') {
        const g = u.group;
        const base = commonDir(g.files.map((f) => f.path));
        const gid = `g${items.length}`;
        for (const f of g.files) {
          items.push({
            kind: 'file',
            from: f.path,
            size: f.size,
            ino: f.ino,
            mtimeMs: f.mtimeMs,
            name: f.name,
            ext: f.ext,
            sub: 'work',
            group: gid,
            groupName: u.name,
            rel: path.relative(base, path.dirname(f.path)),
            main: f === g.main,
          });
        }
        groupRefs[gid] = g.refs.map(([a, b]) => [a.path, b.path]);
      } else {
        const f = u.files[0];
        const innerBase = c.projectDir || u.source;
        const innerRel = path.relative(innerBase, path.dirname(f.path));
        const innerDirs = innerRel && !innerRel.startsWith('..') ? innerRel.split(path.sep) : [];
        const sub = subfolderFor(f, { innerDirs, workStems, mediaWorkStems, hasLayout });
        const it = { kind: 'file', from: f.path, size: f.size, ino: f.ino, mtimeMs: f.mtimeMs, name: f.name, ext: f.ext, sub };
        items.push(it);
        loose.push(it);
      }
    }
    // versioni vecchie dei file di lavoro → 99_Archivio
    const versions = new Map();
    for (const it of [...loose.filter((x) => x.sub === 'work'), ...items.filter((x) => x.group && x.main)]) {
      const k = keyTokens(path.basename(it.name, it.ext)).join(' ') + it.ext;
      if (!versions.has(k)) versions.set(k, []);
      versions.get(k).push(it);
    }
    for (const list of versions.values()) {
      if (list.length < 2) continue;
      const rank = (it) => {
        const v = versionOf(path.basename(it.name, it.ext));
        return [v.final ? 1 : 0, v.ver, it.mtimeMs];
      };
      list.sort((a, b) => {
        const x = rank(a);
        const y = rank(b);
        return y[0] - x[0] || y[1] - x[1] || y[2] - x[2];
      });
      for (const old of list.slice(1)) if (!old.group) old.sub = 'archive'; // un gruppo collegato resta intero
    }

    const known = items.filter((it) => it.sub);
    const unknown = items.filter((it) => !it.sub);
    const base = {
      client: client ? safeName(client) : '',
      project: project ? safeName(project) : '',
      date: ym(minTime),
      reasons,
    };
    if (known.length) out.push({ id: `c${++cid}`, ...base, confidence: score, items: known, groupRefs });
    // tipi sconosciuti: ognuno va in "Da smistare" con il suggerimento del progetto
    for (const it of unknown) {
      out.push({
        id: `c${++cid}`,
        ...base,
        confidence: Math.min(score, 30),
        reasons: ['Tipo di file non riconosciuto', ...reasons],
        items: [{ ...it, sub: 'other' }],
        groupRefs: {},
      });
    }
  }

  out.sort((a, b) => b.confidence - a.confidence || a.client.localeCompare(b.client, 'it'));
  onProgress({ phase: 'done', done: files.length, total: files.length, current: '' });
  return {
    clusters: out,
    existing,
    stats: { files: files.length, packages: packages.length, linkGroups: linkGroups.length, skipped, truncated },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Destinazioni
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Calcola dove va ogni voce del progetto con il cliente e il progetto scelti.
 * → { projectDir, moves:[{from,to,kind,size,ino,mtimeMs,renamed,group?}], notes:[{path,content}] }
 */
function materialize(cluster, { client, project, destRoot, existing = [], rename = true, taken = new Set() }) {
  client = safeName(client);
  project = safeName(project);
  if (!client || !project) throw new Error('Scrivi il cliente e il progetto');
  const clientEntry = existing.find((e) => plain(e.name) === plain(client));
  const clientDir = path.join(destRoot, clientEntry ? clientEntry.name : client);
  const existingProject = clientEntry && clientEntry.projects.find((p) => sameWords(p, project));
  const projectDir = path.join(clientDir, existingProject || `${cluster.date}_${slug(project)}`);
  const drop = new Set([...keyTokens(client), ...keyTokens(project)]);
  const prefix = `${slug(client)}_${slug(project)}`;

  const unique = (p) => {
    const ext = path.extname(p);
    const b = p.slice(0, p.length - ext.length);
    let c = p;
    for (let i = 2; taken.has(c.toLowerCase()); i++) c = `${b}_${i}${ext}`;
    taken.add(c.toLowerCase());
    return c;
  };
  const newName = (it) => {
    if (!rename) return it.name;
    const stem = path.basename(it.name, it.ext);
    const { ver, final } = versionOf(stem);
    const descr = descrPieces(stem, drop)
      .map((p) => slug(p))
      .filter(Boolean);
    let n = [prefix, ...descr].join('_');
    if (ver) n += `_v${String(ver).padStart(2, '0')}`;
    else if (final) n += '_def';
    return n + it.ext;
  };

  const moves = [];
  const groupDirs = {};
  for (const it of cluster.items) {
    let to;
    if (it.kind === 'dir') {
      to = path.join(projectDir, R.DIRS.work, it.name);
    } else if (it.group) {
      if (!groupDirs[it.group]) {
        const main = cluster.items.find((x) => x.group === it.group && x.main) || it;
        const gname = rename ? path.basename(newName(main), main.ext) : path.basename(main.name, main.ext);
        groupDirs[it.group] = unique(path.join(projectDir, R.DIRS.work, gname));
      }
      to = path.join(groupDirs[it.group], it.rel || '', newName(it));
    } else {
      to = path.join(projectDir, R.DIRS[it.sub] || R.DIRS.other, newName(it));
    }
    to = unique(to);
    moves.push({
      from: it.from,
      to,
      kind: it.kind,
      size: it.size,
      ino: it.ino,
      mtimeMs: it.mtimeMs,
      group: it.group,
      renamed: path.basename(to) !== path.basename(it.from),
      sub: it.sub,
    });
  }

  const notes = buildNotes(cluster, { client, project, moves, groupDirs });
  return { projectDir, moves, notes, groupDirs };
}

/** un .txt per ogni gruppo con collegamenti: vecchi nomi e percorsi → nuovi, per ricollegare */
function buildNotes(cluster, { client, project, moves, groupDirs }) {
  const notes = [];
  const where = new Map(moves.map((m) => [m.from, m.to]));
  for (const [gid, dir] of Object.entries(groupDirs)) {
    const members = moves.filter((m) => m.group === gid);
    if (!members.length) continue;
    const refs = (cluster.groupRefs && cluster.groupRefs[gid]) || [];
    const lines = [
      'Fidati · Riorganizza',
      `Progetto: ${client} › ${project}`,
      `Data: ${new Date().toLocaleString('it-IT')}`,
      '',
      'I file collegati sono stati tenuti insieme, nella stessa disposizione.',
      'Se all’apertura un collegamento risulta mancante, usa “Ricollega” e scegli questa cartella:',
      'il file da cercare è quello con il nome NUOVO qui sotto.',
      '',
      '── Nomi cambiati ─────────────────────────────────',
      ...members.map((m) => `${path.basename(m.from)}  →  ${path.basename(m.to)}`),
      '',
      '── Percorsi completi (prima → dopo) ──────────────',
      ...members.map((m) => `${m.from}\n   → ${m.to}`),
    ];
    const outside = refs.filter(([, t]) => !members.some((m) => m.from === t));
    if (outside.length) {
      lines.push('', '── Collegamenti a file finiti in un altro gruppo ─');
      for (const [a, t] of outside) lines.push(`${path.basename(a)} usa ${path.basename(t)}  →  ${where.get(t) || t + ' (non spostato)'}`);
    }
    notes.push({ gid, path: path.join(dir, LINKS_TXT), content: lines.join('\n') + '\n' });
  }
  return notes;
}

// ─────────────────────────────────────────────────────────────────────────────
// Esecuzione
// ─────────────────────────────────────────────────────────────────────────────
const exists = (p) =>
  fsp.lstat(p).then(
    () => true,
    () => false,
  );

/** crea la cartella (e quelle sopra) registrando nel journal quelle create da Fidati */
async function ensureDir(dir, onCreate) {
  const missing = [];
  let d = dir;
  while (!(await exists(d))) {
    missing.unshift(d);
    const up = path.dirname(d);
    if (up === d) break;
    d = up;
  }
  for (const m of missing) {
    await fsp.mkdir(m);
    await onCreate(m);
  }
}

/**
 * Sposta i file dei progetti scelti.
 * jobs: [{ cluster, client, project }]
 * ctx:  { destRoot, existing, rename, journal, sessionId, assertMovable(p), onProgress }
 * → { results:[{ from, to?, ok, error? }], moved, failed }
 */
async function apply(jobs, ctx) {
  const { journal, sessionId, onProgress = () => {} } = ctx;
  const taken = new Set();
  const plans = jobs.map((j) => ({
    job: j,
    ...materialize(j.cluster, {
      client: j.client,
      project: j.project,
      destRoot: ctx.destRoot,
      existing: ctx.existing,
      rename: ctx.rename,
      taken,
    }),
  }));
  const total = plans.reduce((s, p) => s + p.moves.length, 0);
  const results = [];
  const sourceDirs = new Set();
  const okFrom = new Set();
  let done = 0;
  const onCreate = (p) => journal.created(sessionId, p, 'dir');

  for (const plan of plans) {
    for (const m of plan.moves) {
      onProgress({ phase: 'move', done: ++done, total, current: m.from });
      let entry = null;
      try {
        ctx.assertMovable(m.from);
        if (!inside(m.to, ctx.destRoot)) throw new Error('Destinazione non valida');
        const st = await fsp.lstat(m.from);
        if (st.ino !== m.ino || (m.kind === 'file' && st.size !== m.size)) throw new Error('È cambiato dopo l’analisi: rifai l’analisi');
        let to = m.to;
        if (await exists(to)) {
          const ext = m.kind === 'dir' ? '' : path.extname(to);
          const b = to.slice(0, to.length - ext.length);
          for (let i = 2; await exists(to); i++) to = `${b}_${i}${ext}`;
        }
        await ensureDir(path.dirname(to), onCreate);
        entry = await journal.begin(sessionId, {
          op: 'move',
          from: m.from,
          to,
          ino: st.ino,
          dev: st.dev,
          size: m.size,
          mtimeMs: st.mtimeMs,
          isDir: m.kind === 'dir',
        });
        await fsp.rename(m.from, to);
        await journal.done(entry, { to });
        sourceDirs.add(path.dirname(m.from));
        okFrom.add(m.from);
        m.to = to;
        results.push({ from: m.from, to, ok: true });
      } catch (err) {
        const msg =
          err.code === 'EXDEV'
            ? 'La destinazione è su un altro disco'
            : err.code === 'EPERM' || err.code === 'EACCES'
              ? 'Permesso negato da macOS'
              : err.code === 'ENOENT'
                ? 'Non esiste più'
                : err.message;
        if (entry) await journal.fail(entry, msg);
        results.push({ from: m.from, ok: false, error: msg });
      }
    }
    // i .txt si scrivono con i percorsi veri (alcuni possono essere cambiati per evitare doppioni)
    const movedOk = plan.moves.filter((m) => okFrom.has(m.from));
    const notes = buildNotes(plan.job.cluster, {
      client: safeName(plan.job.client),
      project: safeName(plan.job.project),
      moves: movedOk,
      groupDirs: plan.groupDirs,
    });
    for (const n of notes) {
      try {
        let target = n.path;
        for (let i = 2; await exists(target); i++) target = n.path.replace(/\.txt$/, ` ${i}.txt`);
        await ensureDir(path.dirname(target), onCreate);
        await fsp.writeFile(target, n.content);
        await journal.created(sessionId, target, 'file', Buffer.byteLength(n.content));
      } catch {}
    }
  }

  // le cartelle d'origine rimaste vuote si tolgono (al ripristino vengono ricreate)
  const roots = new Set(ctx.sources || []);
  const tried = new Set();
  for (const d of [...sourceDirs].sort((a, b) => b.length - a.length)) {
    let cur = d;
    while (!roots.has(cur) && !tried.has(cur) && (ctx.sources || []).some((s) => inside(cur, s))) {
      tried.add(cur);
      if (!(await removeIfEmpty(cur))) break;
      cur = path.dirname(cur);
    }
  }
  return { results, moved: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok) };
}

// ─────────────────────────────────────────────────────────────────────────────
// Barriere di sicurezza
// ─────────────────────────────────────────────────────────────────────────────
const VOLUME_SYSTEM_TOP = new Set(['System Volume Information', '$RECYCLE.BIN', 'Backups.backupdb', 'lost+found']);

/**
 * Un file si può spostare solo se sta sul disco scelto, fuori da Library, Applicazioni,
 * cartelle nascoste e cartelle escluse, e non è già nella cartella Clienti.
 * ctx: { kind, root, home, exclude, cloudRoots, destRoot }
 */
function assertMovable(p, ctx) {
  const r = path.resolve(p);
  if (!path.isAbsolute(p) || r !== p) throw new Error('Percorso non valido');
  if ((ctx.exclude || []).some((x) => inside(r, x))) throw new Error('Cartella esclusa nelle impostazioni');
  if (ctx.destRoot && inside(r, ctx.destRoot)) throw new Error('È già nella cartella Clienti');
  if ((ctx.cloudRoots || []).includes(r)) throw new Error('Cartella sincronizzata: protetta');
  const base = ctx.kind === 'system' ? ctx.home : ctx.root;
  if (!inside(r, base) || r === base)
    throw new Error(ctx.kind === 'system' ? 'Fuori dalla cartella Inizio' : 'Fuori dal disco selezionato');
  const top = path.relative(base, r).split(path.sep)[0];
  if (top.startsWith('.')) throw new Error('Cartella nascosta: protetta');
  if (ctx.kind === 'system' && (top === 'Library' || top === 'Applications')) {
    // le cartelle cloud stanno in ~/Library/CloudStorage: lì si può, se non sono escluse
    if (!(ctx.cloudRoots || []).some((c) => inside(r, c) && r !== c)) throw new Error('Dati di sistema o delle app: protetti');
  }
  if (ctx.kind !== 'system' && VOLUME_SYSTEM_TOP.has(top)) throw new Error('Cartella di sistema del disco: protetta');
}

/** la cartella Clienti deve stare sul disco scelto, in un posto dove si possono spostare file */
function assertDestination(dest, ctx) {
  assertMovable(dest, { ...ctx, destRoot: null, exclude: [] });
}

module.exports = {
  analyze,
  materialize,
  apply,
  buildNotes,
  readExisting,
  assertMovable,
  assertDestination,
  subfolderFor,
  keyTokens,
  safeName,
  findLinkGroups,
  linkedNames,
  LINKS_TXT,
};
