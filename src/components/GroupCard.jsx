import { useEffect, useRef, useState } from 'react';
import { formatBytes, formatCount, shortPath } from '../lib/format';

const Lock = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
    <rect x="3" y="7" width="10" height="7" rx="2" />
    <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" />
  </svg>
);

/** Un gruppo di file: riga riassuntiva + elenco espandibile delle voci. */
export default function GroupCard({ group, selected, onToggleGroup, onToggleItem, onReveal }) {
  const [open, setOpen] = useState(false);
  const locked = group.level === 'protected';
  const picked = group.items.filter((i) => selected.has(i.id)).length;
  const all = picked === group.items.length && picked > 0;

  const box = useRef(null);
  useEffect(() => {
    if (box.current) box.current.indeterminate = picked > 0 && !all;
  }, [picked, all]);

  const hidden = group.totalCount - group.items.length;

  return (
    <div className="rounded-xl border border-line bg-panel">
      <div className="flex items-center gap-3 px-4 py-3">
        {locked ? (
          <span className="grid h-4 w-4 flex-none place-content-center text-protected" title="Protetto: non eliminabile">
            <Lock />
          </span>
        ) : (
          <input
            ref={box}
            type="checkbox"
            checked={all}
            onChange={() => onToggleGroup(group, !all)}
            aria-label={`Seleziona ${group.title}`}
          />
        )}
        <button className="flex min-w-0 flex-1 items-center gap-4 text-left" onClick={() => setOpen(!open)} aria-expanded={open}>
          <span className="min-w-0 flex-1">
            <span className="block text-[14px] font-medium">{group.title}</span>
            <span className="block truncate text-[12px] text-muted">{group.description}</span>
          </span>
          <span className="flex-none text-right">
            <span className="block font-display text-[15px] font-semibold tabular-nums">
              {group.size > 0 ? formatBytes(group.size) : '—'}
            </span>
            <span className="block text-[11px] text-muted">
              {formatCount(group.totalCount)} {group.totalCount === 1 ? 'elemento' : 'elementi'}
            </span>
          </span>
          <span className={`flex-none text-muted transition-transform ${open ? 'rotate-90' : ''}`} aria-hidden="true">
            ›
          </span>
        </button>
      </div>

      {open && (
        <ul className="max-h-72 overflow-y-auto border-t border-line py-1">
          {group.items.map((it) => (
            <li key={it.id} className="group flex items-center gap-3 px-4 py-1.5 hover:bg-raised">
              {locked ? (
                <span className="w-4 flex-none" />
              ) : (
                <input
                  type="checkbox"
                  checked={selected.has(it.id)}
                  onChange={() => onToggleItem(it.id)}
                  aria-label={`Seleziona ${it.name}`}
                />
              )}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px]">{it.name}</span>
                <span className="block truncate text-[11px] text-muted">{it.note || shortPath(it.path)}</span>
              </span>
              <button
                className="flex-none rounded px-1.5 py-0.5 text-[11px] text-muted opacity-0 hover:text-text group-hover:opacity-100 focus-visible:opacity-100"
                onClick={() => onReveal(it.id)}
              >
                Mostra nel Finder
              </button>
              <span className="w-20 flex-none text-right text-[12px] tabular-nums text-muted">
                {it.size > 0 ? formatBytes(it.size) : '—'}
              </span>
            </li>
          ))}
          {hidden > 0 && (
            <li className="px-4 py-2 text-[11px] text-muted">
              Mostrati i {group.items.length} più grandi. Altri {formatCount(hidden)} elementi più piccoli non sono elencati e
              non vengono toccati.
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
