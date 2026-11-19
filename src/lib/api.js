/**
 * Ponte verso il sistema. Dentro l'app usa window.fidati (electron/preload.cjs).
 * Aperta in un browser con `npm run dev` usa dati finti, così puoi lavorare
 * sull'interfaccia senza analizzare né cancellare niente.
 */
const GB = 1e9;
const MB = 1e6;
let n = 0;
const item = (name, path, size, extra = {}) => ({ id: `m${++n}`, name, path, size, ...extra });
const group = (id, level, title, description, items) => ({
  id,
  level,
  title,
  description,
  items,
  totalCount: items.length,
  size: items.reduce((s, i) => s + i.size, 0),
});

const mockSystem = () => [
  group('adobe', 'safe', 'Cache Adobe', 'Media Cache, Peak Files, cache di Photoshop, Premiere, After Effects, Lightroom.', [
    item('Adobe Media Cache Files', '/Users/tu/Library/Application Support/Adobe/Common/Media Cache Files', 18.4 * GB),
    item('Adobe', '/Users/tu/Library/Caches/Adobe', 6.2 * GB),
    item('Adobe Camera Raw 2', '/Users/tu/Library/Caches/Adobe Camera Raw 2', 1.1 * GB),
  ]),
  group('app-cache', 'safe', 'Cache delle applicazioni', 'File temporanei in ~/Library/Caches.', [
    item('com.spotify.client', '/Users/tu/Library/Caches/com.spotify.client', 3.3 * GB),
    item('com.figma.Desktop', '/Users/tu/Library/Caches/com.figma.Desktop', 820 * MB),
  ]),
  group('browser-cache', 'safe', 'Cache dei browser', 'Solo la cache: cronologia e password restano.', [
    item('Google', '/Users/tu/Library/Caches/Google', 2.4 * GB),
  ]),
  group('node-modules', 'caution', 'Cartelle node_modules', 'Si rigenerano con npm install.', [
    item('Sites/portfolio', '/Users/tu/Sites/portfolio/node_modules', 640 * MB),
    item('Sites/evolution', '/Users/tu/Sites/evolution/node_modules', 410 * MB),
  ]),
  group('video', 'caution', 'Video', 'I tuoi file video. Finiscono nel Cestino.', [
    item('reel-2026.mov', '/Users/tu/Movies/reel-2026.mov', 4.8 * GB),
    item('presentazione.mp4', '/Users/tu/Library/CloudStorage/Dropbox-Azienda/presentazione.mp4', 1.2 * GB, { cloud: true }),
  ]),
  group('app-data', 'protected', 'Dati e impostazioni delle app', 'Eliminarli rompe le app o fa perdere dati.', [
    item('Library/Application Support', '/Users/tu/Library/Application Support', 22 * GB),
  ]),
  group('system', 'protected', 'Sistema macOS', 'File del sistema operativo.', [
    item('System', '/System', 0, { note: 'Protetto da macOS, non analizzato' }),
  ]),
];

const mockExternal = () => [
  group('adobe', 'safe', 'Cache Adobe', 'Media Cache e Peak Files trovati su questo disco.', [
    item('Adobe Media Cache Files · Premiere', '/Volumes/Lavori/Premiere/Media Cache Files', 42 * GB),
  ]),
  group('trash', 'caution', 'Cestino', 'Solo il Cestino di questo disco. Svuotarlo è definitivo.', [
    item('Cestino di questo disco', '/Volumes/Lavori/.Trashes/501', 7.5 * GB),
  ]),
  group('video', 'caution', 'Video', 'I tuoi file video. Finiscono nel Cestino.', [
    item('girato-A001.mov', '/Volumes/Lavori/Progetti/spot/girato-A001.mov', 31 * GB),
  ]),
];

const mockDisks = [
  { id: 'system', name: 'Macintosh HD', kind: 'system', root: '/Users/tu', total: 494 * GB, free: 41 * GB },
  { id: '/Volumes/Lavori', name: 'Lavori', kind: 'external', root: '/Volumes/Lavori', total: 2000 * GB, free: 312 * GB },
  { id: '/Volumes/Backup', name: 'Backup', kind: 'external', root: '/Volumes/Backup', total: 4000 * GB, free: 900 * GB, disabled: 'Disco di backup Time Machine' },
];

