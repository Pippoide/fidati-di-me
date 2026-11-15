#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
#  Fidati — doppio clic per aprire l'app.
#  Uso da Terminale:
#    ./fidati.command        apre l'app
#    ./fidati.command dev    apre l'app con ricaricamento automatico dell'interfaccia
#    ./fidati.command test   prova la logica di analisi/eliminazione su file finti
# ─────────────────────────────────────────────────────────────────────────────
cd "$(dirname "$0")" || exit 1

# Il doppio clic dal Finder non carica il PATH della shell: cerco Node nei posti soliti.
export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.volta/bin:$PATH"
if ! command -v node >/dev/null 2>&1 && [ -s "$HOME/.nvm/nvm.sh" ]; then
  # shellcheck disable=SC1091
  . "$HOME/.nvm/nvm.sh" >/dev/null 2>&1
fi

fail() {
  echo ""
  echo "✗ $1"
  echo ""
  read -n 1 -s -r -p "Premi un tasto per chiudere…"
  exit 1
}

if ! command -v node >/dev/null 2>&1; then
  open "https://nodejs.org/it/download" 2>/dev/null
  fail "Serve Node.js (versione 20.19 o successiva). Ti ho aperto la pagina di download: installalo e riapri fidati.command."
fi

NODE_OK=$(node -e 'const [a,b]=process.versions.node.split(".").map(Number);console.log(a>22||(a===22&&b>=12)||(a===20&&b>=19)?1:0)')
[ "$NODE_OK" = "1" ] || fail "Node.js $(node -v) è troppo vecchio: serve la 20.19+ oppure la 22.12+. Aggiornalo da https://nodejs.org"

if [ ! -d node_modules/electron ] || [ package.json -nt node_modules/.package-lock.json ]; then
  echo "→ Primo avvio: installo le dipendenze (un paio di minuti, serve internet)…"
  npm install --no-audit --no-fund || fail "Installazione non riuscita. Controlla la connessione e riprova."
fi

case "$1" in
  test)
    npm test
    exit $?
    ;;
  dev)
    echo "→ Modalità sviluppo: ogni modifica in src/ si vede subito nell'app."
    npx vite &
    VITE_PID=$!
    trap 'kill $VITE_PID 2>/dev/null' EXIT
    until curl -s -o /dev/null http://localhost:5173; do sleep 0.3; done
    FIDATI_DEV=1 npx electron .
    exit 0
    ;;
esac

# Ricostruisco l'interfaccia solo se qualcosa è cambiato.
if [ ! -f dist/index.html ] || [ -n "$(find src index.html vite.config.js package.json -newer dist/index.html -print -quit 2>/dev/null)" ]; then
  echo "→ Preparo l'interfaccia…"
  npm run build --silent || fail "Build dell'interfaccia non riuscita: guarda l'errore qui sopra."
fi

echo "→ Apro Fidati. Puoi ridurre questa finestra; chiudendola si chiude anche l'app."
npx electron .
