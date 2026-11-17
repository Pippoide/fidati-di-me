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

const mock = {
  isMock: true,
  async listDisks() {
    return mockDisks;
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
