import { useEffect, useMemo, useState } from 'react';
import { api, errorText } from '../lib/api';
import { formatBytes, formatCount, shortPath } from '../lib/format';

/**
 * Trasferimento ordinato, in quattro passi:
 *   1. partenza e arrivo   2. struttura (da confermare)   3. piano (da selezionare)   4. copia
 * La partenza non viene mai modificata: si copia, e i file già presenti all'arrivo non si sovrascrivono.
 */
const ROLES = ['Cliente', 'Anno', 'Progetto', 'Sottoprogetto', 'Categoria', 'Altro'];
const STEPS = ['Partenza e arrivo', 'Struttura', 'Piano', 'Copia'];

const KIND = {
  new: { label: 'Nuova cartella', cls: 'text-safe border-safe/40' },
  merge: { label: 'Aggiunge i file mancanti', cls: 'text-text border-line' },
  loose: { label: 'File sciolti', cls: 'text-text border-line' },
  present: { label: 'Già presente', cls: 'text-muted border-line' },
};
const MATCH = {
  exact: { label: 'Corrispondenza esatta', cls: 'text-safe' },
  similar: { label: 'Nome simile: verifica', cls: 'text-caution' },
  elsewhere: { label: 'Trovato altrove nell’arrivo', cls: 'text-caution' },
  manual: { label: 'Destinazione scelta da te', cls: 'text-text' },
  none: { label: 'Nessuna corrispondenza', cls: 'text-muted' },
};
const FILTERS = [
  ['todo', 'Da copiare'],
  ['check', 'Da verificare'],
  ['left', 'Non selezionati'],
  ['present', 'Già presenti'],
  ['all', 'Tutti'],
];

const btn = 'rounded-lg border border-line px-3 py-1.5 text-[12px] hover:bg-raised disabled:opacity-50';
const primary = 'rounded-lg bg-safe px-5 py-2 text-[13px] font-semibold text-ink hover:brightness-110 disabled:opacity-50';

function Steps({ current }) {
  return (
    <ol className="mb-6 flex flex-wrap items-center gap-2 text-[12px]">
      {STEPS.map((s, i) => (
        <li key={s} className="flex items-center gap-2">
          <span
            className={`grid h-5 w-5 place-content-center rounded-full text-[11px] font-semibold ${
              i < current ? 'bg-safe text-ink' : i === current ? 'bg-text text-ink' : 'bg-raised text-muted'
            }`}
          >
            {i + 1}
          </span>
          <span className={i === current ? 'text-text' : 'text-muted'}>{s}</span>
          {i < STEPS.length - 1 && <span className="mx-1 h-px w-6 bg-line" />}
        </li>
      ))}
    </ol>
  );
}

/** scelta della cartella di partenza o di arrivo */
function PickCard({ title, hint, which, value, disks, locked, onPick }) {
  return (
    <div className="rounded-xl border border-line bg-panel p-4">
      <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted">{title}</h3>
      {value ? (
        <div className="mt-2">
          <p className="truncate font-display text-lg font-semibold">{value.name}</p>
          <p className="truncate text-[12px] text-muted" title={value.root}>
            {shortPath(value.root)}
            {which === 'dest' && value.total ? ` · ${formatBytes(value.free)} liberi` : ''}
          </p>
        </div>
      ) : (
        <p className="mt-2 text-[13px] text-muted">{hint}</p>
      )}
      <div className="mt-3 flex flex-wrap gap-1.5">
        {disks
          // la partenza si legge soltanto: vanno bene anche i dischi di sola lettura (es. Disk Drill)
          .filter((d) => (which === 'src' ? true : !d.disabled))
          .map((d) => (
            <button key={d.id} className={btn} disabled={locked} onClick={() => onPick(which, d.id)} title={d.root}>
              {d.name}
              {(d.note || d.readOnly) && (
                <span className="ml-1.5 text-[10px] uppercase tracking-wider text-muted">
                  {[d.note, d.readOnly && 'sola lettura'].filter(Boolean).join(' · ')}
                </span>
              )}
            </button>
          ))}
        <button className={btn} disabled={locked} onClick={() => onPick(which)}>
          Scegli cartella…
        </button>
      </div>
    </div>
  );
}

