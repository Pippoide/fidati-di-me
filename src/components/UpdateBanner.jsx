import { useEffect, useState } from 'react';
import { api, errorText } from '../lib/api';
import { formatBytes } from '../lib/format';

/** All'avvio controlla se su GitHub c'è una versione più nuova e propone di installarla. */
export default function UpdateBanner() {
  const [info, setInfo] = useState(null); // { current, latest?, size? }
  const [state, setState] = useState('idle'); // idle | working | error
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');

  useEffect(() => {
    api.checkUpdate().then(setInfo).catch(() => {});
    return api.onUpdateProgress(({ done, total }) => setProgress(total ? Math.round((done / total) * 100) : 0));
  }, []);

  if (!info?.latest) return null;

  const install = async () => {
    setState('working');
    setError('');
    try {
      await api.installUpdate(); // l'app si chiude e si riapre aggiornata
    } catch (e) {
      setError(errorText(e));
      setState('error');
    }
  };

  return (
    <div className="mb-4 flex items-center justify-between gap-4 rounded-xl border border-line bg-panel px-4 py-3 text-[13px]">
      <p className="min-w-0">
        <span className="font-medium">È disponibile Fidati {info.latest}</span>
        <span className="text-muted">
          {' '}
          · hai la {info.current}
          {info.size ? ` · ${formatBytes(info.size)}` : ''}
        </span>
        {state === 'error' && <span className="mt-0.5 block text-protected">{error}</span>}
      </p>
      <button
        className="flex-none rounded-lg bg-text px-4 py-1.5 font-semibold text-ink hover:brightness-110 disabled:opacity-60"
        onClick={install}
        disabled={state === 'working'}
      >
        {state === 'working' ? `Scarico… ${progress}%` : state === 'error' ? 'Riprova' : 'Aggiorna e riavvia'}
      </button>
    </div>
  );
}
