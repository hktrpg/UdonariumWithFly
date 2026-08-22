import { EventSystem, Network } from '@udonarium/core/system';
import { IPeerContext, PeerContext } from '@udonarium/core/system/network/peer-context';
import { IRoomInfo } from '@udonarium/core/system/network/room-info';
import { netDebug } from '@udonarium/core/system/network/net-debug';
import { ObjectSynchronizer } from '@udonarium/core/synchronize-object/object-synchronizer';
import { ImageStorage } from '@udonarium/core/file-storage/image-storage';
import { GuestSession } from '@udonarium/guest-session';
import { PeerCursor } from '@udonarium/peer-cursor';
import { Room } from '@udonarium/room';
import { RoomAuth, RoomRole } from '@udonarium/room-auth';
import { TableSelecter } from '@udonarium/table-selecter';
import { TabletopLoadSettle } from '@udonarium/tabletop-load-settle';
import {
  isRecoverableNetworkError,
  isStuckConnecting,
  meshGapPeerIds,
  meshStuckBudgetMs,
  navigatorEffectiveType,
  refreshConnectingSince,
  RoomReopenResult,
  shouldAttemptRoomReopen,
  buildSurvivalMeshContext,
  shouldBootstrapSurvivalMesh,
  shouldLimitDirectMesh,
} from '@udonarium/room-reconnect.util';
import { ConnectionBusyService } from 'service/connection-busy.service';
import { FolderBackupService } from 'service/folder-backup.service';

/**
 * Shared room join: reopen as a room peer and mesh-connect to targets.
 * Used by Lobby and invite deep-links.
 *
 * Probe first (local tabletop stays). Join succeeds only after a live peer stays up
 * and a game-table UPDATE arrives; otherwise the tabletop is left untouched.
 * Join busy ends on the first confirmed live peer (ghost peers may still abort).
 * Resolves false only when every target failed / timed out and no peer is connected.
 */
export class RoomConnectHelper {
  private static readonly CONNECT_TIMEOUT_MS = 60000;
  private static readonly REMESH_ATTEMPTS = 12;
  private static readonly REMESH_DELAY_MS = 250;
  /** After connect attempts, wait this long for at least one open peer (handshake). */
  private static readonly REMESH_PEER_WAIT_MS = 5000;
  /** While a join probe is alone, retry SkyWay room-member mesh this often. */
  private static readonly JOIN_REMESH_MS = 2000;
  /** Ghost SkyWay members often CONNECT then drop; require they stay up this long. */
  static JOIN_STABLE_MS = 1500;
  /**
   * Soft join-data slice: after each CONNECT / extend, wait this long for game-table.
   * While still meshed (open peers), missing data extends another slice instead of aborting.
   * Hard ceiling remains CONNECT_TIMEOUT_MS.
   */
  static JOIN_DATA_MS = 8000;
  /** After the first game-table, wait for child UPDATEs to queue before switching maps. */
  static JOIN_QUIESCE_MS = 400;
  /** Overall join probe ceiling (tests may shorten). */
  static CONNECT_TIMEOUT_MS_FOR_TEST = 0; // 0 = use CONNECT_TIMEOUT_MS
  /** After failed join, App skips reopen until this timestamp (ms since epoch). */
  private static readonly JOIN_OWNED_MS = 2000;
  /** Probe join in progress: keep lobby/tabletop until a live peer + tabletop is confirmed. */
  static joinInProgress = false;
  /** Bumped on each beginJoinProbe — ownership window for NETWORK_ERROR after finish. */
  static joinErrorEpoch = 0;
  /** performance.now()-style wall clock: Date.now() until which join owns NETWORK_ERROR. */
  private static joinOwnedUntil = 0;
  /** Last failed join probe reason for lobby / invite messaging. */
  static lastJoinFailReason = '';
  /** Lobby rooms to hide after a failed join probe (ghost / unreachable). */
  private static readonly suppressedLobbyRooms = new Set<string>();
  /** Prevent NETWORK_ERROR → reopen → NETWORK_ERROR loops. */
  private static reopenInFlight = false;
  /** Quiet mid-session remesh while in a room (bad-network peer flaps). */
  private static readonly MESH_KEEPALIVE_MS = 5000;
  /** Half-open DataChannel older than this is disconnected so remesh can retry. */
  private static readonly STUCK_CONNECTING_MS = 45000;
  /** Tests may shorten stuck budget (0 = use STUCK_CONNECTING_MS). */
  static STUCK_CONNECTING_MS_FOR_TEST = 0;
  private static meshKeepaliveTimer: ReturnType<typeof setInterval> | null = null;
  private static connectingSince = new Map<string, number>();
  private static meshHealInFlight = false;
  private static meshHealDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  private static readonly MESH_HEAL_DEBOUNCE_MS = 400;
  private static reopenRetryTimer: ReturnType<typeof setTimeout> | null = null;
  private static reopenRetryAttempt = 0;
  private static readonly REOPEN_RETRY_BASE_MS = 3000;
  private static readonly REOPEN_RETRY_MAX_MS = 60000;
  /** Throttle mid-session gap reconnect warns (avoid 5s spam while ICE is stuck). */
  private static lastGapWarnAt = 0;
  private static readonly GAP_WARN_COOLDOWN_MS = 60000;

  static get isReopenInFlight(): boolean {
    return RoomConnectHelper.reopenInFlight;
  }

