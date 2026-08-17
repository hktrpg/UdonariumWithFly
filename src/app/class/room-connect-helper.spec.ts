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
    expect(Room.clearLocalTabletopForJoin).not.toHaveBeenCalled();
  });

  it('resolves false and resets when all targets fail while alone', async () => {
    (Network.connect as jasmine.Spy).and.returnValue(false);
    const targets = [peer('a'), peer('b')];
    const result = RoomConnectHelper.openAndConnect(room, '', targets);

    EventSystem.trigger('OPEN_NETWORK', { peerId: 'self' });

    await expectAsync(result).toBeResolvedTo(false);
    expect(resetSpy).toHaveBeenCalled();
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
