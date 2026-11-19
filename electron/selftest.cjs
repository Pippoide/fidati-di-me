'use strict';
/**
 * Prova analisi, eliminazione, dischi ed esclusioni su cartelle finte temporanee.
 * Non tocca nessun file reale.  Uso: npm test
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { scan, removeItem, assertDeletable } = require('./scanner.cjs');
const { listDisks, listFolders, cloudRoots, onDisk } = require('./disks.cjs');

// realpath: su macOS la cartella temporanea (/var/folders/…) è un link a /private/var/…
const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'fidati-test-')));
const home = path.join(root, 'home');
const tmp = path.join(root, 'tmp');
const vol = path.join(root, 'Volumes', 'Lavori');
const write = (rel, bytes = 8192, base = home) => {
  const p = path.join(base, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, Buffer.alloc(bytes, 1));
  return p;
};
const gone = (rel, base = home) => !fs.existsSync(path.join(base, rel));
const names = (groups, id) => (groups.find((g) => g.id === id)?.items || []).map((i) => i.name).sort();
const trashLog = [];
const trash = async (p) => trashLog.push(p);

// ── disco di sistema finto ──
write('Library/Caches/com.apple.Safari/data.bin');
write('Library/Caches/Adobe/After Effects/disk.cache', 50000);
write('Library/Caches/com.spotify.client/blob');
write('Library/Caches/Homebrew/pkg.tar.gz');
write('Library/Application Support/Adobe/Common/Media Cache Files/a.pek', 30000);
write('Library/Application Support/Adobe/Fonts/licenza.dat');
write('Library/Preferences/com.apple.finder.plist');
write('Library/Logs/CreativeCloud/acc.log');
write('Library/Logs/DiagnosticReports/crash.ips');
write('Library/CloudStorage/Dropbox-Azienda/contratto.pdf', 40000);
write('Library/CloudStorage/Dropbox-Azienda/video.mov', 70000);
write('Documents/tesi.pdf');
write('Documents/progetto/node_modules/react/index.js');
write('Documents/progetto/src/App.jsx');
write('Downloads/installer.dmg', 90000);
write('Downloads/foto-vacanze.jpg');
write('Pictures/foto.jpg');
write('Photoshop Temp12345', 20000, tmp);
write('altro.tmp', 100, tmp);

// ── disco esterno finto ──
write('Progetti/spot.prproj', 5000, vol);
write('Progetti/girato/clip.mp4', 60000, vol);
write('Adobe/Media Cache Files/clip.cfa', 40000, vol);
write('Archivio/vecchio.zip', 30000, vol);
write('.Spotlight-V100/store.db', 9000, vol);
write('System Volume Information/x', 9000, vol);
write('.Trashes/501/buttato.mov', 25000, vol);

const dev = (p) => fs.lstatSync(p).dev;

(async () => {
  const clouds = await cloudRoots(home);
  const dropbox = path.join(home, 'Library/CloudStorage/Dropbox-Azienda');
  assert.deepStrictEqual(clouds, [dropbox]);

  const sysCtx = (exclude = []) => ({ kind: 'system', root: home, home, tmp, exclude, cloudRoots: clouds, dev: dev(home), uid: 501 });
  const extCtx = (exclude = []) => ({ kind: 'external', root: vol, home, tmp, exclude, cloudRoots: [], dev: dev(vol), uid: 501 });

  // ── 1. Disco di sistema con Download e Dropbox esclusi ────────────────────
  const excl = [path.join(home, 'Downloads'), dropbox];
  {
    const { groups, registry } = await scan(sysCtx(excl));
    assert.deepStrictEqual(names(groups, 'browser-cache'), ['com.apple.Safari']);
    assert.deepStrictEqual(names(groups, 'adobe'), ['Adobe', 'Adobe Media Cache Files', 'Log · CreativeCloud', 'Photoshop Temp12345']);
    assert.deepStrictEqual(names(groups, 'node-modules'), ['Documents/progetto']);
    assert.deepStrictEqual(names(groups, 'archives'), [], 'Download è escluso');
    assert.deepStrictEqual(names(groups, 'video'), [], 'Dropbox è escluso');
    const all = [...registry.values()].map((r) => r.path);
    assert.ok(!all.some((p) => p.startsWith(path.join(home, 'Downloads'))), 'nessun file da Download');
    assert.ok(!all.some((p) => p.startsWith(dropbox)), 'nessun file da Dropbox');
    assert.ok(!names(groups, 'app-data').includes('Library/CloudStorage'), 'Dropbox non conta nei dati delle app');
  }

  // ── 2. Dropbox incluso: i file compaiono marcati come cloud ──────────────
  {
    const { groups } = await scan(sysCtx([path.join(home, 'Downloads')]));
    const v = groups.find((g) => g.id === 'video').items[0];
    assert.strictEqual(v.name, 'video.mov');
    assert.strictEqual(v.cloud, true);
  }

  // ── 3. Barriera di sicurezza ─────────────────────────────────────────────
  const ctx = sysCtx(excl);
  for (const [bad, mode] of [
    [home, 'rm'],
    [path.join(home, 'Library'), 'rm'],
    [path.join(home, 'Documents'), 'trash'],
    [path.join(home, 'Library/Caches'), 'contents'],
    [path.join(home, 'Library/Preferences/com.apple.finder.plist'), 'rm'],
    [path.join(home, 'Library/Application Support/Adobe/Fonts'), 'contents'],
    [path.join(home, 'Library/Caches/../Preferences'), 'rm'],
    [path.join(home, 'Downloads/installer.dmg'), 'trash'], // escluso
    [dropbox, 'trash'], // la cartella sincronizzata in sé
    [path.join(home, 'Documents/tesi.pdf'), 'contents'], // modalità sbagliata
    [path.join(tmp, 'altro.tmp'), 'rm'],
    [path.join(vol, 'Archivio/vecchio.zip'), 'trash'], // altro disco
    ['/System', 'rm'],
  ]) {
    assert.throws(() => assertDeletable(bad, ctx, mode), undefined, `doveva essere rifiutato: ${bad}`);
  }
  assert.throws(() => assertDeletable(path.join(home, 'Documents'), sysCtx([path.join(home, 'Documents/progetto')]), 'trash'), /esclusa/);

  // ── 4. Disco esterno ────────────────────────────────────────────────────
  {
    const { groups, registry } = await scan(extCtx());
    assert.deepStrictEqual(names(groups, 'adobe'), ['Adobe Media Cache Files · Adobe']);
    assert.deepStrictEqual(names(groups, 'trash'), ['Cestino di questo disco']);
    assert.deepStrictEqual(names(groups, 'creative'), ['spot.prproj']);
    const all = [...registry.values()].map((r) => r.path);
    assert.ok(!all.some((p) => p.includes('.Spotlight') || p.includes('System Volume Information')));
    assert.ok(!all.some((p) => p.startsWith(home)), 'su un disco esterno non si guarda la cartella Inizio');
    for (const [bad, mode] of [
      [vol, 'rm'],
      [path.join(vol, '.Spotlight-V100'), 'rm'],
      [path.join(vol, 'Progetti'), 'rm'], // rm solo per node_modules
      [path.join(vol, 'Progetti'), 'contents'],
      [path.join(home, 'Documents/tesi.pdf'), 'trash'],
    ]) {
      assert.throws(() => assertDeletable(bad, extCtx(), mode), undefined, `doveva essere rifiutato: ${bad}`);
    }

    // escludere "Progetti" toglie anche il suo contenuto dall'analisi
    const r2 = await scan(extCtx([path.join(vol, 'Progetti')]));
    assert.deepStrictEqual(names(r2.groups, 'creative'), []);
    assert.deepStrictEqual(names(r2.groups, 'video'), []);

    // "Fidati di me" sul disco esterno: solo la Media Cache Adobe
    for (const rec of registry.values()) {
      if (rec.level !== 'safe') continue;
      const r = await removeItem(rec, extCtx(), { trash });
      assert.ok(r.ok, `${rec.path}: ${r.error}`);
    }
    assert.ok(gone('Adobe/Media Cache Files/clip.cfa', vol));
    assert.ok(!gone('Adobe/Media Cache Files', vol), 'la cartella resta, vuota');
    assert.ok(!gone('Progetti/girato/clip.mp4', vol));

    // il Cestino svuotato è solo quello di questo disco
    const t = [...registry.values()].find((r) => r.groupId === 'trash');
    assert.ok((await removeItem(t, extCtx(), { trash })).ok);
    assert.ok(gone('.Trashes/501/buttato.mov', vol));

    // un'esclusione aggiunta dopo l'analisi blocca comunque l'eliminazione
    const zip = [...registry.values()].find((r) => r.name === 'vecchio.zip');
    const blocked = await removeItem(zip, extCtx([path.join(vol, 'Archivio')]), { trash });
    assert.strictEqual(blocked.ok, false);
    assert.strictEqual(trashLog.length, 0);
  }

  // ── 5. "Fidati di me" sul disco di sistema ──────────────────────────────
  {
    const { registry } = await scan(sysCtx(excl));
    const prot = [...registry.values()].find((r) => r.level === 'protected');
    assert.strictEqual((await removeItem({ ...prot, mode: 'rm' }, sysCtx(excl), { trash })).ok, false);
    assert.ok(fs.existsSync(prot.path));
    for (const rec of registry.values()) {
      if (rec.level !== 'safe') continue;
      const r = await removeItem(rec, sysCtx(excl), { trash });
      assert.ok(r.ok, `${rec.path}: ${r.error}`);
    }
    assert.ok(gone('Library/Caches/Adobe/After Effects/disk.cache'));
    assert.ok(gone('Library/Application Support/Adobe/Common/Media Cache Files/a.pek'));
    assert.ok(!gone('Library/Application Support/Adobe/Common/Media Cache Files'));
    assert.ok(gone('Library/Logs/CreativeCloud/acc.log'));
    assert.ok(gone('Photoshop Temp12345', tmp));
    for (const keep of [
      'Library/Application Support/Adobe/Fonts/licenza.dat',
      'Library/Preferences/com.apple.finder.plist',
      'Library/CloudStorage/Dropbox-Azienda/contratto.pdf',
      'Documents/tesi.pdf',
      'Documents/progetto/node_modules/react/index.js',
      'Downloads/installer.dmg',
      'Pictures/foto.jpg',
    ]) {
      assert.ok(!gone(keep), `non doveva essere toccato: ${keep}`);
    }
    assert.ok(!gone('altro.tmp', tmp));
    assert.ok(!gone('Progetti/girato/clip.mp4', vol), 'l’altro disco non si tocca');
    assert.strictEqual(trashLog.length, 0);
  }

  // ── 6. Elenco dischi e cartelle ─────────────────────────────────────────
  {
    const volumes = path.join(root, 'Volumes');
    fs.symlinkSync('/', path.join(volumes, 'Macintosh HD'));
    write('Backups.backupdb/x', 10, path.join(volumes, 'Backup TM'));
    write('System/Library/CoreServices/SystemVersion.plist', 10, path.join(volumes, 'Vecchio Mac'));
    const disks = await listDisks({ volumesDir: volumes, home });
    assert.deepStrictEqual(
      disks.map((d) => [d.name, d.kind, d.disabled || null]),
      [
        ['Macintosh HD', 'system', null],
        ['Backup TM', 'external', 'Disco di backup Time Machine'],
        ['Lavori', 'external', null],
        ['Vecchio Mac', 'external', 'Contiene un’installazione di macOS'],
      ]
    );

    const sys = disks[0];
    const folders = await listFolders(sys, { excluded: excl, home });
    const byName = Object.fromEntries(folders.map((f) => [f.name, f]));
    assert.strictEqual(byName.Download.excluded, true);
    assert.strictEqual(byName.Documenti.excluded, false);
    assert.strictEqual(byName['Dropbox · Azienda'].cloud, true);
    assert.strictEqual(byName['Dropbox · Azienda'].excluded, true);
    assert.ok(!folders.some((f) => f.name === 'Library'));

    const ext = disks.find((d) => d.name === 'Lavori');
    const extFolders = (await listFolders(ext, { excluded: [path.join(vol, 'Archivio')], home })).map((f) => [f.name, f.excluded]);
    assert.deepStrictEqual(extFolders, [['Adobe', false], ['Archivio', true], ['Progetti', false]]);
    assert.ok(!onDisk(path.join(home, 'Documents'), ext, home), 'una cartella di un altro disco non si può escludere qui');
    assert.ok(onDisk(path.join(vol, 'Progetti/girato'), ext, home));
  }

  // ── 7. updater: confronto versioni e scelta del pacchetto ───────────────
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
    assert.strictEqual(pickAsset([{ name: 'Fidati-9-x64.zip', browser_download_url: 'https://evil.example/Fidati-9-x64.zip' }], 'x64'), undefined);
    const fake = (body, status = 200) => async () => ({ ok: status === 200, status, json: async () => body });
    assert.strictEqual((await check({ current: '1.0.4', arch: 'arm64', fetchImpl: fake({ tag_name: 'v1.0.5', assets, html_url: 'x' }) })).latest, '1.0.5');
    assert.strictEqual((await check({ current: '1.0.5', arch: 'arm64', fetchImpl: fake({ tag_name: 'v1.0.5', assets }) })).latest, undefined);
    assert.strictEqual((await check({ current: '1.0.0', fetchImpl: fake({}, 404) })).latest, undefined);
    // due varianti: Fidati segue solo le release normali, Fidati BK solo quelle -bk
    const bkBase = 'https://github.com/Pippoide/fidati-di-me/releases/download/v1.0.9-bk/';
    const bkAssets = [{ name: 'Fidati-BK-1.0.9-arm64.zip', browser_download_url: bkBase + 'Fidati-BK-1.0.9-arm64.zip' }];
    assert.strictEqual(pickAsset([...assets, ...bkAssets], 'arm64', 'bk').name, 'Fidati-BK-1.0.9-arm64.zip');
    assert.strictEqual(pickAsset(bkAssets, 'arm64'), undefined, 'Fidati non installa mai lo zip BK');
    const list = [
      { tag_name: 'v1.0.10', assets },
      { tag_name: 'v1.0.9-bk', assets: bkAssets, html_url: 'bk' },
    ];
    assert.strictEqual((await check({ current: '1.0.4', arch: 'arm64', channel: 'bk', fetchImpl: fake(list) })).latest, '1.0.9');
    assert.strictEqual((await check({ current: '1.0.9', arch: 'arm64', channel: 'bk', fetchImpl: fake(list) })).latest, undefined);
    assert.strictEqual((await check({ current: '1.0.4', arch: 'arm64', fetchImpl: fake({ tag_name: 'v1.0.9-bk', assets: bkAssets }) })).latest, undefined);
  }

  // ── 8. trasferimento ordinato: l'esempio HD A → HD B ─────────────────────
  {
    const T = require('./transfer.cjs');
    const A = path.join(root, 'HD A');
    const B = path.join(root, 'HD B');
    write('Rossi/2025/Spot Estate/Sottoprogetto 1A/Assets/logo.png', 3000, A);
    write('Rossi/2025/Spot Estate/Sottoprogetto 1A/Export/spot.mp4', 9000, A);
    write('Rossi/2025/Spot Estate/Sottoprogetto 1A/spot.prproj', 2000, A);
    write('Rossi/2025/Spot Estate/Sottoprogetto 2/post.ai', 1000, A);
    write('Rossi/2025/Spot Estate/Montaggio/v1.prproj', 1000, A);
    write('Rossi/2025/Spot Estate/Montaggio/v2.prproj', 1000, A);
    write('Rossi/2025/Spot Estate/brief.pdf', 500, A);
    write('Rossi/2024/Catalogo/Stampa/catalogo.indd', 4000, A);
    write('Bianchi/2025/Logo/Def/logo.ai', 1500, A);
    write('Verdi/2025/SpotEstate/Social/reel.psd', 1500, A);
    write('Rossi/2025/Spot Estate/Sottoprogetto 1B/x.psd', 100, B);
    write('Rossi/2025/Spot Estate/Montaggio/v1.prproj', 7, B); // diverso: NON va sovrascritto
    write('Rossi/2025/Progetto 2/y.psd', 100, B);
    write('Verdi/2025/Spot Estate/Social/reel.psd', 77, B);
    write('Archivio/Bianchi/vecchio.ai', 100, B);
    const before = fs.readFileSync(path.join(A, 'Rossi/2025/Spot Estate/Sottoprogetto 1A/Export/spot.mp4'));

    const src = await T.readTree(A);
    const dst = await T.readTree(B);
    const det = T.detectLevels(src.tree);
    assert.strictEqual(det.suggested, 4, 'Cliente / Anno / Progetto / Sottoprogetto');
    assert.deepStrictEqual(det.levels.map((l) => l.role), ['Cliente', 'Anno', 'Progetto', 'Sottoprogetto', 'Contenuto']);

    const plan = await T.buildPlan({ srcTree: src.tree, destTree: dst.tree, depth: 4, roles: det.levels.map((l) => l.role) });
    const at = (rel) => plan.find((e) => path.relative(A, e.srcDir) === rel);
    const to = (e) => path.relative(B, e.destDir);

    // Spot Estate esiste in entrambi: dentro ci va solo il Sottoprogetto 1A (e il 2)
    assert.strictEqual(at('Rossi/2025/Spot Estate/Sottoprogetto 1A').kind, 'new');
    assert.strictEqual(to(at('Rossi/2025/Spot Estate/Sottoprogetto 1A')), 'Rossi/2025/Spot Estate/Sottoprogetto 1A');
    assert.strictEqual(at('Rossi/2025/Spot Estate/Sottoprogetto 1A').files, 3);
    assert.strictEqual(to(at('Rossi/2025/Spot Estate/Sottoprogetto 2')), 'Rossi/2025/Spot Estate/Sottoprogetto 2');
    assert.ok(!at('Rossi/2025/Spot Estate/Sottoprogetto 1B'), 'quello che c’è solo all’arrivo non si tocca');
    // Montaggio c'è già: si aggiunge solo v2, v1 resta quello dell'arrivo
    const mont = at('Rossi/2025/Spot Estate/Montaggio');
    assert.strictEqual(mont.kind, 'merge');
    assert.deepStrictEqual([mont.files, mont.skipped], [1, 1]);
    // file sciolti nel progetto
    assert.strictEqual(at('Rossi/2025/Spot Estate').kind, 'loose');
    // un anno che manca: si crea dentro il cliente che c'è già
    assert.strictEqual(to(at('Rossi/2024')), 'Rossi/2024');
    // un cliente nuovo, ma con lo stesso nome altrove: suggerito e non selezionato
    const bianchi = at('Bianchi');
    assert.strictEqual(bianchi.kind, 'new');
    assert.strictEqual(bianchi.selected, false);
    assert.strictEqual(path.relative(B, bianchi.suggestions[0].destDir), 'Archivio/Bianchi');
    // nome simile (SpotEstate ↔ Spot Estate): proposto ma da verificare
    const verdi = at('Verdi/2025/SpotEstate/Social');
    assert.strictEqual(verdi.match, 'similar');
    assert.strictEqual(verdi.selected, false);
    assert.strictEqual(verdi.kind, 'present', 'reel.psd c’è già all’arrivo');

    // copia di tutto ciò che è selezionato
    const ctx = { srcRoot: A, destRoot: B };
    for (const e of plan.filter((x) => x.selected)) {
      const r = await T.copyEntry(e, ctx);
      assert.deepStrictEqual(r.errors, []);
    }
    assert.ok(fs.existsSync(path.join(B, 'Rossi/2025/Spot Estate/Sottoprogetto 1A/Export/spot.mp4')));
    assert.ok(fs.existsSync(path.join(B, 'Rossi/2025/Spot Estate/Sottoprogetto 1A/Assets/logo.png')));
    assert.ok(fs.existsSync(path.join(B, 'Rossi/2025/Spot Estate/Montaggio/v2.prproj')));
    assert.ok(fs.existsSync(path.join(B, 'Rossi/2025/Spot Estate/brief.pdf')));
    assert.ok(fs.existsSync(path.join(B, 'Rossi/2024/Catalogo/Stampa/catalogo.indd')));
    assert.strictEqual(fs.statSync(path.join(B, 'Rossi/2025/Spot Estate/Montaggio/v1.prproj')).size, 7, 'nessuna sovrascrittura');
    assert.ok(!fs.existsSync(path.join(B, 'Bianchi')), 'i non selezionati restano dove sono');
    // la partenza è intatta
    assert.ok(before.equals(fs.readFileSync(path.join(A, 'Rossi/2025/Spot Estate/Sottoprogetto 1A/Export/spot.mp4'))));
    assert.ok(fs.existsSync(path.join(A, 'Bianchi/2025/Logo/Def/logo.ai')));

    // rifacendo il piano, quello copiato risulta "già presente"
    const again = await T.buildPlan({ srcTree: (await T.readTree(A)).tree, destTree: (await T.readTree(B)).tree, depth: 4, roles: [] });
    assert.ok(again.filter((e) => e.selected).length === 0, 'niente da ricopiare');

    // destinazione scelta dall'utente per un non selezionato
    const moved = await T.remeasure(bianchi, path.join(B, 'Da sistemare', 'Bianchi'), { match: 'manual' });
    await T.copyEntry(moved, ctx);
    assert.ok(fs.existsSync(path.join(B, 'Da sistemare/Bianchi/2025/Logo/Def/logo.ai')));

    // barriere: mai copiare fuori dall'arrivo o dentro la partenza
    assert.throws(() => T.assertCopyTarget(path.join(root, 'altrove'), ctx), /fuori/);
    assert.throws(() => T.assertCopyTarget(path.join(B, '../HD A/x'), ctx));
    assert.throws(() => T.assertCopyTarget(path.join(A, 'x'), { srcRoot: A, destRoot: root }), /partenza/);
    assert.strictEqual(T.compareNames('2024', '2025'), null);
    assert.strictEqual(T.compareNames('Spot Estate', 'spot-estate'), 'exact');
    assert.strictEqual(T.compareNames('Sottoprogetto 1A', 'Sottoprogetto 1B'), null);
    assert.strictEqual(T.compareNames('Progetto A', 'Progetto B'), null);
    assert.strictEqual(T.compareNames('Catalgo 2024', 'Catalogo 2024'), 'similar');
    assert.strictEqual(T.compareNames('01 Brief', 'Brief'), 'similar');
  }

  fs.rmSync(root, { recursive: true, force: true });
  console.log('✓ Tutti i controlli superati');
})().catch((err) => {
  console.error(err);
  fs.rmSync(root, { recursive: true, force: true });
  process.exit(1);
});