/** livelli trovati in una delle due cartelle */
function LevelList({ info, depth, roles, editable, onRole }) {
  return (
    <ol className="space-y-1.5">
      {info.levels.map((l) => {
        const content = l.depth >= depth;
        return (
          <li
            key={l.depth}
            className={`rounded-lg border px-3 py-2 ${content ? 'border-dashed border-line opacity-60' : 'border-line bg-panel'}`}
            style={{ marginLeft: Math.min(l.depth, 5) * 14 }}
          >
            <div className="flex items-center gap-2">
              <span className="text-[11px] tabular-nums text-muted">{l.depth + 1}</span>
              {editable && !content ? (
                <select
                  className="rounded-md border border-line bg-raised px-1.5 py-0.5 text-[12px]"
                  value={roles[l.depth] || l.role}
                  onChange={(e) => onRole(l.depth, e.target.value)}
                  aria-label={`Ruolo del livello ${l.depth + 1}`}
                >
                  {[...new Set([...ROLES, roles[l.depth] || l.role])].map((r) => (
                    <option key={r}>{r}</option>
                  ))}
                </select>
              ) : (
                <span className="text-[12px] font-medium">{content ? 'Contenuto' : l.role}</span>
              )}
              <span className="ml-auto text-[11px] text-muted">{formatCount(l.count)} cartelle</span>
            </div>
            <p className="mt-1 truncate text-[12px] text-muted">{l.examples.join(' · ')}</p>
          </li>
        );
      })}
      {!info.levels.length && <li className="text-[13px] text-muted">Nessuna sottocartella.</li>}
    </ol>
  );
}

function EntryRow({ e, srcName, destName, locked, onToggle, onChoose, onSuggestion, onReset, onReveal }) {
  const kind = KIND[e.kind];
  const match = MATCH[e.match] || MATCH.none;
  return (
    <li className="rounded-xl border border-line bg-panel px-4 py-3">
      <div className="flex items-start gap-3">
        <input
          type="checkbox"
          className="mt-0.5"
          checked={e.selected}
          disabled={locked || e.kind === 'present'}
          onChange={() => onToggle(e.id)}
          aria-label={`Seleziona ${e.name}`}
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <span className="truncate text-[14px] font-medium">{e.name}</span>
            {e.role && <span className="text-[11px] uppercase tracking-wider text-muted">{e.role}</span>}
            <span className={`rounded-full border px-2 py-px text-[11px] ${kind.cls}`}>{kind.label}</span>
            <span className={`text-[11px] ${match.cls}`}>{match.label}</span>
          </div>
          <p className="mt-1 truncate text-[12px] text-muted" title={`${srcName}/${e.src}`}>
            da <span className="text-text/80">{srcName}/{e.src}</span>
          </p>
          <p className="truncate text-[12px] text-muted" title={`${destName}/${e.dest}`}>
            a <span className="text-text">{destName}/{e.dest}</span>
          </p>
          {e.via.some((s) => s.match === 'similar') && (
            <p className="mt-1 text-[12px] text-caution">
              {e.via
                .filter((s) => s.match === 'similar')
                .map((s) => `“${s.name}” → “${s.dest}”`)
                .join(', ')}{' '}
              hanno nomi simili ma non uguali: controlla che sia la stessa cartella.
            </p>
          )}
          {e.suggestions.length > 0 && !e.custom && (
            <p className="mt-1 text-[12px] text-caution">
              All’arrivo esiste già una cartella “{e.name}” in un altro punto: scegli tu se usarla.
            </p>
          )}
          <p className="mt-1 text-[12px] tabular-nums text-muted">
            {e.files > 0 ? `${formatCount(e.files)} file · ${formatBytes(e.size)}` : 'Niente da copiare'}
            {e.skipped > 0 && ` · ${formatCount(e.skipped)} già all’arrivo (${formatBytes(e.skippedSize)}), non vengono toccati`}
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {e.suggestions.map((s) => (
              <button key={s.index} className={btn} disabled={locked} onClick={() => onSuggestion(e.id, s.index)} title={s.why}>
                Usa {destName}/{s.dest}
              </button>
            ))}
            {e.kind !== 'present' && (
              <button className={btn} disabled={locked} onClick={() => onChoose(e.id)}>
                Scegli dove…
              </button>
            )}
            {e.custom && (
              <button className={btn} disabled={locked} onClick={() => onReset(e.id)}>
                Ripristina proposta
              </button>
            )}
            <button className={`${btn} border-transparent text-muted`} onClick={() => onReveal(e.id, 'src')}>
              Mostra nel Finder
            </button>
          </div>
        </div>
      </div>
    </li>
  );
}