  static isReopenRetryPending(): boolean {
    return RoomConnectHelper.reopenRetryTimer != null;
  }

  /** True when UI should show Connecting instead of Offline for the local peer id. */
  static isNetworkReconnecting(): boolean {
    return RoomConnectHelper.reopenInFlight || RoomConnectHelper.isReopenRetryPending();
  }

  /** Open DataChannels only (excludes stuck “connecting” streams). */
  static openPeerCount(): number {
    return Network.peerIds.length;
  }

  private static stuckConnectingMs(): number {
    if (RoomConnectHelper.STUCK_CONNECTING_MS_FOR_TEST > 0) {
      return RoomConnectHelper.STUCK_CONNECTING_MS_FOR_TEST;
    }
    return meshStuckBudgetMs(RoomConnectHelper.STUCK_CONNECTING_MS, navigatorEffectiveType());
  }

  /** True while join probe runs, or briefly after fail so App cannot reopen-race abandon. */
  static get isJoinOwningNetworkError(): boolean {
    return RoomConnectHelper.joinInProgress
      || Date.now() < RoomConnectHelper.joinOwnedUntil;
  }

  /**
   * Sticky for this page load: once we have been a room peer, never fall back to a
   * silent lobby Network.open() after NETWORK_ERROR (that feels like a mid-game kick).
   */
  static everHadRoomSession = false;

  private static lobbyRoomKey(roomId: string, roomName: string): string {
    return `${roomId}\n${roomName}`;
  }

  /** Hide a room from the lobby list (does not disconnect anyone). */
  static suppressLobbyRoom(roomId: string, roomName: string) {
    if (!roomId || !roomName) return;
    RoomConnectHelper.suppressedLobbyRooms.add(RoomConnectHelper.lobbyRoomKey(roomId, roomName));
  }

  static isLobbyRoomSuppressed(roomId: string, roomName: string): boolean {
    return RoomConnectHelper.suppressedLobbyRooms.has(RoomConnectHelper.lobbyRoomKey(roomId, roomName));
  }

  static clearLobbyRoomSuppression(roomId?: string, roomName?: string) {
    if (roomId && roomName) {
      RoomConnectHelper.suppressedLobbyRooms.delete(RoomConnectHelper.lobbyRoomKey(roomId, roomName));
      return;
    }
    RoomConnectHelper.suppressedLobbyRooms.clear();
  }

  static filterLobbyRooms<T extends { id: string; name: string }>(rooms: T[]): T[] {
    if (RoomConnectHelper.suppressedLobbyRooms.size < 1) return rooms;
    return rooms.filter(r => !RoomConnectHelper.isLobbyRoomSuppressed(r.id, r.name));
  }

  private static connectTimeoutMs(): number {
    return RoomConnectHelper.CONNECT_TIMEOUT_MS_FOR_TEST > 0
      ? RoomConnectHelper.CONNECT_TIMEOUT_MS_FOR_TEST
      : RoomConnectHelper.CONNECT_TIMEOUT_MS;
  }

  /** True when join UI / Promise may succeed early (at least one live peer). */
  static shouldEarlySucceed(openPeerCount: number): boolean {
    return openPeerCount >= 1;
  }

  /** True when all targets were tried and none remain connected. */
  static shouldFailJoin(triedCount: number, targetCount: number, openPeerCount: number): boolean {
    return targetCount > 0 && triedCount >= targetCount && openPeerCount < 1;
  }

  /**
   * While meshed, do not abort the join probe for missing game-table yet —
   * the joiner is already a room client; tearing down would drop them aggressively.
   */
  static shouldExtendJoinDataWait(openPeerCount: number): boolean {
    return openPeerCount >= 1;
  }

  static isRecoverableNetworkError(errorType: string): boolean {
    return isRecoverableNetworkError(errorType);
  }

  static shouldAttemptRoomReopen(errorType: string): boolean {
    return shouldAttemptRoomReopen(errorType);
  }

  /**
   * App NETWORK_ERROR may reopen only when no join probe / reopen is already running.
   * Prevents abandonFailedJoinProbe ↔ reopenLastRoomOrLobby racing Network.open.
   */
  static shouldAttemptReopenNow(): boolean {
    return !RoomConnectHelper.isJoinOwningNetworkError
      && !RoomConnectHelper.reopenInFlight;
  }

  /** Call when intentionally leaving a room (menu disconnect / resetToLobby). */
  static clearRoomSessionMemory() {
    RoomConnectHelper.everHadRoomSession = false;
    Network.clearLastRoomSession();
    RoomConnectHelper.stopMeshKeepalive();
    RoomConnectHelper.clearReopenRetry();
  }

  static markRoomSessionRemembered() {
    RoomConnectHelper.everHadRoomSession = true;
  }

  /**
   * While in a room, periodically prune stuck handshakes and reconnect missing members.
   * Safe to call repeatedly; no-op if already running.
   */
  static startMeshKeepalive() {
    if (RoomConnectHelper.meshKeepaliveTimer != null) return;
    RoomConnectHelper.meshKeepaliveTimer = setInterval(() => {
      void RoomConnectHelper.tickMeshKeepalive();
    }, RoomConnectHelper.MESH_KEEPALIVE_MS);
    void RoomConnectHelper.tickMeshKeepalive();
  }

