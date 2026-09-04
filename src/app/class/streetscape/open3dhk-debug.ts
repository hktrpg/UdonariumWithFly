/**
 * Open3Dhk download diagnostics.
 * On by default; set localStorage.STREETSCAPE_DEBUG = '0' to silence.
 * Set to '2' / 'verbose' to log every tiny Range GET.
 */
export function isOpen3dhkDebugEnabled(): boolean {
  try {
    if (typeof localStorage === 'undefined') return true;
    return localStorage.getItem('STREETSCAPE_DEBUG') !== '0';
  } catch {
    return true;
  }
}

export function isOpen3dhkVerboseDebug(): boolean {
  try {
    if (typeof localStorage === 'undefined') return false;
    const v = localStorage.getItem('STREETSCAPE_DEBUG');
    return v === '2' || v === 'verbose';
  } catch {
    return false;
  }
}

export function open3dhkDebug(...args: unknown[]): void {
  if (!isOpen3dhkDebugEnabled()) return;
  // eslint-disable-next-line no-console
  console.log('[Open3Dhk]', ...args);
}

export function open3dhkDebugWarn(...args: unknown[]): void {
  if (!isOpen3dhkDebugEnabled()) return;
  // eslint-disable-next-line no-console
  console.warn('[Open3Dhk]', ...args);
}

/** Log every `ms` until the returned disposer is called. */
export function open3dhkDebugHeartbeat(label: string, ms = 5000): () => void {
  if (!isOpen3dhkDebugEnabled()) return () => undefined;
  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const id = setInterval(() => {
    const elapsed = Math.round(
      (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0,
    );
    open3dhkDebug(`⏳ still waiting: ${label}`, { elapsedMs: elapsed });
  }, ms);
  return () => clearInterval(id);
}
