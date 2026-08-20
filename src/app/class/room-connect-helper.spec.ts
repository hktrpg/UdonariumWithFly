import { EventSystem, Network } from '@udonarium/core/system';
import { IPeerContext } from '@udonarium/core/system/network/peer-context';
import { IRoomInfo } from '@udonarium/core/system/network/room-info';
import { Room } from '@udonarium/room';

import { RoomConnectHelper } from './room-connect-helper';

function peer(peerId: string): IPeerContext {
  return { peerId } as IPeerContext;
}

function hostCatalog(from = 'live', identifier = 'PeerCursor') {
  EventSystem.trigger({
    eventName: 'SYNCHRONIZE_GAME_OBJECT',
    data: [{ identifier, version: 1 }],
    sendFrom: from,
  });
}

function hostTabletop(from = 'live') {
  EventSystem.trigger({
    eventName: 'UPDATE_GAME_OBJECT',
    data: {
      aliasName: 'game-table',
      identifier: 'gameTable',
      majorVersion: 1,
      minorVersion: 0,
      syncData: {},
    },
    sendFrom: from,
  });
}

const room: IRoomInfo = {
  id: 'Ab1',
  name: 'TestRoom',
  hasPassword: false,
  peers: [],
  filterByPassword: () => [],
};

describe('RoomConnectHelper settle predicates', () => {
  it('early-succeeds when at least one live peer is open', () => {
    expect(RoomConnectHelper.shouldEarlySucceed(0)).toBeFalse();
    expect(RoomConnectHelper.shouldEarlySucceed(1)).toBeTrue();
    expect(RoomConnectHelper.shouldEarlySucceed(2)).toBeTrue();
  });

  it('fails join only when every target was tried and none remain', () => {
    expect(RoomConnectHelper.shouldFailJoin(1, 2, 0)).toBeFalse();
    expect(RoomConnectHelper.shouldFailJoin(2, 2, 1)).toBeFalse();
    expect(RoomConnectHelper.shouldFailJoin(2, 2, 0)).toBeTrue();
    expect(RoomConnectHelper.shouldFailJoin(0, 0, 0)).toBeFalse();
  });

  it('treats game-table updates as join DATA, not PeerCursor catalogs', () => {
    expect(RoomConnectHelper.isJoinTabletopData('game-table')).toBeTrue();
    expect(RoomConnectHelper.isJoinTabletopData('PeerCursor')).toBeFalse();
    expect(RoomConnectHelper.isJoinTabletopData('table-selecter')).toBeFalse();
  });

  it('maps join fail reasons to lobby i18n key prefixes', () => {
    expect(RoomConnectHelper.joinFailMessageKey('all_targets_failed')).toBe('lobby.staleRoom');
    expect(RoomConnectHelper.joinFailMessageKey('no_tabletop_data')).toBe('lobby.joinDataTimeout');
    expect(RoomConnectHelper.joinFailMessageKey('connect_timeout')).toBe('lobby.joinNetworkTimeout');
    expect(RoomConnectHelper.joinFailMessageKey('network_error_open')).toBe('lobby.joinNetworkTimeout');
  });
});

describe('RoomConnectHelper.reopenLastRoomOrLobby', () => {
  afterEach(() => {
    (RoomConnectHelper as any).reopenInFlight = false;
  });

  it('remeshes after OPEN_NETWORK when a room session exists', async () => {
    spyOn(Network, 'getLastRoomSession').and.returnValue({
      userId: 'u1',
      roomId: 'Ab1',
      roomName: 'TestRoom',
      meshPassword: '',
    });
    spyOn(Network, 'open');
    spyOnProperty(Network, 'peer', 'get').and.returnValue({ userId: 'u1', peerId: 'self' } as IPeerContext);
    spyOnProperty(Network, 'peerId', 'get').and.returnValue('self');
    const remesh = spyOn(RoomConnectHelper, 'remeshRoomPeers').and.resolveTo();

    expect(RoomConnectHelper.reopenLastRoomOrLobby()).toBeTrue();
    EventSystem.trigger('OPEN_NETWORK', { peerId: 'self' });
    await new Promise<void>(resolve => setTimeout(resolve, 20));

    expect(remesh).toHaveBeenCalledWith('Ab1', 'TestRoom', '');
  });

  it('does not remesh when reopening as a plain lobby peer', async () => {
    spyOn(Network, 'getLastRoomSession').and.returnValue(null);
    spyOn(Network, 'open');
    spyOnProperty(Network, 'peer', 'get').and.returnValue({ userId: 'u1', peerId: 'self' } as IPeerContext);
    spyOnProperty(Network, 'peerId', 'get').and.returnValue('self');
    const remesh = spyOn(RoomConnectHelper, 'remeshRoomPeers').and.resolveTo();

    expect(RoomConnectHelper.reopenLastRoomOrLobby()).toBeTrue();
    EventSystem.trigger('OPEN_NETWORK', { peerId: 'self' });
    await new Promise<void>(resolve => setTimeout(resolve, 20));

    expect(remesh).not.toHaveBeenCalled();
  });
});

