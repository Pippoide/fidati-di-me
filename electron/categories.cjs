'use strict';
/**
 * Definizione dei gruppi mostrati nell'interfaccia e regole di classificazione.
 *
 * level:
 *   safe      → si può eliminare senza conseguenze (è ciò che pulisce "Fidati di me")
 *   caution   → file tuoi o costosi da rigenerare: serve una conferma esplicita
 *   protected → sistema / dati delle app: mostrati ma MAI eliminabili
 */
const GROUPS = [
  // ── safe ────────────────────────────────────────────────────────────────
  {
    id: 'adobe',
    level: 'safe',
    title: 'Cache Adobe',
    description:
      'Media Cache, Peak Files (anche su dischi esterni), cache di Photoshop, Premiere, After Effects, Lightroom, Camera Raw, Bridge e log di Creative Cloud.',
  },
  {
    id: 'app-cache',
    level: 'safe',
    title: 'Cache delle applicazioni',
    description: 'File temporanei in ~/Library/Caches. Le app li ricreano quando servono.',
  },
  {
    id: 'browser-cache',
    level: 'safe',
    title: 'Cache dei browser',
    description: 'Solo la cache di Safari, Chrome, Firefox, Edge, Brave, Arc. Cronologia, password e preferiti restano.',
  },
  {
    id: 'dev-cache',
    level: 'safe',
    title: 'Cache di sviluppo',
    description: 'DerivedData di Xcode, cache di npm, Yarn, pnpm, Homebrew, CocoaPods, Gradle.',
  },
  {
    id: 'logs',
    level: 'safe',
    title: 'Log e report di crash',
    description: 'Registri diagnostici in ~/Library/Logs.',
  },

  // ── caution ─────────────────────────────────────────────────────────────
  {
    id: 'trash',
    level: 'caution',
    title: 'Cestino',
    description: 'Solo il Cestino di questo disco. Svuotarlo è definitivo.',
  },
  {
    id: 'node-modules',
    level: 'caution',
    title: 'Cartelle node_modules',
    description: 'Si rigenerano con npm install, ma i progetti non partono finché non lo fai.',
  },
  {
    id: 'ios-backups',
    level: 'caution',
    title: 'Backup di iPhone e iPad',
    description: 'Backup locali dei dispositivi. Eliminali solo se hai un backup su iCloud o non ti servono più.',
  },
  {
    id: 'archives',
    level: 'caution',
    title: 'Archivi e installer',
    description: 'File .zip, .dmg, .pkg, .iso e simili. Finiscono nel Cestino.',
  },
  {
    id: 'video',
    level: 'caution',
    title: 'Video',
    description: 'I tuoi file video. Finiscono nel Cestino.',
  },
  {
    id: 'images',
    level: 'caution',
    title: 'Immagini',
    description: 'Foto e immagini, inclusa la libreria di Foto. Finiscono nel Cestino.',
  },
  {
    id: 'audio',
    level: 'caution',
    title: 'Audio',
    description: 'Musica e registrazioni. Finiscono nel Cestino.',
  },
  {
    id: 'creative',
    level: 'caution',
    title: 'Progetti creativi',
    description: 'File .psd, .ai, .indd, .aep, .prproj, .fig, .sketch e simili. Finiscono nel Cestino.',
  },
  {
    id: 'documents',
    level: 'caution',
    title: 'Documenti',
    description: 'PDF, testi, fogli di calcolo, presentazioni. Finiscono nel Cestino.',
  },
  {
    id: 'code',
    level: 'caution',
    title: 'Codice',
    description: 'File sorgente e di configurazione. Finiscono nel Cestino.',
  },
  {
    id: 'other',
    level: 'caution',
    title: 'Altri file',
    description: 'File che non rientrano nelle altre categorie. Finiscono nel Cestino.',
  },

  // ── protected ───────────────────────────────────────────────────────────
  {
    id: 'app-data',
    level: 'protected',
    title: 'Dati e impostazioni delle app',
    description:
      'Contenuto di ~/Library: preferenze, licenze, portachiavi, posta, messaggi. Eliminarli rompe le app o fa perdere dati.',
  },
  {
    id: 'applications',
    level: 'protected',
    title: 'Applicazioni',
    description: 'Le app installate. Per rimuoverne una usa il suo disinstallatore o trascinala nel Cestino dal Finder.',
  },
  {
    id: 'system',
    level: 'protected',
    title: 'Sistema macOS',
    description: 'File del sistema operativo. macOS li protegge e non vanno toccati.',
  },
];

