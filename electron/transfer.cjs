'use strict';
/**
 * Trasferimento ordinato: copia i progetti da una cartella (o disco) di partenza
 * a una di arrivo rispettando la gerarchia che c'è già all'arrivo.
 *
 *   1. readTree        legge le cartelle di partenza e di arrivo
 *   2. detectLevels    capisce la gerarchia (Cliente / Anno / Progetto / …)
 *   3. buildPlan       per ogni progetto trova dove va: dentro la cartella che
 *                      corrisponde all'arrivo, oppure in una nuova
 *   4. copyEntry       copia. Non tocca MAI la partenza e non sovrascrive MAI
 *                      un file che esiste già all'arrivo.
 *
 * Nessuna dipendenza da Electron: si prova con `npm test`.
 */
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');

// ── nomi ─────────────────────────────────────────────────────────────────────

/** cartelle di sistema dei dischi e file da non portarsi dietro */
const SKIP_DIRS = new Set([
  '.Spotlight-V100', '.Trashes', '.fseventsd', '.DocumentRevisions-V100', '.TemporaryItems',
  '.Trash', 'System Volume Information', '$RECYCLE.BIN', 'Backups.backupdb', 'node_modules', '.git',
]);
const SKIP_FILES = new Set(['.DS_Store', 'Thumbs.db', 'desktop.ini', 'Icon\r']);

/** cartelle "di contenuto": quando compaiono, la gerarchia è finita */
const CONTENT_NAMES = new Set(
  `assets asset export exports links link footage girato render renders output consegne consegna definitivi def bozze
  draft drafts stampa print psd ai indd img image images immagini foto photo photos video videos audio musica music
  font fonts docs doc documenti documents materiali materiale risorse resources src source sources raw proxy proxies
  media grafica graphics elements elementi sfx vfx comp comps cache preview previews pdf jpg png mov mp4 wav old backup
  archive archivio project files progetto adobe premiere after effects photoshop illustrator indesign`
    .split(/\s+/)
    .filter(Boolean)
);

/** estensioni di file di progetto: la cartella che li contiene è un progetto */
const PROJECT_EXT = new Set(
  `.prproj .aep .aepx .psd .psb .ai .indd .idml .xd .fig .sketch .drp .fcpbundle .fcpxml .blend .c4d .mb .ma .max
  .veg .aup3 .logicx .als .ptx .key .pptx .docx .afdesign .afphoto .afpub .cdr .ae .mogrt .pproj`
    .split(/\s+/)
    .filter(Boolean)
);

const isYear = (name) => /^(19|20)\d{2}$/.test(name.trim());
const isHidden = (name) => name.startsWith('.');

