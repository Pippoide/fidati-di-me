import { useState } from 'react';
import { formatBytes, formatCount, shortPath } from '../lib/format';

const SUB_LABEL = {
  brief: '00_Brief',
  images: '01_Asset/Immagini',
  logos: '01_Asset/Loghi',
  fonts: '01_Asset/Font',
  media: '01_Asset/Video_Audio',
  other: '01_Asset/Altro',
  work: '02_Lavorazione',
  digital: '03_Export/Digitale',
  print: '03_Export/Stampa',
  archive: '99_Archivio',
};

/** colore del punteggio di sicurezza */
export const scoreColor = (n, threshold) => (n >= threshold ? 'text-safe' : n >= threshold / 2 ? 'text-caution' : 'text-protected');

const Badge = ({ children, tone = 'muted' }) => (
  <span
    className={`flex-none rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider ${
      tone === 'caution' ? 'border-caution/40 text-caution' : 'border-line text-muted'
    }`}
  >
    {children}
  </span>
);

/**
 * Un progetto proposto da "Riorganizza".
 * mode = 'select' → casella per includerlo; 'assign' → pulsante "Sposta" (lista Da smistare)
 */
export default function ProjectCard({ card, threshold, mode = 'select', checked, disabled, onToggle, onRename, onAssign }) {
  const [open, setOpen] = useState(false);
  const [client, setClient] = useState(card.client);
  const [project, setProject] = useState(card.project);
  const commit = () => {
    if (client !== card.client || project !== card.project) onRename(card.id, client, project);
  };
  const ready = client.trim() && project.trim();
  const first = card.items[0];

  return (
    <div className="rounded-xl border border-line bg-panel">
      <div className="flex items-start gap-3 px-4 py-3">
        {mode === 'select' && (
          <input
            type="checkbox"
            className="mt-2"
            checked={checked}
            disabled={disabled || !ready}
            onChange={() => onToggle(card.id)}
            aria-label="Includi questo progetto"
          />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <input
              className="w-40 rounded-md border border-line bg-raised px-2 py-1 text-[13px] placeholder:text-muted/70 focus:border-text/60 focus:outline-none"
              placeholder="Cliente"
              value={client}
              disabled={disabled}
              onChange={(e) => setClient(e.target.value)}
              onBlur={commit}
              onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
              aria-label="Cliente"
            />
            <span className="text-muted">›</span>
            <input
              className="w-48 rounded-md border border-line bg-raised px-2 py-1 text-[13px] placeholder:text-muted/70 focus:border-text/60 focus:outline-none"
              placeholder="Progetto"
              value={project}
              disabled={disabled}
              onChange={(e) => setProject(e.target.value)}
              onBlur={commit}
              onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
              aria-label="Progetto"
            />
            {card.hasLinks && <Badge>Collegati</Badge>}
            {card.hasPackage && <Badge>Pacchetto</Badge>}
            {card.edited && <Badge tone="caution">Scelto da te</Badge>}
          </div>
          <p className="mt-1.5 truncate text-[12px] text-muted" title={card.reasons.join(' · ')}>
            {mode === 'assign' && first ? (
              <>
                <span className="text-text">{first.name}</span>
                {card.items.length > 1 ? ` e altri ${card.items.length - 1}` : ''} ·{' '}
                {shortPath(first.from.slice(0, first.from.length - first.name.length))}
              </>
            ) : (
              card.reasons.join(' · ')
            )}
          </p>
          {card.error && <p className="mt-1 text-[12px] text-protected">{card.error}</p>}
        </div>
        <button className="flex flex-none items-center gap-3 text-right" onClick={() => setOpen(!open)} aria-expanded={open}>
          <span>
            <span className={`block font-display text-[15px] font-semibold tabular-nums ${scoreColor(card.confidence, threshold)}`}>
              {card.confidence}%
            </span>
            <span className="block text-[11px] text-muted">
              {formatCount(card.count)} file · {formatBytes(card.size)}
            </span>
          </span>
          <span className={`text-muted transition-transform ${open ? 'rotate-90' : ''}`} aria-hidden="true">
            ›
          </span>
        </button>
        {mode === 'assign' && (
          <button
            className="flex-none self-center rounded-lg bg-text px-3 py-1.5 text-[12px] font-semibold text-ink hover:brightness-90 disabled:opacity-40"
            disabled={disabled || !ready}
            onClick={() => onAssign(card.id, client, project)}
          >
            Sposta
          </button>
        )}
      </div>

      {open && (
        <ul className="max-h-72 overflow-y-auto border-t border-line px-4 py-2 text-[12px]">
          {mode === 'assign' && <li className="pb-2 text-muted">{card.reasons.join(' · ')}</li>}
          {card.items.map((it) => (
            <li key={it.from} className="flex items-baseline gap-2 py-1">
              <span className="w-56 flex-none truncate" title={it.from}>
                {it.kind === 'dir' ? '▸ ' : ''}
                {it.name}
              </span>
              <span className="flex-none text-muted">→</span>
              <span className="min-w-0 flex-1 truncate text-muted" title={it.to || ''}>
                {it.to ? (
                  <>
                    {it.to.split('/').slice(0, -1).join('/')}/
                    <span className={it.renamed ? 'text-text' : ''}>{it.to.split('/').pop()}</span>
                  </>
                ) : (
                  SUB_LABEL[it.sub]
                )}
              </span>
              {it.linked && <span className="flex-none text-[10px] uppercase tracking-wider text-muted">collegato</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
