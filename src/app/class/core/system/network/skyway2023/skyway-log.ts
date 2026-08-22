import { Logger } from '@skyway-sdk/core';
import { netDebug } from '../net-debug';

let installed = false;

/** Flatten SDK log args for regex filters. */
export function skyWayMsgText(msg: unknown[]): string {
  return msg.map(m => (typeof m === 'string' ? m : JSON.stringify(m))).join(' ');
}

/** Expected peer churn / missing lobby Find — SDK dumps noisy payloads; keep console quiet. */
export function isBenignSkyWayNoise(msg: unknown[]): boolean {
  try {
    return /onStreamAdded|already left|"name"\s*:\s*"timeout"|timeout:\s*onStreamAdded|channelNotFound|\[failed\]\s*findChannel|signalingClient|publicationNotExist|alreadySubscribedPublication|localPersonNotJoinedChannel/i
      .test(skyWayMsgText(msg));
  } catch {
    return false;
  }
}

/**
 * Real recovery signals that should stay visible as a single warn line
 * (not console.error with a stack-looking SDK dump).
 */
/** Subscribe races / channel not ready — retry without tearing down the stream. */
export function isRetriableSubscribeError(msg: string): boolean {
  return /already left|onStreamAdded|timeout|publicationNotExist|alreadySubscribedPublication|localPersonNotJoinedChannel/i.test(msg);
}

export function isDowngradedSkyWayWarn(msg: unknown[]): boolean {
  try {
    return /restartIce limit exceeded/i.test(skyWayMsgText(msg));
  } catch {
    return false;
  }
}

export function shortSkyWaySummary(msg: unknown[]): string {
  for (const m of msg) {
    if (!m || typeof m !== 'object') continue;
    const any = m as { info?: { name?: string; detail?: string }; name?: string; message?: string };
    if (any.info?.name) {
      return any.info.detail ? `${any.info.name}: ${any.info.detail}` : any.info.name;
    }
    if (any.name && any.message) return `${any.name}: ${any.message}`;
  }
  for (const m of msg) {
    if (typeof m === 'string' && m.length > 0 && m.length < 160) return m;
  }
  return 'error';
}

/**
 * Soften @skyway-sdk console noise: expected subscribe timeouts / missing channels
 * become netDebug-only; ICE restart limit is a one-line warn; other errors stay one-line
 * (full payload only with UDONARIUM_NET_DEBUG=1).
 */
export function installSkyWayQuietLogger() {
  if (installed) return;

  const proto = Logger.prototype as unknown as {
    _log?: (level: string, ...msg: unknown[]) => void;
  };
  const original = proto._log;
  if (typeof original !== 'function') return;
  installed = true;

  proto._log = function (this: unknown, level: string, ...msg: unknown[]) {
    if ((level === 'error' || level === 'warn') && isBenignSkyWayNoise(msg)) {
      netDebug(`[skyWay] ${shortSkyWaySummary(msg)} (ignored)`);
      return;
    }
    if ((level === 'error' || level === 'warn') && isDowngradedSkyWayWarn(msg)) {
      console.warn(`[skyWay] ${shortSkyWaySummary(msg)}`);
      netDebug('[skyWay] detail', ...msg);
      return;
    }
    if (level === 'error') {
      console.error(`[skyWay] ${shortSkyWaySummary(msg)}`);
      netDebug('[skyWay] detail', ...msg);
      return;
    }
    return original.apply(this, [level, ...msg] as [string, ...unknown[]]);
  };
}
