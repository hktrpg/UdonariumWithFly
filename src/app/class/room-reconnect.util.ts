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

/** Extend mesh prune budget on slow effective connection types (Network Information API). */
export function meshStuckBudgetMs(baseMs: number, effectiveType?: string): number {
  if (baseMs <= 0) return baseMs;
  if (effectiveType === 'slow-2g' || effectiveType === '2g') return Math.max(baseMs, 90000);
  if (effectiveType === '3g') return Math.max(baseMs, 60000);
  return baseMs;
}

/** Wait before treating a dropped DataChannel as a hard disconnect (ICE may recover). */
export function poorNetworkCloseDebounceMs(effectiveType?: string): number {
  if (effectiveType === 'slow-2g' || effectiveType === '2g') return 15000;
  if (effectiveType === '3g') return 10000;
  return 8000;
}

export function navigatorEffectiveType(): string | undefined {
  try {
    return (navigator as Navigator & { connection?: { effectiveType?: string } }).connection?.effectiveType;
  } catch {
    return undefined;
  }
}

/** Inputs for survival mesh policy (local client only). */
export type SurvivalMeshInput = {
  openCount: number;
  roomMemberCount: number;
  bestOpenPing?: number;
};

/** Peer shape for buildSurvivalMeshContext (open RTT sampling). */
export type SurvivalMeshPeer = {
  isOpen?: boolean;
  session?: { ping?: number };
};

/**
 * Build survival mesh policy inputs.
 * openCount follows openPeerIds (open DataChannel list), not half-open handshakes.
 */
export function buildSurvivalMeshContext(
  openPeerIds: readonly string[],
  memberIds: readonly string[],
  peers: readonly SurvivalMeshPeer[],
): SurvivalMeshInput {
  let bestPing = 0;
  for (const p of peers) {
    const ping = p.session?.ping;
    if (p.isOpen && ping != null && ping > bestPing) bestPing = ping;
  }
  return {
    openCount: openPeerIds.length,
    roomMemberCount: memberIds.length,
    bestOpenPing: bestPing > 0 ? bestPing : undefined,
  };
}

/** Relay fan-out targets: every other open peer besides the packet source. */
export function relayTargetPeerIds(selfPeerId: string, openPeerIds: readonly string[]): string[] {
  return openPeerIds.filter(id => !!id && id !== selfPeerId);
}

export type RelayContainer = {
  ttl: number;
  users?: string[];
};

export type RelayFanOutPeer = {
  peerId: string;
  isOpen: boolean;
  send: (container: RelayContainer) => void;
};

/**
 * Fan-out relay from source peer to other open peers (SkyWayConnection.onRelay).
 * @returns peerIds that received the container
 */
export function applyRelayFanOut(
  sourcePeerId: string,
  openPeerIds: readonly string[],
  relayTargetsFromTable: string[] | null | undefined,
  peers: readonly RelayFanOutPeer[],
  relayUserIds: string[] | undefined,
  container: RelayContainer,
): string[] {
  if (container.ttl <= 0) return [];

  let targets = relayTargetsFromTable;
  if (!targets?.length) {
    targets = relayTargetPeerIds(sourcePeerId, openPeerIds);
  }
  if (targets.length < 1) return [];

  container.ttl--;

  if (container.users && container.users.length > 0 && relayUserIds) {
    container.users = relayUserIds;
  }

  const forwarded: string[] = [];
  for (const peerId of targets) {
    const peer = peers.find(p => p.peerId === peerId);
    if (peer?.isOpen) {
      peer.send(container);
      forwarded.push(peerId);
    }
  }
  return forwarded;
}

function isSlowEffectiveType(): boolean {
  const et = navigatorEffectiveType();
  return et === 'slow-2g' || et === '2g' || et === '3g';
}

function isHighLatencyMesh(bestOpenPing?: number): boolean {
  return bestOpenPing != null && bestOpenPing > 2000;
}

/** TRPG tables — keep full mesh; relay-only breaks bidirectional sync on 3–4 clients. */
const SMALL_ROOM_FULL_MESH = 4;

let rekeyFullMeshUntil = 0;

/** After room auth re-key, keep full mesh for a short window (all clients). */
export function markRekeyFullMeshBoost(durationMs = 120000): void {
  rekeyFullMeshUntil = Date.now() + durationMs;
}

export function isRekeyFullMeshBoost(): boolean {
  return Date.now() < rekeyFullMeshUntil;
}

/**
 * True when this client should keep at most one direct mesh link and rely on hub relay.
 * Uses measured RTT on an open peer — avoids false positives from effectiveType alone.
 */
export function shouldLimitDirectMesh(input: SurvivalMeshInput): boolean {
  const { openCount, roomMemberCount, bestOpenPing } = input;
  if (roomMemberCount <= SMALL_ROOM_FULL_MESH || openCount === 0) return false;
  if (openCount >= roomMemberCount - 1) return false;
  if (openCount > 1) return false;
  return isHighLatencyMesh(bestOpenPing);
}

/** When no open peer yet, connect only one hub on slow links instead of full mesh. */
export function shouldBootstrapSurvivalMesh(input: SurvivalMeshInput): boolean {
  const { openCount, roomMemberCount, bestOpenPing } = input;
  if (roomMemberCount <= SMALL_ROOM_FULL_MESH || openCount !== 0) return false;
  return isSlowEffectiveType() || isHighLatencyMesh(bestOpenPing);
}

export type RoomReopenResult = 'started' | 'busy' | 'no-session';

export function isRecoverableNetworkError(errorType: string): boolean {
  return (RECOVERABLE_NETWORK_ERROR_TYPES as readonly string[]).includes(errorType);
}

/** True when we should try reopenLastRoom (including token / transient backend errors). */
export function shouldAttemptRoomReopen(errorType: string): boolean {
  // Stale same-name member after sleep/WS drop — delayed reopen (duplicate-member outage),
  // not an immediate Network.open churn. joinRoomPerson also retries first.
  if (/already-?same-?name-?member-?exist/i.test(errorType)) return true;
  if ((ROOM_REOPEN_NETWORK_ERROR_TYPES as readonly string[]).includes(errorType)) return true;
  // SDK kebab-cases internalError → internal-error, Event asPromise timeout, etc.
  if (/^internal(-|$)/.test(errorType)) return true;
  if (/timeout|as-promise/i.test(errorType)) return true;
  // SkyWay rtcApiFatalError after _reconnectLimit (situation 1 outage).
  if (/rtc-?api/i.test(errorType)) return true;
  if (errorType === 'token-api') return true;
  return false;
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
