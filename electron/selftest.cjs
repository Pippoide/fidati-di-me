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
