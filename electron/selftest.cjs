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
  }

  // ── 8. Riorganizza: progetti, collegamenti, versioni, da smistare ───────
  {
    const O = require('./organizer.cjs');
    const { Journal } = require('./journal.cjs');
    const src = path.join(root, 'org', 'Scrivania');
    const dest = path.join(root, 'org', 'Clienti');
    const w = (rel, content = 'x'.repeat(100)) => {
      const p = path.join(src, rel);
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, content);
      return p;
    };
    fs.mkdirSync(path.join(dest, 'Arianne e Bea', '2025-03_Capsules'), { recursive: true });
    w('Bivio/Totebag/foto_piccione.jpg');
    w('Bivio/Totebag/Links/texture-carta.png');
    // InDesign cita i collegamenti come percorso UTF-8 e come testo UTF-16
    w(
      'Bivio/Totebag/totebag_v2.indd',
      'INDD /Users/x/Bivio/Totebag/foto_piccione.jpg \0' + Buffer.from('texture-carta.png', 'utf16le').toString('latin1'),
    );
    w('Bivio/Totebag/totebag_v1.indd', 'vuoto');
    w('Bivio/Totebag/Export/totebag_def.pdf');
    w('Bivio/Totebag/brief cliente.docx');
    w('Bivio/Totebag/strano.xyz');
    w('Brochure Folder/Brochure.indd');
    w('Brochure Folder/Links/a.jpg');
    w('arianne_capsules_post1.png');
    w('arianne_capsules_post2.png');
    w('IMG_1234.jpg');
    w('sito/package.json', '{}');
    w('sito/src/index.js');

    const orgCtx = { kind: 'external', root: path.join(root, 'org'), home, exclude: [], cloudRoots: [], destRoot: dest };
    const r = await O.analyze({ sources: [src], destRoot: dest, isAllowed: (p) => (O.assertMovable(p, orgCtx), true) });
    const find = (pred) => r.clusters.find((c) => c.items.some(pred));
    const tote = find((i) => i.name === 'totebag_v2.indd');
    assert.strictEqual(tote.client, 'Bivio');
    assert.strictEqual(tote.project, 'Totebag');
    assert.ok(tote.confidence >= 70);
    const linked = tote.items
      .filter((i) => i.group)
      .map((i) => i.name)
      .sort();
    assert.deepStrictEqual(linked, ['foto_piccione.jpg', 'texture-carta.png', 'totebag_v2.indd'], 'collegamenti trovati');
    assert.strictEqual(tote.items.find((i) => i.name === 'totebag_v1.indd').sub, 'archive', 'versione vecchia in 99_Archivio');
    assert.strictEqual(tote.items.find((i) => i.name === 'brief cliente.docx').sub, 'brief');
    const capsule = find((i) => i.name === 'arianne_capsules_post1.png');
    assert.strictEqual(capsule.client, 'Arianne e Bea', 'cliente già presente riconosciuto');
    assert.strictEqual(capsule.project, 'Capsules');
    assert.ok(find((i) => i.name === 'IMG_1234.jpg').confidence < 70, 'file anonimo da smistare');
    assert.ok(find((i) => i.name === 'strano.xyz').confidence < 70, 'tipo sconosciuto da smistare');
    assert.ok(
      find((i) => i.kind === 'dir' && i.name === 'Brochure Folder'),
      'pacchetto InDesign intero',
    );
    assert.ok(!r.clusters.some((c) => c.items.some((i) => i.from.includes(`${path.sep}sito${path.sep}`))), 'progetti di codice ignorati');

    const log = path.join(root, 'org', 'log.jsonl');
    const j = await new Journal(log).load();
    const sid = await j.startSession({ kind: 'riorganizza', label: 'test', root: src });
    const jobs = r.clusters.filter((c) => c.confidence >= 70).map((c) => ({ cluster: c, client: c.client, project: c.project }));
    const res = await O.apply(jobs, {
      destRoot: dest,
      existing: r.existing,
      rename: true,
      journal: j,
      sessionId: sid,
      sources: [src],
      assertMovable: (p) => O.assertMovable(p, orgCtx),
    });
    assert.strictEqual(res.failed.length, 0);
    const proj = path.join(dest, 'Bivio');
    const [projDir] = fs.readdirSync(proj);
    assert.ok(/^\d{4}-\d{2}_Totebag$/.test(projDir));
    const group = path.join(proj, projDir, '02_Lavorazione', 'Bivio_Totebag_v02');
    assert.ok(fs.existsSync(path.join(group, 'Bivio_Totebag_v02.indd')));
    assert.ok(fs.existsSync(path.join(group, 'Links', 'Bivio_Totebag_texture_carta.png')), 'disposizione dei collegamenti conservata');
    const txt = fs.readFileSync(path.join(group, O.LINKS_TXT), 'utf8');
    assert.ok(txt.includes('foto_piccione.jpg  →  Bivio_Totebag_foto_piccione.jpg'));
    assert.ok(fs.existsSync(path.join(proj, projDir, '99_Archivio', 'Bivio_Totebag_v01.indd')));
    assert.ok(
      fs.existsSync(path.join(dest, 'Arianne e Bea', '2025-03_Capsules', '01_Asset', 'Immagini', 'Arianne_e_Bea_Capsules_post1.png')),
    );
    assert.ok(fs.existsSync(path.join(src, 'IMG_1234.jpg')), 'i file da smistare restano dove sono');
    assert.ok(fs.existsSync(path.join(src, 'Bivio/Totebag/strano.xyz')));
    assert.throws(() => O.assertMovable(path.join(dest, 'x.jpg'), orgCtx), /Clienti/);

    // il registro sopravvive alla chiusura: lo si rilegge da zero e si ripristina tutto
    const j2 = await new Journal(log).load();
    const ids = j2.list()[0].entries.map((e) => e.id);
    assert.ok(ids.length >= 8);
    // un file modificato dopo lo spostamento chiede conferma
    fs.appendFileSync(path.join(group, 'Bivio_Totebag_v02.indd'), 'modifica');
    const first = await j2.restore(ids);
    assert.ok(first.needsConfirm.some((i) => i.kind === 'modified'));
    const back = await j2.restore(ids, { force: true });
    assert.ok(
      back.results.every((x) => x.ok),
      JSON.stringify(back.results.filter((x) => !x.ok)),
    );
    for (const rel of [
      'Bivio/Totebag/totebag_v2.indd',
      'Bivio/Totebag/Links/texture-carta.png',
      'Bivio/Totebag/Export/totebag_def.pdf',
      'arianne_capsules_post1.png',
    ]) {
      assert.ok(fs.existsSync(path.join(src, rel)), `ripristinato: ${rel}`);
    }
    assert.ok(!fs.existsSync(proj), 'le cartelle create da Fidati vengono tolte');
    assert.ok(fs.existsSync(path.join(dest, 'Arianne e Bea', '2025-03_Capsules')), 'le cartelle che c’erano già restano');
    assert.strictEqual(
      (await new Journal(log).load()).list()[0].entries.every((e) => e.state === 'restored'),
      true,
    );
  }

  // ── 9. Pulizia: dal Cestino alla cartella d'origine ─────────────────────
  {
    const { Journal, trashWithLog } = require('./journal.cjs');
    const fakeTrash = path.join(root, 'trash');
    fs.mkdirSync(fakeTrash);
    const doc = write('Documents/preventivo.pdf', 5000);
    write('preventivo.pdf', 10, fakeTrash); // nel Cestino c'è già un file con lo stesso nome
    const trashFn = async (p) => fs.renameSync(p, path.join(fakeTrash, 'preventivo 2.pdf')); // come fa il Finder
    const log = path.join(root, 'pulizia.jsonl');
    const j = await new Journal(log).load();
    const sid = await j.startSession({ kind: 'pulizia', label: 'test', root: home });
    await trashWithLog(j, sid, doc, { trashFn, trashDir: fakeTrash, size: 5000 });
    assert.ok(!fs.existsSync(doc));
    const j2 = await new Journal(log).load();
    const [entry] = j2.list()[0].entries;
    assert.strictEqual(entry.to, path.join(fakeTrash, 'preventivo 2.pdf'));
    const res = await j2.restore([entry.id]);
    assert.ok(res.results[0].ok);
    assert.strictEqual(fs.statSync(doc).size, 5000, 'tornato nella cartella d’origine');
    assert.ok(fs.existsSync(path.join(fakeTrash, 'preventivo.pdf')), 'l’altro file nel Cestino non si tocca');
  }

  fs.rmSync(root, { recursive: true, force: true });
  console.log('✓ Tutti i controlli superati');
})().catch((err) => {
  console.error(err);
  fs.rmSync(root, { recursive: true, force: true });
  process.exit(1);
});
