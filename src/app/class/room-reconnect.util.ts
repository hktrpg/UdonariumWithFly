/** Last successful room open — used to rejoin after SkyWay fatal closes the peer. */
export type LastRoomSession = {
  userId: string;
  roomId: string;
  roomName: string;
  /** SkyWay channel password (mesh or legacy). */
  meshPassword: string;
};

/** Transient errors where auto-reopen is safe (not backend/auth config). */
export const RECOVERABLE_NETWORK_ERROR_TYPES = [
  'disconnected',
  'socket-error',
  'unavailable-id',
  /** SkyWay SDK: updateMemberTtl / restartIce / event lost after cable drop. */
  'internal',
  /** formatFatalError fallback when SDK name is missing. */
  'default',
] as const;

/**
 * Also try room reopen for these: a fresh Network.open() refreshes SkyWay token /
 * context. If reopen fails, the UI still shows the backend help modal.
 */
export const ROOM_REOPEN_NETWORK_ERROR_TYPES = [
  ...RECOVERABLE_NETWORK_ERROR_TYPES,
  'token-expired',
  'authentication',
  'server-error',
] as const;

export type RoomReopenResult = 'started' | 'busy' | 'no-session';

export function isRecoverableNetworkError(errorType: string): boolean {
  return (RECOVERABLE_NETWORK_ERROR_TYPES as readonly string[]).includes(errorType);
}

/** True when we should try reopenLastRoom (including token / transient backend errors). */
export function shouldAttemptRoomReopen(errorType: string): boolean {
  return (ROOM_REOPEN_NETWORK_ERROR_TYPES as readonly string[]).includes(errorType);
}

/** Room channel members that do not yet have an open DataChannel. */
export function meshGapPeerIds(
  selfId: string,
  memberIds: readonly string[],
  openPeerIds: readonly string[],
): string[] {
  const open = new Set(openPeerIds);
  return memberIds.filter(id => !!id && id !== selfId && !open.has(id));
}

/** True when a half-open connect attempt has exceeded the stuck budget. */
export function isStuckConnecting(
  connectingSinceMs: number | undefined,
  nowMs: number,
  stuckMs: number,
): boolean {
  return connectingSinceMs != null && stuckMs > 0 && (nowMs - connectingSinceMs) >= stuckMs;
}

/**
 * Track when each non-open peer first appeared.
 * Drop entries for peers that left or opened.
 */
export function refreshConnectingSince(
  prev: ReadonlyMap<string, number>,
  peers: ReadonlyArray<{ peerId: string; isOpen: boolean }>,
  nowMs: number,
): Map<string, number> {
  const next = new Map<string, number>();
  for (const p of peers) {
    if (!p.peerId || p.isOpen) continue;
    next.set(p.peerId, prev.get(p.peerId) ?? nowMs);
  }
  return next;
}