export default function TransferView({ disks }) {
  const [step, setStep] = useState(0);
  const [src, setSrc] = useState(null);
  const [dest, setDest] = useState(null);
  const [structure, setStructure] = useState(null); // { src, dest }
  const [depth, setDepth] = useState(1);
  const [roles, setRoles] = useState([]);
  const [entries, setEntries] = useState([]);
  const [destCap, setDestCap] = useState(null);
  const [filter, setFilter] = useState('todo');
  const [busy, setBusy] = useState(null); // 'read' | 'plan' | 'copy'
  const [progress, setProgress] = useState(null);
  const [confirm, setConfirm] = useState(false);
  const [report, setReport] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => api.transfer.onProgress(setProgress), []);
  const locked = !!busy;

  const guard = async (kind, fn) => {
    setBusy(kind);
    setError(null);
    setProgress(null);
    try {
      return await fn();
    } catch (e) {
      setError(errorText(e));
      return null;
    } finally {
      setBusy(null);
    }
  };

  // ── 1. partenza e arrivo ──
  const pick = (which, diskId) =>
    guard('pick', async () => {
      const r = await api.transfer.pick(which, diskId);
      if (!r) return;
      (which === 'src' ? setSrc : setDest)(r);
      setStructure(null);
      setEntries([]);
      setReport(null);
      setStep(0);
    });

  const readStructure = () =>
    guard('read', async () => {
      const r = await api.transfer.analyze();
      setStructure(r);
      setDepth(r.src.suggested);
      setRoles(r.src.levels.map((l) => l.role));
      setStep(1);
    });

  // ── 2. struttura ──
  const changeDepth = (d) => {
    const max = structure.src.levels.length || 1;
    const next = Math.max(1, Math.min(max, d));
    setDepth(next);
    // le etichette si ricalcolano se l'utente non le ha toccate
    setRoles((rs) => rs.map((r, i) => (i >= next ? 'Contenuto' : r === 'Contenuto' ? 'Sottoprogetto' : r)));
  };
  const setRole = (i, r) => setRoles((rs) => rs.map((x, j) => (j === i ? r : x)));

  const makePlan = () =>
    guard('plan', async () => {
      const r = await api.transfer.plan(depth, roles.slice(0, depth));
      setEntries(r.entries);
      setDestCap(r.dest);
      setFilter('todo');
      setReport(null);
      setStep(2);
    });

  /** avviso se all'arrivo la gerarchia ha un ordine diverso (es. l'anno a un altro livello) */
  const mismatch = useMemo(() => {
    if (!structure) return null;
    const yearAt = (info) => info.levels.findIndex((l) => l.role === 'Anno');
    const a = roles.indexOf('Anno');
    const b = yearAt(structure.dest);
    if (a >= 0 && b >= 0 && a !== b) return `Alla partenza l’anno è al livello ${a + 1}, all’arrivo al livello ${b + 1}.`;
    if (a >= 0 && b < 0 && structure.dest.levels.length) return 'All’arrivo non ho trovato cartelle per anno.';
    return null;
  }, [structure, roles]);

  // ── 3. piano ──
  const replace = (e) => setEntries((es) => es.map((x) => (x.id === e.id ? e : x)));
  const toggle = (id) => setEntries((es) => es.map((x) => (x.id === id ? { ...x, selected: !x.selected } : x)));
  const choose = (id) => guard('dest', async () => replace(await api.transfer.chooseDest(id)));
  const suggestion = (id, i) => guard('dest', async () => replace(await api.transfer.useSuggestion(id, i)));
  const reset = (id) => guard('dest', async () => replace(await api.transfer.resetDest(id)));

  const doubtful = (e) => e.match === 'similar' || e.match === 'elsewhere' || e.suggestions.length > 0;
  const shown = entries.filter((e) => {
    if (filter === 'todo') return e.kind !== 'present' && e.selected;
    if (filter === 'check') return e.kind !== 'present' && doubtful(e);
    if (filter === 'left') return e.kind !== 'present' && !e.selected;
    if (filter === 'present') return e.kind === 'present';
    return true;
  });
  const count = (f) =>
    entries.filter((e) =>
      f === 'todo' ? e.kind !== 'present' && e.selected
      : f === 'check' ? e.kind !== 'present' && doubtful(e)
      : f === 'left' ? e.kind !== 'present' && !e.selected
      : f === 'present' ? e.kind === 'present'
      : true
    ).length;

  /** raggruppa per cartella di arrivo */
  const byDest = useMemo(() => {
    const m = new Map();
    for (const e of shown) {
      const parent = e.dest.includes('/') ? e.dest.slice(0, e.dest.lastIndexOf('/')) : '';
      if (!m.has(parent)) m.set(parent, []);
      m.get(parent).push(e);
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0], 'it', { numeric: true }));
  }, [shown]);

  const selected = entries.filter((e) => e.selected && e.kind !== 'present');
  const selSize = selected.reduce((s, e) => s + e.size, 0);
  const selFiles = selected.reduce((s, e) => s + e.files, 0);
  const noSpace = destCap?.free > 0 && selSize > destCap.free;
  const setAll = (on) => setEntries((es) => es.map((e) => (shown.includes(e) && e.kind !== 'present' ? { ...e, selected: on } : e)));

  // ── 4. copia ──
  const run = () =>
    guard('copy', async () => {
      setConfirm(false);
      setStep(3);
      const ids = selected.map((e) => e.id);
      const r = await api.transfer.run(ids);
      setEntries(r.entries);
      setDestCap(r.dest);
      const failed = r.results.filter((x) => !x.ok);
      setReport({
        copied: r.results.reduce((s, x) => s + (x.copied || 0), 0),
        bytes: r.results.reduce((s, x) => s + (x.bytes || 0), 0),
        skipped: r.results.reduce((s, x) => s + (x.skipped || 0), 0),
        failed: failed.map((x) => ({
          name: entries.find((e) => e.id === x.id)?.name || x.id,
          error: x.error || x.errors?.[0]?.error || 'Errore',
          more: (x.errors?.length || 0) - 1,
        })),
        left: r.entries.filter((e) => e.kind !== 'present').length,
      });
      setFilter(r.entries.some((e) => e.kind !== 'present') ? 'left' : 'present');
      setStep(2);
    }).finally(() => setStep((s) => (s === 3 ? 2 : s)));

  const pct = progress?.total ? Math.min(100, (progress.bytes / progress.total) * 100) : 0;

  return (
    <div className="pb-24">
      <Steps current={step} />

      {api.isMock && (
        <p className="mb-4 rounded-lg border border-caution/40 bg-caution/10 px-3 py-2 text-[12px] text-caution">
          Anteprima nel browser con dati di esempio: qui non viene copiato nulla.
        </p>
      )}
      {error && <p className="mb-4 rounded-lg border border-protected/40 bg-protected/10 px-3 py-2 text-[13px] text-protected">{error}</p>}

      {/* ── 1 ── */}
      <section className="grid gap-3 md:grid-cols-2">
        <PickCard title="Partenza" which="src" value={src} disks={disks} locked={locked} onPick={pick}
          hint="Il disco o la cartella da cui copiare. Non viene modificata: va bene anche un disco di sola lettura, come quelli montati da Disk Drill." />
        <PickCard title="Arrivo" which="dest" value={dest} disks={disks} locked={locked} onPick={pick}
          hint="Il disco o la cartella in cui sistemare i progetti." />
      </section>
      {step === 0 && (
        <div className="mt-5 flex items-center gap-4">
          <button className={primary} disabled={locked || !src || !dest} onClick={readStructure}>
            {busy === 'read' ? 'Leggo le cartelle…' : 'Leggi la struttura'}
          </button>
          {busy === 'read' && progress && (
            <span className="truncate text-[12px] text-muted">
              {progress.side === 'src' ? 'Partenza' : 'Arrivo'} · {formatCount(progress.folders || 0)} cartelle ·{' '}
              {shortPath(progress.current || '')}
            </span>
          )}
        </div>
      )}
      <p className="mt-3 text-[12px] text-muted">
        Fidati <strong className="text-text">copia</strong> e basta: i file di partenza restano dove sono e nessun file già
        presente all’arrivo viene sovrascritto.
      </p>

      {/* ── 2 ── */}
      {structure && step >= 1 && (
        <section className="mt-8">
          <h2 className="font-display text-xl font-semibold">Ho capito quest’ordine. È giusto?</h2>
          <p className="mt-1 text-[13px] text-muted">
            Ogni livello è una cartella dentro l’altra. Correggi le etichette se serve e indica dove finisce la gerarchia: da lì
            in giù (Assets, Export…) le cartelle si copiano così come sono.
          </p>
          <div className="mt-4 flex items-center gap-3 text-[13px]">
            <span>Livelli della gerarchia</span>
            <button className={btn} disabled={locked || step > 1} onClick={() => changeDepth(depth - 1)} aria-label="Un livello in meno">−</button>
            <span className="w-4 text-center font-semibold tabular-nums">{depth}</span>
            <button className={btn} disabled={locked || step > 1} onClick={() => changeDepth(depth + 1)} aria-label="Un livello in più">+</button>
            <span className="text-muted">
              Unità da copiare: <span className="text-text">{roles[depth - 1]}</span>
            </span>
          </div>
          <div className="mt-4 grid gap-6 md:grid-cols-2">
            <div>
              <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted">Partenza · {structure.src.name}</h3>
              <LevelList info={structure.src} depth={depth} roles={roles} editable={step === 1 && !locked} onRole={setRole} />
            </div>
            <div>
              <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted">Arrivo · {structure.dest.name}</h3>
              <LevelList info={structure.dest} depth={structure.dest.suggested} roles={[]} editable={false} />
            </div>
          </div>
          {mismatch && (
            <p className="mt-3 rounded-lg border border-caution/40 bg-caution/10 px-3 py-2 text-[12px] text-caution">
              {mismatch} Le corrispondenze si cercano livello per livello: controlla bene il piano.
            </p>
          )}
          {(structure.src.truncated || structure.dest.truncated) && (
            <p className="mt-3 text-[12px] text-caution">Le cartelle sono moltissime: ho letto solo le prime 30.000.</p>
          )}
          <p className="mt-4 rounded-lg border border-line bg-panel px-3 py-2 text-[12px] text-muted">
            Come funziona: scendo livello per livello. Se una cartella esiste già all’arrivo ci entro; la prima che non esiste viene
            copiata lì dentro, intera. Se esiste anche l’ultimo livello ({roles[depth - 1]}), aggiungo solo i file che mancano.
          </p>
          {step === 1 && (
            <div className="mt-5 flex gap-2">
              <button className={primary} disabled={locked} onClick={makePlan}>
                {busy === 'plan' ? 'Preparo il piano…' : 'Confermo l’ordine'}
              </button>
              <button className={btn} disabled={locked} onClick={readStructure}>
                Rileggi
              </button>
            </div>
          )}
          {step >= 2 && (
            <button className={`${btn} mt-4`} disabled={locked} onClick={() => setStep(1)}>
              Modifica la struttura
            </button>
          )}
        </section>
      )}

      {/* ── 3 ── */}
      {step >= 2 && (
        <section className="mt-10">
          <h2 className="font-display text-xl font-semibold">Dove va ogni progetto</h2>
          <p className="mt-1 text-[13px] text-muted">
            Spunta cosa copiare. Quello che non selezioni resta com’è: puoi mandarlo in una cartella a tua scelta con “Scegli dove…”.
          </p>

          {report && (
            <div className="mt-4 rounded-xl border border-safe/30 bg-safe/10 px-4 py-3 text-[13px]">
              <p className="font-medium text-safe">
                Copia finita: {formatCount(report.copied)} file, {formatBytes(report.bytes)}.
                {report.skipped > 0 && ` ${formatCount(report.skipped)} erano già all’arrivo e non sono stati toccati.`}
              </p>
              {report.left > 0 && (
                <p className="mt-1 text-muted">
                  {formatCount(report.left)} {report.left === 1 ? 'elemento è rimasto' : 'elementi sono rimasti'} alla partenza: li
                  trovi in “Non selezionati”, scegli tu dove mandarli.
                </p>
              )}
              {report.failed.length > 0 && (
                <ul className="mt-2 space-y-0.5 text-[12px] text-protected">
                  {report.failed.slice(0, 6).map((f, i) => (
                    <li key={i}>
                      {f.name}: {f.error}
                      {f.more > 0 && ` (e altri ${f.more})`}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          <div className="mt-4 flex flex-wrap items-center gap-1.5">
            {FILTERS.map(([id, label]) => (
              <button
                key={id}
                onClick={() => setFilter(id)}
                className={`rounded-full border px-3 py-1 text-[12px] ${filter === id ? 'border-text/60 bg-raised' : 'border-line text-muted hover:text-text'}`}
              >
                {label} <span className="tabular-nums">{count(id)}</span>
              </button>
            ))}
            {shown.some((e) => e.kind !== 'present') && (
              <span className="ml-auto flex gap-1.5">
                <button className={btn} disabled={locked} onClick={() => setAll(true)}>Seleziona tutti</button>
                <button className={btn} disabled={locked} onClick={() => setAll(false)}>Nessuno</button>
              </span>
            )}
          </div>

          {byDest.map(([parent, list]) => (
            <div key={parent} className="mt-5">
              <h3 className="mb-2 truncate text-[12px] text-muted">
                → <span className="text-text">{[dest?.name, parent].filter(Boolean).join(' / ').replaceAll('/', ' / ')}</span>
              </h3>
              <ul className="space-y-2">
                {list.map((e) => (
                  <EntryRow key={e.id} e={e} srcName={src?.name} destName={dest?.name} locked={locked}
                    onToggle={toggle} onChoose={choose} onSuggestion={suggestion} onReset={reset} onReveal={api.transfer.reveal} />
                ))}
              </ul>
            </div>
          ))}
          {!shown.length && <p className="mt-8 text-center text-[13px] text-muted">Niente in questo elenco.</p>}
        </section>
      )}

      {/* ── barra di copia ── */}
      {step >= 2 && (
        <footer className="fixed bottom-0 left-0 right-0 z-10 flex items-center justify-between gap-4 border-t border-line bg-panel px-8 py-3">
          <p className="text-[13px]">
            <span className="font-semibold tabular-nums">{formatCount(selected.length)}</span> da copiare ·{' '}
            <span className="font-semibold tabular-nums">{formatBytes(selSize)}</span>
            {destCap?.total > 0 && (
              <span className={noSpace ? 'text-protected' : 'text-muted'}> · {formatBytes(destCap.free)} liberi su {dest?.name}</span>
            )}
          </p>
          <button className={primary} disabled={locked || !selected.length || noSpace} onClick={() => setConfirm(true)}>
            Copia selezionati
          </button>
        </footer>
      )}

      {/* ── conferma ── */}
      {confirm && (
        <div className="fixed inset-0 z-20 grid place-items-center bg-black/60 p-6 backdrop-blur-sm">
          <div role="dialog" aria-modal="true" className="w-full max-w-md rounded-2xl border border-line bg-panel p-6 shadow-2xl">
            <h2 className="font-display text-xl font-semibold">Copiare {formatCount(selected.length)} elementi?</h2>
            <p className="mt-1 text-[13px] text-muted">
              {formatCount(selFiles)} file, {formatBytes(selSize)}, da <span className="text-text">{src?.name}</span> a{' '}
              <span className="text-text">{dest?.name}</span>.
            </p>
            <ul className="mt-4 max-h-48 space-y-1 overflow-y-auto rounded-lg bg-raised p-3 text-[12px]">
              {selected.map((e) => (
                <li key={e.id} className="flex justify-between gap-4">
                  <span className="truncate">{e.dest}</span>
                  <span className="flex-none tabular-nums text-muted">{formatBytes(e.size)}</span>
                </li>
              ))}
            </ul>
            <ul className="mt-4 space-y-1 text-[12px] text-muted">
              <li>· I file di partenza non vengono spostati né eliminati.</li>
              <li>· I file che esistono già all’arrivo non vengono sovrascritti.</li>
              <li>· Gli elementi non selezionati restano dove sono.</li>
            </ul>
            <div className="mt-6 flex justify-end gap-2">
              <button className="rounded-lg px-4 py-2 text-[13px] text-muted hover:bg-raised hover:text-text" onClick={() => setConfirm(false)}>
                Annulla
              </button>
              <button className={primary} onClick={run}>
                Copia
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── avanzamento ── */}
      {busy === 'copy' && (
        <div className="fixed inset-0 z-20 grid place-items-center bg-black/60 p-6 backdrop-blur-sm" role="status">
          <div className="w-full max-w-md rounded-2xl border border-line bg-panel p-6 text-center shadow-2xl">
            <p className="font-display text-xl font-semibold">Copio {progress?.name || '…'}</p>
            <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-raised">
              <div className="h-full rounded-full bg-safe transition-[width]" style={{ width: `${pct}%` }} />
            </div>
            <p className="mt-2 text-[12px] tabular-nums text-muted">
              {progress ? `${formatBytes(progress.bytes)} di ${formatBytes(progress.total)} · ${formatCount(progress.files)} di ${formatCount(progress.totalFiles)} file` : 'Preparazione…'}
            </p>
            <p className="mt-1 truncate text-[11px] text-muted">{shortPath(progress?.current || '')}</p>
            <button className={`${btn} mt-5`} onClick={() => api.transfer.stop()}>
              Interrompi
            </button>
            <p className="mt-2 text-[11px] text-muted">Interrompendo, quello già copiato resta all’arrivo.</p>
          </div>
        </div>
      )}
    </div>
  );
}
