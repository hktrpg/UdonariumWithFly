import { EventSystem, Network } from '@udonarium/core/system';
import { IPeerContext } from '@udonarium/core/system/network/peer-context';
import { IRoomInfo } from '@udonarium/core/system/network/room-info';
import { Room } from '@udonarium/room';

import { RoomConnectHelper } from './room-connect-helper';

function peer(peerId: string): IPeerContext {
  return { peerId } as IPeerContext;
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

  it('fails join only when every target was tried and no peer remains', () => {
    expect(RoomConnectHelper.shouldFailJoin(1, 2, 0)).toBeFalse();
    expect(RoomConnectHelper.shouldFailJoin(2, 2, 1)).toBeFalse();
    expect(RoomConnectHelper.shouldFailJoin(2, 2, 0)).toBeTrue();
    expect(RoomConnectHelper.shouldFailJoin(0, 0, 0)).toBeFalse();
  });
});

describe('RoomConnectHelper.openAndConnect', () => {
  let openPeers: IPeerContext[];
  let resetSpy: jasmine.Spy;

  beforeEach(() => {
    openPeers = [];
    spyOn(Network, 'open');
    spyOn(Network, 'connect').and.returnValue(true);
    spyOnProperty(Network, 'peers', 'get').and.callFake(() => openPeers);
    spyOnProperty(Network, 'peer', 'get').and.returnValue({ userId: 'u1', peerId: 'self' } as IPeerContext);
    spyOnProperty(Network, 'peerId', 'get').and.returnValue('self');
    spyOn(Room, 'clearLocalTabletopForJoin');
    resetSpy = spyOn(RoomConnectHelper, 'resetIfAlone');
  });

  it('resolves true on first CONNECT_PEER without waiting for remaining targets', async () => {
    const targets = [peer('live'), peer('ghost')];
    const result = RoomConnectHelper.openAndConnect(room, '', targets);

    EventSystem.trigger('OPEN_NETWORK', { peerId: 'self' });
    openPeers = [peer('live')];
    EventSystem.trigger('CONNECT_PEER', { peerId: 'live' });

    await expectAsync(result).toBeResolvedTo(true);
    expect(resetSpy).not.toHaveBeenCalled();
    expect(Network.connect).toHaveBeenCalledTimes(2);
  });

  it('resolves false and resets when all targets fail while alone', async () => {
    (Network.connect as jasmine.Spy).and.returnValue(false);
    const targets = [peer('a'), peer('b')];
    const result = RoomConnectHelper.openAndConnect(room, '', targets);

    EventSystem.trigger('OPEN_NETWORK', { peerId: 'self' });

    await expectAsync(result).toBeResolvedTo(false);
    expect(resetSpy).toHaveBeenCalled();
  });

  it('ignores late DISCONNECT_PEER after success (settled / unregistered)', async () => {
    const targets = [peer('live'), peer('ghost')];
    const result = RoomConnectHelper.openAndConnect(room, '', targets);

    EventSystem.trigger('OPEN_NETWORK', { peerId: 'self' });
    openPeers = [peer('live')];
    EventSystem.trigger('CONNECT_PEER', { peerId: 'live' });
    await expectAsync(result).toBeResolvedTo(true);

    resetSpy.calls.reset();
    openPeers = [];
    EventSystem.trigger('DISCONNECT_PEER', { peerId: 'ghost' });
    EventSystem.trigger('DISCONNECT_PEER', { peerId: 'live' });

    expect(resetSpy).not.toHaveBeenCalled();
  });
});
