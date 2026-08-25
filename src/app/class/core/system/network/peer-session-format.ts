/** Format throughput for peer status UI (e.g. 2.5kb/s). */
export function formatBitrate(bps: number): string {
  if (!Number.isFinite(bps) || bps < 0) return '—';
  if (bps < 1024) return `${Math.round(bps)}b/s`;
  if (bps < 1024 * 1024) {
    const kb = bps / 1024;
    return `${kb >= 10 ? kb.toFixed(0) : kb.toFixed(1)}kb/s`;
  }
  const mb = bps / (1024 * 1024);
  return `${mb >= 10 ? mb.toFixed(0) : mb.toFixed(1)}mb/s`;
}

/** Format RTT number for peer status UI (suffix applied by i18n as `ms`). */
export function formatPing(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '—';
  if (ms < 10 && ms !== Math.round(ms)) return ms.toFixed(1);
  return String(Math.round(ms));
}
