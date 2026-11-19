'use strict';
/**
 * Registro persistente degli spostamenti (Cronologia), per poter rimettere i file
 * dov'erano anche dopo la chiusura dell'app. Nessuna dipendenza da Electron.
 *
 * Due registri separati, in ~/Library/Application Support/Fidati/log/:
 *   riorganizzazione.jsonl → ogni file spostato da "Riorganizza"
 *   pulizia.jsonl          → solo i file scelti a mano e spostati nel Cestino
 *                            (cache e dati di sistema eliminati subito non vengono registrati)
 *
 * Formato: una riga JSON per evento, solo in aggiunta (mai riscritto).
 *   { t:'session', id, kind, label, root, at }
 *   { t:'begin',   id, s, op:'move'|'trash', from, to?, ino, dev, size, mtimeMs, isDir, trashDir? }
 *   { t:'done',    id, to?, mtimeMs? }
 *   { t:'fail',    id, error }
 *   { t:'restored',id, path, at }
 *   { t:'created', s, path, kind:'dir'|'file', size? }   cartelle e .txt creati da Fidati
 *   { t:'forget',  s }                                     sessione tolta dalla cronologia
 *
 * Scrittura "prima di agire": l'evento begin è salvato (e sincronizzato su disco) PRIMA
 * di spostare il file, done DOPO. Se l'app si chiude a metà, al riavvio load() guarda il
 * disco e decide se lo spostamento è avvenuto o no.
 */
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');

const exists = (p) =>
  fsp.lstat(p).then(
    () => true,
    () => false,
  );
