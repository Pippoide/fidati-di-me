# Fidati

Una piccola app per macOS che analizza le cartelle del tuo Mac, raggruppa i file per tipo e ti aiuta a liberare spazio senza rompere niente. Riordina anche i progetti di lavoro (soprattutto Adobe) in una cartella per cliente, e tiene una cronologia di ogni spostamento per poter tornare indietro.

L'app ha tre sezioni: **Pulizia**, **Riorganizza** e **Cronologia**.

Gira in una finestra sua, non nel browser, e si aggiorna da sola tramite GitHub. L'interfaccia è scritta in **React** e **Tailwind CSS**, quindi puoi modificarla come un normale progetto front-end.

---

## Installare l'app (senza Terminale)

1. Vai su [Releases](https://github.com/Pippoide/fidati-di-me/releases/latest) e scarica il `.dmg`: **arm64** per i Mac con chip Apple (M1 e successivi), **x64** per i Mac Intel.
2. Apri il `.dmg` e trascina **Fidati** in **Applicazioni**.
3. Al primo avvio macOS la blocca, perché l'app non ha un certificato Apple a pagamento: vai in *Impostazioni di Sistema → Privacy e sicurezza* e premi **Apri comunque**. Si fa una volta sola.
4. Per un'analisi completa: *Privacy e sicurezza → Accesso completo al disco* → attiva **Fidati**.

### Aggiornamenti

All'avvio Fidati controlla se su GitHub c'è una versione più nuova. Se c'è, compare un avviso con il pulsante **Aggiorna e riavvia**: l'app scarica la nuova versione, sostituisce sé stessa e si riapre.

- L'app deve stare in **Applicazioni** (non va aperta direttamente dal `.dmg`).
- Dopo un aggiornamento macOS può chiedere di riattivare "Accesso completo al disco": senza certificato Apple vede la nuova versione come un'app diversa.

---

## Pubblicare una nuova versione

| Branch | A cosa serve |
| --- | --- |
| `dev` | Dove si lavora. I push qui non producono nulla. |
| `build` | Rilascio. Ogni push qui fa partire la build su GitHub. |

Quando `dev` è pronto, portalo in `build` (pull request `dev → build` su GitHub, oppure `git checkout build && git merge dev && git push`). GitHub Actions (`.github/workflows/build.yml`) allora:

1. accende un Mac, installa le dipendenze ed esegue i test;
2. assegna la versione `1.0.N`, dove N cresce da solo a ogni build;
3. compila `Fidati.app` per Apple Silicon e Intel;
4. pubblica una release con i `.dmg` (per installare) e gli `.zip` (per l'updater).

Dopo qualche minuto chi ha Fidati installata trova l'avviso di aggiornamento al prossimo avvio. L'avanzamento si vede nella scheda **Actions** della repo.

---

## Avvio per sviluppo (`fidati.command`)

Per lavorare sul codice senza passare dalla build:

1. Clona la repo.
2. Fai doppio clic su **`fidati.command`**.
3. Al primo avvio lo script installa le dipendenze (un paio di minuti, serve internet). Dal secondo in poi l'app si apre subito.

**Serve Node.js** 20.19 o successivo (oppure 22.12+). Se manca, lo script apre la pagina di download di nodejs.org.

### Se macOS blocca il file

Il file arriva da internet, quindi al primo doppio clic macOS può dire che "non può essere aperto". Due soluzioni:

- **Clic destro** su `fidati.command` → **Apri** → **Apri**. Su macOS 15 o successivi: prova ad aprirlo, poi vai in *Impostazioni di Sistema → Privacy e sicurezza* e premi **Apri comunque**.
- Oppure, da Terminale, dentro la cartella `fidati`:

  ```bash
  xattr -d com.apple.quarantine fidati.command
  chmod +x fidati.command
  ```

### Accesso completo al disco (consigliato)

macOS non lascia leggere alcune cartelle (Cestino, Mail, parte di `~/Library`) senza permesso. Per un'analisi completa:

*Impostazioni di Sistema → Privacy e sicurezza → Accesso completo al disco* → attiva **Fidati** (o **Terminale**, se la avvii da `fidati.command`).

Senza questo permesso l'app funziona lo stesso: salta semplicemente ciò che non può leggere.

---

## Come funziona

### Scegli il disco

Nella colonna a sinistra trovi il **disco di sistema** (di solito *Macintosh HD*) e i **dischi esterni** collegati. Fidati lavora **su un disco alla volta**: l'analisi, "Fidati di me" e ogni eliminazione restano sul disco scelto, e nulla di ciò che sta su un altro disco viene toccato, nemmeno un disco montato dentro una cartella.

- **Disco di sistema**: si analizzano la tua cartella Inizio, `~/Library`, le applicazioni e i file temporanei.
- **Disco esterno**: si analizza tutto il disco, tranne le cartelle di sistema nascoste (Spotlight, `.fseventsd`, ecc.).
- **Non selezionabili**: dischi di backup Time Machine, dischi con un'installazione di macOS e dischi di sola lettura (per esempio un `.dmg` aperto).

L'elenco si aggiorna da solo quando colleghi o espelli un disco e torni sulla finestra di Fidati. Se espelli il disco analizzato, i risultati vengono azzerati.

### Escludi cartelle

Sotto il disco ci sono le sue cartelle principali (per il disco di sistema: Documenti, Download, Scrivania… più Dropbox, iCloud Drive, Google Drive e OneDrive). **Togli la spunta** a una cartella per escluderla: non viene analizzata e non viene toccata, nemmeno da "Fidati di me". Con **+ Escludi un'altra cartella…** puoi escluderne una qualsiasi, anche in profondità.

- Le cartelle sincronizzate con un cloud partono **escluse**: eliminare un file lì lo toglie anche dal cloud e dagli altri dispositivi. Se le includi, i loro file sono segnati con l'etichetta *cloud* e la conferma te lo ricorda.
- Le esclusioni vengono salvate e restano valide ai riavvii (in `~/Library/Application Support/Fidati/settings.json`).
- Se cambi le esclusioni dopo un'analisi, i risultati vengono azzerati: rifai l'analisi. In ogni caso l'eliminazione ricontrolla le esclusioni attuali.

### Analizza

Esamina il disco scelto, poi mostra tutto diviso in gruppi, su tre livelli:

| Livello | Cosa contiene | Cosa puoi fare |
| --- | --- | --- |
| 🟢 **Si può eliminare** | Cache Adobe, cache delle app, cache dei browser, cache di sviluppo, log | Selezionare ed eliminare liberamente |
| 🟠 **Controlla prima** | Cestino, `node_modules`, backup iPhone/iPad, archivi e installer, video, immagini, audio, progetti creativi, documenti, codice, altri file | Selezionare ed eliminare dopo una conferma |
| 🔴 **Meglio non toccare** | Sistema macOS, applicazioni, dati e impostazioni delle app | Solo guardare: non sono selezionabili |

Ogni gruppo si apre per vedere le singole voci, selezionarle una a una e mostrarle nel Finder. Per ogni gruppo sono elencate le 300 voci più grandi; quelle più piccole vengono conteggiate ma non toccate.

**Come vengono eliminati i file:**

- **Cache e log** → eliminati direttamente (delle cartelle si svuota il contenuto, la cartella resta al suo posto).
- **I tuoi file personali** (documenti, foto, video, archivi…) → spostati nel **Cestino**, quindi recuperabili.
- **`node_modules`, backup iOS, svuotamento del Cestino** → definitivi, e la finestra di conferma lo dice. Il Cestino svuotato è solo quello del disco scelto.

### Fidati di me

Un solo pulsante: seleziona **tutti e soli i gruppi verdi** e li pulisce, dopo averti mostrato il riepilogo con lo spazio che recupererai. È la pulizia di ciò che macOS chiama "Dati di sistema" nello spazio di archiviazione: cache, log e file temporanei che le app ricreano da sole.

Non tocca mai documenti, preferenze, licenze, password, cronologia dei browser, file del sistema operativo. Non svuota nemmeno il Cestino: quello resta una tua scelta.

Su un **disco esterno** "Fidati di me" pulisce solo le cache multimediali Adobe che trova (cartelle `Media Cache Files` e `Peak Files`, per chi ha spostato la cache di Premiere o After Effects su un disco di lavoro).

Dopo la pulizia le app possono essere un po' più lente al primo avvio, perché ricostruiscono la cache. È normale.

### Attenzione particolare ad Adobe

Fidati cerca e pulisce:

- `~/Library/Application Support/Adobe/Common/Media Cache Files`, `Media Cache` e `Peak Files` (Premiere Pro, After Effects, Media Encoder, Audition: di solito il grosso dello spazio)
- `~/Library/Caches/Adobe/…` (cache disco di After Effects, Lightroom, Bridge, Photoshop, ecc.)
- `~/Library/Caches/Adobe Camera Raw…`, `com.adobe.*`, `CSXS`
- i file `Photoshop Temp…` rimasti nella cartella temporanea dopo un crash
- i log di Creative Cloud in `~/Library/Logs`

**Non tocca**: font Adobe, licenze, preferenze, preset, plugin, salvataggi automatici dei progetti, file sincronizzati di Creative Cloud.

Se un'app Adobe è aperta, la sua cache è in uso: Fidati se ne accorge, **salta la cache Adobe** e ti chiede di chiudere l'app e riprovare. Nota: dopo la pulizia Premiere e After Effects rigenerano le anteprime dei progetti alla prima apertura.

### Riorganizza

Legge una cartella (o tutto il disco scelto), riconosce i file di progetto e li **sposta** (non li copia) in questa struttura:

```
Clienti/
└── Cliente/
    └── 2026-11_Progetto/
        ├── 00_Brief/              documenti, brief, preventivi
        ├── 01_Asset/
        │   ├── Immagini/
        │   ├── Loghi/             .svg, .eps, immagini con "logo" nel nome
        │   ├── Font/
        │   └── Video_Audio/
        ├── 02_Lavorazione/        .psd .ai .indd .aep .prproj .xd .fig…
        ├── 03_Export/
        │   ├── Digitale/          png/jpg/mp4/pdf esportati
        │   └── Stampa/            pdf e tif per la tipografia
        └── 99_Archivio/           versioni vecchie (_v1, _old, "copia"), zip
```

La cartella `Clienti` di partenza è `~/Documents/Clienti` sul disco di sistema e `Clienti/` nella radice di un disco esterno; si cambia con **Cambia…**. I clienti e i progetti che ci sono già vengono riconosciuti e riempiti, non duplicati.

**Come riconosce un progetto** (ogni progetto riceve un punteggio di sicurezza da 0 a 100):

- **File collegati**: legge i `.indd`, `.ai`, `.aep`, `.aet` e `.prproj` e trova le immagini, i video e gli altri file che usano.
- **Cartelle pacchetto** (create da "Pacchetto" di InDesign/Illustrator o da "Raccogli file" di After Effects: `Links`, `Document fonts`, `(Footage)`): si spostano intere, senza toccare niente dentro.
- **Cartella di progetto**: la cartella con un nome "vero" più vicina al file (cartelle come `Export`, `Links`, `Immagini`, `Def` vengono saltate). La cartella sopra diventa il cliente.
- **Nome dei file**: `cliente_progetto_….ai`; i file sparsi con lo stesso inizio finiscono insieme.
- **Clienti già presenti** nella cartella Clienti (basta una parola lunga del nome: "arianne" trova *Arianne e Bea*).

**Regola dei file collegati (mista)**: un file di lavoro e i suoi collegamenti restano insieme, nella stessa disposizione, in `02_Lavorazione/<nome>/`; il resto viene smistato nelle sottocartelle.

**Rinomina** (attivabile): `Cliente_Progetto_descrizione_v01.ext`. Se un gruppo di file collegati viene rinominato o spostato, accanto c'è `Fidati - collegamenti e nomi cambiati.txt` con vecchi e nuovi nomi e percorsi, per ricollegarli in InDesign/After Effects/Premiere con "Ricollega".

**Soglia di sicurezza** (predefinita 70%, si cambia con il cursore e viene ricordata): sotto la soglia un progetto non si sposta. Prima di spostare c'è sempre un'**anteprima** dove puoi correggere cliente e progetto, togliere un progetto o aggiungerne uno sotto soglia scrivendo tu i nomi. Alla fine trovi la **lista di smistamento**: i file che non ho saputo collocare, rimasti dove erano, con un suggerimento; scrivi cliente e progetto e premi **Sposta**.

Non vengono mai toccati: progetti di codice (cartelle con `.git`, `package.json`, `node_modules`…), librerie (Foto, Final Cut, Logic…), app, installer, `~/Library`, cartelle nascoste, cartelle escluse e la cartella Clienti stessa. Le cartelle d'origine rimaste vuote vengono tolte (il ripristino le ricrea).

> Se un'app Adobe è aperta te lo segnalo: chiudi i documenti prima di spostarli.

### Cronologia

Ogni spostamento viene registrato **prima** di essere fatto, in due registri separati che restano anche dopo la chiusura dell'app:

- `~/Library/Application Support/Fidati/log/riorganizzazione.jsonl` → ogni file spostato da Riorganizza (e da "Sposta" nella lista di smistamento)
- `~/Library/Application Support/Fidati/log/pulizia.jsonl` → solo i file **scelti a mano** e mandati nel Cestino. Cache e dati di sistema eliminati subito non vengono registrati.

Dalla sezione **Cronologia** rimetti i file nella posizione originale: **uno alla volta**, **selezionati**, **una sessione intera** o **tutto**. Per la pulizia, il file viene ripreso dal Cestino (anche se il Finder l'ha rinominato) e torna nella sua cartella.

Prima di ripristinare ti avviso se il file è stato modificato dopo lo spostamento, se al suo posto c'è già un altro file (viene rimesso con "(ripristinato)" nel nome) o se non si trova più (per esempio Cestino svuotato). Quando una sessione è tutta ripristinata, le cartelle e i `.txt` creati da Fidati vengono tolti. Se l'app si chiude a metà di uno spostamento, al riavvio il registro controlla il disco e si rimette in pari.

> Per riprendere file dal Cestino del disco di sistema serve "Accesso completo al disco".

---

## Sicurezza

- L'interfaccia non manda mai percorsi al sistema, solo l'identificativo di una voce trovata dall'ultima analisi.
- Prima di ogni eliminazione c'è un ultimo controllo (`assertDeletable` in `electron/scanner.cjs`): rifiuta tutto ciò che è fuori dal disco scelto, le cartelle escluse (anche quelle aggiunte dopo l'analisi), le cartelle principali (`Documenti`, `Scrivania`, `Download`, `Library`…), la radice delle cartelle cloud e, dentro `~/Library`, qualunque cosa non sia in un elenco ristretto di cartelle di cache e log. Su un disco esterno rifiuta le cartelle di sistema del disco.
- Ogni file viene ricontrollato al momento dell'eliminazione: se non sta più sul disco analizzato (o il disco è stato scollegato), non si tocca.
- I link simbolici non vengono mai seguiti, e l'analisi non entra in altri dischi montati dentro una cartella.
- Riorganizza sposta solo file del disco scelto, fuori da `~/Library`, dalle app, dalle cartelle nascoste ed escluse (`assertMovable` in `electron/organizer.cjs`), e ricontrolla ogni file prima di spostarlo: se è cambiato dopo l'analisi non lo tocca.
- L'app non chiede la password di amministratore e non si collega a internet (tranne per controllare gli aggiornamenti).

Puoi verificare la logica su file finti, senza toccare nulla di reale:

```bash
./fidati.command test
```

---

## Modificare l'app

```
fidati/
├── fidati.command          launcher (doppio clic)
├── README.md
├── index.html
├── vite.config.js
├── package.json
├── src/                    ── INTERFACCIA (React + Tailwind) ──
│   ├── main.jsx
│   ├── App.jsx             schermata, stato, flusso "Fidati di me"
│   ├── index.css           colori e font (blocco @theme di Tailwind 4)
│   ├── components/
│   │   ├── GroupCard.jsx   un gruppo con l'elenco delle voci
│   │   ├── ConfirmDialog.jsx
│   │   ├── Sidebar.jsx     scelta del disco e cartelle escluse
│   │   ├── Organizer.jsx   sezione Riorganizza (impostazioni, anteprima, smistamento)
│   │   ├── ProjectCard.jsx un progetto proposto, con cliente e progetto modificabili
│   │   ├── History.jsx     sezione Cronologia e ripristino
│   │   └── UpdateBanner.jsx
│   └── lib/
│       ├── api.js          ponte verso il sistema + dati di esempio
│       └── format.js       formattazione di byte e percorsi
└── electron/               ── SISTEMA (Node) ──
    ├── main.cjs            finestra e comunicazione con l'interfaccia
    ├── preload.cjs         funzioni esposte a React (window.fidati)
    ├── scanner.cjs         analisi ed eliminazione (un disco alla volta)
    ├── disks.cjs           dischi collegati e cartelle proposte
    ├── updater.cjs         aggiornamento da GitHub Releases
    ├── categories.cjs      gruppi, estensioni, regole Adobe
    ├── organizer.cjs       Riorganizza: riconoscimento progetti e spostamenti
    ├── organizer-rules.cjs struttura delle cartelle, estensioni e parole chiave
    ├── journal.cjs         Cronologia: registro persistente e ripristino
    └── selftest.cjs        test su file finti
```

### Lavorare sull'interfaccia

```bash
./fidati.command dev
```

Apre l'app con ricaricamento automatico: salvi un file in `src/` e la finestra si aggiorna.

In alternativa `npm run dev` e apri `http://localhost:5173` nel browser: lì l'interfaccia usa **dati di esempio** (vedi `src/lib/api.js`), così puoi lavorare su layout e stile senza analizzare né cancellare niente.

### Modifiche frequenti

| Voglio… | Dove |
| --- | --- |
| Cambiare colori e font | `src/index.css`, blocco `@theme` |
| Cambiare testi e layout | `src/App.jsx` e `src/components/` |
| Aggiungere un gruppo o un'estensione | `electron/categories.cjs` (`GROUPS`, `EXT_GROUP`) |
| Spostare un gruppo tra verde / arancione / rosso | campo `level` in `GROUPS` |
| Aggiungere una cartella da pulire | `electron/scanner.cjs`: aggiungila all'analisi **e** a `LIBRARY_ALLOWED`, altrimenti il controllo di sicurezza la rifiuta |
| Riconoscere altre cache Adobe | `ADOBE_RE`, `ADOBE_LOG_RE` e `ADOBE_CACHE_DIRS` in `electron/categories.cjs` |
| Riconoscere altre cartelle cloud | `CLOUD_NAME_RE` in `electron/categories.cjs` |
| Cambiare quando un disco non è selezionabile | `whyNot` in `electron/disks.cjs` |
| Cambiare le cartelle di un progetto (00_Brief, 01_Asset…) | `DIRS` in `electron/organizer-rules.cjs` |
| Decidere dove va un tipo di file | `EXT` e `WORDS` in `electron/organizer-rules.cjs`, funzione `subfolderFor` in `electron/organizer.cjs` |
| Cambiare la soglia predefinita | `DEFAULT_THRESHOLD` in `electron/organizer-rules.cjs` |
| Cambiare il formato dei nomi | `newName` dentro `materialize` in `electron/organizer.cjs` |

Dopo ogni modifica a `electron/scanner.cjs`, `organizer.cjs` o `journal.cjs` lancia `./fidati.command test`.

---

## Compatibilità e limiti

- Funziona su Mac **Intel e Apple Silicon**. La versione di macOS minima dipende da Electron: quella indicata in `package.json` richiede un macOS recente. Per un Mac più vecchio abbassa la versione di `electron` in `package.json` (per esempio `^32` per macOS 10.15), elimina `node_modules` e riapri `fidati.command`.
- Avviata da `fidati.command`, la finestra del Terminale resta aperta mentre l'app gira: chiudendola si chiude anche l'app. L'app installata dal `.dmg` non ha questo limite.
- Le cache di sistema in `/Library/Caches` e `/System` richiedono privilegi di amministratore e sono volutamente escluse.
- Si analizza un disco alla volta. Sul disco di sistema si guarda solo la tua cartella Inizio: gli altri utenti del Mac non vengono analizzati.
- I dischi esterni formattati NTFS (Windows) sono di sola lettura su macOS, quindi non selezionabili. I dischi di rete compaiono nell'elenco ma l'analisi può essere lenta.
- I file solo nel cloud (non scaricati) contano 0 byte, perché non occupano spazio sul disco. Eliminare un file in una cartella sincronizzata lo toglie anche dal cloud (resta comunque nel Cestino): per questo quelle cartelle partono escluse.
- La prima analisi di un disco molto pieno può durare qualche minuto.