  static stopMeshKeepalive() {
    if (RoomConnectHelper.meshKeepaliveTimer != null) {
      clearInterval(RoomConnectHelper.meshKeepaliveTimer);
      RoomConnectHelper.meshKeepaliveTimer = null;
    }
    if (RoomConnectHelper.meshHealDebounceTimer != null) {
      clearTimeout(RoomConnectHelper.meshHealDebounceTimer);
      RoomConnectHelper.meshHealDebounceTimer = null;
    }
    RoomConnectHelper.connectingSince.clear();
    RoomConnectHelper.clearReopenRetry();
  }

  /**
   * Schedule mesh heal — debounced on peer disconnect to avoid reconnect storms
   * while subscribe / disconnect races settle.
   */
  static scheduleMeshHeal(fromDisconnect = false) {
    if (fromDisconnect) {
      if (RoomConnectHelper.meshHealDebounceTimer != null) {
        clearTimeout(RoomConnectHelper.meshHealDebounceTimer);
      }
      RoomConnectHelper.meshHealDebounceTimer = setTimeout(() => {
        RoomConnectHelper.meshHealDebounceTimer = null;
        void RoomConnectHelper.tickMeshKeepalive();
      }, RoomConnectHelper.MESH_HEAL_DEBOUNCE_MS);
      return;
    }
    void RoomConnectHelper.tickMeshKeepalive();
  }

  /** One heal pass — also used on DISCONNECT_PEER for faster recovery than the interval. */
  static async tickMeshKeepalive(): Promise<void> {
    if (RoomConnectHelper.meshHealInFlight) return;
    if (RoomConnectHelper.joinInProgress || RoomConnectHelper.reopenInFlight) return;

    if (!Network.isOpen) {
      if (RoomConnectHelper.everHadRoomSession && Network.getLastRoomSession()?.roomId) {
        RoomConnectHelper.scheduleReopenRetry('disconnected');
      }
      return;
    }
    if (!Network.peer?.isRoom) return;

    RoomConnectHelper.meshHealInFlight = true;
    try {
      await RoomConnectHelper.healMeshGaps();
    } catch (e) {
      console.warn('RoomConnectHelper mesh keepalive failed', e);
    } finally {
      RoomConnectHelper.meshHealInFlight = false;
    }
  }

  /**
   * Disconnect peers stuck in connecting longer than the budget so connect() can retry.
   * @returns peerIds that were pruned
   */
  static pruneStuckConnectingPeers(nowMs: number = Date.now()): string[] {
    const stuckMs = RoomConnectHelper.stuckConnectingMs();
    RoomConnectHelper.connectingSince = refreshConnectingSince(
      RoomConnectHelper.connectingSince,
      Network.peers.map(p => ({ peerId: p.peerId, isOpen: !!p.isOpen })),
      nowMs,
    );

    const pruned: string[] = [];
    for (const [peerId, since] of [...RoomConnectHelper.connectingSince]) {
      if (!isStuckConnecting(since, nowMs, stuckMs)) continue;
      Network.disconnect(PeerContext.parse(peerId));
      pruned.push(peerId);
      RoomConnectHelper.connectingSince.delete(peerId);
    }
    if (pruned.length > 0) {
      console.warn(
        `[mesh] pruned ${pruned.length} stuck connecting peer(s) after ${stuckMs}ms`,
        pruned.map(id => id.slice(0, 12)),
      );
    }
    return pruned;
  }

  /**
   * Mid-session mesh repair: prune stuck handshakes, connect room members without an open channel.
   * Falls back to lobby remesh only when alone and channel membership is empty.
   */
  static async healMeshGaps(): Promise<void> {
    if (!Network.isRoomChannelReady()) {
      RoomConnectHelper.scheduleReopenRetry('disconnected');
      return;
    }

    RoomConnectHelper.pruneStuckConnectingPeers();

    const selfId = Network.peerId;
    const members = Network.listRoomMemberPeerIds();
    const gaps = meshGapPeerIds(selfId, members, Network.peerIds);
    const gapsToFill = RoomConnectHelper.filterMeshConnectTargets(gaps);
    const toConnect = RoomConnectHelper.connectMissingPeers(
      gapsToFill.map(id => PeerContext.parse(id)),
    );
    if (toConnect.length > 0) {
      const now = Date.now();
      if (now - RoomConnectHelper.lastGapWarnAt >= RoomConnectHelper.GAP_WARN_COOLDOWN_MS) {
        RoomConnectHelper.lastGapWarnAt = now;
        console.warn(
          `[mesh] reconnecting ${toConnect.length} room member(s) without open DataChannel`,
          toConnect.map(id => id.slice(0, 12)),
        );
      }
    }

    const otherMembers = members.filter(id => id && id !== selfId);
    if (otherMembers.length < 1 && RoomConnectHelper.openPeerCount() < 1) {
      const session = Network.getLastRoomSession();
      if (session?.roomId && session.roomName) {
        const connectPassword = RoomConnectHelper.connectPasswordForRoom(
          session.roomName, session.meshPassword || '');
        try {
          await RoomConnectHelper.remeshRoomPeers(session.roomId, session.roomName, connectPassword);
        } catch (e) {
          netDebug('[mesh] remesh during heal failed', e);
        }
      }
    }
  }

  static filterMeshConnectTargets(peerIds: string[]): string[] {
    const members = Network.listRoomMemberPeerIds();
    const ctx = buildSurvivalMeshContext(Network.peerIds, members, Network.peers);
    if (shouldLimitDirectMesh(ctx)) return [];
    if (shouldBootstrapSurvivalMesh(ctx)) return peerIds.slice(0, 1);
    return peerIds;
  }

