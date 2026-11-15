# Fidati

Una piccola app per macOS che analizza le cartelle del tuo Mac, raggruppa i file per tipo e ti aiuta a liberare spazio senza rompere niente.

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

### Analizza

Esamina la tua cartella utente, `~/Library`, le applicazioni installate e i file temporanei, poi mostra tutto diviso in gruppi, su tre livelli:

| Livello | Cosa contiene | Cosa puoi fare |
| --- | --- | --- |
| 🟢 **Si può eliminare** | Cache Adobe, cache delle app, cache dei browser, cache di sviluppo, log | Selezionare ed eliminare liberamente |
| 🟠 **Controlla prima** | Cestino, `node_modules`, backup iPhone/iPad, archivi e installer, video, immagini, audio, progetti creativi, documenti, codice, altri file | Selezionare ed eliminare dopo una conferma |
| 🔴 **Meglio non toccare** | Sistema macOS, applicazioni, dati e impostazioni delle app | Solo guardare: non sono selezionabili |

Ogni gruppo si apre per vedere le singole voci, selezionarle una a una e mostrarle nel Finder. Per ogni gruppo sono elencate le 300 voci più grandi; quelle più piccole vengono conteggiate ma non toccate.

**Come vengono eliminati i file:**

- **Cache e log** → eliminati direttamente (delle cartelle si svuota il contenuto, la cartella resta al suo posto).
- **I tuoi file personali** (documenti, foto, video, archivi…) → spostati nel **Cestino**, quindi recuperabili.
- **`node_modules`, backup iOS, svuotamento del Cestino** → definitivi, e la finestra di conferma lo dice.

### Fidati di me

Un solo pulsante: seleziona **tutti e soli i gruppi verdi** e li pulisce, dopo averti mostrato il riepilogo con lo spazio che recupererai. È la pulizia di ciò che macOS chiama "Dati di sistema" nello spazio di archiviazione: cache, log e file temporanei che le app ricreano da sole.

Non tocca mai documenti, preferenze, licenze, password, cronologia dei browser, file del sistema operativo. Non svuota nemmeno il Cestino: quello resta una tua scelta.

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

---

## Sicurezza

- L'interfaccia non manda mai percorsi al sistema, solo l'identificativo di una voce trovata dall'ultima analisi.
- Prima di ogni eliminazione c'è un ultimo controllo (`assertDeletable` in `electron/scanner.cjs`): rifiuta tutto ciò che è fuori dalla cartella utente, le cartelle principali (`Documenti`, `Scrivania`, `Download`, `Library`…) e, dentro `~/Library`, qualunque cosa non sia in un elenco ristretto di cartelle di cache e log.
- I link simbolici non vengono mai seguiti.
- L'app non chiede la password di amministratore e non si collega a internet.

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
│   │   └── UpdateBanner.jsx
│   └── lib/
│       ├── api.js          ponte verso il sistema + dati di esempio
│       └── format.js       formattazione di byte e percorsi
└── electron/               ── SISTEMA (Node) ──
    ├── main.cjs            finestra e comunicazione con l'interfaccia
    ├── preload.cjs         funzioni esposte a React (window.fidati)
    ├── scanner.cjs         analisi ed eliminazione
    ├── updater.cjs         aggiornamento da GitHub Releases
    ├── categories.cjs      gruppi, estensioni, regole Adobe
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
| Riconoscere altre cache Adobe | `ADOBE_RE` e `ADOBE_LOG_RE` in `electron/categories.cjs` |

Dopo ogni modifica a `electron/scanner.cjs` lancia `./fidati.command test`.

---

## Compatibilità e limiti

- Funziona su Mac **Intel e Apple Silicon**. La versione di macOS minima dipende da Electron: quella indicata in `package.json` richiede un macOS recente. Per un Mac più vecchio abbassa la versione di `electron` in `package.json` (per esempio `^32` per macOS 10.15), elimina `node_modules` e riapri `fidati.command`.
- Avviata da `fidati.command`, la finestra del Terminale resta aperta mentre l'app gira: chiudendola si chiude anche l'app. L'app installata dal `.dmg` non ha questo limite.
- Le cache di sistema in `/Library/Caches` e `/System` richiedono privilegi di amministratore e sono volutamente escluse.
- Dischi esterni e altri utenti del Mac non vengono analizzati.
- I file solo su iCloud (non scaricati) contano 0 byte, perché non occupano spazio sul disco. Attenzione: eliminare un file in una cartella sincronizzata con iCloud lo toglie anche da iCloud (resta comunque nel Cestino).
- La prima analisi di un disco molto pieno può durare qualche minuto.
