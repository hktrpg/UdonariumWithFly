import { EventSystem, Network } from '@udonarium/core/system';
import { IPeerContext } from '@udonarium/core/system/network/peer-context';
import { IRoomInfo } from '@udonarium/core/system/network/room-info';
import { netDebug } from '@udonarium/core/system/network/net-debug';
import { ObjectSynchronizer } from '@udonarium/core/synchronize-object/object-synchronizer';
import { GuestSession } from '@udonarium/guest-session';
import { PeerCursor } from '@udonarium/peer-cursor';
import { Room } from '@udonarium/room';
import { RoomAuth, RoomRole } from '@udonarium/room-auth';
import { isRecoverableNetworkError } from '@udonarium/room-reconnect.util';
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
  private static readonly CONNECT_TIMEOUT_MS = 45000;
  private static readonly REMESH_ATTEMPTS = 12;
  private static readonly REMESH_DELAY_MS = 250;
  /** After connect attempts, wait this long for at least one open peer (handshake). */
  private static readonly REMESH_PEER_WAIT_MS = 5000;
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
  /** Probe join in progress: keep lobby/tabletop until a live peer + tabletop is confirmed. */
  static joinInProgress = false;
  /** Last failed join probe reason for lobby / invite messaging. */
  static lastJoinFailReason = '';
  /** Lobby rooms to hide after a failed join probe (ghost / unreachable). */
  private static readonly suppressedLobbyRooms = new Set<string>();
  /** Prevent NETWORK_ERROR → reopen → NETWORK_ERROR loops. */
  private static reopenInFlight = false;

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
   * One-sided connect is enough: the remote gets onSubscribed and opens the reverse stream.
   * Does not resolve until an open peer appears, the room is alone, or peer-wait times out.
   */
  static async remeshRoomPeers(roomId: string, roomName: string, connectPassword: string = ''): Promise<void> {
    let attemptedConnect = false;
    for (let i = 0; i < RoomConnectHelper.REMESH_ATTEMPTS; i++) {
      if (Network.peers.length > 0) return;

      const rooms = await Network.listAllRooms();
      const room = rooms.find(r => r.id === roomId && r.name === roomName);
      if (!room) {
        await new Promise(r => setTimeout(r, RoomConnectHelper.REMESH_DELAY_MS));
        continue;
      }

      const others = room.filterByPassword(connectPassword).filter(p => p.peerId !== Network.peerId);
      if (others.length < 1) return; // alone in room listing

      for (const peer of others) {
        if (Network.connect(peer)) attemptedConnect = true;
      }
      if (Network.peers.length > 0) return;

      await new Promise(r => setTimeout(r, RoomConnectHelper.REMESH_DELAY_MS));
    }

    if (attemptedConnect && Network.peers.length < 1) {
      await RoomConnectHelper.waitForOpenPeer(RoomConnectHelper.REMESH_PEER_WAIT_MS);
    }
  }

  /** Resolve when Network.peers has an open peer, or when timeoutMs elapses. */
  static waitForOpenPeer(timeoutMs: number): Promise<void> {
    if (timeoutMs <= 0 || Network.peers.length > 0) return Promise.resolve();
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
        if (Network.peers.length > 0) done();
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

  private static beginJoinProbe() {
    RoomConnectHelper.joinInProgress = true;
    RoomConnectHelper.lastJoinFailReason = '';
    FolderBackupService.instance?.beginJoinQuarantine();
    ObjectSynchronizer.instance.enableJoinFetch();
    ObjectSynchronizer.instance.holdPeerSync();
  }

  private static endJoinProbe(ok: boolean) {
    RoomConnectHelper.joinInProgress = false;
    ObjectSynchronizer.instance.disableJoinFetch();
    ObjectSynchronizer.instance.releasePeerSync(ok);
    if (ok) FolderBackupService.instance?.markContentTrusted();
    else FolderBackupService.instance?.abortJoinQuarantine();
  }

  /**
   * After SkyWay fatal close: reopen the last room (so lobby lists us again),
   * or fall back to a plain lobby peer when no room session was stored.
   * Shows busy overlay until OPEN_NETWORK (+ remesh) / NETWORK_ERROR / timeout.
   * @returns false if a reopen is already in progress.
   */
  static reopenLastRoomOrLobby(): boolean {
    if (RoomConnectHelper.reopenInFlight) return false;
    RoomConnectHelper.reopenInFlight = true;

    const session = Network.getLastRoomSession();
    const willReopenRoom = !!(session?.roomId && session.roomName);
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
      // Allow a later genuine drop to reconnect again.
      setTimeout(() => { RoomConnectHelper.reopenInFlight = false; }, 2000);
    };
    const timer = setTimeout(() => {
      console.warn('RoomConnectHelper reopenLastRoomOrLobby timeout');
      finish();
    }, 30000);

    EventSystem.register(key)
      .on('OPEN_NETWORK', () => {
        void (async () => {
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
      .on('NETWORK_ERROR', () => finish());

    if (willReopenRoom) {
      const userId = session!.userId || Network.peer.userId;
      Network.open(userId, session!.roomId, session!.roomName, session!.meshPassword || '');
    } else {
      Network.open();
    }
    if (PeerCursor.myCursor) PeerCursor.myCursor.peerId = Network.peerId;
    return true;
  }

  static openAndConnect(room: IRoomInfo, password: string, targetPeers: IPeerContext[]): Promise<boolean> {
    ConnectionBusyService.instance?.show('peer.connectingRoom');
    RoomConnectHelper.beginJoinProbe();
    return new Promise(resolve => {
      const userId = Network.peer.userId;
      Network.open(userId, room.id, room.name, password);
      if (PeerCursor.myCursor) PeerCursor.myCursor.peerId = Network.peerId;

      const listenerKey = { roomJoin: true };
      const tried = new Set<string>();
      let settled = false;
      let sawTabletopData = false;
      let failReason = '';
      let stableElapsed = RoomConnectHelper.JOIN_STABLE_MS <= 0;
      let stableTimer: ReturnType<typeof setTimeout> | null = null;
      let dataTimer: ReturnType<typeof setTimeout> | null = null;
      let quiesceTimer: ReturnType<typeof setTimeout> | null = null;
      const timeoutId = setTimeout(() => {
        if (settled) return;
        console.warn('RoomConnectHelper connect timeout');
        // Pre-probe behavior: first live peer means we stay in the room. Never kick a meshed client.
        if (Network.peers.length >= 1) {
          Room.clearLocalTabletopForJoin();
          finish(true);
          return;
        }
        failReason = 'connect_timeout';
        finish(false);
      }, RoomConnectHelper.connectTimeoutMs());

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
        clearTimeout(timeoutId);
        EventSystem.unregister(listenerKey);
        ConnectionBusyService.instance?.hide();
        if (!ok) RoomConnectHelper.lastJoinFailReason = failReason || 'unknown';
        else RoomConnectHelper.lastJoinFailReason = '';
        RoomConnectHelper.endJoinProbe(ok);
        if (!ok) {
          // Hide unreachable rooms in the lobby. Never eject a meshed client.
          RoomConnectHelper.suppressLobbyRoom(room.id, room.name);
          if (Network.peers.length < 1) RoomConnectHelper.abandonFailedJoinProbe();
        } else {
          RoomConnectHelper.clearLobbyRoomSuppression(room.id, room.name);
        }
        resolve(ok);
      };

      const confirmIfStable = () => {
        if (settled) return;
        if (!RoomConnectHelper.shouldEarlySucceed(Network.peers.length)) return;
        if (!stableElapsed) return;
        if (!sawTabletopData) return;
        // Live peer + game-table payload: drop local samples, then apply queued updates.
        Room.clearLocalTabletopForJoin();
        finish(true);
      };

      const scheduleConfirm = () => {
        if (settled) return;
        if (!RoomConnectHelper.shouldEarlySucceed(Network.peers.length)) return;
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
   * game-table extends another slice. Alone → fail probe only (hide room in lobby;
   * never kick / resetToLobby).
   * Hard ceiling is connectTimeoutMs() (meshed → stay / succeed; alone → fail+hide).
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
          if (RoomConnectHelper.shouldExtendJoinDataWait(Network.peers.length)) {
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

      const onConnect = (peerId: string) => {
        if (settled) return;
        netDebug('連線成功！', peerId);
        tried.add(peerId);
        netDebug(`連線進度 ${tried.size}/${targetPeers.length}（成功 ${Network.peers.length}）`);
        scheduleConfirm();
        scheduleDataDeadline();
      };

      const onDisconnect = (peerId: string) => {
        // Stale lobby/room peers often leave before subscribe finishes — not a join failure by itself.
        if (settled) return;
        console.warn('放棄連線（對方離線或訂閱逾時）', peerId);
        tried.add(peerId);
        netDebug(`連線進度 ${tried.size}/${targetPeers.length}（成功 ${Network.peers.length}）`);
        if (Network.peers.length < 1 && stableTimer != null) {
          clearTimeout(stableTimer);
          stableTimer = null;
          if (RoomConnectHelper.JOIN_STABLE_MS > 0) stableElapsed = false;
        }
        if (RoomConnectHelper.shouldFailJoin(tried.size, targetPeers.length, Network.peers.length)) {
          failReason = 'all_targets_failed';
          finish(false);
        }
      };

      EventSystem.register(listenerKey)
        .on('OPEN_NETWORK', event => {
          netDebug('RoomConnectHelper OPEN_PEER', event.data.peerId);
          EventSystem.unregister(listenerKey);
          if (targetPeers.length < 1) {
            finish(true);
            return;
          }
          // Probe first: keep local tabletop until a live peer sends a game-table.
          for (const peer of targetPeers) {
            if (!Network.connect(peer)) onDisconnect(peer.peerId);
          }
          if (settled) return;
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
              if (RoomConnectHelper.shouldEarlySucceed(Network.peers.length)) {
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
      PeerCursor.myCursor.peerId = Network.peerId;
    });

    RoomAuth.applyIdentity(role, roomId);
    await RoomConnectHelper.remeshRoomPeers(roomId, roomName, '');
  }

  /**
   * Leave a failed join's room peer when we never meshed (cancel probe only).
   * Does not run when data peers exist — those clients stay in the room.
   */
  static abandonFailedJoinProbe() {
    if (Network.peers.length > 0) return;
    if (!Network.peer?.isRoom) return;
    Network.open();
    if (PeerCursor.myCursor) PeerCursor.myCursor.peerId = Network.peerId;
  }

  /** @deprecated no-op — join probe must not kick meshed clients. */
  static resetIfAlone() {
    // no-op
  }

  /** Explicit disconnect / menu logout — not used by join probe failure. */
  static resetToLobby() {
    GuestSession.isGuest = false;
    RoomAuth.clearAttained();
    if (PeerCursor.myCursor) {
      PeerCursor.isGMHold = false;
      const wasGM = PeerCursor.myCursor.isGMMode;
      PeerCursor.myCursor.isGMMode = true;
      if (!wasGM) EventSystem.trigger('CHANGE_GM_MODE', null);
    }
    Network.open();
    if (PeerCursor.myCursor) PeerCursor.myCursor.peerId = Network.peerId;
  }
}
