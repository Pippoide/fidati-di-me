'use strict';
/**
 * Regole di "Riorganizza": struttura delle cartelle, tipi di file e parole chiave.
 * È il file da toccare per cambiare dove finisce cosa.
 *
 * Struttura (B): Clienti / <Cliente> / <AAAA-MM_Progetto> / …
 */

/** sottocartelle di ogni progetto */
const DIRS = {
  brief: '00_Brief',
  images: '01_Asset/Immagini',
  logos: '01_Asset/Loghi',
  fonts: '01_Asset/Font',
  media: '01_Asset/Video_Audio',
  other: '01_Asset/Altro', // solo per i file assegnati a mano da "Da smistare"
  work: '02_Lavorazione',
  digital: '03_Export/Digitale',
  print: '03_Export/Stampa',
  archive: '99_Archivio',
};

const set = (s) => new Set(s.split(' ').map((e) => '.' + e));

const EXT = {
  work: set('psd psb ai indd idml indt aep aet prproj mogrt xd fig sketch afdesign afphoto afpub'),
  images: set('jpg jpeg png gif webp heic heif tif tiff bmp raw cr2 cr3 nef arw dng orf raf rw2 avif'),
  vector: set('svg eps'),
  fonts: set('otf ttf woff woff2 ttc dfont'),
  media: set('mov mp4 m4v avi mkv mxf r3d braw mts m2ts webm wav mp3 aif aiff m4a flac aac'),
  docs: set('doc docx txt rtf md pages odt eml msg xls xlsx numbers csv ppt pptx key'),
  pdf: set('pdf'),
  archives: set('zip rar 7z'),
};

/** file che contengono collegamenti ad altri file (si leggono per trovarli) */
const LINKERS = set('indd ai aep aet prproj');

/** file che non c'entrano con i progetti: ignorati, restano dove sono */
const IGNORE_EXT = set(
  'dmg pkg iso mpkg xip app js jsx ts tsx mjs cjs json html htm css scss vue py rb php java swift c h cpp go rs sh yml yaml toml lock map log ds_store ini plist download crdownload part',
);

const words = (s) => new Set(s.split(' '));

/** parole nel nome (o nella cartella) che indicano dove va un file */
const WORDS = {
  export: words(
    'export esportato esportati def definitivo definitivi final finale finali web social post story stories banner ig instagram fb facebook linkedin mockup preview anteprima render renders out output lowres hd',
  ),
  print: words('stampa print tipografia tipografico cmyk abbondanza bleed crocini pdfx x1a x4'),
  brief: words('brief preventivo offerta contratto fattura ordine riferimenti reference references ref moodboard specifiche note testi'),
  logo: words('logo logos loghi logotipo marchio pittogramma monogramma'),
  old: words('old vecchio vecchia vecchi vecchie copia copy backup bak obsoleto scartato scarto archivio'),
  final: words('def definitivo final finale ok last ultimo'),
};

/**
 * cartelle che NON indicano un progetto (si risale alla cartella sopra).
 * Confronto senza maiuscole e accenti.
 */
const GENERIC_DIRS = words(
  'links link collegamenti immagini images img image foto photo photos assets asset export exports esportati def definitivi finali final stampa print web social png jpg jpeg pdf video audio font fonts footage lavorazione sorgenti source sources materiali materiale brief archivio old vecchi bozze draft drafts render renders out output mockup mockups logo loghi desktop scrivania documenti documents download downloads lavori lavoro progetti projects clienti work varie misc nuova cartella senza titolo untitled folder',
);

/** parole senza significato per riconoscere un progetto */
const NOISE = words(
  'img image immagine dsc dscn dcim dji gopro screenshot schermata screen untitled senza titolo documento document doc file scan scansione whatsapp foto photo pic video audio nuovo nuova new cartella folder download esempio test prova temp tmp copia copy final finale def definitivo ok last ultimo export web stampa print the and di da del della per con il la le lo gli un una e ed',
);

/** cartelle "pacchetto" di InDesign/Illustrator/After Effects: si spostano intere */
const PACKAGE_SUBDIR_RE = /^(links|collegamenti|document fonts|font del documento|fonts|\(footage\)|footage)$/i;

/** cartelle da non riordinare mai (progetti di codice, librerie…) */
const SKIP_DIR_MARKERS = ['.git', 'package.json', 'node_modules', 'Podfile', 'Cargo.toml', 'pyproject.toml'];
const SKIP_DIR_EXT = new Set([
  '.app',
  '.photoslibrary',
  '.photolibrary',
  '.imovielibrary',
  '.fcpbundle',
  '.tvlibrary',
  '.musiclibrary',
  '.logicx',
  '.band',
  '.rtfd',
  '.sketch',
  '.xcodeproj',
  '.xcworkspace',
  '.lrdata',
  '.lrcat-data',
  '.bundle',
  '.framework',
  '.plugin',
]);

/** soglia predefinita di sicurezza (0–100) sotto la quale un file va in "Da smistare" */
const DEFAULT_THRESHOLD = 70;

module.exports = {
  DIRS,
  EXT,
  LINKERS,
  IGNORE_EXT,
  WORDS,
  GENERIC_DIRS,
  NOISE,
  PACKAGE_SUBDIR_RE,
  SKIP_DIR_MARKERS,
  SKIP_DIR_EXT,
  DEFAULT_THRESHOLD,
};
