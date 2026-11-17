import { formatBytes } from '../lib/format';

const Cloud = () => (
  <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
    <path d="M4.5 12.5h7.3a2.7 2.7 0 0 0 .4-5.4A4 4 0 0 0 4.4 6.6a3 3 0 0 0 .1 5.9Z" />
  </svg>
);

function DiskList({ disks, diskId, locked, onSelect }) {
  return (
    <div role="radiogroup" aria-label="Disco da analizzare" className="space-y-1.5">
      {disks.map((d) => {
        const active = d.id === diskId;
        const used = d.total ? (d.total - d.free) / d.total : 0;
        return (
          <button
            key={d.id}
            role="radio"
            aria-checked={active}
            disabled={locked || !!d.disabled}
            onClick={() => onSelect(d.id)}
            title={d.disabled || undefined}
            className={`w-full rounded-lg border px-3 py-2.5 text-left transition-colors disabled:cursor-not-allowed ${
              active ? 'border-text/60 bg-raised' : 'border-line hover:bg-raised/60'
            } ${d.disabled ? 'opacity-45' : ''} ${locked && !active ? 'opacity-60' : ''}`}
          >
            <span className="flex items-baseline justify-between gap-2">
              <span className="truncate text-[13px] font-medium">{d.name}</span>
              <span className="flex-none text-[10px] uppercase tracking-wider text-muted">
                {d.kind === 'system' ? 'Sistema' : 'Esterno'}
              </span>
            </span>
            {d.disabled ? (
              <span className="mt-1 block text-[11px] text-muted">{d.disabled}</span>
            ) : (
              <>
                <span className="mt-2 block h-1 overflow-hidden rounded-full bg-line">
                  <span className={`block h-full rounded-full ${active ? 'bg-text' : 'bg-muted'}`} style={{ width: `${used * 100}%` }} />
                </span>
                <span className="mt-1 block text-[11px] text-muted">
                  {formatBytes(d.free)} liberi su {formatBytes(d.total)}
                </span>
              </>
            )}
          </button>
        );
      })}
    </div>
  );
}

function FolderList({ folders, locked, onToggle, onPick, isSystem }) {
  const regular = folders.filter((f) => !f.custom);
  const custom = folders.filter((f) => f.custom);
  const row = (f) => (
    <li key={f.path}>
      <label className={`flex items-center gap-2.5 rounded-md px-2 py-1.5 ${locked ? 'opacity-60' : 'hover:bg-raised'}`} title={f.path}>
        <input type="checkbox" checked={!f.excluded} disabled={locked} onChange={() => onToggle(f.path, !f.excluded)} />
        <span className={`min-w-0 flex-1 truncate text-[13px] ${f.excluded ? 'text-muted line-through decoration-muted/50' : ''}`}>
          {f.name}
        </span>
        {f.cloud && (
          <span className="flex-none text-muted" title="Sincronizzata con il cloud">
            <Cloud />
          </span>
        )}
      </label>
    </li>
  );
  return (
    <>
      {regular.length > 0 ? (
        <ul className="space-y-0.5">{regular.map(row)}</ul>
      ) : (
        <p className="px-2 text-[12px] text-muted">Nessuna cartella nella radice del disco.</p>
      )}
      {custom.length > 0 && (
        <>
          <p className="mb-1 mt-3 px-2 text-[11px] text-muted">Altre cartelle escluse</p>
          <ul className="space-y-0.5">{custom.map(row)}</ul>
        </>
      )}
      <button
        className="mt-2 w-full rounded-md px-2 py-1.5 text-left text-[12px] text-muted hover:bg-raised hover:text-text disabled:opacity-50"
        onClick={onPick}
        disabled={locked}
      >
        + Escludi un’altra cartella…
      </button>
      {isSystem && folders.some((f) => f.cloud && !f.excluded) && (
        <p className="mt-2 rounded-md border border-caution/30 bg-caution/10 px-2 py-1.5 text-[11px] leading-snug text-caution">
          Eliminare file da una cartella sincronizzata li toglie anche dal cloud.
        </p>
      )}
    </>
  );
}

/** Colonna di sinistra: quale disco analizzare e quali cartelle saltare. */
export default function Sidebar({ disks, diskId, folders, locked, onSelectDisk, onToggleFolder, onPickFolder }) {
  const disk = disks.find((d) => d.id === diskId);
  return (
    <aside className="flex w-64 flex-none flex-col overflow-y-auto border-r border-line px-4 py-5">
      <h2 className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-wider text-muted">Disco</h2>
      <DiskList disks={disks} diskId={diskId} locked={locked} onSelect={onSelectDisk} />
      <p className="mt-2 px-1 text-[11px] leading-snug text-muted">Si analizza e si pulisce un solo disco alla volta.</p>

      {disk && (
        <>
          <h2 className="mb-1 mt-6 px-1 text-[11px] font-semibold uppercase tracking-wider text-muted">Cartelle</h2>
          <p className="mb-2 px-1 text-[11px] leading-snug text-muted">
            Togli la spunta per escludere una cartella: non viene analizzata né toccata.
          </p>
          <FolderList
            folders={folders}
            locked={locked}
            onToggle={onToggleFolder}
            onPick={onPickFolder}
            isSystem={disk.kind === 'system'}
          />
        </>
      )}
    </aside>
  );
}
