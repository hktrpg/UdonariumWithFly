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
  /** Ghost SkyWay members often CONNECT then drop; require they stay up this long. */
  static JOIN_STABLE_MS = 1500;
  /** After CONNECT, fail the probe if no game-table data arrives (ghost / empty room). */
  static JOIN_DATA_MS = 8000;
  /** After the first game-table, wait for child UPDATEs to queue before switching maps. */
  static JOIN_QUIESCE_MS = 400;
  /** Probe join in progress: keep lobby/tabletop until a live peer + tabletop is confirmed. */
  static joinInProgress = false;
  /** Prevent NETWORK_ERROR → reopen → NETWORK_ERROR loops. */
  private static reopenInFlight = false;

  /** True when join UI / Promise may succeed early (at least one live peer). */
  static shouldEarlySucceed(openPeerCount: number): boolean {
    return openPeerCount >= 1;
  }

  /** True when all targets were tried and none remain connected. */
  static shouldFailJoin(triedCount: number, targetCount: number, openPeerCount: number): boolean {
    return targetCount > 0 && triedCount >= targetCount && openPeerCount < 1;
  }

  static isRecoverableNetworkError(errorType: string): boolean {
    return isRecoverableNetworkError(errorType);
  }

  /** Host tabletop payload (not PeerCursor / selecter) — safe to switch maps. */
  static isJoinTabletopData(aliasName: string): boolean {
    return aliasName === 'game-table';
  }

  private static beginJoinProbe() {
    RoomConnectHelper.joinInProgress = true;
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
   * Shows busy overlay until OPEN_NETWORK / NETWORK_ERROR / timeout.
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
      .on('OPEN_NETWORK', () => finish())
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
      let stableElapsed = RoomConnectHelper.JOIN_STABLE_MS <= 0;
      let stableTimer: ReturnType<typeof setTimeout> | null = null;
      let dataTimer: ReturnType<typeof setTimeout> | null = null;
      let quiesceTimer: ReturnType<typeof setTimeout> | null = null;
      const timeoutId = setTimeout(() => {
        if (settled) return;
        console.warn('RoomConnectHelper connect timeout');
        finish(false);
      }, RoomConnectHelper.CONNECT_TIMEOUT_MS);

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
        RoomConnectHelper.endJoinProbe(ok);
        if (!ok) RoomConnectHelper.resetToLobby();
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

      const scheduleDataDeadline = () => {
        if (settled) return;
        if (RoomConnectHelper.JOIN_DATA_MS <= 0) return;
        if (dataTimer != null) return;
        dataTimer = setTimeout(() => {
          dataTimer = null;
          if (settled) return;
          if (sawTabletopData) {
            confirmIfStable();
            return;
          }
          console.warn('RoomConnectHelper no tabletop data');
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
              if (RoomConnectHelper.shouldEarlySucceed(Network.peers.length)) {
                scheduleConfirm();
                return;
              }
              finish(false);
            });
        })
        .on('NETWORK_ERROR', () => {
          if (settled) return;
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

    for (let i = 0; i < 12; i++) {
      const rooms = await Network.listAllRooms();
      const room = rooms.find(r => r.id === roomId && r.name === roomName);
      if (room) {
        for (const peer of room.filterByPassword('')) {
          if (peer.peerId !== Network.peerId) Network.connect(peer);
        }
        if (room.peers.length <= 1 || Network.peers.length > 0) break;
      }
      await new Promise(r => setTimeout(r, 250));
    }
  }

  /** Leave a failed probe room and return to the lobby peer. */
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