/** "Spot_Estate - 2025" → "spot estate 2025" */
const norm = (s) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[_\-.,'’]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** come norm, ma senza numerazioni iniziali ("01 ") e suffissi da copia ("copia", "(2)") */
const core = (s) =>
  norm(s)
    .replace(/^\d{1,3} (?=\D)/, '')
    .replace(/ (copia|copy|old|vecchio|nuovo|new)$/, '')
    .replace(/ ?\(\d+\)$/, '')
    .trim();

function levenshtein(a, b) {
  if (a === b) return 0;
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[b.length];
}

/** 'exact' (stesso nome, a meno di maiuscole/accenti/separatori), 'similar', oppure null */
function compareNames(a, b) {
  if (norm(a) === norm(b)) return 'exact';
  if (isYear(a) || isYear(b)) return null; // gli anni devono essere identici
  const ca = core(a);
  const cb = core(b);
  if (!ca || !cb) return null;
  if (ca === cb || ca.replace(/ /g, '') === cb.replace(/ /g, '')) return 'similar';
  // refusi ("Catalgo" ↔ "Catalogo"): solo su parole lunghe, e mai se cambiano numeri
  // o sigle corte ("Sottoprogetto 1A" e "Sottoprogetto 1B" sono cartelle diverse)
  const ta = ca.split(' ');
  const tb = cb.split(' ');
  if (ta.length !== tb.length || ca.replace(/\D/g, '') !== cb.replace(/\D/g, '')) return null;
  for (let i = 0; i < ta.length; i++) {
    if (ta[i] === tb[i]) continue;
    const len = Math.max(ta[i].length, tb[i].length);
    if (Math.min(ta[i].length, tb[i].length) < 5 || /\d/.test(ta[i] + tb[i])) return null;
    if (1 - levenshtein(ta[i], tb[i]) / len < 0.8) return null;
  }
  return 'similar';
}

/** la cartella corrispondente tra i figli di dest: prima l'uguale, poi la più simile (solo se unica) */
function findMatch(name, children) {
  const exact = children.find((c) => compareNames(name, c.name) === 'exact');
  if (exact) return { node: exact, type: 'exact' };
  const similar = children.filter((c) => compareNames(name, c.name) === 'similar');
  if (similar.length === 1) return { node: similar[0], type: 'similar' };
  return null;
}

// ── lettura ──────────────────────────────────────────────────────────────────

/** p è uguale a base o sta dentro base */
const inside = (p, base) => p === base || p.startsWith(base.endsWith(path.sep) ? base : base + path.sep);

async function readDir(dir) {
  try {
    return await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

/**
 * Albero delle sole cartelle fino a maxDepth (figli diretti della radice = profondità 0).
 * nodo: { name, path, depth, children, files: [nomi], projectFiles }
 */
async function readTree(root, { maxDepth = 6, maxDirs = 30000, onProgress } = {}) {
  let seen = 0;
  const make = (name, p, depth) => ({ name, path: p, depth, children: [], files: [], projectFiles: 0 });
  const top = make(path.basename(root) || root, root, -1);
  const queue = [top];
  while (queue.length) {
    const node = queue.shift();
    for (const e of await readDir(node.path)) {
      if (e.isDirectory()) {
        if (isHidden(e.name) || SKIP_DIRS.has(e.name) || node.depth + 1 > maxDepth || seen >= maxDirs) continue;
        if (e.name.endsWith('.app') || e.name.endsWith('.photoslibrary')) {
          node.files.push(e.name); // pacchetti: si trattano come file
          continue;
        }
        const child = make(e.name, path.join(node.path, e.name), node.depth + 1);
        node.children.push(child);
        queue.push(child);
        if (++seen % 200 === 0 && onProgress) onProgress({ folders: seen, current: child.path });
      } else if (e.isFile() || e.isSymbolicLink()) {
        if (SKIP_FILES.has(e.name)) continue;
        node.files.push(e.name);
        if (PROJECT_EXT.has(path.extname(e.name).toLowerCase())) node.projectFiles++;
      }
    }
    node.children.sort((a, b) => a.name.localeCompare(b.name, 'it', { numeric: true }));
  }
  return { tree: top, folders: seen, truncated: seen >= maxDirs };
}

const nodesAt = (tree, depth) => {
  const out = [];
  const walk = (n) => {
    if (n.depth === depth) return out.push(n);
    if (n.depth < depth) n.children.forEach(walk);
  };
  walk(tree);
  return out;
};

const ROLES = ['Cliente', 'Anno', 'Progetto', 'Sottoprogetto', 'Categoria', 'Altro'];

/**
 * Capisce la gerarchia.
 * → { levels: [{ depth, count, examples, yearShare, contentShare, projectShare, role }], suggested }
 *   suggested = quanti livelli formano la gerarchia; dal livello `suggested` in giù è contenuto.
 */
function detectLevels(tree) {
  const levels = [];
  for (let d = 0; ; d++) {
    const nodes = nodesAt(tree, d);
    if (!nodes.length) break;
    const names = [...new Set(nodes.map((n) => n.name))];
    levels.push({
      depth: d,
      count: nodes.length,
      examples: names.slice(0, 5),
      yearShare: nodes.filter((n) => isYear(n.name)).length / nodes.length,
      contentShare: nodes.filter((n) => CONTENT_NAMES.has(norm(n.name)) || CONTENT_NAMES.has(norm(n.name).split(' ')[0])).length / nodes.length,
      projectShare: nodes.filter((n) => n.projectFiles > 0).length / nodes.length,
    });
  }
  let suggested = Math.min(levels.length, 3);
  for (const l of levels) {
    // cartelle tipo Assets/Export: la gerarchia finisce sopra di loro
    if (l.depth > 0 && l.contentShare >= 0.5) {
      suggested = l.depth;
      break;
    }
    // cartelle che contengono direttamente file di progetto: sono l'ultimo livello
    if (l.projectShare >= 0.5) {
      suggested = l.depth + 1;
      break;
    }
  }
  suggested = Math.max(1, Math.min(suggested, levels.length || 1));
  return { levels: assignRoles(levels, suggested), suggested };
}

/** etichette proposte per i livelli della gerarchia */
function assignRoles(levels, count) {
  const plain = levels.slice(0, count).filter((l) => l.yearShare < 0.6).length;
  const names = plain === 1 ? ['Progetto'] : plain === 2 ? ['Cliente', 'Progetto'] : ['Cliente', 'Progetto', 'Sottoprogetto'];
  let i = 0;
  return levels.map((l) => {
    if (l.depth >= count) return { ...l, role: 'Contenuto' };
    if (l.yearShare >= 0.6) return { ...l, role: 'Anno' };
    return { ...l, role: names[i++] || `Livello ${l.depth + 1}` };
  });
}

// ── piano ────────────────────────────────────────────────────────────────────

/** tutte le cartelle dell'arrivo fino a una profondità, per cercare corrispondenze "altrove" */
function flatten(tree, maxDepth) {
  const out = [];
  const walk = (n) => {
    if (n.depth >= 0) out.push(n);
    if (n.depth < maxDepth) n.children.forEach(walk);
  };
  walk(tree);
  return out;
}

/** cosa c'è da copiare da srcDir a destDir (solo i file che all'arrivo non ci sono) */
async function measure(srcDir, destDir, { only } = {}) {
  let files = 0;
  let size = 0;
  let skipped = 0;
  let skippedSize = 0;
  const walk = async (src, dst, names) => {
    const entries = await readDir(src);
    for (const e of entries) {
      if (names && !names.includes(e.name)) continue;
      const s = path.join(src, e.name);
      const d = dst && path.join(dst, e.name);
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name)) continue;
        let destExists = false;
        if (d) destExists = await fsp.stat(d).then((st) => st.isDirectory(), () => false);
        await walk(s, destExists ? d : null);
      } else if (e.isFile() || e.isSymbolicLink()) {
        if (SKIP_FILES.has(e.name)) continue;
        let sz = 0;
        try {
          sz = (await fsp.lstat(s)).size;
        } catch {}
        const there = d ? await fsp.lstat(d).then(() => true, () => false) : false;
        if (there) {
          skipped++;
          skippedSize += sz;
        } else {
          files++;
          size += sz;
        }
      }
    }
  };
  const destExists = await fsp.stat(destDir).then((st) => st.isDirectory(), () => false);
  await walk(srcDir, destExists ? destDir : null, only);
  return { files, size, skipped, skippedSize, destExists };
}