  /**
   * Connect room/lobby peers that are not open and not already handshaking.
   * @returns peerIds for which Network.connect() returned true
   */
  private static connectMissingPeers(targets: IPeerContext[]): string[] {
    const attempting = new Set(Network.peers.map(p => p.peerId));
    const connected: string[] = [];
    for (const peer of targets) {
      if (!peer?.peerId || Network.peerIds.includes(peer.peerId) || attempting.has(peer.peerId)) continue;
      if (Network.connect(peer)) connected.push(peer.peerId);
    }
    return connected;
  }

  private static async listAllRoomsSafe(force: boolean): Promise<IRoomInfo[]> {
    try {
      return await Network.listAllRooms(force);
    } catch (e) {
      netDebug('[mesh] listAllRooms failed', e);
      return [];
    }
  }

  /**
   * Handshake in flight but no open peer yet: wait briefly, then prune and keep remeshing.
   * Avoids aborting remesh while a half-open stream is stuck below the stuck budget.
   */
  private static async waitHandshakeOrPrune(): Promise<'open' | 'retry'> {
    await RoomConnectHelper.waitForOpenPeer(RoomConnectHelper.REMESH_PEER_WAIT_MS);
    if (RoomConnectHelper.openPeerCount() > 0) return 'open';
    const pruned = RoomConnectHelper.pruneStuckConnectingPeers();
    if (pruned.length < 1 && Network.peers.length > 0) {
      // Still half-open under stuck budget — brief pause then retry remesh loop.
      await new Promise(r => setTimeout(r, RoomConnectHelper.REMESH_DELAY_MS));
    }
    return 'retry';
  }

  /** Host tabletop payload (not PeerCursor / selecter) — safe to switch maps. */
  static isJoinTabletopData(aliasName: string): boolean {
    return aliasName === 'game-table';
  }

  /** PeerId password digest filter: role/mesh rooms use empty digests. */
  static connectPasswordForRoom(roomName: string, meshPassword: string): string {
    if (RoomAuth.isRoleAuthRoom(roomName) || RoomAuth.isMeshLocked(roomName)) return '';
    return meshPassword || '';
  }

  /**
   * Poll lobby listings and mesh-connect to peers in the same room.
   * Prefer local SkyWay room members when available (fewer lobby Find storms).
   * One-sided connect is enough: the remote gets onSubscribed and opens the reverse stream.
   * Does not resolve until an open peer appears, attempts are exhausted while alone, or peer-wait times out.
   * Uses open peerIds (not half-open streams) so stuck “connecting” does not abort remesh.
   */
  static async remeshRoomPeers(roomId: string, roomName: string, connectPassword: string = ''): Promise<void> {
    let attemptedConnect = false;
    for (let i = 0; i < RoomConnectHelper.REMESH_ATTEMPTS; i++) {
      RoomConnectHelper.pruneStuckConnectingPeers();
      if (RoomConnectHelper.openPeerCount() > 0) return;

      // Channel members first — connect() already requires targets in room.members.
      // When others are visible in-channel, skip lobby Find this round (retry next loop).
      const memberIds = Network.listRoomMemberPeerIds();
      const otherMembers = memberIds.filter(id => id && id !== Network.peerId);
      if (otherMembers.length > 0) {
        const remeshTargets = RoomConnectHelper.filterMeshConnectTargets(otherMembers);
        if (RoomConnectHelper.connectMissingPeers(
          remeshTargets.map(id => PeerContext.parse(id)),
        ).length > 0) {
          attemptedConnect = true;
        }
        if (RoomConnectHelper.openPeerCount() > 0) return;
        if (Network.peers.length > 0) {
          if (await RoomConnectHelper.waitHandshakeOrPrune() === 'open') return;
          continue;
        }
        await new Promise(r => setTimeout(r, RoomConnectHelper.REMESH_DELAY_MS));
        continue;
      }

      const rooms = await RoomConnectHelper.listAllRoomsSafe(true);
      const room = rooms.find(r => r.id === roomId && r.name === roomName);
      if (!room) {
        await new Promise(r => setTimeout(r, RoomConnectHelper.REMESH_DELAY_MS));
        continue;
      }

      const others = room.filterByPassword(connectPassword).filter(p => p.peerId !== Network.peerId);
      if (others.length < 1) {
        // Lobby TTL / cache lag: keep retrying until attempts exhausted.
        await new Promise(r => setTimeout(r, RoomConnectHelper.REMESH_DELAY_MS));
        continue;
      }

      const lobbyTargets = RoomConnectHelper.filterMeshConnectTargets(
        others.map(p => p.peerId),
      );
      const lobbyPeers = lobbyTargets
        .map(id => others.find(p => p.peerId === id))
        .filter((p): p is IPeerContext => !!p);
      if (RoomConnectHelper.connectMissingPeers(lobbyPeers).length > 0) attemptedConnect = true;
      if (RoomConnectHelper.openPeerCount() > 0) return;
      if (Network.peers.length > 0) {
        if (await RoomConnectHelper.waitHandshakeOrPrune() === 'open') return;
        continue;
      }

      await new Promise(r => setTimeout(r, RoomConnectHelper.REMESH_DELAY_MS));
    }

    if (attemptedConnect && RoomConnectHelper.openPeerCount() < 1) {
      await RoomConnectHelper.waitForOpenPeer(RoomConnectHelper.REMESH_PEER_WAIT_MS);
      if (RoomConnectHelper.openPeerCount() < 1) {
        console.warn('[mesh] remesh finished with no open DataChannel peers');
      }
    }
  }