const ext = (list, group) => Object.fromEntries(list.split(' ').map((e) => ['.' + e, group]));

/** estensione → gruppo, per i file personali */
const EXT_GROUP = {
  ...ext('zip rar 7z tar gz tgz bz2 xz dmg pkg iso mpkg xip', 'archives'),
  ...ext('mp4 mov m4v avi mkv webm wmv flv mpg mpeg mts m2ts mxf r3d braw prores', 'video'),
  ...ext('jpg jpeg png gif webp heic heif tif tiff bmp svg raw cr2 cr3 nef arw dng orf raf rw2 ico icns avif', 'images'),
  ...ext('mp3 wav aiff aif flac m4a aac ogg wma caf mid midi', 'audio'),
  ...ext('psd psb ai indd idml eps aep aet prproj mogrt xd fig sketch afdesign afphoto blend c4d procreate', 'creative'),
  ...ext('pdf doc docx xls xlsx ppt pptx pages numbers key txt rtf md odt ods odp csv epub', 'documents'),
  ...ext(
    'js jsx ts tsx mjs cjs json html htm css scss sass less vue svelte py rb php java kt swift c h cpp hpp cs go rs sh zsh yml yaml toml xml sql lock map',
    'code'
  ),
};

/** cartelle "pacchetto" trattate come un unico file */
const PACKAGE_GROUP = {
  '.photoslibrary': 'images',
  '.photolibrary': 'images',
  '.imovielibrary': 'video',
  '.fcpbundle': 'video',
  '.tvlibrary': 'video',
  '.musiclibrary': 'audio',
  '.logicx': 'audio',
  '.band': 'audio',
  '.app': 'other',
  '.rtfd': 'documents',
  '.sketch': 'creative',
};

/** classificazione delle voci in ~/Library/Caches */
const ADOBE_RE = /adobe|csxs|acrobat|lightroom|photoshop|premiere|after ?effects|creative ?cloud/i;
const BROWSER_RE = /^google$|chrome|chromium|safari|firefox|mozilla|edgemac|microsoft edge|brave|opera|vivaldi|thebrowser/i;
const DEV_RE =
  /homebrew|yarn|pnpm|cocoapods|^pip$|typescript|node-gyp|^electron$|com\.apple\.dt\.|jetbrains|vscode|go-build|gradle|carthage|org\.swift\.swiftpm/i;

/** log che appartengono ad Adobe in ~/Library/Logs */
const ADOBE_LOG_RE = /adobe|creative ?cloud|csxs|^ngl|pdapp|amt3|oobelib|coresync|acrobat/i;

/** app Adobe "vere" in esecuzione (non i processi in background di Creative Cloud) */
const ADOBE_APP_RE = /\/Applications\/Adobe [^/]+\/([^/]+)\.app\/Contents\/MacOS\//;
const ADOBE_BACKGROUND_RE = /creative cloud|ccx|core ?sync|ipc|crash|helper|update|desktop service/i;

/** cartelle di cache Adobe riconosciute ovunque (anche su dischi esterni): se ne svuota il contenuto */
const ADOBE_CACHE_DIRS = new Set(['Media Cache Files', 'Peak Files']);

/** cartelle di sistema nella radice di un disco esterno: mai analizzate né toccate */
const VOLUME_SYSTEM_TOP = new Set(['System Volume Information', '$RECYCLE.BIN', 'Backups.backupdb', 'lost+found']);

/** cartelle sincronizzate con un cloud (nella cartella Inizio) */
const CLOUD_NAME_RE = /^(dropbox|google ?drive|onedrive|box|pcloud|mega|icloud drive)\b/i;

/** nomi italiani delle cartelle standard, come nel Finder */
const HOME_LABELS = {
  Desktop: 'Scrivania',
  Documents: 'Documenti',
  Downloads: 'Download',
  Movies: 'Filmati',
  Music: 'Musica',
  Pictures: 'Immagini',
  Public: 'Pubblica',
};

module.exports = {
  ADOBE_CACHE_DIRS,
  VOLUME_SYSTEM_TOP,
  CLOUD_NAME_RE,
  HOME_LABELS,
  GROUPS,
  EXT_GROUP,
  PACKAGE_GROUP,
  ADOBE_RE,
  BROWSER_RE,
  DEV_RE,
  ADOBE_LOG_RE,
  ADOBE_APP_RE,
  ADOBE_BACKGROUND_RE,
};