let seq = 0;
const newId = (prefix) => `${prefix}${Date.now().toString(36)}${(++seq).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/** "foto.jpg" → "foto (ripristinato).jpg", "foto (ripristinato 2).jpg"… finché non è libero */
async function freeName(p, label = 'ripristinato') {
  const ext = path.extname(p);
  const base = p.slice(0, p.length - ext.length);
  for (let i = 1; ; i++) {
    const c = `${base} (${label}${i > 1 ? ' ' + i : ''})${ext}`;
    if (!(await exists(c))) return c;
  }
}

/**
 * Cerca nel Cestino l'elemento con questo inode. Il Finder può rinominarlo
 * ("foto 2.jpg", "foto 10.31.22.jpg"), ma l'inode non cambia.
 * → percorso, null se non c'è, oppure lancia EPERM se il Cestino non è leggibile.
 */
async function findInTrash(trashDir, name, ino, hint) {
  if (hint) {
    try {
      if ((await fsp.lstat(hint)).ino === ino) return hint;
    } catch {}
  }
  const entries = await fsp.readdir(trashDir); // EPERM senza "Accesso completo al disco"
  const stem = path.basename(name, path.extname(name)).toLowerCase();
  const sorted = [...entries].sort((a, b) => (b.toLowerCase().startsWith(stem) ? 1 : 0) - (a.toLowerCase().startsWith(stem) ? 1 : 0));
  for (const e of sorted) {
    const p = path.join(trashDir, e);
    try {
      if ((await fsp.lstat(p)).ino === ino) return p;
    } catch {}
  }
  return null;
}

class Journal {
  constructor(file) {
    this.file = file;
    this.sessions = new Map(); // id → { id, kind, label, root, at, entries: [], created: [], forgotten }
    this.entries = new Map(); // id → entry
    this.loaded = false;
  }

  async _append(ev, sync = false) {
    await fsp.mkdir(path.dirname(this.file), { recursive: true });
    const fh = await fsp.open(this.file, 'a');
    try {
      await fh.write(JSON.stringify(ev) + '\n');
      if (sync) await fh.datasync();
    } finally {
      await fh.close();
    }
    this._apply(ev);
  }

  _apply(ev) {
    switch (ev.t) {
      case 'session':
        this.sessions.set(ev.id, {
          id: ev.id,
          kind: ev.kind,
          label: ev.label,
          root: ev.root,
          at: ev.at,
          entries: [],
          created: [],
          forgotten: false,
        });
        break;
      case 'begin': {
        const s = this.sessions.get(ev.s);
        if (!s) return;
        const { t, ...rest } = ev;
        const e = { ...rest, session: ev.s, state: 'pending' };
        this.entries.set(ev.id, e);
        s.entries.push(e);
        break;
      }
      case 'done': {
        const e = this.entries.get(ev.id);
        if (!e) return;
        e.state = 'done';
        if (ev.to !== undefined) e.to = ev.to;
        if (ev.mtimeMs !== undefined) e.mtimeMs = ev.mtimeMs;
        break;
      }
      case 'fail': {
        const e = this.entries.get(ev.id);
        if (e) Object.assign(e, { state: 'failed', error: ev.error });
        break;
      }
      case 'restored': {
        const e = this.entries.get(ev.id);
        if (e) Object.assign(e, { state: 'restored', restoredTo: ev.path, restoredAt: ev.at });
        break;
      }
      case 'created': {
        const s = this.sessions.get(ev.s);
        if (s) s.created.push({ path: ev.path, kind: ev.kind, size: ev.size });
        break;
      }
      case 'forget': {
        const s = this.sessions.get(ev.s);
        if (s) s.forgotten = true;
        break;
      }
    }
  }

  /** legge il registro dal disco e sistema gli spostamenti rimasti a metà */
  async load() {
    if (this.loaded) return this;
    let text = '';
    try {
      text = await fsp.readFile(this.file, 'utf8');
    } catch {}
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      try {
        this._apply(JSON.parse(line));
      } catch {} // una riga troncata da un arresto improvviso: si salta
    }
    this.loaded = true;
    for (const e of this.entries.values()) {
      if (e.state !== 'pending') continue;
      const fromThere = await exists(e.from);
      if (e.op === 'move') {
        if (!fromThere && e.to && (await exists(e.to))) await this._append({ t: 'done', id: e.id });
        else await this._append({ t: 'fail', id: e.id, error: 'Interrotto prima dello spostamento' });
      } else if (!fromThere) {
        await this._append({ t: 'done', id: e.id }); // è nel Cestino: lo si ritrova con l'inode
      } else {
        await this._append({ t: 'fail', id: e.id, error: 'Interrotto prima di finire nel Cestino' });
      }
    }
    return this;
  }

  async startSession({ kind, label, root }) {
    const id = newId('s');
    await this._append({ t: 'session', id, kind, label, root, at: Date.now() }, true);
    return id;
  }

  /** da chiamare PRIMA di spostare: salva l'intenzione */
  async begin(sessionId, info) {
    const id = newId('e');
    await this._append({ t: 'begin', id, s: sessionId, ...info }, true);
    return id;
  }

  done(id, extra = {}) {
    return this._append({ t: 'done', id, ...extra });
  }

  fail(id, error) {
    return this._append({ t: 'fail', id, error: String(error) });
  }

  created(sessionId, p, kind, size) {
    return this._append({ t: 'created', s: sessionId, path: p, kind, size });
  }

  forget(sessionId) {
    return this._append({ t: 'forget', s: sessionId });
  }

  /** sessioni visibili, dalla più recente; per l'interfaccia */
  list() {
    return [...this.sessions.values()]
      .filter((s) => !s.forgotten && s.entries.some((e) => e.state !== 'failed'))
      .sort((a, b) => b.at - a.at)
      .map((s) => ({
        id: s.id,
        kind: s.kind,
        label: s.label,
        root: s.root,
        at: s.at,
        entries: s.entries
          .filter((e) => e.state !== 'pending')
          .map((e) => ({
            id: e.id,
            op: e.op,
            from: e.from,
            to: e.to || null,
            size: e.size,
            isDir: !!e.isDir,
            state: e.state,
            error: e.error,
            restoredTo: e.restoredTo,
          })),
      }));
  }

  /** dove si trova adesso il file di una voce, o un errore leggibile */
  async _locate(e) {
    if (e.op === 'trash') {
      let found;
      try {
        found = await findInTrash(e.trashDir, path.basename(e.from), e.ino, e.to);
      } catch (err) {
        if (err.code === 'EPERM' || err.code === 'EACCES') {
          throw new Error('Per riprendere i file dal Cestino concedi a Fidati “Accesso completo al disco”');
        }
        throw new Error('Cestino non raggiungibile: il disco è collegato?');
      }
      if (!found) throw new Error('Non è più nel Cestino (svuotato o già ripreso dal Finder)');
      return found;
    }
    let st;
    try {
      st = await fsp.lstat(e.to);
    } catch {
      throw new Error('Non si trova più dove l’avevo messo: è stato spostato o eliminato');
    }
    if (e.ino && st.ino !== e.ino) throw new Error('Al suo posto ora c’è un altro file');
    return e.to;
  }

  /**
   * Controlla cosa succederebbe ripristinando queste voci.
   * → { ready:[{id,cur}], issues:[{id, name, kind:'conflict'|'modified'|'error', message}] }
   */
  async check(ids) {
    const ready = [];
    const issues = [];
    for (const id of ids) {
      const e = this.entries.get(id);
      if (!e || e.state !== 'done') continue;
      const name = path.basename(e.from);
      let cur;
      try {
        cur = await this._locate(e);
      } catch (err) {
        issues.push({ id, name, kind: 'error', message: err.message });
        continue;
      }
      if (await exists(e.from)) {
        issues.push({
          id,
          name,
          kind: 'conflict',
          message: 'Nella posizione originale c’è già un file con questo nome: verrà ripristinato con “(ripristinato)” nel nome',
        });
      } else if (!e.isDir && e.mtimeMs) {
        try {
          const st = await fsp.lstat(cur);
          if (Math.abs(st.mtimeMs - e.mtimeMs) > 1 || st.size !== e.size) {
            issues.push({ id, name, kind: 'modified', message: 'È stato modificato dopo lo spostamento: torna con le modifiche' });
          }
        } catch {}
      }
      ready.push({ id, cur });
    }
    return { ready, issues };
  }

  /**
   * Rimette i file nella posizione originale (in ordine inverso a come sono stati spostati).
   * Senza force, se ci sono avvisi non tocca niente e li restituisce.
   * → { needsConfirm?:issues, results:[{id, ok, path?, error?}] }
   */
  async restore(ids, { force = false } = {}) {
    const order = [...this.entries.values()]
      .filter((e) => ids.includes(e.id))
      .map((e) => e.id)
      .reverse();
    const { ready, issues } = await this.check(order);
    if (issues.length && !force) return { needsConfirm: issues, results: [] };
    const results = issues.filter((i) => i.kind === 'error').map((i) => ({ id: i.id, ok: false, error: i.message }));
    const touched = new Set();
    for (const { id, cur } of ready) {
      const e = this.entries.get(id);
      try {
        let target = e.from;
        if (await exists(target)) target = await freeName(target);
        await fsp.mkdir(path.dirname(target), { recursive: true });
        await fsp.rename(cur, target);
        await this._append({ t: 'restored', id, path: target, at: Date.now() });
        touched.add(e.session);
        results.push({ id, ok: true, path: target });
      } catch (err) {
        const msg = err.code === 'EPERM' || err.code === 'EACCES' ? 'Permesso negato da macOS' : err.message;
        results.push({ id, ok: false, error: msg });
      }
    }
    for (const s of touched) await this._tidy(s);
    return { results };
  }

  /** sessione tutta ripristinata: toglie i .txt creati (se intatti) e le cartelle rimaste vuote */
  async _tidy(sessionId) {
    const s = this.sessions.get(sessionId);
    if (!s || s.entries.some((e) => e.state === 'done')) return;
    for (const c of s.created.filter((c) => c.kind === 'file')) {
      try {
        if ((await fsp.lstat(c.path)).size === c.size) await fsp.unlink(c.path);
      } catch {}
    }
    const dirs = s.created.filter((c) => c.kind === 'dir').map((c) => c.path);
    dirs.sort((a, b) => b.length - a.length); // dalle più profonde
    for (const d of dirs) await removeIfEmpty(d);
  }
}

/** elimina una cartella solo se vuota (un .DS_Store da solo conta come vuota) */
async function removeIfEmpty(dir) {
  try {
    const list = await fsp.readdir(dir);
    if (list.some((n) => n !== '.DS_Store')) return false;
    if (list.length) await fsp.unlink(path.join(dir, '.DS_Store'));
    await fsp.rmdir(dir);
    return true;
  } catch {
    return false;
  }
}

/**
 * Sposta nel Cestino registrando il movimento nel registro della pulizia.
 * trashFn(p) è shell.trashItem in Electron.
 */
async function trashWithLog(journal, sessionId, p, { trashFn, trashDir, size }) {
  const st = await fsp.lstat(p);
  const id = await journal.begin(sessionId, {
    op: 'trash',
    from: p,
    ino: st.ino,
    dev: st.dev,
    size,
    mtimeMs: st.mtimeMs,
    isDir: st.isDirectory(),
    trashDir,
  });
  try {
    await trashFn(p);
  } catch (err) {
    await journal.fail(id, err.message);
    throw err;
  }
  let to = null;
  try {
    to = await findInTrash(trashDir, path.basename(p), st.ino);
  } catch {} // Cestino non leggibile ora: lo si ritrova al momento del ripristino
  await journal.done(id, { to });
}

module.exports = { Journal, trashWithLog, findInTrash, removeIfEmpty, freeName };
