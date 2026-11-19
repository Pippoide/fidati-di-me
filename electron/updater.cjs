'use strict';
/**
 * Updater "fatto in casa": non richiede certificato Apple né server.
 * Legge l'ultima release pubblica su GitHub, scarica lo zip per questo Mac,
 * sostituisce Fidati.app e la riapre.
 */
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const { execFile, spawn } = require('child_process');

const REPO = 'Pippoide/fidati-di-me';
const API = `https://api.github.com/repos/${REPO}/releases`;

/**
 * Canale di aggiornamento: 'stable' per Fidati, 'bk' per Fidati BK (branch Build_BK).
 * Lo imposta la build su GitHub nel package.json; ogni app segue solo le proprie release.
 */
let CHANNEL = 'stable';
try {
  CHANNEL = require('../package.json').fidatiChannel || 'stable';
} catch {}
const isBkTag = (tag) => /-bk$/i.test(String(tag));
const isBkAsset = (name) => /^Fidati-BK-/i.test(name);
const DOWNLOAD_PREFIX = `https://github.com/${REPO}/releases/download/`;

/** "v1.0.12" → [1,0,12] */
const parseVersion = (v) =>
  String(v)
    .replace(/^v/, '')
    .split('.')
    .map((n) => parseInt(n, 10) || 0);

function isNewer(latest, current) {
  const a = parseVersion(latest);
  const b = parseVersion(current);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) > (b[i] || 0);
  }
  return false;
}

/** sceglie lo zip giusto (arm64 = Apple Silicon, x64 = Intel) e del canale giusto */
function pickAsset(assets, arch, channel = 'stable') {
  return (assets || []).find(
    (a) =>
      a.name.endsWith(`-${arch}.zip`) &&
      isBkAsset(a.name) === (channel === 'bk') &&
      String(a.browser_download_url).startsWith(DOWNLOAD_PREFIX)
  );
}

/** l'ultima release del canale: stable = l'ultima "ufficiale", bk = l'ultima con tag …-bk */
async function latestRelease(channel, fetchImpl) {
  const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'Fidati' };
  if (channel === 'bk') {
    const res = await fetchImpl(`${API}?per_page=30`, { headers });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`GitHub ha risposto ${res.status}`);
    const list = await res.json();
    return (Array.isArray(list) ? list : []).find((r) => !r.draft && isBkTag(r.tag_name)) || null;
  }
  const res = await fetchImpl(`${API}/latest`, { headers });
  if (res.status === 404) return null; // nessuna release ancora
  if (!res.ok) throw new Error(`GitHub ha risposto ${res.status}`);
  const rel = await res.json();
  return isBkTag(rel.tag_name) ? null : rel;
}

/** Ritorna { current, latest, url, size, digest, page } oppure { current } se non c'è niente di nuovo. */
async function check({ current, arch = process.arch, fetchImpl = fetch, channel = CHANNEL } = {}) {
  const rel = await latestRelease(channel, fetchImpl);
  if (!rel) return { current };
  const latest = String(rel.tag_name || '').replace(/^v/, '').replace(/-bk$/i, '');
  if (!latest || !isNewer(latest, current)) return { current };
  const asset = pickAsset(rel.assets, arch, channel);
  if (!asset) return { current };
  return {
    current,
    latest,
    url: asset.browser_download_url,
    size: asset.size,
    digest: asset.digest || null, // "sha256:…" se GitHub lo fornisce
    page: rel.html_url,
  };
}

const run = (cmd, args) =>
  new Promise((resolve, reject) => execFile(cmd, args, (err) => (err ? reject(err) : resolve())));

/** percorso di Fidati.app in esecuzione, o errore se non è aggiornabile sul posto */
async function currentBundle(execPath = process.execPath) {
  const bundle = path.resolve(execPath, '..', '..', '..');
  if (!bundle.endsWith('.app')) throw new Error('L’aggiornamento funziona solo dall’app installata');
  if (bundle.startsWith('/Volumes/') || bundle.includes('/AppTranslocation/')) {
    throw new Error('Sposta prima Fidati nella cartella Applicazioni, poi riaprila e riprova');
  }
  try {
    await fsp.access(path.dirname(bundle), fs.constants.W_OK);
  } catch {
    throw new Error('Non ho i permessi per sostituire l’app in questa cartella');
  }
  return bundle;
}

/**
 * Scarica, verifica, estrae e prepara lo scambio. Ritorna una funzione
 * `swapAndRelaunch()` da chiamare subito prima di chiudere l'app.
 */
async function prepare(update, { tmpDir, onProgress = () => {}, fetchImpl = fetch } = {}) {
  if (!update || !String(update.url).startsWith(DOWNLOAD_PREFIX)) throw new Error('Indirizzo di aggiornamento non valido');
  const bundle = await currentBundle();
  const work = await fsp.mkdtemp(path.join(tmpDir, 'fidati-update-'));
  const zip = path.join(work, 'update.zip');

  // download con avanzamento
  const res = await fetchImpl(update.url, { headers: { 'User-Agent': 'Fidati' } });
  if (!res.ok || !res.body) throw new Error(`Download non riuscito (${res.status})`);
  const total = Number(res.headers.get('content-length')) || update.size || 0;
  const hash = crypto.createHash('sha256');
  const out = fs.createWriteStream(zip);
  let done = 0;
  for await (const chunk of res.body) {
    hash.update(chunk);
    done += chunk.length;
    if (!out.write(chunk)) await new Promise((r) => out.once('drain', r));
    onProgress({ done, total });
  }
  await new Promise((resolve, reject) => out.end((err) => (err ? reject(err) : resolve())));

  // integrità: confronto con l'impronta pubblicata da GitHub
  if (update.digest && update.digest.startsWith('sha256:')) {
    if (hash.digest('hex') !== update.digest.slice(7)) throw new Error('Il file scaricato è corrotto: riprova');
  }

  // estrazione con ditto (conserva firma e permessi)
  const extracted = path.join(work, 'app');
  await run('/usr/bin/ditto', ['-x', '-k', zip, extracted]);
  const name = (await fsp.readdir(extracted)).find((n) => n.endsWith('.app'));
  if (!name) throw new Error('Pacchetto di aggiornamento non valido');
  const fresh = path.join(extracted, name);
  await fsp.access(path.join(fresh, 'Contents', 'MacOS'));

  // script che aspetta la chiusura dell'app, scambia le cartelle e riapre
  const script = path.join(work, 'swap.sh');
  await fsp.writeFile(
    script,
    [
      '#!/bin/sh',
      'PID="$1"; OLD="$2"; NEW="$3"',
      'while kill -0 "$PID" 2>/dev/null; do sleep 0.2; done',
      'if mv "$OLD" "$OLD.vecchia" && mv "$NEW" "$OLD"; then',
      '  rm -rf "$OLD.vecchia"',
      'else',
      '  [ -d "$OLD.vecchia" ] && [ ! -d "$OLD" ] && mv "$OLD.vecchia" "$OLD"', // rollback
      'fi',
      'xattr -dr com.apple.quarantine "$OLD" 2>/dev/null',
      'open "$OLD"',
      '',
    ].join('\n'),
    { mode: 0o700 }
  );

  return function swapAndRelaunch() {
    spawn('/bin/sh', [script, String(process.pid), bundle, fresh], { detached: true, stdio: 'ignore' }).unref();
  };
}

module.exports = { check, prepare, isNewer, pickAsset, REPO, CHANNEL };
