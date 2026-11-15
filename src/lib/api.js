/**
 * Ponte verso il sistema. Dentro l'app usa window.fidati (electron/preload.cjs).
 * Aperta in un browser con `npm run dev` usa dati finti, così puoi lavorare
 * sull'interfaccia senza analizzare né cancellare niente.
 */
const GB = 1e9;
const MB = 1e6;
let n = 0;
const item = (name, path, size, note) => ({ id: `m${++n}`, name, path, size, note });
const group = (id, level, title, description, items) => ({
  id,
  level,
  title,
  description,
  items,
  totalCount: items.length,
  size: items.reduce((s, i) => s + i.size, 0),
});

const mockGroups = () => [
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
  ]),
  group('app-data', 'protected', 'Dati e impostazioni delle app', 'Eliminarli rompe le app o fa perdere dati.', [
    item('Library/Application Support', '/Users/tu/Library/Application Support', 22 * GB),
  ]),
  group('system', 'protected', 'Sistema macOS', 'File del sistema operativo.', [
    item('System', '/System', 0, 'Protetto da macOS, non analizzato'),
  ]),
];

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let progressCb = () => {};

const mock = {
  isMock: true,
  async scan() {
    for (let i = 1; i <= 12; i++) {
      await wait(120);
      progressCb({ scanned: i * 9377, current: '/Users/tu/Library/Caches/esempio' });
    }
    return { groups: mockGroups(), scanned: 112524, disk: { total: 494 * GB, free: 41 * GB } };
  },
  async remove(ids) {
    await wait(600);
    return { results: ids.map((id) => ({ id, ok: true, freed: 1 * GB })), disk: { total: 494 * GB, free: 70 * GB } };
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