  /** Resolve when an open DataChannel peer appears, or when timeoutMs elapses. */
  static waitForOpenPeer(timeoutMs: number): Promise<void> {
    if (timeoutMs <= 0 || RoomConnectHelper.openPeerCount() > 0) return Promise.resolve();
    return new Promise(resolve => {
      const key = { remeshPeerWait: true };
      let settled = false;
      const done = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        EventSystem.unregister(key);
        resolve();
      };
      const timer = setTimeout(done, timeoutMs);
      EventSystem.register(key).on('CONNECT_PEER', () => {
        if (RoomConnectHelper.openPeerCount() > 0) done();
      });
    });
  }

  /** Map join fail reason to lobby i18n key prefix (title/text/help under that prefix). */
  static joinFailMessageKey(reason: string): string {
    if (reason === 'no_tabletop_data') return 'lobby.joinDataTimeout';
    if (reason === 'connect_timeout' || reason === 'network_error_mesh' || reason === 'network_error_open') {
      return 'lobby.joinNetworkTimeout';
    }
    return 'lobby.staleRoom';
  }

  /**
   * Hide from lobby only when peers were reachable as ghosts / empty —
   * not on transient network timeout or open errors (user should retry the same room).
   */
  static shouldSuppressLobbyRoom(reason: string): boolean {
    return reason === 'all_targets_failed' || reason === 'no_tabletop_data';
  }

  /**
   * Lobby snapshot peers plus current SkyWay room members.
   * Lobby TTL can list ghosts while live members are already in-channel (or vice versa).
   */
  static gatherJoinTargets(seed: IPeerContext[]): IPeerContext[] {
    const byId = new Map<string, IPeerContext>();
    for (const p of seed || []) {
      if (p?.peerId) byId.set(p.peerId, p);
    }
    for (const id of Network.listRoomMemberPeerIds()) {
      if (!id || id === Network.peerId) continue;
      if (!byId.has(id)) byId.set(id, PeerContext.parse(id));
    }
    return Array.from(byId.values());
  }

  private static beginJoinProbe() {
    RoomConnectHelper.joinInProgress = true;
    RoomConnectHelper.joinErrorEpoch++;
    RoomConnectHelper.joinOwnedUntil = 0;
    RoomConnectHelper.lastJoinFailReason = '';
    FolderBackupService.instance?.beginJoinQuarantine();
    ObjectSynchronizer.instance.enableJoinFetch();
    ObjectSynchronizer.instance.holdPeerSync();
  }

  private static endJoinProbe(ok: boolean) {
    RoomConnectHelper.joinInProgress = false;
    ObjectSynchronizer.instance.disableJoinFetch();
    ObjectSynchronizer.instance.releasePeerSync(ok);
    if (ok) {
      RoomConnectHelper.joinOwnedUntil = 0;
      FolderBackupService.instance?.markContentTrusted();
      // ZIP load calls restoreAfterRoomLoad (ROOM_PIECES remount + suppress bounce).
      // Mesh join used to skip that — 2nd tab tokens can stick invisible / without
      // images until map switch or another peer's CONNECT_PEER. Mirror ZIP settle.
      queueMicrotask(() => RoomConnectHelper.settleTabletopAfterMeshJoin());
    } else {
      // Hold reopen off while abandonFailedJoinProbe opens lobby (and a short tail).
      RoomConnectHelper.joinOwnedUntil = Date.now() + RoomConnectHelper.JOIN_OWNED_MS;
      FolderBackupService.instance?.abortJoinQuarantine();
    }
  }

  /** Remount + re-request images after a successful mesh join probe. */
  static settleTabletopAfterMeshJoin() {
    // Mesh path: one ROOM_PIECES via restore — no delayed second remount (dual-flash).
    // Does not interact with reopen / joinOwnedUntil (connection ownership stays separate).
    TabletopLoadSettle.begin();
    try {
      TableSelecter.instance.restoreAfterRoomLoad();
    } catch (e) {
      console.warn('RoomConnectHelper join settle (restore) failed', e);
      TabletopLoadSettle.forceRelease();
      return;
    }
    try {
      ImageStorage.instance.synchronize();
    } catch (e) {
      console.warn('RoomConnectHelper join settle (images) failed', e);
    }
  }

  static clearReopenRetry() {
    if (RoomConnectHelper.reopenRetryTimer != null) {
      clearTimeout(RoomConnectHelper.reopenRetryTimer);
      RoomConnectHelper.reopenRetryTimer = null;
    }
    RoomConnectHelper.reopenRetryAttempt = 0;
  }

  /**
   * After a failed reopen or channel drop, retry with backoff instead of staying offline.
   */
  static scheduleReopenRetry(errorType: string = 'disconnected') {
    if (!shouldAttemptRoomReopen(errorType)) return;
    if (!Network.getLastRoomSession()?.roomId && RoomConnectHelper.everHadRoomSession) return;
    if (RoomConnectHelper.isJoinOwningNetworkError) return;
    if (RoomConnectHelper.reopenRetryTimer != null) return;

    const delayMs = Math.min(
      RoomConnectHelper.REOPEN_RETRY_BASE_MS * (2 ** RoomConnectHelper.reopenRetryAttempt),
      RoomConnectHelper.REOPEN_RETRY_MAX_MS,
    );
    RoomConnectHelper.reopenRetryAttempt++;

    RoomConnectHelper.reopenRetryTimer = setTimeout(() => {
      RoomConnectHelper.reopenRetryTimer = null;
      if (!RoomConnectHelper.shouldAttemptReopenNow()) {
        RoomConnectHelper.scheduleReopenRetry(errorType);
        return;
      }
      const result = RoomConnectHelper.reopenLastRoomOrLobby();
      if (result !== 'started') {
        RoomConnectHelper.scheduleReopenRetry(errorType);
      }
    }, delayMs);
  }

  /**
   * After SkyWay fatal close: reopen the last room (+ remesh).
   * Lobby peer reopen only when this page never had a room session.
   * If we had a room but session is missing, returns 'no-session' and does nothing
   * (avoids mid-game eject to lobby).
   * Shows busy overlay until OPEN_NETWORK (+ remesh) / NETWORK_ERROR / timeout.
   */
  static reopenLastRoomOrLobby(): RoomReopenResult {
    if (RoomConnectHelper.isJoinOwningNetworkError) return 'busy';
    if (RoomConnectHelper.reopenInFlight) return 'busy';

    const session = Network.getLastRoomSession();
    const willReopenRoom = !!(session?.roomId && session.roomName);
    if (!willReopenRoom && RoomConnectHelper.everHadRoomSession) {
      console.warn('RoomConnectHelper reopen skipped: room session missing after mid-game drop');
      return 'no-session';
    }

    RoomConnectHelper.reopenInFlight = true;
    const busyKey = willReopenRoom ? 'net.reconnectingRoom' : 'net.reconnecting';
    ConnectionBusyService.instance?.show(busyKey);

    const key = { autoReconnect: true };
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      EventSystem.unregister(key);
      ConnectionBusyService.instance?.hide();
      RoomConnectHelper.reopenInFlight = false;
    };
    const timer = setTimeout(() => {
      console.warn('RoomConnectHelper reopenLastRoomOrLobby timeout');
      finish();
      RoomConnectHelper.scheduleReopenRetry('disconnected');
    }, 30000);

    EventSystem.register(key)
      .on('OPEN_NETWORK', () => {
        void (async () => {
          RoomConnectHelper.clearReopenRetry();
          if (willReopenRoom && session) {
            const connectPassword = RoomConnectHelper.connectPasswordForRoom(
              session.roomName, session.meshPassword || '');
            try {
              await RoomConnectHelper.remeshRoomPeers(session.roomId, session.roomName, connectPassword);
            } catch (e) {
              console.warn('RoomConnectHelper remesh after reopen failed', e);
            }
          }
          finish();
        })();
      })
      .on('NETWORK_ERROR', event => {
        finish();
        RoomConnectHelper.scheduleReopenRetry(event.data?.errorType || 'disconnected');
      });

    if (willReopenRoom) {
      const userId = session!.userId || Network.peer.userId;
      Network.open(userId, session!.roomId, session!.roomName, session!.meshPassword || '');
    } else {
      Network.open();
    }
    // PeerCursor.peerId is set on OPEN_NETWORK (AppComponent) — open() is async.
    return 'started';
  }

  static openAndConnect(room: IRoomInfo, password: string, targetPeers: IPeerContext[]): Promise<boolean> {
    ConnectionBusyService.instance?.show('peer.connectingRoom');
    RoomConnectHelper.beginJoinProbe();
    return new Promise(resolve => {
      const userId = Network.peer.userId;
      Network.open(userId, room.id, room.name, password);
      // PeerCursor.peerId is set on OPEN_NETWORK (AppComponent) — open() is async.

      const listenerKey = { roomJoin: true };
      const tried = new Set<string>();
      let settled = false;
      let sawTabletopData = false;
      let failReason = '';
      let stableElapsed = RoomConnectHelper.JOIN_STABLE_MS <= 0;
      let stableTimer: ReturnType<typeof setTimeout> | null = null;
      let dataTimer: ReturnType<typeof setTimeout> | null = null;
      let quiesceTimer: ReturnType<typeof setTimeout> | null = null;
      let remeshTimer: ReturnType<typeof setInterval> | null = null;
      let roomOpenRetries = 0;
      /** Lobby seed plus SkyWay room members discovered during the probe. */
      let joinTargets = targetPeers.slice();
      /** Mesh budget starts at OPEN_NETWORK — room open must not burn the join ceiling. */
      let timeoutId: ReturnType<typeof setTimeout> | null = null;

      const finish = (ok: boolean) => {
        if (settled) return;
        settled = true;
        if (stableTimer != null) {
          clearTimeout(stableTimer);
          stableTimer = null;
        }
        if (dataTimer != null) {
          clearTimeout(dataTimer);
          dataTimer = null;
        }
        if (quiesceTimer != null) {
          clearTimeout(quiesceTimer);
          quiesceTimer = null;
        }
        if (remeshTimer != null) {
          clearInterval(remeshTimer);
          remeshTimer = null;
        }
        if (timeoutId != null) {
          clearTimeout(timeoutId);
          timeoutId = null;
        }
        EventSystem.unregister(listenerKey);
        ConnectionBusyService.instance?.hide();
        if (!ok) RoomConnectHelper.lastJoinFailReason = failReason || 'unknown';
        else RoomConnectHelper.lastJoinFailReason = '';
        RoomConnectHelper.endJoinProbe(ok);
        if (!ok) {
          if (RoomConnectHelper.shouldSuppressLobbyRoom(RoomConnectHelper.lastJoinFailReason)) {
            RoomConnectHelper.suppressLobbyRoom(room.id, room.name);
          }
          if (RoomConnectHelper.openPeerCount() < 1) RoomConnectHelper.abandonFailedJoinProbe();
        } else {
          RoomConnectHelper.clearLobbyRoomSuppression(room.id, room.name);
        }
        resolve(ok);
      };

      const startConnectTimeout = () => {
        if (timeoutId != null || settled) return;
        timeoutId = setTimeout(() => {
          timeoutId = null;
          if (settled) return;
          console.warn('RoomConnectHelper connect timeout');
          // Pre-probe behavior: first live peer means we stay in the room. Never kick a meshed client.
          if (RoomConnectHelper.openPeerCount() >= 1) {
            Room.clearLocalTabletopForJoin();
            finish(true);
            return;
          }
          failReason = 'connect_timeout';
          finish(false);
        }, RoomConnectHelper.connectTimeoutMs());
      };

      const confirmIfStable = () => {
        if (settled) return;
        if (!RoomConnectHelper.shouldEarlySucceed(RoomConnectHelper.openPeerCount())) return;
        if (!stableElapsed) return;
        if (!sawTabletopData) return;
        // Live peer + game-table payload: drop local samples, then apply queued updates.
        Room.clearLocalTabletopForJoin();
        finish(true);
      };

      const scheduleConfirm = () => {
        if (settled) return;
        if (!RoomConnectHelper.shouldEarlySucceed(RoomConnectHelper.openPeerCount())) return;
        if (RoomConnectHelper.JOIN_STABLE_MS <= 0) {
          stableElapsed = true;
          confirmIfStable();
          return;
        }
        if (stableTimer != null) return;
        stableTimer = setTimeout(() => {
          stableTimer = null;
          stableElapsed = true;
          confirmIfStable();
        }, RoomConnectHelper.JOIN_STABLE_MS);
      };

      /**
       * Soft data deadline: restart slice on CONNECT; while still meshed, missing
       * game-table extends another slice. Alone → fail probe only (ghost rooms may
       * hide; network timeouts keep the room listed). Never kick / resetToLobby.
       * Hard ceiling is connectTimeoutMs() (meshed → stay / succeed; alone → fail).
       */
      const scheduleDataDeadline = () => {
        if (settled) return;
        if (RoomConnectHelper.JOIN_DATA_MS <= 0) return;
        if (dataTimer != null) {
          clearTimeout(dataTimer);
          dataTimer = null;
        }
        dataTimer = setTimeout(() => {
          dataTimer = null;
          if (settled) return;
          if (sawTabletopData) {
            confirmIfStable();
            return;
          }
          if (RoomConnectHelper.shouldExtendJoinDataWait(RoomConnectHelper.openPeerCount())) {
            netDebug('join data wait extended — still meshed, not aborting');
            scheduleDataDeadline();
            return;
          }
          console.warn('RoomConnectHelper no tabletop data');
          failReason = 'no_tabletop_data';
          finish(false);
        }, RoomConnectHelper.JOIN_DATA_MS);
      };

      const scheduleQuiesceConfirm = () => {
        if (settled || !sawTabletopData) return;
        if (RoomConnectHelper.JOIN_QUIESCE_MS <= 0) {
          queueMicrotask(() => confirmIfStable());
          return;
        }
        if (quiesceTimer != null) clearTimeout(quiesceTimer);
        quiesceTimer = setTimeout(() => {
          quiesceTimer = null;
          confirmIfStable();
        }, RoomConnectHelper.JOIN_QUIESCE_MS);
      };

      /** Connect any not-yet-tried join targets; expand from current SkyWay members. */
      const meshJoinTargets = () => {
        if (settled) return;
        joinTargets = RoomConnectHelper.gatherJoinTargets(joinTargets);
        for (const peer of joinTargets) {
          if (tried.has(peer.peerId)) continue;
          // Soft fail: peer not in room.members yet / not ready — retry on remesh.
          // Do not mark tried or abort the probe (first-join race with SkyWay membership).
          if (!Network.connect(peer)) continue;
        }
      };

      const onConnect = (peerId: string) => {
        if (settled) return;
        netDebug('連線成功！', peerId);
        tried.add(peerId);
        netDebug(`連線進度 ${tried.size}/${joinTargets.length}（成功 ${RoomConnectHelper.openPeerCount()}）`);
        scheduleConfirm();
        scheduleDataDeadline();
      };

      const onDisconnect = (peerId: string) => {
        // Stale lobby/room peers often leave before subscribe finishes — not a join failure by itself.
        if (settled) return;
        console.warn('放棄連線（對方離線或訂閱逾時）', peerId);
        tried.add(peerId);
        netDebug(`連線進度 ${tried.size}/${joinTargets.length}（成功 ${RoomConnectHelper.openPeerCount()}）`);
        if (RoomConnectHelper.openPeerCount() < 1 && stableTimer != null) {
          clearTimeout(stableTimer);
          stableTimer = null;
          if (RoomConnectHelper.JOIN_STABLE_MS > 0) stableElapsed = false;
        }
        // Refresh members before deciding all targets failed — a live peer may have joined.
        joinTargets = RoomConnectHelper.gatherJoinTargets(joinTargets);
        if (RoomConnectHelper.shouldFailJoin(tried.size, joinTargets.length, RoomConnectHelper.openPeerCount())) {
          failReason = 'all_targets_failed';
          finish(false);
        }
      };

      EventSystem.register(listenerKey)
        .on('OPEN_NETWORK', event => {
          netDebug('RoomConnectHelper OPEN_PEER', event.data.peerId);
          EventSystem.unregister(listenerKey);
          startConnectTimeout();
          joinTargets = RoomConnectHelper.gatherJoinTargets(targetPeers);
          if (joinTargets.length < 1) {
            finish(true);
            return;
          }
          // Probe first: keep local tabletop until a live peer sends a game-table.
          meshJoinTargets();
          if (settled) return;
          // Lobby list can lag SkyWay membership; keep remeshing while alone.
          remeshTimer = setInterval(() => {
            if (settled) return;
            meshJoinTargets();
          }, RoomConnectHelper.JOIN_REMESH_MS);
          EventSystem.register(listenerKey)
            .on('CONNECT_PEER', event => onConnect(event.data.peerId))
            .on('DISCONNECT_PEER', event => onDisconnect(event.data.peerId))
            .on('UPDATE_GAME_OBJECT', event => {
              if (settled || event.isSendFromSelf) return;
              const aliasName = event.data?.aliasName || '';
              if (aliasName === 'PeerCursor') return;
              if (RoomConnectHelper.isJoinTabletopData(aliasName)) sawTabletopData = true;
              if (sawTabletopData) scheduleQuiesceConfirm();
            })
            .on('NETWORK_ERROR', () => {
              if (settled) return;
              // Pre-probe: meshed NETWORK_ERROR still counts as joined.
              if (RoomConnectHelper.shouldEarlySucceed(RoomConnectHelper.openPeerCount())) {
                if (sawTabletopData) {
                  Room.clearLocalTabletopForJoin();
                  finish(true);
                  return;
                }
                scheduleConfirm();
                scheduleDataDeadline();
                return;
              }
              failReason = 'network_error_mesh';
              finish(false);
            });
        })
        .on('NETWORK_ERROR', () => {
          if (settled) return;
          if (roomOpenRetries < 1) {
            roomOpenRetries++;
            console.warn('RoomConnectHelper room open failed, retrying once');
            Network.open(userId, room.id, room.name, password);
            return;
          }
          failReason = 'network_error_open';
          finish(false);
        });
    });
  }

  /**
   * Re-open into the same roomId with a new encoded roomName (auth re-key),
   * then remesh with peers advertising that name.
   * @param meshPassword SkyWay password for the new roomName ('' if unlocked).
   */
  static async rekeyRoom(roomId: string, roomName: string, meshPassword: string = ''): Promise<void> {
    const userId = Network.peer.userId;
    const wasGuest = GuestSession.isGuest;
    const wasGM = !!PeerCursor.myCursor?.isGMMode;
    let role: RoomRole = 'user';
    if (wasGM) role = 'gm';
    else if (wasGuest) role = 'guest';

    // Prefer explicit mesh; otherwise unseal with the role password we joined with.
    let mesh = meshPassword;
    if (mesh === '' && RoomAuth.isMeshLocked(roomName)) {
      const rolePw = RoomAuth.getSessionRolePassword(role);
      mesh = RoomAuth.resolveMeshPassword(roomId, roomName, role, rolePw);
    }
    RoomAuth.rememberSession(role, RoomAuth.getSessionRolePassword(role), mesh);

    await new Promise<void>(resolve => {
      const key = { rekey: true };
      EventSystem.register(key)
        .on('OPEN_NETWORK', () => {
          EventSystem.unregister(key);
          resolve();
        });
      Network.open(userId, roomId, roomName, mesh);
    });

    RoomAuth.applyIdentity(role, roomId);
    await RoomConnectHelper.remeshRoomPeers(roomId, roomName, '');
  }

  /**
   * Leave a failed join's room peer when we never meshed (cancel probe only).
   * Does not run when data peers exist — those clients stay in the room.
   */
  static abandonFailedJoinProbe() {
    if (RoomConnectHelper.openPeerCount() > 0) return;
    if (!Network.peer?.isRoom) return;
    Network.open();
    // PeerCursor.peerId is set on OPEN_NETWORK (AppComponent).
  }

  /** @deprecated no-op — join probe must not kick meshed clients. */
  static resetIfAlone() {
    // no-op
  }

  /** Explicit disconnect / menu logout — not used by join probe failure. */
  static resetToLobby() {
    GuestSession.isGuest = false;
    RoomAuth.clearAttained();
    RoomConnectHelper.clearRoomSessionMemory();
    if (PeerCursor.myCursor) {
      PeerCursor.isGMHold = false;
      const wasGM = PeerCursor.myCursor.isGMMode;
      PeerCursor.myCursor.isGMMode = true;
      if (!wasGM) EventSystem.trigger('CHANGE_GM_MODE', null);
    }
    Network.open();
    // PeerCursor.peerId is set on OPEN_NETWORK (AppComponent).
  }
}
