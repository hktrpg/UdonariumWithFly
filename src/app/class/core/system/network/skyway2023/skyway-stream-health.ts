/** No inbound data for this long marks a channel as stale (metrics / debug only). */
export const STALE_INBOUND_MS = 45000;

/** healthRate below this with long silence is considered stale inbound. */
export const STALE_HEALTH_THRESHOLD = 0.12;

export type StreamHealthMetrics = {
  healthRate: number;
  ping: number;
  pingRate: number;
  speed: number;
};

/** Same formula as upstream WithFly skyway-data-stream updateStatsAsync. */
export function computeStreamHealthMetrics(deltaTimeMs: number, currentPing: number): StreamHealthMetrics {
  const healthRate = deltaTimeMs <= 10000 ? 1 : 5000 / ((deltaTimeMs - 10000) + 5000);
  const ping = healthRate < 1 ? deltaTimeMs : currentPing;
  const pingRate = 500 / (ping + 500);
  return { healthRate, ping, pingRate, speed: pingRate * healthRate };
}

/** True when inbound has been quiet long enough to flag in debug logs. */
export function isInboundStale(deltaTimeMs: number, healthRate: number): boolean {
  return deltaTimeMs > STALE_INBOUND_MS && healthRate < STALE_HEALTH_THRESHOLD;
}

/**
 * Upstream WithFly never forces DataChannel recycle on stale inbound.
 * HKTRPG aligns: monitor health only; recovery is via RoomConnectHelper / mesh-death reopen.
 */
export function shouldRecycleStaleDataChannel(_deltaTimeMs: number, _healthRate: number): boolean {
  return false;
}