describe('RoomConnectHelper.remeshRoomPeers', () => {
  let openPeers: IPeerContext[];
  const prevAttempts = (RoomConnectHelper as any).REMESH_ATTEMPTS;
  const prevDelay = (RoomConnectHelper as any).REMESH_DELAY_MS;
  const prevPeerWait = (RoomConnectHelper as any).REMESH_PEER_WAIT_MS;

  beforeEach(() => {
    openPeers = [];
    spyOn(Network, 'connect').and.returnValue(true);
    spyOnProperty(Network, 'peers', 'get').and.callFake(() => openPeers);
    spyOnProperty(Network, 'peerId', 'get').and.returnValue('self');
  });
  afterEach(() => {
    (RoomConnectHelper as any).REMESH_ATTEMPTS = prevAttempts;
    (RoomConnectHelper as any).REMESH_DELAY_MS = prevDelay;
    (RoomConnectHelper as any).REMESH_PEER_WAIT_MS = prevPeerWait;
  });

  it('returns immediately when the room listing is alone', async () => {
    spyOn(Network, 'listAllRooms').and.resolveTo([{
      id: 'Ab1',
      name: 'TestRoom',
      hasPassword: false,
      peers: [peer('self')],
      filterByPassword: () => [peer('self')],
    }]);

    await RoomConnectHelper.remeshRoomPeers('Ab1', 'TestRoom', '');
    expect(Network.connect).not.toHaveBeenCalled();
  });

  it('waits for CONNECT_PEER after connect attempts before resolving', async () => {
    const other = peer('other');
    spyOn(Network, 'listAllRooms').and.resolveTo([{
      id: 'Ab1',
      name: 'TestRoom',
      hasPassword: false,
      peers: [peer('self'), other],
      filterByPassword: () => [peer('self'), other],
    }]);
    (RoomConnectHelper as any).REMESH_ATTEMPTS = 1;
    (RoomConnectHelper as any).REMESH_DELAY_MS = 0;
    (RoomConnectHelper as any).REMESH_PEER_WAIT_MS = 500;

    const done = RoomConnectHelper.remeshRoomPeers('Ab1', 'TestRoom', '');
    await new Promise<void>(resolve => setTimeout(resolve, 20));
    expect(Network.connect).toHaveBeenCalled();
    openPeers = [other];
    EventSystem.trigger('CONNECT_PEER', { peerId: 'other' });
    await done;
  });
});

