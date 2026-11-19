import { useCallback, useEffect, useState } from 'react';
import { api, errorText } from '../lib/api';
import { formatBytes, formatCount, shortPath } from '../lib/format';

const TABS = [
  {
    id: 'riorganizza',
    title: 'Riorganizzazioni',
    hint: 'Ogni file spostato da Riorganizza. Rimettilo dov’era, da solo, a gruppi o tutti insieme.',
  },
  {
    id: 'pulizia',
    title: 'Pulizia · Cestino',
    hint: 'Solo i file che hai scelto tu e mandato nel Cestino: se ti sei sbagliato tornano nella loro cartella. Cache e dati di sistema, eliminati subito, non sono qui.',
  },
];

const STATE = {
  done: { riorganizza: 'Spostato', pulizia: 'Nel Cestino', cls: 'text-text' },
  restored: { riorganizza: 'Rimesso a posto', pulizia: 'Ripreso', cls: 'text-safe' },
  failed: { riorganizza: 'Non riuscito', pulizia: 'Non riuscito', cls: 'text-protected' },
};

const when = (ms) =>
  new Date(ms).toLocaleString('it-IT', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const base = (p) => (p ? p.split('/').pop() : '');
const dir = (p) => (p ? shortPath(p.split('/').slice(0, -1).join('/')) : '');

/** Cronologia: tutti gli spostamenti registrati, ripristinabili anche dopo la chiusura dell'app. */
export default function History() {
  const [tab, setTab] = useState('riorganizza');
  const [data, setData] = useState({ riorganizza: [], pulizia: [] });
  const [selected, setSelected] = useState(() => new Set());
  const [open, setOpen] = useState(() => new Set());
  const [busy, setBusy] = useState(false);
  const [ask, setAsk] = useState(null); // { ids, issues }
  const [report, setReport] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    try {
      setData(await api.logList());
    } catch (e) {
      setError(errorText(e));
    }
  }, []);
  useEffect(() => {
    load();
    window.addEventListener('focus', load);
    return () => window.removeEventListener('focus', load);
  }, [load]);

  const sessions = data[tab] || [];
  const restorable = (s) => s.entries.filter((e) => e.state === 'done');
  const allIds = sessions.flatMap((s) => restorable(s).map((e) => e.id));

  const switchTab = (id) => {
    setTab(id);
    setSelected(new Set());
    setReport(null);
    setError(null);
  };

  const restore = async (ids, force = false) => {
    if (!ids.length) return;
    setBusy(true);
    setError(null);
    setAsk(null);
    try {
      const res = await api.logRestore(tab, ids, force);
      if (res.needsConfirm) {
        setAsk({ ids, issues: res.needsConfirm });
        return;
      }
      setData((d) => ({ ...d, [tab]: res.list }));
      setSelected(new Set());
      const ok = res.results.filter((r) => r.ok).length;
      setReport({ ok, failed: res.results.filter((r) => !r.ok) });
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const forget = async (sessionId) => {
    try {
      const list = await api.logForget(tab, sessionId);
      setData((d) => ({ ...d, [tab]: list }));
    } catch (e) {
      setError(errorText(e));
    }
  };

  const toggle = (ids, on) =>
    setSelected((s) => {
      const n = new Set(s);
      for (const id of ids) on ? n.add(id) : n.delete(id);
      return n;
    });

  const nameOf = (id) => base(sessions.flatMap((s) => s.entries).find((e) => e.id === id)?.from);

  return (
    <div className="pb-6">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-4">
        <div role="tablist" className="flex gap-1 rounded-lg border border-line p-1">
          {TABS.map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => switchTab(t.id)}
              className={`rounded-md px-3 py-1.5 text-[13px] ${tab === t.id ? 'bg-raised font-medium' : 'text-muted hover:text-text'}`}
            >
              {t.title}
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <button
            className="rounded-lg border border-line px-3 py-2 text-[13px] hover:bg-raised disabled:opacity-40"
            disabled={busy || !selected.size}
            onClick={() => restore([...selected])}
          >
            Ripristina selezionati{selected.size ? ` · ${formatCount(selected.size)}` : ''}
          </button>
          <button
            className="rounded-lg bg-text px-4 py-2 text-[13px] font-semibold text-ink hover:brightness-90 disabled:opacity-40"
            disabled={busy || !allIds.length}
            onClick={() => restore(allIds)}
          >
            Ripristina tutto
          </button>
        </div>
      </div>
      <p className="mb-5 text-[12px] text-muted">{TABS.find((t) => t.id === tab).hint}</p>

      {error && <p className="mb-4 rounded-lg border border-protected/40 bg-protected/10 px-3 py-2 text-[13px] text-protected">{error}</p>}
      {report && (
        <div className="mb-5 rounded-xl border border-safe/30 bg-safe/10 px-4 py-3 text-[13px]">
          <p className="font-medium text-safe">
            {report.ok
              ? `${formatCount(report.ok)} ${report.ok === 1 ? 'elemento rimesso' : 'elementi rimessi'} nella posizione originale.`
              : 'Nessun elemento ripristinato.'}
          </p>
          {report.failed.length > 0 && (
            <ul className="mt-2 space-y-0.5 text-[12px] text-muted">
              {report.failed.slice(0, 8).map((f) => (
                <li key={f.id}>
                  {nameOf(f.id)}: {f.error}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {sessions.length === 0 && (
        <p className="mx-auto mt-16 max-w-md text-center text-[14px] text-muted">
          {tab === 'riorganizza' ? 'Nessuna riorganizzazione ancora.' : 'Nessun file mandato nel Cestino da Fidati.'}
        </p>
      )}

      <div className="space-y-2">
        {sessions.map((s) => {
          const left = restorable(s);
          const isOpen = open.has(s.id);
          const size = s.entries.reduce((n, e) => n + (e.size || 0), 0);
          const pickedHere = left.filter((e) => selected.has(e.id)).length;
          return (
            <div key={s.id} className="rounded-xl border border-line bg-panel">
              <div className="flex items-center gap-3 px-4 py-3">
                <input
                  type="checkbox"
                  checked={left.length > 0 && pickedHere === left.length}
                  ref={(el) => el && (el.indeterminate = pickedHere > 0 && pickedHere < left.length)}
                  disabled={!left.length || busy}
                  onChange={() =>
                    toggle(
                      left.map((e) => e.id),
                      pickedHere !== left.length,
                    )
                  }
                  aria-label="Seleziona la sessione"
                />
                <button
                  className="flex min-w-0 flex-1 items-center gap-4 text-left"
                  onClick={() => setOpen((o) => (o.has(s.id) ? new Set([...o].filter((x) => x !== s.id)) : new Set([...o, s.id])))}
                  aria-expanded={isOpen}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block text-[14px] font-medium">{when(s.at)}</span>
                    <span className="block truncate text-[12px] text-muted">
                      {s.label} · da {shortPath(s.root || '')}
                    </span>
                  </span>
                  <span className="flex-none text-right">
                    <span className="block font-display text-[15px] font-semibold tabular-nums">{formatBytes(size)}</span>
                    <span className="block text-[11px] text-muted">
                      {formatCount(s.entries.length)} elementi
                      {left.length !== s.entries.length ? ` · ${formatCount(left.length)} da ripristinare` : ''}
                    </span>
                  </span>
                  <span className={`flex-none text-muted transition-transform ${isOpen ? 'rotate-90' : ''}`} aria-hidden="true">
                    ›
                  </span>
                </button>
                {left.length > 0 ? (
                  <button
                    className="flex-none rounded-lg border border-line px-3 py-1.5 text-[12px] hover:bg-raised disabled:opacity-40"
                    disabled={busy}
                    onClick={() => restore(left.map((e) => e.id))}
                  >
                    Ripristina sessione
                  </button>
                ) : (
                  <button
                    className="flex-none rounded-lg px-3 py-1.5 text-[12px] text-muted hover:bg-raised hover:text-text"
                    onClick={() => forget(s.id)}
                  >
                    Togli dalla cronologia
                  </button>
                )}
              </div>

              {isOpen && (
                <ul className="max-h-80 overflow-y-auto border-t border-line px-4 py-2 text-[12px]">
                  {s.entries.map((e) => {
                    const st = STATE[e.state] || STATE.done;
                    const now = e.state === 'restored' ? e.restoredTo : e.to;
                    return (
                      <li key={e.id} className="flex items-center gap-3 py-1.5">
                        <input
                          type="checkbox"
                          checked={selected.has(e.id)}
                          disabled={e.state !== 'done' || busy}
                          onChange={() => toggle([e.id], !selected.has(e.id))}
                          aria-label={`Seleziona ${base(e.from)}`}
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate" title={e.from}>
                            {e.isDir ? '▸ ' : ''}
                            {base(e.from)}
                          </span>
                          <span className="block truncate text-muted" title={`${e.from}\n→ ${now || ''}`}>
                            {dir(e.from)}
                            {e.state === 'done' && e.to && tab === 'riorganizza' ? `  →  ${shortPath(e.to)}` : ''}
                          </span>
                        </span>
                        <span className={`flex-none text-[11px] ${st.cls}`} title={e.error || ''}>
                          {st[tab]}
                        </span>
                        <span className="w-16 flex-none text-right tabular-nums text-muted">{formatBytes(e.size)}</span>
                        <button
                          className="flex-none text-[11px] text-muted underline-offset-2 hover:text-text hover:underline disabled:opacity-30"
                          disabled={!now}
                          onClick={() => api.logReveal(tab, e.id)}
                        >
                          Mostra
                        </button>
                        {e.state === 'done' && (
                          <button
                            className="flex-none text-[11px] text-text underline-offset-2 hover:underline disabled:opacity-30"
                            disabled={busy}
                            onClick={() => restore([e.id])}
                          >
                            Ripristina
                          </button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          );
        })}
      </div>

      {ask && (
        <div className="fixed inset-0 z-20 grid place-items-center bg-black/60 p-6 backdrop-blur-sm">
          <div role="dialog" aria-modal="true" className="w-full max-w-lg rounded-2xl border border-line bg-panel p-6 shadow-2xl">
            <h2 className="font-display text-xl font-semibold">Prima di ripristinare</h2>
            <p className="mt-1 text-[13px] text-muted">
              {formatCount(ask.ids.length)} {ask.ids.length === 1 ? 'elemento' : 'elementi'} da rimettere a posto. Per alcuni c’è qualcosa
              da sapere:
            </p>
            <ul className="mt-4 max-h-60 space-y-2 overflow-y-auto rounded-lg bg-raised p-3 text-[12px]">
              {ask.issues.map((i) => (
                <li key={i.id}>
                  <span className="font-medium">{i.name}</span>{' '}
                  <span className={i.kind === 'error' ? 'text-protected' : 'text-caution'}>{i.message}</span>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-[12px] text-muted">
              Gli altri tornano al loro posto normalmente. Quelli in rosso non si possono ripristinare.
            </p>
            <div className="mt-6 flex justify-end gap-2">
              <button className="rounded-lg px-4 py-2 text-[13px] text-muted hover:bg-raised hover:text-text" onClick={() => setAsk(null)}>
                Annulla
              </button>
              <button
                className="rounded-lg bg-text px-4 py-2 text-[13px] font-semibold text-ink hover:brightness-90"
                onClick={() => restore(ask.ids, true)}
              >
                Ripristina
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
