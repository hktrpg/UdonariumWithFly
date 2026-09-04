/** Streetscape error codes (align MODEL_* style). */

export const STREETSCAPE_ERRORS = {
  INVALID_PACK: 'STREETSCAPE_INVALID_PACK',
  NO_MANIFEST: 'STREETSCAPE_NO_MANIFEST',
  NO_FLOOR: 'STREETSCAPE_NO_FLOOR',
  NO_FEATURE: 'STREETSCAPE_NO_FEATURE',
  OVER_CAPS: 'STREETSCAPE_OVER_CAPS',
  CANCELLED: 'STREETSCAPE_CANCELLED',
  NOT_A_PACK: 'STREETSCAPE_NOT_A_PACK',
  FETCH_FAILED: 'STREETSCAPE_FETCH_FAILED',
  /** LandsD Open3Dhk CDN returned 5xx (often 502 Proxy Error). */
  UPSTREAM_UNAVAILABLE: 'STREETSCAPE_UPSTREAM_UNAVAILABLE',
  UNKNOWN_SOURCE: 'STREETSCAPE_UNKNOWN_SOURCE',
  NO_QUERY: 'STREETSCAPE_NO_QUERY',
  NO_STREET_MATCH: 'STREETSCAPE_NO_STREET_MATCH',
  NO_MORE_MODELS: 'STREETSCAPE_NO_MORE_MODELS',
} as const;

export function isStreetscapeAbort(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const name = (err as { name?: string }).name;
  const message = err instanceof Error ? err.message : '';
  return name === 'AbortError' || message === STREETSCAPE_ERRORS.CANCELLED;
}

export function isOpen3dhkUpstreamUnavailable(err: unknown): boolean {
  return err instanceof Error && err.message === STREETSCAPE_ERRORS.UPSTREAM_UNAVAILABLE;
}

export function streetscapeErrorI18nKey(err: unknown): string {
  if (isStreetscapeAbort(err)) return 'streetscape.error.cancelled';
  const code = err instanceof Error ? err.message : String(err || '');
  switch (code) {
    case STREETSCAPE_ERRORS.INVALID_PACK: return 'streetscape.error.invalidPack';
    case STREETSCAPE_ERRORS.NO_MANIFEST: return 'streetscape.error.noManifest';
    case STREETSCAPE_ERRORS.NO_FLOOR: return 'streetscape.error.noFloor';
    case STREETSCAPE_ERRORS.NO_FEATURE: return 'streetscape.error.noFeature';
    case STREETSCAPE_ERRORS.OVER_CAPS: return 'streetscape.error.overCaps';
    case STREETSCAPE_ERRORS.CANCELLED: return 'streetscape.error.cancelled';
    case STREETSCAPE_ERRORS.NOT_A_PACK: return 'streetscape.error.notAPack';
    case STREETSCAPE_ERRORS.FETCH_FAILED: return 'streetscape.error.fetchFailed';
    case STREETSCAPE_ERRORS.UPSTREAM_UNAVAILABLE: return 'streetscape.error.upstreamUnavailable';
    case STREETSCAPE_ERRORS.UNKNOWN_SOURCE: return 'streetscape.error.unknownSource';
    case STREETSCAPE_ERRORS.NO_QUERY: return 'streetscape.error.noQuery';
    case STREETSCAPE_ERRORS.NO_STREET_MATCH: return 'streetscape.error.noStreetMatch';
    case STREETSCAPE_ERRORS.NO_MORE_MODELS: return 'streetscape.error.noMoreModels';
    default: return 'streetscape.error.generic';
  }
}
