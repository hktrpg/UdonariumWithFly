const pad2 = (n: number) => String(n).padStart(2, '0');

/** Parse `YYYY-MM-DDTHH:mm:ss[.fff]Z` to UTC epoch ms without `new Date(isoString)`. */
export function utcMsFromIsoInstant(utcIso: string): number | null {
  const raw = String(utcIso ?? '').trim();
  if (!raw) return null;

  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?Z$/i.exec(raw);
  if (m) {
    const frac = m[7] ? Number(m[7].slice(0, 3).padEnd(3, '0')) : 0;
    const ms = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6], frac);
    return Number.isFinite(ms) ? ms : null;
  }

  try {
    const parsed = Date.parse(raw);
    return Number.isFinite(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function formatLocalWallViaIntl(utcMs: number): string | null {
  try {
    if (typeof Intl === 'undefined' || !Intl.DateTimeFormat) return null;
    const parts = new Intl.DateTimeFormat(undefined, {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(utcMs);
    const pick = (type: Intl.DateTimeFormatPartTypes) =>
      parts.find(p => p.type === type)?.value;
    const y = pick('year');
    const mo = pick('month');
    const d = pick('day');
    const h = pick('hour');
    const mi = pick('minute');
    if (!y || !mo || !d || h == null || mi == null) return null;
    return `${y}-${mo}-${d} ${h}:${mi}`;
  } catch {
    return null;
  }
}

function safeLocalWallFromUtcMs(utcMs: number): string | null {
  try {
    const d = new Date(utcMs);
    const t = typeof d.getTime === 'function' ? d.getTime() : NaN;
    if (!Number.isNaN(t)) {
      return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
    }
  } catch {
    // patched Date — try Intl
  }
  return formatLocalWallViaIntl(utcMs);
}

/**
 * Format a UTC ISO instant for display in the viewer's local timezone.
 * Uses numeric `Date` timestamps when possible so a patched `Date` constructor
 * (e.g. from token/crypto libs) does not break `new Date(isoString)`.
 */
export function formatUtcIsoToLocal(utcIso: string): string {
  const raw = String(utcIso ?? '').trim();
  if (!raw) return raw;

  const utcMs = utcMsFromIsoInstant(raw);
  if (utcMs == null) return raw;

  const local = safeLocalWallFromUtcMs(utcMs);
  return local ?? raw;
}

export type AppVersionStamp = {
  readonly committedAt: string;
  readonly sha: string;
  readonly branch: string;
};

/** Cached at module load — safe for Angular templates (no per-tick Date parsing). */
export function buildAppVersionDisplay(v: AppVersionStamp): string {
  return `${formatUtcIsoToLocal(v.committedAt)} ${v.sha} ${v.branch}`;
}
