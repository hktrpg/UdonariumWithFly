import { EventSystem, Network } from '@udonarium/core/system';
import { IPeerContext } from '@udonarium/core/system/network/peer-context';
import { IRoomInfo } from '@udonarium/core/system/network/room-info';
import { GuestSession } from '@udonarium/guest-session';
import { PeerCursor } from '@udonarium/peer-cursor';
import { Room } from '@udonarium/room';
import { RoomAuth, RoomRole } from '@udonarium/room-auth';
import { isRecoverableNetworkError } from '@udonarium/room-reconnect.util';
import { ConnectionBusyService } from 'service/connection-busy.service';

/**
 * Shared room join: reopen as a room peer and mesh-connect to targets.
 * Used by Lobby and invite deep-links.
 */
export class RoomConnectHelper {
  /**
   * Resolves true if at least one peer connected; false if all attempts failed
   * (and the local peer was reset out of the room).
   */
  private static readonly CONNECT_TIMEOUT_MS = 45000;
  /** Prevent NETWORK_ERROR → reopen → NETWORK_ERROR loops. */
  private static reopenInFlight = false;

  static isRecoverableNetworkError(errorType: string): boolean {
    return isRecoverableNetworkError(errorType);
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
    return new Promise(resolve => {
      const userId = Network.peer.userId;
      Network.open(userId, room.id, room.name, password);
      PeerCursor.myCursor.peerId = Network.peerId;

      const triedPeer: string[] = [];
      let settled = false;
      const timeoutId = setTimeout(() => {
        console.warn('RoomConnectHelper connect timeout');
        RoomConnectHelper.resetIfAlone();
        finish(false);
      }, RoomConnectHelper.CONNECT_TIMEOUT_MS);

      const finish = (ok: boolean) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutId);
        EventSystem.unregister(triedPeer);
        ConnectionBusyService.instance?.hide();
        resolve(ok);
      };

      const onTried = () => {
        if (triedPeer.length < targetPeers.length) return false;
        RoomConnectHelper.resetIfAlone();
        finish(Network.peers.length > 0);
        return true;
      };

      const onConnect = (peerId: string) => {
        console.log('連線成功！', peerId);
        triedPeer.push(peerId);
        console.log(`連線進度 ${triedPeer.length}/${targetPeers.length}（成功 ${Network.peers.length}）`);
        return onTried();
      };

      const onDisconnect = (peerId: string) => {
        // Stale lobby/room peers often leave before subscribe finishes — not a join failure by itself.
        console.warn('放棄連線（對方離線或訂閱逾時）', peerId);
        triedPeer.push(peerId);
        console.warn(`連線進度 ${triedPeer.length}/${targetPeers.length}（成功 ${Network.peers.length}）`);
        return onTried();
      };

      EventSystem.register(triedPeer)
        .on('OPEN_NETWORK', event => {
          console.log('RoomConnectHelper OPEN_PEER', event.data.peerId);
          EventSystem.unregister(triedPeer);
          // Discard lobby sample tables/tokens before catalog merge; otherwise shared
          // syncIds (gameTable, testCharacter_*) overwrite the host house via LWW.
          Room.clearLocalTabletopForJoin();
          if (targetPeers.length < 1) {
            finish(true);
            return;
          }
          for (const peer of targetPeers) {
            if (!Network.connect(peer) && onDisconnect(peer.peerId)) return;
          }
          EventSystem.register(triedPeer)
            .on('CONNECT_PEER', event => onConnect(event.data.peerId))
            .on('DISCONNECT_PEER', event => onDisconnect(event.data.peerId))
            .on('NETWORK_ERROR', () => {
              RoomConnectHelper.resetIfAlone();
              finish(false);
            });
        })
        .on('NETWORK_ERROR', () => {
          RoomConnectHelper.resetIfAlone();
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

  static resetIfAlone() {
    if (Network.peers.length < 1) {
      GuestSession.isGuest = false;
      RoomAuth.clearAttained();
      if (PeerCursor.myCursor) {
        PeerCursor.isGMHold = false;
        const wasGM = PeerCursor.myCursor.isGMMode;
        PeerCursor.myCursor.isGMMode = true;
        if (!wasGM) EventSystem.trigger('CHANGE_GM_MODE', null);
      }
      Network.open();
      PeerCursor.myCursor.peerId = Network.peerId;
    }
  }
}