/**
 * Costruisce il piano. Scende nella gerarchia di partenza tenendosi agganciato
 * alla cartella corrispondente all'arrivo: il primo livello che all'arrivo non
 * esiste diventa un "progetto da copiare" dentro l'ultima cartella che corrisponde.
 *
 * → [{ id, kind, name, role, srcDir, destDir, only?, via, match, suggestions, files, size, skipped, selected }]
 *   kind: 'new'     la cartella non c'è all'arrivo: si crea
 *         'merge'   c'è già: si aggiungono solo i file mancanti
 *         'loose'   file sciolti in una cartella della gerarchia
 *         'present' è già tutto all'arrivo
 */
async function buildPlan({ srcTree, destTree, depth, roles = [] }) {
  const destAll = flatten(destTree, depth + 1);
  const plan = [];
  let n = 0;
  const roleOf = (d) => roles[d] || `Livello ${d + 1}`;

  const add = async (entry) => {
    const m = await measure(entry.srcDir, entry.destDir, { only: entry.only });
    if (!m.files && !m.skipped) return; // cartella vuota: niente da fare
    const kind = !m.files ? 'present' : entry.kind;
    const doubtful = entry.match === 'similar' || entry.suggestions.length > 0;
    plan.push({
      id: `t${++n}`,
      ...entry,
      kind,
      files: m.files,
      size: m.size,
      skipped: m.skipped,
      skippedSize: m.skippedSize,
      selected: kind !== 'present' && !doubtful,
    });
  };

  /** cartelle dell'arrivo con lo stesso nome ma in un altro punto della gerarchia */
  const elsewhere = (node, expectedParent) =>
    destAll
      .filter((d) => compareNames(node.name, d.name) === 'exact' && path.dirname(d.path) !== expectedParent && !isYear(node.name))
      .filter((d) => !CONTENT_NAMES.has(norm(d.name)))
      .slice(0, 3)
      .map((d) => ({ destDir: d.path, why: 'Stesso nome in un altro punto dell’arrivo' }));

  const walk = async (src, dest, via) => {
    // file sciolti dentro una cartella della gerarchia che corrisponde
    if (src.files.length) {
      await add({
        kind: 'loose',
        name: src.depth < 0 ? 'File nella radice' : `File sciolti in “${src.name}”`,
        role: src.depth < 0 ? '' : roleOf(src.depth),
        srcDir: src.path,
        destDir: dest.path,
        only: src.files,
        via,
        match: 'exact',
        suggestions: [],
      });
    }
    for (const child of src.children) {
      const m = findMatch(child.name, dest.children);
      const step = { name: child.name, role: roleOf(child.depth), dest: m?.node.name || null, match: m?.type || 'none' };
      const chain = [...via, step];
      const matchType = chain.some((s) => s.match === 'similar') ? 'similar' : 'exact';
      if (m && child.depth < depth - 1) {
        await walk(child, m.node, chain);
      } else if (m) {
        // ultimo livello della gerarchia: c'è già, si completano i file mancanti
        await add({
          kind: 'merge',
          name: child.name,
          role: roleOf(child.depth),
          srcDir: child.path,
          destDir: m.node.path,
          via: chain,
          match: matchType,
          suggestions: [],
        });
      } else {
        const destDir = path.join(dest.path, child.name);
        await add({
          kind: 'new',
          name: child.name,
          role: roleOf(child.depth),
          srcDir: child.path,
          destDir,
          via: chain,
          match: via.some((s) => s.match === 'similar') ? 'similar' : via.length ? 'exact' : 'none',
          suggestions: elsewhere(child, dest.path),
        });
      }
    }
  };

  await walk(srcTree, destTree, []);
  return plan;
}

