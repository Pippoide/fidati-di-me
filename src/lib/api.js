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
let orgProgressCb = () => {};

// ── Riorganizza e Cronologia: dati di esempio ──
const SUB = { work: '02_Lavorazione', images: '01_Asset/Immagini', logos: '01_Asset/Loghi', digital: '03_Export/Digitale', print: '03_Export/Stampa', brief: '00_Brief', archive: '99_Archivio', other: '01_Asset/Altro' };
const mockClusterData = [
  { id: 'c1', client: 'Il Bivio', project: 'Totebag', confidence: 100, reasons: ['File collegati fra loro (InDesign, Illustrator, After Effects, Premiere)', 'Cartella di progetto “Totebag”', 'Cliente dalla cartella “Il Bivio”'],
    files: [['totebag_v2.indd', 'work', true], ['foto_piccione.jpg', 'work', true], ['Links/texture-carta.png', 'work', true], ['totebag_v1.indd', 'archive'], ['brief cliente.docx', 'brief'], ['Export/totebag_def.pdf', 'print']] },
  { id: 'c2', client: 'Arianne e Bea', project: 'Capsules', confidence: 80, reasons: ['Nomi dei file simili', 'Cliente già presente: “Arianne e Bea”', 'Progetto già presente'],
    files: [['arianne_capsules_post1.png', 'images'], ['arianne_capsules_post2.png', 'images']] },
  { id: 'c3', client: '', project: 'Brochure', confidence: 45, reasons: ['Cartella pacchetto (Links / Document fonts)', 'Cliente non riconosciuto'], files: [['Brochure Folder', 'work']], dir: true },
  { id: 'c4', client: 'Bivio', project: 'Logo', confidence: 35, reasons: ['Cliente dedotto dal nome'], files: [['bivio_logo.svg', 'logos']] },
  { id: 'c5', client: '', project: '', confidence: 0, reasons: ['Cliente non riconosciuto', 'Progetto non riconosciuto'], files: [['IMG_1234.jpg', 'images']] },
];
const mockPreview = (c, client = c.client, project = c.project) => ({
  id: c.id, client, project, confidence: c.confidence, reasons: c.reasons,
  size: c.files.length * 4.2 * MB, count: c.files.length, hasLinks: c.files.some((f) => f[2]), hasPackage: !!c.dir, error: null,
  items: c.files.map(([rel, sub, linked]) => ({
    from: `/Users/tu/Desktop/${rel}`, name: rel.split('/').pop(), kind: c.dir ? 'dir' : 'file', size: 4.2 * MB, sub, linked: !!linked,
    to: client && project ? `${client}/2026-11_${project.replace(/ /g, '_')}/${SUB[sub]}/${linked ? 'Totebag_v02/' : ''}${c.dir ? rel : `${client}_${project}_${rel.split('/').pop()}`.replace(/ /g, '_')}` : null,
    renamed: !c.dir,
  })),
});
const day = 864e5;
let mockLog = {
  riorganizza: [
    { id: 's1', kind: 'riorganizza', label: 'Riorganizzazione su Macintosh HD', root: '/Users/tu/Desktop', at: Date.now() - 2 * day, entries: [
      { id: 'e1', op: 'move', from: '/Users/tu/Desktop/locandina.indd', to: '/Users/tu/Documents/Clienti/Il Bivio/2026-11_Festival/02_Lavorazione/Il_Bivio_Festival_locandina.indd', size: 12 * MB, state: 'done' },
      { id: 'e2', op: 'move', from: '/Users/tu/Desktop/locandina.pdf', to: '/Users/tu/Documents/Clienti/Il Bivio/2026-11_Festival/03_Export/Stampa/Il_Bivio_Festival_locandina.pdf', size: 3 * MB, state: 'restored', restoredTo: '/Users/tu/Desktop/locandina.pdf' },
    ] },
  ],
  pulizia: [
    { id: 's2', kind: 'pulizia', label: 'Nel Cestino da Macintosh HD', root: '/Users/tu', at: Date.now() - day, entries: [
      { id: 'e3', op: 'trash', from: '/Users/tu/Movies/reel-2026.mov', to: '/Users/tu/.Trash/reel-2026.mov', size: 4.8 * GB, state: 'done' },
      { id: 'e4', op: 'trash', from: '/Users/tu/Downloads/vecchio.zip', to: null, size: 300 * MB, state: 'done' },
    ] },
  ],
};

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
  async orgOptions() {
    return { threshold: 70, rename: true, dest: '/Users/tu/Documents/Clienti' };
  },
  async orgSetOptions(o) {
    return o;
  },
  async orgPickSource() {
    return '/Users/tu/Desktop';
  },
  async orgPickDest() {
    return '/Users/tu/Documents/Clienti';
  },
  async orgAnalyze(_diskId, source) {
    for (let i = 1; i <= 8; i++) {
      await wait(110);
      orgProgressCb({ phase: i < 6 ? 'scan' : 'links', done: i, total: 8, current: '/Users/tu/Desktop/esempio' });
    }
    return { source: source || '/Users/tu', dest: '/Users/tu/Documents/Clienti', stats: { files: 11, packages: 1, linkGroups: 1, skipped: 1, truncated: false }, adobeOpen: [], clusters: mockClusterData.map((c) => mockPreview(c)) };
  },
  async orgPreview(id, client, project) {
    return mockPreview(mockClusterData.find((c) => c.id === id), client, project);
  },
  async orgApply(jobs) {
    await wait(700);
    return { moved: jobs.length * 2, failed: [], applied: jobs.map((j) => j.id) };
  },
  orgReveal() {},
  onOrgProgress(cb) {
    orgProgressCb = cb;
    return () => (orgProgressCb = () => {});
  },
  async logList() {
    return mockLog;
  },
  async logRestore(kind, ids, force) {
    const issues = ids.includes('e4') ? [{ id: 'e4', name: 'vecchio.zip', kind: 'error', message: 'Non è più nel Cestino (svuotato o già ripreso dal Finder)' }] : [];
    if (issues.length && !force) return { needsConfirm: issues, results: [] };
    await wait(400);
    mockLog = { ...mockLog, [kind]: mockLog[kind].map((s) => ({ ...s, entries: s.entries.map((e) => (ids.includes(e.id) && e.id !== 'e4' ? { ...e, state: 'restored', restoredTo: e.from } : e)) })) };
    return { results: ids.map((id) => ({ id, ok: id !== 'e4' })), list: mockLog[kind] };
  },
  async logForget(kind, sessionId) {
    mockLog = { ...mockLog, [kind]: mockLog[kind].filter((s) => s.id !== sessionId) };
    return mockLog[kind];
  },
  logReveal() {},
  onProgress(cb) {
    progressCb = cb;
    return () => (progressCb = () => {});
  },
};

export const api = window.fidati ?? mock;

/** messaggio d'errore leggibile da una chiamata al sistema */
export const errorText = (e) => (e?.message || String(e)).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