const mockFolders = {
  system: [
    ['Documenti', '/Users/tu/Documents'],
    ['Download', '/Users/tu/Downloads'],
    ['Filmati', '/Users/tu/Movies'],
    ['Immagini', '/Users/tu/Pictures'],
    ['Scrivania', '/Users/tu/Desktop'],
    ['Sites', '/Users/tu/Sites'],
    ['Dropbox · Azienda', '/Users/tu/Library/CloudStorage/Dropbox-Azienda', true],
    ['iCloud Drive', '/Users/tu/Library/Mobile Documents/com~apple~CloudDocs', true],
  ],
  '/Volumes/Lavori': [
    ['Archivio', '/Volumes/Lavori/Archivio'],
    ['Premiere', '/Volumes/Lavori/Premiere'],
    ['Progetti', '/Volumes/Lavori/Progetti'],
  ],
};
const mockExcluded = new Set(['/Users/tu/Library/CloudStorage/Dropbox-Azienda', '/Users/tu/Library/Mobile Documents/com~apple~CloudDocs']);
const foldersOf = (diskId) =>
  (mockFolders[diskId] || []).map(([name, path, cloud]) => ({ name, path, cloud: !!cloud, custom: false, excluded: mockExcluded.has(path) }));

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let progressCb = () => {};

// ── trasferimento ordinato (dati finti) ──
const level = (depth, role, examples, count) => ({ depth, role, examples, count, yearShare: role === 'Anno' ? 1 : 0, contentShare: 0, projectShare: 0 });
const mockLevels = {
  src: [
    level(0, 'Cliente', ['Bianchi', 'Rossi'], 2),
    level(1, 'Anno', ['2024', '2025'], 3),
    level(2, 'Progetto', ['Catalogo', 'Logo', 'Spot Estate'], 3),
    level(3, 'Sottoprogetto', ['Def', 'Montaggio', 'Social', 'Storyboard'], 5),
    level(4, 'Contenuto', ['Assets', 'Export'], 2),
  ],
  dest: [
    level(0, 'Cliente', ['Rossi'], 1),
    level(1, 'Anno', ['2025'], 1),
    level(2, 'Progetto', ['Progetto 2', 'Spot Estate'], 2),
    level(3, 'Contenuto', ['Montaggio'], 1),
  ],
};
const step = (name, role, dest, match = 'exact') => ({ name, role, dest, match });
const entry = (id, kind, name, role, src, dest, files, size, extra = {}) => ({
  id, kind, name, role, src, dest, files, size, skipped: 0, skippedSize: 0, match: 'exact', custom: false, suggestions: [], via: [],
  selected: kind !== 'present', ...extra,
});
const mockPlan = () => [
  entry('t1', 'new', 'Storyboard', 'Sottoprogetto', 'Rossi/2025/Spot Estate/Storyboard', 'Rossi/2025/Spot Estate/Storyboard', 214, 38 * GB, {
    via: [step('Rossi', 'Cliente', 'Rossi'), step('2025', 'Anno', '2025'), step('Spot Estate', 'Progetto', 'Spot Estate')],
  }),
  entry('t2', 'new', 'Social', 'Sottoprogetto', 'Rossi/2025/Spot Estate/Social', 'Rossi/2025/Spot Estate/Social', 48, 2.1 * GB, {
    via: [step('Rossi', 'Cliente', 'Rossi'), step('2025', 'Anno', '2025'), step('Spot Estate', 'Progetto', 'Spot Estate')],
  }),
  entry('t3', 'merge', 'Montaggio', 'Sottoprogetto', 'Rossi/2025/Spot Estate/Montaggio', 'Rossi/2025/Spot Estate/Montaggio', 12, 6.4 * GB, {
    skipped: 31, skippedSize: 22 * GB,
    via: [step('Rossi', 'Cliente', 'Rossi'), step('2025', 'Anno', '2025'), step('Spot Estate', 'Progetto', 'Spot Estate'), step('Montaggio', 'Sottoprogetto', 'Montaggio')],
  }),
  entry('t4', 'new', '2024', 'Anno', 'Rossi/2024', 'Rossi/2024', 380, 54 * GB, { via: [step('Rossi', 'Cliente', 'Rossi')] }),
  entry('t5', 'new', 'Bianchi', 'Cliente', 'Bianchi', 'Bianchi', 96, 9.3 * GB, {
    match: 'none', selected: false,
    suggestions: [{ index: 0, dest: 'Archivio/Bianchi', why: 'Stesso nome in un altro punto dell’arrivo' }],
  }),
  entry('t6', 'merge', 'Spot_estate', 'Progetto', 'Verdi/2025/Spot_estate', 'Verdi/2025/Spot Estate', 7, 800 * MB, {
    match: 'similar', selected: false,
    via: [step('Verdi', 'Cliente', 'Verdi'), step('2025', 'Anno', '2025'), step('Spot_estate', 'Progetto', 'Spot Estate', 'similar')],
  }),
  entry('t7', 'present', 'Catalogo', 'Progetto', 'Rossi/2023/Catalogo', 'Rossi/2023/Catalogo', 0, 0, { skipped: 120, skippedSize: 12 * GB }),
];
let trPlan = [];
const trPicked = { src: { root: '/Volumes/HD A', name: 'HD A' }, dest: { root: '/Volumes/HD B', name: 'HD B' } };
let trCb = () => {};
const mockTransfer = {
  async pick(which, diskId) {
    const d = mockDisks.find((x) => x.id === diskId) || { root: which === 'src' ? '/Volumes/HD A' : '/Volumes/HD B', name: which === 'src' ? 'HD A' : 'HD B', total: 2000 * GB, free: 700 * GB };
    trPicked[which] = { root: d.root, name: d.name };
    return { root: d.root, name: d.name, total: d.total, free: d.free };
  },
  async analyze() {
    for (let i = 1; i <= 6; i++) {
      await wait(100);
      trCb({ phase: 'read', side: i < 4 ? 'src' : 'dest', folders: i * 340, current: '/Volumes/HD A/Rossi/2025' });
    }
    return {
      src: { ...trPicked.src, folders: 1240, levels: mockLevels.src, suggested: 4 },
      dest: { ...trPicked.dest, folders: 860, levels: mockLevels.dest, suggested: 3 },
    };
  },
  async plan() {
    await wait(400);
    trPlan = mockPlan();
    return { entries: trPlan, dest: { total: 2000 * GB, free: 700 * GB } };
  },
  async chooseDest(id) {
    const e = trPlan.find((x) => x.id === id);
    Object.assign(e, { dest: `Da sistemare/${e.name}`, custom: true, match: 'manual', kind: 'new', selected: true });
    return { ...e };
  },
  async useSuggestion(id, index) {
    const e = trPlan.find((x) => x.id === id);
    Object.assign(e, { dest: e.suggestions[index].dest, custom: true, match: 'elsewhere', kind: 'merge', selected: true });
    return { ...e };
  },
  async resetDest(id) {
    const fresh = mockPlan().find((x) => x.id === id);
    trPlan = trPlan.map((x) => (x.id === id ? fresh : x));
    return fresh;
  },
  async run(ids) {
    const list = trPlan.filter((e) => ids.includes(e.id));
    const total = list.reduce((s, e) => s + e.size, 0);
    for (let i = 1; i <= 20; i++) {
      await wait(90);
      trCb({ phase: 'copy', name: list[Math.min(list.length - 1, Math.floor(i / 7))]?.name, current: '/Volumes/HD A/Rossi/2025/Spot Estate/Storyboard/Export/v3.mov', bytes: (total * i) / 20, total, files: i * 10, totalFiles: 200 });
    }
    const results = list.map((e) => ({ id: e.id, ok: true, copied: e.files, bytes: e.size, skipped: e.skipped, errors: [] }));
    trPlan = trPlan.map((e) => (ids.includes(e.id) ? { ...e, kind: 'present', skipped: e.skipped + e.files, files: 0, size: 0, selected: false } : e));
    return { results, entries: trPlan, dest: { total: 2000 * GB, free: 700 * GB - total } };
  },
  async stop() {},
  reveal() {},
  onProgress(cb) {
    trCb = cb;
    return () => (trCb = () => {});
  },
};