/** ricalcola un elemento del piano dopo un cambio di destinazione */
async function remeasure(entry, destDir, { kind, match } = {}) {
  const m = await measure(entry.srcDir, destDir, { only: entry.only });
  return {
    ...entry,
    destDir,
    kind: !m.files ? 'present' : kind || (m.destExists ? 'merge' : 'new'),
    match: match || entry.match,
    files: m.files,
    size: m.size,
    skipped: m.skipped,
    skippedSize: m.skippedSize,
    selected: m.files > 0,
  };
}

// ── copia ────────────────────────────────────────────────────────────────────

/** la copia è ammessa solo dentro l'arrivo, mai dentro la partenza */
function assertCopyTarget(destDir, ctx) {
  const d = path.resolve(destDir);
  if (d !== destDir) throw new Error('Percorso di arrivo non valido');
  if (!inside(d, ctx.destRoot)) throw new Error('La destinazione è fuori dalla cartella di arrivo');
  if (inside(d, ctx.srcRoot)) throw new Error('La destinazione è dentro la cartella di partenza');
}

/**
 * Copia srcDir dentro destDir. I file già presenti all'arrivo vengono saltati,
 * mai sovrascritti; la partenza resta com'è (solo lettura).
 * → { copied, bytes, skipped, errors: [{ file, error }] }
 */
async function copyEntry(entry, ctx, { onFile, shouldStop = () => false } = {}) {
  assertCopyTarget(entry.destDir, ctx);
  if (!inside(entry.srcDir, ctx.srcRoot)) throw new Error('La sorgente è fuori dalla cartella di partenza');
  const out = { copied: 0, bytes: 0, skipped: 0, errors: [] };

  const copyFile = async (s, d) => {
    const st = await fsp.lstat(s);
    if (st.isSymbolicLink()) {
      try {
        await fsp.symlink(await fsp.readlink(s), d);
        out.copied++;
      } catch (e) {
        if (e.code === 'EEXIST') out.skipped++;
        else throw e;
      }
      return;
    }
    try {
      // COPYFILE_EXCL: se il file esiste già all'arrivo la copia si ferma, non sovrascrive
      await fsp.copyFile(s, d, fs.constants.COPYFILE_EXCL);
    } catch (e) {
      if (e.code === 'EEXIST') {
        out.skipped++;
        return;
      }
      throw e;
    }
    const written = await fsp.stat(d);
    if (written.size !== st.size) {
      await fsp.unlink(d).catch(() => {}); // copia incompleta creata da noi
      throw new Error('Copia incompleta');
    }
    await fsp.utimes(d, st.atime, st.mtime).catch(() => {});
    out.copied++;
    out.bytes += st.size;
  };

  const walk = async (src, dst, names) => {
    await fsp.mkdir(dst, { recursive: true });
    for (const e of await readDir(src)) {
      if (shouldStop()) return;
      if (names && !names.includes(e.name)) continue;
      const s = path.join(src, e.name);
      const d = path.join(dst, e.name);
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name)) continue;
        const clash = await fsp.lstat(d).then((st) => !st.isDirectory(), () => false);
        if (clash) {
          out.errors.push({ file: s, error: 'All’arrivo c’è un file con lo stesso nome della cartella' });
          continue;
        }
        await walk(s, d);
      } else if (e.isFile() || e.isSymbolicLink()) {
        if (SKIP_FILES.has(e.name)) continue;
        try {
          await copyFile(s, d);
        } catch (err) {
          out.errors.push({ file: s, error: err.code === 'ENOSPC' ? 'Spazio esaurito sul disco di arrivo' : err.message });
          if (err.code === 'ENOSPC') throw Object.assign(new Error('Spazio esaurito sul disco di arrivo'), { partial: out });
        }
        if (onFile) onFile({ file: s, bytes: out.bytes });
      }
    }
  };

  await walk(entry.srcDir, entry.destDir, entry.only);
  return out;
}

module.exports = {
  readTree,
  detectLevels,
  assignRoles,
  buildPlan,
  remeasure,
  copyEntry,
  assertCopyTarget,
  compareNames,
  findMatch,
  inside,
  ROLES,
};
