'use strict';
/**
 * Prova l'analisi e l'eliminazione su una finta cartella utente temporanea.
 * Non tocca nessun file reale.  Uso: npm test
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { scan, removeItem, assertDeletable } = require('./scanner.cjs');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fidati-test-'));
const home = path.join(root, 'home');
const tmp = path.join(root, 'tmp');
const write = (rel, bytes = 8192, base = home) => {
  const p = path.join(base, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, Buffer.alloc(bytes, 1));
  return p;
};

write('Library/Caches/com.apple.Safari/data.bin');
write('Library/Caches/Adobe/After Effects/disk.cache', 50000);
write('Library/Caches/com.spotify.client/blob');
write('Library/Caches/Homebrew/pkg.tar.gz');
write('Library/Application Support/Adobe/Common/Media Cache Files/a.pek', 30000);
write('Library/Application Support/Adobe/Fonts/licenza.dat');
write('Library/Preferences/com.apple.finder.plist');
write('Library/Logs/CreativeCloud/acc.log');
write('Library/Logs/DiagnosticReports/crash.ips');
write('Documents/tesi.pdf');
write('Documents/progetto/node_modules/react/index.js');
write('Documents/progetto/src/App.jsx');
write('Downloads/installer.dmg', 90000);
write('Pictures/foto.jpg');
write('Photoshop Temp12345', 20000, tmp);
write('altro.tmp', 100, tmp);

(async () => {
  const { groups, registry } = await scan({ home, tmp });
  const g = Object.fromEntries(groups.map((x) => [x.id, x]));
  const names = (id) => g[id].items.map((i) => i.name).sort();

  assert.deepStrictEqual(names('browser-cache'), ['com.apple.Safari']);
  assert.deepStrictEqual(names('adobe'), ['Adobe', 'Adobe Media Cache Files', 'Log · CreativeCloud', 'Photoshop Temp12345']);
  assert.deepStrictEqual(names('app-cache'), ['com.spotify.client']);
  assert.deepStrictEqual(names('dev-cache'), ['Homebrew']);
  assert.deepStrictEqual(names('node-modules'), ['Documents/progetto']);
  assert.deepStrictEqual(names('archives'), ['installer.dmg']);
  assert.ok(g['app-data'].items.some((i) => i.name === 'Library/Preferences'));
  assert.strictEqual(g.code.items.length, 1, 'i file dentro node_modules non vanno contati come codice');

  // i percorsi pericolosi devono essere rifiutati
  for (const bad of [
    home,
    path.join(home, 'Library'),
    path.join(home, 'Documents'),
    path.join(home, 'Library/Caches'),
    path.join(home, 'Library/Preferences/com.apple.finder.plist'),
    path.join(home, 'Library/Application Support/Adobe/Fonts'),
    path.join(home, 'Library/Caches/../Preferences'),
    path.join(tmp, 'altro.tmp'),
    '/System',
    '/Applications/Safari.app',
  ]) {
    assert.throws(() => assertDeletable(bad, home, tmp), undefined, `doveva essere rifiutato: ${bad}`);
  }

  // un elemento protetto non si elimina nemmeno forzando la chiamata
  const prot = [...registry.values()].find((r) => r.level === 'protected');
  assert.strictEqual((await removeItem({ ...prot, mode: 'rm' }, { home, tmp })).ok, false);
  assert.ok(fs.existsSync(prot.path));

  // "Fidati di me": elimina tutti e soli i gruppi sicuri
  const trashed = [];
  for (const rec of registry.values()) {
    if (rec.level === 'safe') {
      const r = await removeItem(rec, { home, tmp, trash: async (p) => trashed.push(p) });
      assert.ok(r.ok, `${rec.path}: ${r.error}`);
    }
  }
  const gone = (rel, base = home) => !fs.existsSync(path.join(base, rel));
  assert.ok(gone('Library/Caches/Adobe/After Effects/disk.cache'));
  assert.ok(gone('Library/Application Support/Adobe/Common/Media Cache Files/a.pek'));
  assert.ok(!gone('Library/Application Support/Adobe/Common/Media Cache Files'), 'la cartella resta, vuota');
  assert.ok(gone('Library/Logs/CreativeCloud/acc.log'));
  assert.ok(gone('Photoshop Temp12345', tmp));
  assert.ok(!gone('altro.tmp', tmp));
  for (const keep of [
    'Library/Application Support/Adobe/Fonts/licenza.dat',
    'Library/Preferences/com.apple.finder.plist',
    'Documents/tesi.pdf',
    'Documents/progetto/node_modules/react/index.js',
    'Downloads/installer.dmg',
    'Pictures/foto.jpg',
  ]) {
    assert.ok(!gone(keep), `non doveva essere toccato: ${keep}`);
  }
  assert.strictEqual(trashed.length, 0);

  fs.rmSync(root, { recursive: true, force: true });
  console.log('✓ Tutti i controlli superati');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});

// ── updater: confronto versioni e scelta del pacchetto ─────────────────────
{
  const { isNewer, pickAsset, check } = require('./updater.cjs');
  assert.ok(isNewer('1.0.10', '1.0.9'));
  assert.ok(isNewer('v1.1.0', '1.0.99'));
  assert.ok(!isNewer('1.0.3', '1.0.3'));
  assert.ok(!isNewer('1.0.2', '1.0.3'));
  const base = 'https://github.com/Pippoide/fidati-di-me/releases/download/v1.0.5/';
  const assets = [
    { name: 'Fidati-1.0.5-arm64.dmg', browser_download_url: base + 'Fidati-1.0.5-arm64.dmg' },
    { name: 'Fidati-1.0.5-arm64.zip', browser_download_url: base + 'Fidati-1.0.5-arm64.zip' },
    { name: 'Fidati-1.0.5-x64.zip', browser_download_url: base + 'Fidati-1.0.5-x64.zip' },
  ];
  assert.strictEqual(pickAsset(assets, 'x64').name, 'Fidati-1.0.5-x64.zip');
  assert.strictEqual(pickAsset(assets, 'arm64').name, 'Fidati-1.0.5-arm64.zip');
  // un pacchetto ospitato altrove non viene mai accettato
  assert.strictEqual(pickAsset([{ name: 'Fidati-9-x64.zip', browser_download_url: 'https://evil.example/Fidati-9-x64.zip' }], 'x64'), undefined);
  const fake = (body, status = 200) => async () => ({ ok: status === 200, status, json: async () => body });
  check({ current: '1.0.4', arch: 'arm64', fetchImpl: fake({ tag_name: 'v1.0.5', assets, html_url: 'x' }) }).then((u) =>
    assert.strictEqual(u.latest, '1.0.5')
  );
  check({ current: '1.0.5', arch: 'arm64', fetchImpl: fake({ tag_name: 'v1.0.5', assets }) }).then((u) => assert.strictEqual(u.latest, undefined));
  check({ current: '1.0.0', fetchImpl: fake({}, 404) }).then((u) => assert.strictEqual(u.latest, undefined));
}
