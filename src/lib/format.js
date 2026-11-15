const UNITS = ['byte', 'KB', 'MB', 'GB', 'TB'];

/** 1536000 → "1,5 MB" (unità decimali, come il Finder) */
export function formatBytes(bytes) {
  if (!bytes || bytes < 0) return '0 KB';
  let i = 0;
  let n = bytes;
  while (n >= 1000 && i < UNITS.length - 1) {
    n /= 1000;
    i++;
  }
  const digits = i < 2 || n >= 100 ? 0 : n >= 10 ? 1 : 2;
  return `${n.toLocaleString('it-IT', { maximumFractionDigits: digits })} ${UNITS[i]}`;
}

export const formatCount = (n) => n.toLocaleString('it-IT');

/** /Users/gio/Documents/x.pdf → ~/Documents/x.pdf */
export const shortPath = (p) => p.replace(/^\/Users\/[^/]+/, '~');
