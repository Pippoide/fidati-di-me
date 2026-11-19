import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, errorText } from './lib/api';
import { formatBytes, formatCount, shortPath } from './lib/format';
import GroupCard from './components/GroupCard';
import ConfirmDialog from './components/ConfirmDialog';
import UpdateBanner from './components/UpdateBanner';
import Sidebar from './components/Sidebar';
import TransferView from './components/TransferView';

const LEVELS = [
  { id: 'safe', color: 'bg-safe', title: 'Si può eliminare', hint: 'Cache, log e file temporanei. È ciò che pulisce “Fidati di me”.' },
  { id: 'caution', color: 'bg-caution', title: 'Controlla prima', hint: 'File tuoi o lenti da rigenerare. Decidi tu, voce per voce.' },
  { id: 'protected', color: 'bg-protected', title: 'Meglio non toccare', hint: 'Sistema, applicazioni e dati delle app. Solo in lettura.' },
];

export default function App() {
  const [mode, setMode] = useState('clean'); // clean | transfer
  const [info, setInfo] = useState(null); // { name, channel, version }
  useEffect(() => {
    api.info?.().then(setInfo).catch(() => {});
  }, []);
  const [phase, setPhase] = useState('idle'); // idle | scanning | ready
  const [progress, setProgress] = useState({ scanned: 0, current: '' });
  const [groups, setGroups] = useState([]);
  const [disks, setDisks] = useState([]);
  const [diskId, setDiskId] = useState(null);
  const [scannedDiskId, setScannedDiskId] = useState(null);
  const [folders, setFolders] = useState([]);
  const [selected, setSelected] = useState(() => new Set());
  const [plan, setPlan] = useState(null); // conferma in corso
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState(null); // esito dell'ultima pulizia
  const [notice, setNotice] = useState(null); // es. "cartelle cambiate: rifai l'analisi"
  const [error, setError] = useState(null);

  useEffect(() => api.onProgress(setProgress), []);

  const disk = disks.find((d) => d.id === diskId) || null;
  const isSystem = disk?.kind !== 'external';
  const locked = phase === 'scanning' || busy;

  /** id → { item, group } */
  const index = useMemo(() => {
    const m = new Map();
    for (const g of groups) for (const it of g.items) m.set(it.id, { item: it, group: g });
    return m;
  }, [groups]);

  /** torna allo stato iniziale (cambio di disco o di cartelle) */
  const resetResults = useCallback(() => {
    setPhase((p) => (p === 'scanning' ? p : 'idle'));
    setGroups([]);
    setSelected(new Set());
    setReport(null);
    setScannedDiskId(null);
  }, []);

  /** elenco dischi: all'avvio e ogni volta che la finestra torna in primo piano (dischi collegati o espulsi) */
  const refreshDisks = useCallback(async () => {
    try {
      const list = await api.listDisks();
      setDisks(list);
      setDiskId((id) => (list.some((d) => d.id === id && !d.disabled) ? id : (list.find((d) => !d.disabled)?.id ?? null)));
    } catch (e) {
      setError(errorText(e));
    }
  }, []);
  useEffect(() => {
    refreshDisks();
    window.addEventListener('focus', refreshDisks);
    return () => window.removeEventListener('focus', refreshDisks);
  }, [refreshDisks]);

  // il disco analizzato è stato espulso: i risultati non valgono più
  useEffect(() => {
    if (scannedDiskId && disks.length && !disks.some((d) => d.id === scannedDiskId)) {
      resetResults();
      setNotice('Il disco analizzato è stato scollegato.');
    }
  }, [disks, scannedDiskId, resetResults]);

  // cartelle proposte per il disco scelto
  useEffect(() => {
    if (!diskId) return setFolders([]);
    let alive = true;
    api
      .listFolders(diskId)
      .then((f) => alive && setFolders(f))
      .catch((e) => alive && setError(errorText(e)));
    return () => {
      alive = false;
    };
  }, [diskId]);

  const updateCapacity = (id, cap) => cap && setDisks((ds) => ds.map((d) => (d.id === id ? { ...d, ...cap } : d)));

  const selectDisk = (id) => {
    if (id === diskId || locked) return;
    setDiskId(id);
    setError(null);
    setNotice(null);
    resetResults();
  };

  const changeFolders = async (action) => {
    try {
      setFolders(await action());
      setError(null);
      if (phase === 'ready') {
        resetResults();
        setNotice('Hai cambiato le cartelle da analizzare: rifai l’analisi.');
      }
    } catch (e) {
      setError(errorText(e));
    }
  };
  const toggleFolder = (folder, excluded) => changeFolders(() => api.setExcluded(diskId, folder, excluded));
  const pickFolder = () => changeFolders(() => api.pickExcluded(diskId));

  const scan = async () => {
    if (!diskId) return null;
    const id = diskId;
    setPhase('scanning');
    setError(null);
    setNotice(null);
    setReport(null);
    setSelected(new Set());
    setProgress({ scanned: 0, current: '' });
    try {
      const res = await api.scan(id);
      setGroups(res.groups);
      updateCapacity(id, res.disk);
      setScannedDiskId(id);
      setPhase('ready');
      return res.groups;
    } catch (e) {
      setError(errorText(e));
      setPhase('idle');
      return null;
    }
  };

  /** prepara il riepilogo mostrato nella finestra di conferma */
  const buildPlan = async (ids, trust, source = index) => {
    const byGroup = new Map();
    let size = 0;
    for (const id of ids) {
      const entry = source.get(id);
      if (!entry) continue;
      size += entry.item.size;
      const row = byGroup.get(entry.group.id) || { title: entry.group.title, size: 0, id: entry.group.id, level: entry.group.level };
      row.size += entry.item.size;
      byGroup.set(entry.group.id, row);
    }
    const rows = [...byGroup.values()];
    const has = (...gids) => rows.some((r) => gids.includes(r.id));
    const adobeOpen = has('adobe') ? await api.adobeRunning() : [];
    return {
      trust,
      ids,
      size,
      count: ids.length,
      groups: rows,
      adobeOpen,
      diskName: disk?.name,
      hasCloud: ids.some((id) => source.get(id)?.item.cloud),
      hasEmptyTrash: has('trash'),
      hasPermanent: has('node-modules', 'ios-backups'),
      hasTrash: rows.some((r) => r.level === 'caution' && !['trash', 'node-modules', 'ios-backups'].includes(r.id)),
    };
  };

  const askDeleteSelected = async () => setPlan(await buildPlan([...selected], false));

  /** “Fidati di me”: analizza se serve, poi propone tutti e soli i gruppi sicuri del disco scelto */
  const trustMe = async () => {
    const current = phase === 'ready' && scannedDiskId === diskId ? groups : await scan();
    if (!current) return;
    const source = new Map();
    const ids = [];
    for (const g of current) {
      for (const it of g.items) {
        source.set(it.id, { item: it, group: g });
        if (g.level === 'safe') ids.push(it.id);
      }
    }
    if (!ids.length) return setReport({ freed: 0, trashed: 0, failed: [], empty: true });
    setPlan(await buildPlan(ids, true, source));
  };

  const runPlan = async () => {
    setBusy(true);
    try {
      const { results, disk: newCapacity } = await api.remove(plan.ids);
      const done = new Map(results.filter((r) => r.ok).map((r) => [r.id, r]));
      const failed = results
        .filter((r) => !r.ok || r.error)
        .map((r) => ({ name: index.get(r.id)?.item.name || r.id, error: r.error }));
      setGroups((gs) =>
        gs
          .map((g) => {
            const gone = g.items.filter((i) => done.has(i.id));
            if (!gone.length) return g;
            return {
              ...g,
              items: g.items.filter((i) => !done.has(i.id)),
              totalCount: g.totalCount - gone.length,
              size: Math.max(0, g.size - gone.reduce((s, i) => s + i.size, 0)),
            };
          })
          .filter((g) => g.items.length)
      );
      setSelected((s) => new Set([...s].filter((id) => !done.has(id))));
      updateCapacity(scannedDiskId, newCapacity);
      setReport({
        freed: results.reduce((s, r) => s + (r.freed || 0), 0),
        trashed: results.reduce((s, r) => s + (r.trashed || 0), 0),
        failed,
      });
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
      setPlan(null);
    }
  };

  const toggleItem = (id) =>
    setSelected((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  const toggleGroup = (group, on) =>
    setSelected((s) => {
      const n = new Set(s);
      for (const it of group.items) on ? n.add(it.id) : n.delete(it.id);
      return n;
    });

  const selectedSize = useMemo(() => [...selected].reduce((s, id) => s + (index.get(id)?.item.size || 0), 0), [selected, index]);
  const safeSize = groups.filter((g) => g.level === 'safe').reduce((s, g) => s + g.size, 0);
  const used = disk ? disk.total - disk.free : 0;

  return (
    <div className="flex h-full flex-col">
      {/* ── intestazione ─────────────────────────────────────────────── */}
      <header className="drag flex items-end justify-between gap-6 border-b border-line px-8 pb-5 pt-10">
        <div className="min-w-0">
          <div className="flex items-center gap-4">
            <h1 className="font-display text-3xl font-bold tracking-tight">
              Fidati
              {info?.channel === 'bk' && (
                <span className="ml-2 rounded-md border border-caution/50 px-1.5 py-0.5 align-middle text-[11px] font-semibold tracking-wider text-caution">
                  BK
                </span>
              )}
            </h1>
            <div role="tablist" aria-label="Funzione" className="no-drag flex rounded-lg border border-line p-0.5 text-[12px]">
              {[
                ['clean', 'Pulizia'],
                ['transfer', 'Trasferimento ordinato'],
              ].map(([id, label]) => (
                <button
                  key={id}
                  role="tab"
                  aria-selected={mode === id}
                  disabled={locked}
                  onClick={() => setMode(id)}
                  className={`rounded-md px-3 py-1 disabled:opacity-50 ${mode === id ? 'bg-raised text-text' : 'text-muted hover:text-text'}`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          {mode === 'transfer' ? (
            <p className="mt-1 text-[13px] text-muted">Copia i progetti da un disco all’altro, ognuno al suo posto.</p>
          ) : disk?.total ? (
            <div className="mt-2 w-72">
              <div className="h-1.5 overflow-hidden rounded-full bg-raised">
                <div className="h-full rounded-full bg-text" style={{ width: `${Math.min(100, (used / disk.total) * 100)}%` }} />
              </div>
              <p className="mt-1.5 truncate text-[12px] text-muted">
                <span className="text-text">{disk.name}</span> · {formatBytes(disk.free)} liberi su {formatBytes(disk.total)}
              </p>
            </div>
          ) : (
            <p className="mt-1 text-[13px] text-muted">Analizza il Mac e libera spazio senza rompere niente.</p>
          )}
        </div>
        <div className={`no-drag flex flex-none items-center gap-2 ${mode === 'clean' ? '' : 'hidden'}`}>
          <button
            className="rounded-lg border border-line px-4 py-2 text-[13px] hover:bg-raised disabled:opacity-50"
            onClick={scan}
            disabled={locked || !diskId}
          >
            {phase === 'ready' ? 'Analizza di nuovo' : 'Analizza'}
          </button>
          <button
            className="rounded-lg bg-safe px-5 py-2 text-[13px] font-semibold text-ink hover:brightness-110 disabled:opacity-50"
            onClick={trustMe}
            disabled={locked || !diskId}
          >
            Fidati di me{phase === 'ready' && safeSize > 0 ? ` · ${formatBytes(safeSize)}` : ''}
          </button>
        </div>
      </header>

      <main className={`min-h-0 flex-1 overflow-y-auto px-8 py-6 ${mode === 'transfer' ? '' : 'hidden'}`}>
        {mode === 'transfer' && <UpdateBanner />}
        <TransferView disks={disks} />
      </main>

      <div className={`flex min-h-0 flex-1 ${mode === 'clean' ? '' : 'hidden'}`}>
        <Sidebar
          disks={disks}
          diskId={diskId}
          folders={folders}
          locked={locked}
          onSelectDisk={selectDisk}
          onToggleFolder={toggleFolder}
          onPickFolder={pickFolder}
        />

        {/* ── contenuto ────────────────────────────────────────────────── */}
        <main className="min-w-0 flex-1 overflow-y-auto px-8 py-6">
          {mode === 'clean' && <UpdateBanner />}
          {api.isMock && (
            <p className="mb-4 rounded-lg border border-caution/40 bg-caution/10 px-3 py-2 text-[12px] text-caution">
              Anteprima nel browser con dati di esempio: qui non viene analizzato né eliminato nulla.
            </p>
          )}
          {error && (
            <p className="mb-4 rounded-lg border border-protected/40 bg-protected/10 px-3 py-2 text-[13px] text-protected">{error}</p>
          )}
          {notice && <p className="mb-4 rounded-lg border border-line bg-panel px-3 py-2 text-[13px] text-muted">{notice}</p>}
          {report && (
            <div className="mb-5 rounded-xl border border-safe/30 bg-safe/10 px-4 py-3 text-[13px]">
              <p className="font-medium text-safe">
                {report.empty
                  ? `Niente da pulire su ${disk?.name ?? 'questo disco'}: è già tutto in ordine.`
                  : `Fatto. ${formatBytes(report.freed)} liberati${report.trashed ? `, ${formatBytes(report.trashed)} spostati nel Cestino` : ''}.`}
              </p>
              {report.failed.length > 0 && (
                <ul className="mt-2 space-y-0.5 text-[12px] text-muted">
                  {report.failed.slice(0, 6).map((f, i) => (
                    <li key={i}>
                      {f.name}: {f.error}
                    </li>
                  ))}
                  {report.failed.length > 6 && <li>…e altri {report.failed.length - 6}</li>}
                </ul>
              )}
            </div>
          )}

          {phase === 'idle' && (
            <div className="mx-auto mt-14 max-w-md text-center">
              <p className="font-display text-2xl font-semibold">{disk ? `Pronto ad analizzare ${disk.name}` : 'Nessun disco disponibile'}</p>
              {isSystem ? (
                <p className="mt-3 text-[14px] leading-relaxed text-muted">
                  <strong className="text-text">Analizza</strong> esamina la tua cartella Inizio, le app e i dati di sistema, e
                  ti mostra i file divisi per gruppi: scegli tu cosa eliminare.
                  <br />
                  <strong className="text-text">Fidati di me</strong> pulisce da solo cache, log e file temporanei, con un occhio
                  di riguardo per le app Adobe. Prima ti mostra cosa sta per fare.
                </p>
              ) : (
                <p className="mt-3 text-[14px] leading-relaxed text-muted">
                  <strong className="text-text">Analizza</strong> esamina tutto il disco e ti mostra i file divisi per gruppi.
                  <br />
                  <strong className="text-text">Fidati di me</strong> qui pulisce solo le cache multimediali Adobe (Media Cache,
                  Peak Files) che trova sul disco.
                </p>
              )}
              <p className="mt-3 text-[12px] text-muted">Le cartelle senza spunta, nella colonna a sinistra, non vengono toccate.</p>
              <button className="mt-6 text-[12px] text-muted underline underline-offset-2 hover:text-text" onClick={api.openPrivacy}>
                Per un’analisi completa concedi “Accesso completo al disco”
              </button>
            </div>
          )}

          {phase === 'scanning' && (
            <div className="mx-auto mt-20 max-w-md text-center" role="status">
              <div className="mx-auto h-1 w-56 overflow-hidden rounded-full bg-raised">
                <div className="h-full w-1/3 animate-[slide_1.2s_ease-in-out_infinite] rounded-full bg-safe" />
              </div>
              <p className="mt-6 font-display text-xl font-semibold tabular-nums">{formatCount(progress.scanned)} file analizzati</p>
              <p className="mt-1 truncate text-[12px] text-muted">{shortPath(progress.current || '') || 'Preparazione…'}</p>
              <style>{'@keyframes slide{0%{transform:translateX(-100%)}100%{transform:translateX(300%)}}'}</style>
            </div>
          )}

          {phase === 'ready' && groups.length === 0 && (
            <p className="mx-auto mt-16 max-w-md text-center text-[14px] text-muted">Su {disk?.name} non ho trovato nulla da mostrare.</p>
          )}

          {phase === 'ready' &&
            LEVELS.map((level) => {
              const list = groups.filter((g) => g.level === level.id).sort((a, b) => b.size - a.size);
              if (!list.length) return null;
              return (
                <section key={level.id} className="mb-8">
                  <div className="mb-3 flex items-baseline gap-2.5">
                    <span className={`h-2 w-2 flex-none translate-y-[-1px] rounded-full ${level.color}`} />
                    <h2 className="text-[13px] font-semibold uppercase tracking-wider">{level.title}</h2>
                    <span className="truncate text-[12px] text-muted">{level.hint}</span>
                  </div>
                  <div className="space-y-2">
                    {list.map((g) => (
                      <GroupCard
                        key={g.id}
                        group={g}
                        selected={selected}
                        onToggleGroup={toggleGroup}
                        onToggleItem={toggleItem}
                        onReveal={api.reveal}
                      />
                    ))}
                  </div>
                </section>
              );
            })}
        </main>
      </div>

      {/* ── barra di selezione ───────────────────────────────────────── */}
      {mode === 'clean' && selected.size > 0 && (
        <footer className="flex items-center justify-between border-t border-line bg-panel px-8 py-3">
          <p className="text-[13px]">
            <span className="font-semibold tabular-nums">{formatCount(selected.size)}</span> selezionati ·{' '}
            <span className="font-semibold tabular-nums">{formatBytes(selectedSize)}</span>
            <span className="text-muted"> · {disk?.name}</span>
          </p>
          <div className="flex gap-2">
            <button className="rounded-lg px-3 py-2 text-[13px] text-muted hover:bg-raised hover:text-text" onClick={() => setSelected(new Set())}>
              Deseleziona
            </button>
            <button
              className="rounded-lg bg-protected px-4 py-2 text-[13px] font-semibold text-ink hover:brightness-110 disabled:opacity-50"
              onClick={askDeleteSelected}
              disabled={locked}
            >
              Elimina selezionati
            </button>
          </div>
        </footer>
      )}

      {plan && <ConfirmDialog plan={plan} busy={busy} onCancel={() => setPlan(null)} onConfirm={runPlan} />}
    </div>
  );
}