describe('RoomConnectHelper.openAndConnect', () => {
  let openPeers: IPeerContext[];
  let resetSpy: jasmine.Spy;
  const prevStableMs = RoomConnectHelper.JOIN_STABLE_MS;
  const prevDataMs = RoomConnectHelper.JOIN_DATA_MS;
  const prevQuiesceMs = RoomConnectHelper.JOIN_QUIESCE_MS;

  beforeEach(() => {
    RoomConnectHelper.JOIN_STABLE_MS = 0;
    RoomConnectHelper.JOIN_DATA_MS = 0;
    RoomConnectHelper.JOIN_QUIESCE_MS = 0;
    RoomConnectHelper.lastJoinFailReason = '';
    openPeers = [];
    spyOn(Network, 'open');
    spyOn(Network, 'connect').and.returnValue(true);
    spyOnProperty(Network, 'peers', 'get').and.callFake(() => openPeers);
    spyOnProperty(Network, 'peer', 'get').and.returnValue({ userId: 'u1', peerId: 'self' } as IPeerContext);
    spyOnProperty(Network, 'peerId', 'get').and.returnValue('self');
    spyOn(Room, 'clearLocalTabletopForJoin');
    resetSpy = spyOn(RoomConnectHelper, 'resetToLobby');
  });
  afterEach(() => {
    RoomConnectHelper.JOIN_STABLE_MS = prevStableMs;
    RoomConnectHelper.JOIN_DATA_MS = prevDataMs;
    RoomConnectHelper.JOIN_QUIESCE_MS = prevQuiesceMs;
    RoomConnectHelper.joinInProgress = false;
    RoomConnectHelper.lastJoinFailReason = '';
  });

  it('resolves true on first CONNECT_PEER without waiting for remaining targets', async () => {
    const targets = [peer('live'), peer('ghost')];
    const result = RoomConnectHelper.openAndConnect(room, '', targets);

    EventSystem.trigger('OPEN_NETWORK', { peerId: 'self' });
    openPeers = [peer('live')];
    EventSystem.trigger('CONNECT_PEER', { peerId: 'live' });
    hostTabletop('live');

    await expectAsync(result).toBeResolvedTo(true);
    expect(resetSpy).not.toHaveBeenCalled();
    expect(Network.connect).toHaveBeenCalledTimes(2);
    expect(Room.clearLocalTabletopForJoin).toHaveBeenCalledTimes(1);
  });

  it('does not switch tabletop until a live peer sends a game-table', async () => {
    const result = RoomConnectHelper.openAndConnect(room, '', [peer('live')]);

    EventSystem.trigger('OPEN_NETWORK', { peerId: 'self' });
    openPeers = [peer('live')];
    EventSystem.trigger('CONNECT_PEER', { peerId: 'live' });
    hostCatalog('live');
    await new Promise<void>(resolve => setTimeout(resolve, 20));
    expect(Room.clearLocalTabletopForJoin).not.toHaveBeenCalled();

    hostTabletop('live');
    await expectAsync(result).toBeResolvedTo(true);
    expect(Room.clearLocalTabletopForJoin).toHaveBeenCalledTimes(1);
  });

  it('fails quickly when a live peer never sends a game-table', async () => {
    RoomConnectHelper.JOIN_DATA_MS = 40;
    const result = RoomConnectHelper.openAndConnect(room, '', [peer('live')]);

    EventSystem.trigger('OPEN_NETWORK', { peerId: 'self' });
    openPeers = [peer('live')];
    EventSystem.trigger('CONNECT_PEER', { peerId: 'live' });
    hostCatalog('live');

    await expectAsync(result).toBeResolvedTo(false);
    expect(resetSpy).toHaveBeenCalled();
    expect(RoomConnectHelper.lastJoinFailReason).toBe('no_tabletop_data');
    expect(Room.clearLocalTabletopForJoin).not.toHaveBeenCalled();
  });

  it('resets the data deadline when a later peer connects after a ghost', async () => {
    RoomConnectHelper.JOIN_DATA_MS = 80;
    const result = RoomConnectHelper.openAndConnect(room, '', [peer('ghost'), peer('live')]);

    EventSystem.trigger('OPEN_NETWORK', { peerId: 'self' });
    openPeers = [peer('ghost')];
    EventSystem.trigger('CONNECT_PEER', { peerId: 'ghost' });
    await new Promise<void>(resolve => setTimeout(resolve, 50));
    openPeers = [peer('live')];
    EventSystem.trigger('CONNECT_PEER', { peerId: 'live' });
    await new Promise<void>(resolve => setTimeout(resolve, 50));
    hostTabletop('live');

    await expectAsync(result).toBeResolvedTo(true);
    expect(resetSpy).not.toHaveBeenCalled();
  });

  it('resolves false and resets when all targets fail while alone', async () => {
    (Network.connect as jasmine.Spy).and.returnValue(false);
    const targets = [peer('a'), peer('b')];
    const result = RoomConnectHelper.openAndConnect(room, '', targets);

    EventSystem.trigger('OPEN_NETWORK', { peerId: 'self' });

    await expectAsync(result).toBeResolvedTo(false);
    expect(resetSpy).toHaveBeenCalled();
    expect(RoomConnectHelper.lastJoinFailReason).toBe('all_targets_failed');
    expect(Room.clearLocalTabletopForJoin).not.toHaveBeenCalled();
  });

  it('ignores late DISCONNECT_PEER after success (settled / unregistered)', async () => {
    const targets = [peer('live'), peer('ghost')];
    const result = RoomConnectHelper.openAndConnect(room, '', targets);

    EventSystem.trigger('OPEN_NETWORK', { peerId: 'self' });
    openPeers = [peer('live')];
    EventSystem.trigger('CONNECT_PEER', { peerId: 'live' });
    hostTabletop('live');
    await expectAsync(result).toBeResolvedTo(true);

    resetSpy.calls.reset();
    openPeers = [];
    EventSystem.trigger('DISCONNECT_PEER', { peerId: 'ghost' });
    EventSystem.trigger('DISCONNECT_PEER', { peerId: 'live' });

    expect(resetSpy).not.toHaveBeenCalled();
  });

  it('fails join and resets when the only peer is a ghost that drops', async () => {
    RoomConnectHelper.JOIN_STABLE_MS = 50;
    const targets = [peer('ghost')];
    const result = RoomConnectHelper.openAndConnect(room, '', targets);

    EventSystem.trigger('OPEN_NETWORK', { peerId: 'self' });
    openPeers = [peer('ghost')];
    EventSystem.trigger('CONNECT_PEER', { peerId: 'ghost' });
    openPeers = [];
    EventSystem.trigger('DISCONNECT_PEER', { peerId: 'ghost' });

    await expectAsync(result).toBeResolvedTo(false);
    expect(resetSpy).toHaveBeenCalled();
    expect(Room.clearLocalTabletopForJoin).not.toHaveBeenCalled();
  });
});
