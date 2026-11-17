import { useEffect } from 'react';
import { formatBytes, formatCount } from '../lib/format';

/**
 * Conferma prima di eliminare.
 * plan = { trust, count, size, groups:[{title,size,level}], hasTrash, hasPermanent, hasEmptyTrash, adobeOpen:[] }
 */
export default function ConfirmDialog({ plan, busy, onCancel, onConfirm }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && !busy && onCancel();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onCancel]);

  return (
    <div className="fixed inset-0 z-20 grid place-items-center bg-black/60 p-6 backdrop-blur-sm">
      <div role="dialog" aria-modal="true" className="w-full max-w-md rounded-2xl border border-line bg-panel p-6 shadow-2xl">
        <h2 className="font-display text-xl font-semibold">
          {plan.trust ? 'Fidati di me' : 'Eliminare gli elementi selezionati?'}
        </h2>
        <p className="mt-1 text-[13px] text-muted">
          {plan.trust
            ? 'Elimino solo cache, log e file temporanei: le app li ricreano da sole. Nessun documento, nessuna impostazione, nessun file di sistema.'
            : `${formatCount(plan.count)} ${plan.count === 1 ? 'elemento' : 'elementi'}, ${formatBytes(plan.size)} in totale.`}
        </p>
        {plan.diskName && (
          <p className="mt-2 text-[12px] text-muted">
            Disco: <span className="text-text">{plan.diskName}</span>. Gli altri dischi e le cartelle escluse non vengono toccati.
          </p>
        )}

        <ul className="mt-4 max-h-48 space-y-1 overflow-y-auto rounded-lg bg-raised p-3 text-[13px]">
          {plan.groups.map((g) => (
            <li key={g.title} className="flex justify-between gap-4">
              <span className="truncate">{g.title}</span>
              <span className="flex-none tabular-nums text-muted">{g.size > 0 ? formatBytes(g.size) : '—'}</span>
            </li>
          ))}
          <li className="flex justify-between gap-4 border-t border-line pt-2 font-medium">
            <span>Totale</span>
            <span className="tabular-nums">{formatBytes(plan.size)}</span>
          </li>
        </ul>

        <div className="mt-4 space-y-2 text-[12px]">
          {plan.adobeOpen.length > 0 && (
            <p className="rounded-lg border border-caution/40 bg-caution/10 p-2.5 text-caution">
              {plan.adobeOpen.join(', ')} {plan.adobeOpen.length === 1 ? 'è aperta' : 'sono aperte'}: la cache Adobe verrà
              saltata. Chiudi le app Adobe e riprova per pulirla.
            </p>
          )}
          {plan.hasCloud && (
            <p className="rounded-lg border border-caution/40 bg-caution/10 p-2.5 text-caution">
              Alcuni file sono in una cartella sincronizzata (Dropbox, iCloud Drive…): eliminarli li toglie anche dal cloud e dagli
              altri dispositivi.
            </p>
          )}
          {plan.hasTrash && <p className="text-muted">I tuoi file personali vanno nel Cestino: puoi recuperarli da lì.</p>}
          {(plan.hasPermanent || plan.hasEmptyTrash) && (
            <p className="text-caution">
              {plan.hasEmptyTrash ? 'Lo svuotamento del Cestino di questo disco' : 'L’eliminazione di node_modules e backup'} è definitiva.
            </p>
          )}
          {plan.trust && <p className="text-muted">Consiglio: chiudi le altre app prima di procedere.</p>}
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <button
            className="rounded-lg px-4 py-2 text-[13px] text-muted hover:bg-raised hover:text-text disabled:opacity-50"
            onClick={onCancel}
            disabled={busy}
          >
            Annulla
          </button>
          <button
            className={`rounded-lg px-4 py-2 text-[13px] font-semibold text-ink disabled:opacity-60 ${
              plan.trust ? 'bg-safe hover:brightness-110' : 'bg-protected hover:brightness-110'
            }`}
            onClick={onConfirm}
            disabled={busy}
          >
            {busy ? 'Elimino…' : plan.trust ? `Pulisci ${formatBytes(plan.size)}` : 'Elimina'}
          </button>
        </div>
      </div>
    </div>
  );
}