const mock = {
  isMock: true,
  async listDisks() {
    return mockDisks;
  },
  async info() {
    return { name: 'Fidati BK', channel: 'bk', version: 'anteprima' };
  },
  async listFolders(diskId) {
    return foldersOf(diskId);
  },
  async setExcluded(diskId, path, excluded) {
    excluded ? mockExcluded.add(path) : mockExcluded.delete(path);
    return foldersOf(diskId);
  },
  async pickExcluded(diskId) {
    return foldersOf(diskId);
  },
  async scan(diskId) {
    const disk = mockDisks.find((d) => d.id === diskId);
    for (let i = 1; i <= 12; i++) {
      await wait(120);
      progressCb({ scanned: i * 9377, current: `${disk.root}/esempio` });
    }
    return { groups: disk.kind === 'system' ? mockSystem() : mockExternal(), scanned: 112524, disk: { total: disk.total, free: disk.free } };
  },
  async remove(ids) {
    await wait(600);
    return { results: ids.map((id) => ({ id, ok: true, freed: 1 * GB })), disk: null };
  },
  reveal() {},
  async adobeRunning() {
    return [];
  },
  openPrivacy() {},
  async checkUpdate() {
    return { current: 'anteprima' };
  },
  async installUpdate() {},
  transfer: mockTransfer,
  onUpdateProgress() {
    return () => {};
  },
  onProgress(cb) {
    progressCb = cb;
    return () => (progressCb = () => {});
  },
};

export const api = window.fidati ?? mock;

/** messaggio d'errore leggibile da una chiamata al sistema */
export const errorText = (e) => (e?.message || String(e)).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
