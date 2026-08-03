import { ObjectStore } from '@udonarium/core/synchronize-object/object-store';
import { EventSystem, Network } from '@udonarium/core/system';
import { IPeerContext } from '@udonarium/core/system/network/peer-context';
import { IRoomInfo } from '@udonarium/core/system/network/room-info';
import { GuestSession } from '@udonarium/guest-session';
import { PeerCursor } from '@udonarium/peer-cursor';

/**
 * Shared room join: reopen as a room peer and mesh-connect to targets.
 * Used by Lobby and invite deep-links.
 */
export class RoomConnectHelper {
  /**
   * Resolves true if at least one peer connected; false if all attempts failed
   * (and the local peer was reset out of the room).
   */
  static openAndConnect(room: IRoomInfo, password: string, targetPeers: IPeerContext[]): Promise<boolean> {
    return new Promise(resolve => {
      const userId = Network.peer.userId;
      Network.open(userId, room.id, room.name, password);
      PeerCursor.myCursor.peerId = Network.peerId;

      const triedPeer: string[] = [];
      let settled = false;

      const finish = (ok: boolean) => {
        if (settled) return;
        settled = true;
        EventSystem.unregister(triedPeer);
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
        console.log('連線成功 ' + triedPeer.length + '/' + targetPeers.length);
        return onTried();
      };

      const onDisconnect = (peerId: string) => {
        console.warn('連線失敗', peerId);
        triedPeer.push(peerId);
        console.warn('連線失敗 ' + triedPeer.length + '/' + targetPeers.length);
        return onTried();
      };

      EventSystem.register(triedPeer)
        .on('OPEN_NETWORK', event => {
          console.log('RoomConnectHelper OPEN_PEER', event.data.peerId);
          EventSystem.unregister(triedPeer);
          ObjectStore.instance.clearDeleteHistory();
          for (const peer of targetPeers) {
            if (!Network.connect(peer) && onDisconnect(peer.peerId)) return;
          }
          EventSystem.register(triedPeer)
            .on('CONNECT_PEER', event => onConnect(event.data.peerId))
            .on('DISCONNECT_PEER', event => onDisconnect(event.data.peerId));
        });
    });
  }

  static resetIfAlone() {
    if (Network.peers.length < 1) {
      GuestSession.isGuest = false;
      if (PeerCursor.myCursor) {
        PeerCursor.isGMHold = false;
        PeerCursor.myCursor.isGMMode = false;
      }
      Network.open();
      PeerCursor.myCursor.peerId = Network.peerId;
    }
  }
}
