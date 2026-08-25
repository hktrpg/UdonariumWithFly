/**
 * Pure-ish recovery policy for SkyWay outages and token refresh.
 * Triggers only on classified fatal / token-fetch outcomes — not SDK ice-params URLs.
 */

export type OutageKind = 'rtc-api' | 'token-api' | 'server-error' | 'token-expired' | 'disconnected';

const OUTAGE_COOLDOWN_MS: Record<OutageKind, number> = {
  'rtc-api': 45000,
  'token-api': 30000,
  'server-error': 30000,
  'token-expired': 10000,
  disconnected: 0,
};

const REOPEN_BASE_MS: Record<OutageKind, number> = {
  'rtc-api': 8000,
  'token-api': 8000,
  'server-error': 8000,
  'token-expired': 4000,
  disconnected: 3000,
};

const REOPEN_MAX_MS: Record<OutageKind, number> = {
  'rtc-api': 180000,
  'token-api': 180000,
  'server-error': 180000,
  'token-expired': 60000,
  disconnected: 60000,
};

/** Map NETWORK_ERROR / formatFatalError types onto an outage kind. */
export function classifyOutageKind(errorType: string): OutageKind {
  const t = String(errorType || '').toLowerCase();
  if (/rtc-?api/.test(t)) return 'rtc-api';
  if (t === 'token-api' || t === 'token-fetch') return 'token-api';
  if (t === 'server-error' || t === 'authentication') return 'server-error';
  if (t === 'token-expired') return 'token-expired';
  return 'disconnected';
}

/** True when this error type should attempt room reopen (extends room-reconnect.util). */
export function isOutageReopenable(errorType: string): boolean {
  return /rtc-?api/i.test(String(errorType || ''));
}

export function nextRefreshDelayMs(
  attempt: number,
  baseMs = 2000,
  maxMs = 60000,
  jitterFn: () => number = Math.random,
): number {
  const exp = Math.min(baseMs * (2 ** Math.max(0, attempt)), maxMs);
  const jitter = Math.floor(jitterFn() * Math.min(1500, exp * 0.25));
  return exp + jitter;
}

/** Desync N clients hitting POST /token at once (0..maxMs). */
export function reopenJitterMs(peerId?: string, maxMs = 3000, randomFn: () => number = Math.random): number {
  if (!peerId) return Math.floor(randomFn() * maxMs);
  let h = 0;
  for (let i = 0; i < peerId.length; i++) h = ((h << 5) - h + peerId.charCodeAt(i)) | 0;
  return Math.abs(h) % (maxMs + 1);
}

export function shouldSuppressConfigErrorModal(
  errorType: string,
  opts: {
    reopenResult?: 'started' | 'busy' | 'no-session' | string;
    retryPending?: boolean;
    coolingDown?: boolean;
  },
): boolean {
  const config = errorType === 'server-error'
    || errorType === 'authentication'
    || errorType === 'token-expired';
  if (!config) return false;
  if (opts.reopenResult === 'started') return true;
  if (opts.reopenResult === 'busy') return true;
  if (opts.retryPending) return true;
  if (opts.coolingDown) return true;
  return false;
}

/**
 * Session-scoped outage gate. One instance per SkyWayFacade / shared via RoomConnectHelper.
 */
export class SkyWayRecoveryGate {
  private cooldownUntil = 0;
  private lastKind: OutageKind = 'disconnected';
  private lastHealAt = 0;
  private static readonly SLOW_HEAL_MS = 15000;

  noteFailure(kind: OutageKind, nowMs: number = Date.now()): void {
    this.lastKind = kind;
    const cool = OUTAGE_COOLDOWN_MS[kind] ?? 0;
    if (cool > 0) {
      this.cooldownUntil = Math.max(this.cooldownUntil, nowMs + cool);
      console.warn(`skyway-outage: kind=${kind} cooldownUntil=${new Date(this.cooldownUntil).toISOString()}`);
    }
  }

  noteSuccess(nowMs: number = Date.now()): void {
    this.cooldownUntil = 0;
    this.lastKind = 'disconnected';
    this.lastHealAt = nowMs;
  }

  isCoolingDown(nowMs: number = Date.now()): boolean {
    return nowMs < this.cooldownUntil;
  }

  get lastOutageKind(): OutageKind {
    return this.lastKind;
  }

  nextReopenDelayMs(attempt: number, kind?: OutageKind): number {
    const k = kind ?? this.lastKind;
    const base = REOPEN_BASE_MS[k] ?? REOPEN_BASE_MS.disconnected;
    const max = REOPEN_MAX_MS[k] ?? REOPEN_MAX_MS.disconnected;
    return Math.min(base * (2 ** Math.max(0, attempt)), max);
  }

  /**
   * Skip heal only when the session is closed during an outage cooldown.
   * While still open, return false so soft mesh death can recover (situation 2).
   */
  shouldSkipMeshHeal(isOpen: boolean, nowMs: number = Date.now()): boolean {
    if (!this.isCoolingDown(nowMs)) return false;
    return !isOpen;
  }

  /**
   * While open during cooldown, allow heal but not more often than SLOW_HEAL_MS.
   * Pure check — call markHealAttempt() when a heal actually runs.
   */
  shouldThrottleOpenHeal(isOpen: boolean, nowMs: number = Date.now()): boolean {
    if (!isOpen || !this.isCoolingDown(nowMs)) return false;
    return this.lastHealAt > 0 && (nowMs - this.lastHealAt) < SkyWayRecoveryGate.SLOW_HEAL_MS;
  }

  markHealAttempt(nowMs: number = Date.now()): void {
    this.lastHealAt = nowMs;
  }

  /** Reset timers (tests / page unload). */
  resetForTests(): void {
    this.cooldownUntil = 0;
    this.lastKind = 'disconnected';
    this.lastHealAt = 0;
  }
}

/** Shared gate for RoomConnectHelper + facade token path. */
export const skyWayRecoveryGate = new SkyWayRecoveryGate();
