import { useEffect, useMemo, useState } from 'react';
import { api, errorText } from '../lib/api';
import { formatBytes, formatCount, shortPath } from '../lib/format';
import ProjectCard from './ProjectCard';

const TREE = `Clienti/
└── Cliente/
    └── 2026-11_Progetto/
        ├── 00_Brief/
        ├── 01_Asset/  Immagini · Loghi · Font · Video_Audio
        ├── 02_Lavorazione/  (i file collegati restano insieme)
        ├── 03_Export/  Digitale · Stampa
        └── 99_Archivio/  (versioni vecchie)`;

const PHASE_LABEL = { scan: 'Leggo le cartelle…', links: 'Cerco i file collegati…', move: 'Sposto i file…', done: 'Quasi fatto…' };

/** Riorganizza: riconosce i progetti e li sposta in Clienti/Cliente/Progetto. */
export default function Organizer({ disk, resetKey, onBusy, onOpenHistory }) {
  const [opts, setOpts] = useState(null); // { threshold, rename, dest }
  const [mode, setMode] = useState('folder'); // folder | disk
  const [source, setSource] = useState(null);
  const [phase, setPhase] = useState('setup'); // setup | analyzing | preview | applying | done
  const [progress, setProgress] = useState(null);
  const [analysis, setAnalysis] = useState(null); // { source, dest, stats, adobeOpen }
  const [cards, setCards] = useState([]); // anteprime dei progetti (con edited)
  const [picked, setPicked] = useState(() => new Set()); // progetti esclusi a mano (si parte da tutti inclusi)
  const [confirm, setConfirm] = useState(false);
  const [report, setReport] = useState(null); // { moved, failed }
  const [error, setError] = useState(null);

  const busy = phase === 'analyzing' || phase === 'applying';
  useEffect(() => onBusy(busy), [busy, onBusy]);
  useEffect(() => api.onOrgProgress(setProgress), []);

  // cambio di disco o di cartelle escluse: si ricomincia
  useEffect(() => {
    if (!disk) return;
    setPhase('setup');
    setCards([]);
    setReport(null);
    setError(null);
    setSource(null);
    api
      .orgOptions(disk.id)
      .then(setOpts)
      .catch((e) => setError(errorText(e)));
  }, [disk?.id, resetKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const threshold = opts?.threshold ?? 70;
  const isReady = (c) => c.client && c.project && !c.error && (c.edited || c.confidence >= threshold);
  const ready = cards.filter(isReady);
  const unsorted = cards.filter((c) => !isReady(c));
  const chosen = ready.filter((c) => !picked.has(c.id));
  const chosenFiles = chosen.reduce((s, c) => s + c.count, 0);
  const chosenSize = chosen.reduce((s, c) => s + c.size, 0);

  const byClient = useMemo(() => {
    const m = new Map();
    for (const c of ready) {
      if (!m.has(c.client)) m.set(c.client, []);
      m.get(c.client).push(c);
    }
    return [...m].sort((a, b) => a[0].localeCompare(b[0], 'it'));
  }, [ready]);

  const saveOpts = async (patch) => {
    setOpts((o) => ({ ...o, ...patch }));
    try {
      await api.orgSetOptions(patch);
      if ('rename' in patch && cards.length) {
        // i nomi di destinazione cambiano: si ricalcolano le anteprime
        const fresh = await Promise.all(cards.map((c) => (c.client && c.project ? api.orgPreview(c.id, c.client, c.project) : c)));
        setCards((cs) => cs.map((c, i) => ({ ...fresh[i], edited: c.edited })));
      }
    } catch (e) {
      setError(errorText(e));
    }
  };

  const pickSource = async () => {
    try {
      const p = await api.orgPickSource(disk.id);
      if (p) {
        setSource(p);
        setMode('folder');
      }
    } catch (e) {
      setError(errorText(e));
    }
  };
  const pickDest = async () => {
    try {
      const p = await api.orgPickDest(disk.id);
      if (p) setOpts((o) => ({ ...o, dest: p }));
    } catch (e) {
      setError(errorText(e));
    }
  };

  const analyze = async () => {
    setError(null);
    setReport(null);
    setPhase('analyzing');
    setProgress(null);
    try {
      const res = await api.orgAnalyze(disk.id, mode === 'disk' ? null : source);
      setAnalysis(res);
      setCards(res.clusters.map((c) => ({ ...c, edited: false })));
      setPicked(new Set());
      setPhase('preview');
    } catch (e) {
      setError(errorText(e));
      setPhase('setup');
    }
  };

  const rename = async (id, client, project) => {
    try {
      const fresh = await api.orgPreview(id, client, project);
      setCards((cs) => cs.map((c) => (c.id === id ? { ...fresh, edited: true } : c)));
    } catch (e) {
      setError(errorText(e));
    }
  };

  const toggle = (id) =>
    setPicked((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });

  const run = async (jobs) => {
    const res = await api.orgApply(jobs.map((c) => ({ id: c.id, client: c.client, project: c.project })));
    const done = new Set(res.applied);
    setCards((cs) => cs.filter((c) => !done.has(c.id)));
    return res;
  };

  const applyChosen = async () => {
    setConfirm(false);
    setPhase('applying');
    setProgress(null);
    setError(null);
    try {
      const res = await run(chosen);
      setReport({ moved: res.moved, failed: res.failed });
      // da qui in poi tutto ciò che resta è "Da smistare"
      setCards((cs) => cs.map((c) => ({ ...c, edited: false, confidence: Math.min(c.confidence, threshold - 1) })));
      setPhase('done');
    } catch (e) {
      setError(errorText(e));
      setPhase('preview');
    }
  };

  const assign = async (id, client, project) => {
    setError(null);
    try {
      const fresh = await api.orgPreview(id, client, project);
      if (fresh.error) throw new Error(fresh.error);
      setPhase('applying');
      const res = await run([fresh]);
      setReport((r) => ({ moved: (r?.moved || 0) + res.moved, failed: [...(r?.failed || []), ...res.failed] }));
    } catch (e) {
      setError(errorText(e));
    } finally {
      setPhase('done');
    }
  };

  if (!disk) return <p className="mx-auto mt-16 max-w-md text-center text-[14px] text-muted">Nessun disco disponibile.</p>;

  return (
    <div className="pb-6">
      {error && <p className="mb-4 rounded-lg border border-protected/40 bg-protected/10 px-3 py-2 text-[13px] text-protected">{error}</p>}

      {/* ── impostazioni ───────────────────────────────────────────── */}
      {(phase === 'setup' || phase === 'analyzing') && opts && (
        <div className="grid gap-6 lg:grid-cols-[1fr_auto]">
          <div className="space-y-5">
            <section>
              <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted">Cosa riordinare</h2>
              <div className="space-y-1.5" role="radiogroup">
                <label
                  className={`flex items-center gap-3 rounded-lg border px-3 py-2.5 ${mode === 'folder' ? 'border-text/60 bg-raised' : 'border-line'}`}
                >
                  <input type="radio" name="org-mode" checked={mode === 'folder'} onChange={() => setMode('folder')} disabled={busy} />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13px] font-medium">Una cartella</span>
                    <span className="block truncate text-[12px] text-muted">{source ? shortPath(source) : 'Nessuna cartella scelta'}</span>
                  </span>
                  <button
                    className="rounded-md border border-line px-3 py-1 text-[12px] hover:bg-raised disabled:opacity-50"
                    onClick={pickSource}
                    disabled={busy}
                  >
                    Scegli…
                  </button>
                </label>
                <label
                  className={`flex items-center gap-3 rounded-lg border px-3 py-2.5 ${mode === 'disk' ? 'border-text/60 bg-raised' : 'border-line'}`}
                >
                  <input type="radio" name="org-mode" checked={mode === 'disk'} onChange={() => setMode('disk')} disabled={busy} />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13px] font-medium">Tutto {disk.name}</span>
                    <span className="block text-[12px] text-muted">
                      {disk.kind === 'system' ? 'La cartella Inizio, senza Library e app.' : 'Tutto il disco.'} Le cartelle senza spunta a
                      sinistra restano fuori.
                    </span>
                  </span>
                </label>
              </div>
            </section>

            <section>
              <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted">Cartella dei clienti</h2>
              <div className="flex items-center gap-3 rounded-lg border border-line px-3 py-2.5">
                <span className="min-w-0 flex-1 truncate text-[13px]" title={opts.dest}>
                  {shortPath(opts.dest)}
                </span>
                <button
                  className="rounded-md border border-line px-3 py-1 text-[12px] hover:bg-raised disabled:opacity-50"
                  onClick={pickDest}
                  disabled={busy}
                >
                  Cambia…
                </button>
              </div>
              <p className="mt-1.5 text-[11px] text-muted">Se non esiste la creo io. I clienti già presenti qui vengono riconosciuti.</p>
            </section>

            <section className="space-y-3">
              <label className="flex items-start gap-3">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={opts.rename}
                  onChange={() => saveOpts({ rename: !opts.rename })}
                  disabled={busy}
                />
                <span>
                  <span className="block text-[13px]">Rinomina i file</span>
                  <span className="block text-[12px] text-muted">
                    Cliente_Progetto_descrizione_v01. Per i file collegati (InDesign, After Effects, Premiere) lascio un .txt con vecchi e
                    nuovi nomi per ricollegarli.
                  </span>
                </span>
              </label>
              <Threshold
                value={threshold}
                onChange={(v) => setOpts((o) => ({ ...o, threshold: v }))}
                onCommit={(v) => saveOpts({ threshold: v })}
                disabled={busy}
              />
            </section>

            <button
              className="rounded-lg bg-safe px-5 py-2 text-[13px] font-semibold text-ink hover:brightness-110 disabled:opacity-50"
              onClick={analyze}
              disabled={busy || (mode === 'folder' && !source)}
            >
              {phase === 'analyzing' ? 'Analizzo…' : 'Analizza'}
            </button>
            {phase === 'analyzing' && <Progress p={progress} />}
            <p className="text-[12px] text-muted">
              Prima di spostare qualsiasi cosa ti mostro l’anteprima. Ogni spostamento finisce nella Cronologia e si può annullare.
            </p>
          </div>
          <pre className="h-fit rounded-xl border border-line bg-panel p-4 text-[11.5px] leading-relaxed text-muted">{TREE}</pre>
        </div>
      )}

      {/* ── anteprima ──────────────────────────────────────────────── */}
      {(phase === 'preview' || (phase === 'applying' && !report)) && analysis && (
        <>
          <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="font-display text-xl font-semibold">
                {formatCount(ready.length)} {ready.length === 1 ? 'progetto pronto' : 'progetti pronti'} ·{' '}
                <span className="text-muted">{formatCount(unsorted.length)} da smistare</span>
              </p>
              <p className="mt-1 text-[12px] text-muted">
                {formatCount(analysis.stats.files)} file letti in {shortPath(analysis.source)} · destinazione {shortPath(analysis.dest)}
                {analysis.stats.skipped ? ` · ${analysis.stats.skipped} cartelle di codice o librerie lasciate stare` : ''}
              </p>
            </div>
            <div className="flex items-center gap-4">
              <Threshold
                value={threshold}
                onChange={(v) => setOpts((o) => ({ ...o, threshold: v }))}
                onCommit={(v) => saveOpts({ threshold: v })}
                disabled={busy}
                compact
              />
              <button
                className="text-[12px] text-muted underline underline-offset-2 hover:text-text"
                onClick={() => setPhase('setup')}
                disabled={busy}
              >
                Cambia impostazioni
              </button>
            </div>
          </div>

          {analysis.stats.truncated && (
            <Note tone="caution">Ci sono troppi file: ho letto i primi 30.000. Riordina una cartella alla volta per vederli tutti.</Note>
          )}
          {analysis.adobeOpen.length > 0 && (
            <Note tone="caution">
              {analysis.adobeOpen.join(', ')} {analysis.adobeOpen.length === 1 ? 'è aperta' : 'sono aperte'}: chiudi i documenti prima di
              spostarli, o l’app perderà i collegamenti.
            </Note>
          )}

          {byClient.length === 0 && (
            <p className="my-10 text-center text-[14px] text-muted">Nessun progetto supera la soglia del {threshold}%.</p>
          )}
          {byClient.map(([client, list]) => (
            <section key={client} className="mb-6">
              <h2 className="mb-2 text-[13px] font-semibold uppercase tracking-wider">{client}</h2>
              <div className="space-y-2">
                {list.map((c) => (
                  <ProjectCard
                    key={c.id}
                    card={c}
                    threshold={threshold}
                    checked={!picked.has(c.id)}
                    disabled={busy}
                    onToggle={toggle}
                    onRename={rename}
                  />
                ))}
              </div>
            </section>
          ))}

          {unsorted.length > 0 && (
            <details className="mb-6 rounded-xl border border-line">
              <summary className="cursor-default px-4 py-3 text-[13px]">
                <span className="font-semibold">Da smistare · {formatCount(unsorted.length)}</span>
                <span className="text-muted">
                  {' '}
                  — sotto la soglia: restano dove sono e te li ripropongo alla fine. Se scrivi tu cliente e progetto, passano fra i progetti pronti.
                </span>
              </summary>
              <div className="space-y-2 px-3 pb-3">
                {unsorted.map((c) => (
                  <ProjectCard
                    key={c.id}
                    card={c}
                    threshold={threshold}
                    mode="select"
                    checked={false}
                    disabled
                    onToggle={() => {}}
                    onRename={rename}
                  />
                ))}
              </div>
            </details>
          )}

          <footer className="sticky bottom-0 -mx-8 flex items-center justify-between border-t border-line bg-panel px-8 py-3">
            <p className="text-[13px]">
              <span className="font-semibold tabular-nums">{formatCount(chosenFiles)}</span> file in{' '}
              <span className="font-semibold tabular-nums">{formatCount(chosen.length)}</span> progetti · {formatBytes(chosenSize)}
            </p>
            <button
              className="rounded-lg bg-safe px-5 py-2 text-[13px] font-semibold text-ink hover:brightness-110 disabled:opacity-50"
              disabled={busy || !chosen.length}
              onClick={() => setConfirm(true)}
            >
              {phase === 'applying' ? 'Sposto…' : 'Riorganizza'}
            </button>
          </footer>
          {phase === 'applying' && <Progress p={progress} />}
        </>
      )}

      {/* ── fine: esito e lista di smistamento ──────────────────────── */}
      {(phase === 'done' || (phase === 'applying' && report)) && report && (
        <>
          <div className="mb-5 rounded-xl border border-safe/30 bg-safe/10 px-4 py-3 text-[13px]">
            <p className="font-medium text-safe">
              Fatto. {formatCount(report.moved)} {report.moved === 1 ? 'elemento spostato' : 'elementi spostati'} in{' '}
              {shortPath(analysis.dest)}.
            </p>
            <p className="mt-1 text-[12px] text-muted">Puoi rimettere tutto com’era, anche un file alla volta, dalla Cronologia.</p>
            {report.failed.length > 0 && (
              <ul className="mt-2 space-y-0.5 text-[12px] text-muted">
                {report.failed.slice(0, 8).map((f, i) => (
                  <li key={i}>
                    {f.name}: {f.error}
                  </li>
                ))}
                {report.failed.length > 8 && <li>…e altri {report.failed.length - 8}</li>}
              </ul>
            )}
            <div className="mt-3 flex gap-2">
              <button
                className="rounded-lg border border-line bg-panel px-3 py-1.5 text-[12px] hover:bg-raised"
                onClick={() => api.orgReveal(analysis.dest)}
              >
                Apri la cartella dei clienti
              </button>
              <button className="rounded-lg border border-line bg-panel px-3 py-1.5 text-[12px] hover:bg-raised" onClick={onOpenHistory}>
                Cronologia
              </button>
              <button
                className="rounded-lg px-3 py-1.5 text-[12px] text-muted hover:bg-raised hover:text-text"
                onClick={() => setPhase('setup')}
                disabled={busy}
              >
                Nuova analisi
              </button>
            </div>
          </div>

          <h2 className="mb-1 text-[13px] font-semibold uppercase tracking-wider">Lista di smistamento · {formatCount(cards.length)}</h2>
          {cards.length ? (
            <>
              <p className="mb-3 text-[12px] text-muted">
                Per questi non sono abbastanza sicuro. Sono rimasti dove erano: scrivi cliente e progetto e premi Sposta, oppure lasciali
                lì.
              </p>
              <div className="space-y-2">
                {cards.map((c) => (
                  <ProjectCard
                    key={c.id}
                    card={c}
                    threshold={threshold}
                    mode="assign"
                    disabled={busy}
                    onRename={rename}
                    onAssign={assign}
                  />
                ))}
              </div>
            </>
          ) : (
            <p className="text-[13px] text-muted">Niente da smistare: ho riconosciuto tutto.</p>
          )}
        </>
      )}

      {confirm && (
        <div className="fixed inset-0 z-20 grid place-items-center bg-black/60 p-6 backdrop-blur-sm">
          <div role="dialog" aria-modal="true" className="w-full max-w-md rounded-2xl border border-line bg-panel p-6 shadow-2xl">
            <h2 className="font-display text-xl font-semibold">Riorganizzare {formatCount(chosen.length)} progetti?</h2>
            <p className="mt-1 text-[13px] text-muted">
              Sposto {formatCount(chosenFiles)} file ({formatBytes(chosenSize)}) in {shortPath(analysis.dest)}. Non copio niente: i file
              cambiano posto
              {opts.rename ? ' e nome' : ''}.
            </p>
            <ul className="mt-4 space-y-1.5 text-[12px] text-muted">
              <li>• I file collegati restano insieme in 02_Lavorazione, con un .txt per ricollegarli.</li>
              <li>• Le cartelle d’origine rimaste vuote vengono tolte.</li>
              <li>• {formatCount(unsorted.length)} da smistare restano dove sono: te li elenco alla fine.</li>
              <li>• Ogni spostamento va nella Cronologia: puoi annullarlo quando vuoi, anche dopo aver chiuso l’app.</li>
            </ul>
            <div className="mt-6 flex justify-end gap-2">
              <button
                className="rounded-lg px-4 py-2 text-[13px] text-muted hover:bg-raised hover:text-text"
                onClick={() => setConfirm(false)}
              >
                Annulla
              </button>
              <button
                className="rounded-lg bg-safe px-4 py-2 text-[13px] font-semibold text-ink hover:brightness-110"
                onClick={applyChosen}
              >
                Riorganizza
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Threshold({ value, onChange, onCommit, disabled, compact }) {
  return (
    <label className={compact ? 'flex items-center gap-2 text-[12px]' : 'block'}>
      <span className={compact ? 'text-muted' : 'block text-[13px]'}>
        Soglia di sicurezza <span className="font-semibold tabular-nums text-text">{value}%</span>
      </span>
      <input
        type="range"
        min="0"
        max="100"
        step="5"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        onMouseUp={(e) => onCommit(Number(e.currentTarget.value))}
        onKeyUp={(e) => onCommit(Number(e.currentTarget.value))}
        className={`accent-[var(--color-safe)] ${compact ? 'w-32' : 'mt-1 w-64'}`}
        aria-label="Soglia di sicurezza"
      />
      {!compact && (
        <span className="block text-[12px] text-muted">
          Sotto questa soglia un file non viene spostato e finisce nella lista di smistamento.
        </span>
      )}
    </label>
  );
}

function Progress({ p }) {
  return (
    <div className="mt-4" role="status">
      <div className="h-1 w-56 overflow-hidden rounded-full bg-raised">
        <div
          className="h-full rounded-full bg-safe transition-[width]"
          style={{ width: p?.total ? `${Math.round((p.done / p.total) * 100)}%` : '30%' }}
        />
      </div>
      <p className="mt-2 text-[12px] text-muted">
        {PHASE_LABEL[p?.phase] || 'Preparazione…'}
        {p?.total ? ` ${formatCount(p.done)} di ${formatCount(p.total)}` : ''}
      </p>
      {p?.current && <p className="truncate text-[11px] text-muted">{shortPath(p.current)}</p>}
    </div>
  );
}

function Note({ tone, children }) {
  return (
    <p
      className={`mb-4 rounded-lg border px-3 py-2 text-[12px] ${tone === 'caution' ? 'border-caution/40 bg-caution/10 text-caution' : 'border-line bg-panel text-muted'}`}
    >
      {children}
    </p>
  );
}
