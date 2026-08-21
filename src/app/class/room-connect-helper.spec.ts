import { EventSystem, Network } from '@udonarium/core/system';
import { IPeerContext } from '@udonarium/core/system/network/peer-context';
import { IRoomInfo } from '@udonarium/core/system/network/room-info';
import { Room } from '@udonarium/room';
import { TableSelecter } from '@udonarium/table-selecter';

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

  it('extends join-data wait while meshed instead of aborting', () => {
    expect(RoomConnectHelper.shouldExtendJoinDataWait(0)).toBeFalse();
    expect(RoomConnectHelper.shouldExtendJoinDataWait(1)).toBeTrue();
  });

  it('resetIfAlone is a no-op (join probe must not kick)', () => {
    const leave = spyOn(RoomConnectHelper, 'resetToLobby');
    RoomConnectHelper.resetIfAlone();
    expect(leave).not.toHaveBeenCalled();
  });

  it('filterLobbyRooms hides suppressed rooms', () => {
    RoomConnectHelper.clearLobbyRoomSuppression();
    RoomConnectHelper.suppressLobbyRoom('Ab1', 'TestRoom');
    const filtered = RoomConnectHelper.filterLobbyRooms([
      { id: 'Ab1', name: 'TestRoom' },
      { id: 'Cd2', name: 'Other' },
    ]);
    expect(filtered).toEqual([{ id: 'Cd2', name: 'Other' }]);
    RoomConnectHelper.clearLobbyRoomSuppression();
  });

  it('maps join fail reasons to lobby i18n key prefixes', () => {
    expect(RoomConnectHelper.joinFailMessageKey('all_targets_failed')).toBe('lobby.staleRoom');
    expect(RoomConnectHelper.joinFailMessageKey('no_tabletop_data')).toBe('lobby.joinDataTimeout');
    expect(RoomConnectHelper.joinFailMessageKey('connect_timeout')).toBe('lobby.joinNetworkTimeout');
    expect(RoomConnectHelper.joinFailMessageKey('network_error_open')).toBe('lobby.joinNetworkTimeout');
  });

  it('suppresses lobby rooms only for stale/empty fails, not network timeouts', () => {
    expect(RoomConnectHelper.shouldSuppressLobbyRoom('all_targets_failed')).toBeTrue();
    expect(RoomConnectHelper.shouldSuppressLobbyRoom('no_tabletop_data')).toBeTrue();
    expect(RoomConnectHelper.shouldSuppressLobbyRoom('connect_timeout')).toBeFalse();
    expect(RoomConnectHelper.shouldSuppressLobbyRoom('network_error_open')).toBeFalse();
    expect(RoomConnectHelper.shouldSuppressLobbyRoom('network_error_mesh')).toBeFalse();
  });

  it('gatherJoinTargets merges lobby seed with SkyWay room members', () => {
    spyOn(Network, 'listRoomMemberPeerIds').and.returnValue(['self', 'room-live']);
    spyOnProperty(Network, 'peerId', 'get').and.returnValue('self');
    const merged = RoomConnectHelper.gatherJoinTargets([peer('lobby-a')]);
    expect(merged.map(p => p.peerId).sort()).toEqual(['lobby-a', 'room-live']);
  });
});

describe('RoomConnectHelper.reopenLastRoomOrLobby', () => {
  afterEach(() => {
    (RoomConnectHelper as any).reopenInFlight = false;
    (RoomConnectHelper as any).joinOwnedUntil = 0;
    RoomConnectHelper.joinInProgress = false;
    RoomConnectHelper.everHadRoomSession = false;
  });

  it('remeshes after OPEN_NETWORK when a room session exists', async () => {
    RoomConnectHelper.everHadRoomSession = true;
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

    expect(RoomConnectHelper.reopenLastRoomOrLobby()).toBe('started');
    EventSystem.trigger('OPEN_NETWORK', { peerId: 'self' });
    await new Promise<void>(resolve => setTimeout(resolve, 20));

    expect(remesh).toHaveBeenCalledWith('Ab1', 'TestRoom', '');
  });

  it('reopens lobby peer only when this page never had a room', async () => {
    RoomConnectHelper.everHadRoomSession = false;
    spyOn(Network, 'getLastRoomSession').and.returnValue(null);
    spyOn(Network, 'open');
    spyOnProperty(Network, 'peer', 'get').and.returnValue({ userId: 'u1', peerId: 'self' } as IPeerContext);
    spyOnProperty(Network, 'peerId', 'get').and.returnValue('self');
    const remesh = spyOn(RoomConnectHelper, 'remeshRoomPeers').and.resolveTo();

    expect(RoomConnectHelper.reopenLastRoomOrLobby()).toBe('started');
    EventSystem.trigger('OPEN_NETWORK', { peerId: 'self' });
    await new Promise<void>(resolve => setTimeout(resolve, 20));

    expect(Network.open).toHaveBeenCalled();
    expect(remesh).not.toHaveBeenCalled();
  });

  it('skips lobby reopen when room session is missing after mid-game', () => {
    RoomConnectHelper.everHadRoomSession = true;
    spyOn(Network, 'getLastRoomSession').and.returnValue(null);
    const open = spyOn(Network, 'open');

    expect(RoomConnectHelper.reopenLastRoomOrLobby()).toBe('no-session');
    expect(open).not.toHaveBeenCalled();
  });

  it('returns busy while join probe is in progress', () => {
    RoomConnectHelper.joinInProgress = true;
    RoomConnectHelper.everHadRoomSession = true;
    spyOn(Network, 'getLastRoomSession').and.returnValue({
      userId: 'u1',
      roomId: 'Ab1',
      roomName: 'TestRoom',
      meshPassword: '',
    });
    const open = spyOn(Network, 'open');

    expect(RoomConnectHelper.shouldAttemptReopenNow()).toBeFalse();
    expect(RoomConnectHelper.reopenLastRoomOrLobby()).toBe('busy');
    expect(open).not.toHaveBeenCalled();
  });

  it('returns busy during joinOwnedUntil after a failed probe', () => {
    RoomConnectHelper.joinInProgress = false;
    (RoomConnectHelper as any).joinOwnedUntil = Date.now() + 5000;
    RoomConnectHelper.everHadRoomSession = true;
    spyOn(Network, 'getLastRoomSession').and.returnValue({
      userId: 'u1',
      roomId: 'Ab1',
      roomName: 'TestRoom',
      meshPassword: '',
    });
    const open = spyOn(Network, 'open');

    expect(RoomConnectHelper.isJoinOwningNetworkError).toBeTrue();
    expect(RoomConnectHelper.shouldAttemptReopenNow()).toBeFalse();
    expect(RoomConnectHelper.reopenLastRoomOrLobby()).toBe('busy');
    expect(open).not.toHaveBeenCalled();
  });
});

describe('RoomConnectHelper.remeshRoomPeers', () => {
  let streamPeers: IPeerContext[];
  let openPeerIds: string[];
  const prevAttempts = (RoomConnectHelper as any).REMESH_ATTEMPTS;
  const prevDelay = (RoomConnectHelper as any).REMESH_DELAY_MS;
  const prevPeerWait = (RoomConnectHelper as any).REMESH_PEER_WAIT_MS;

  beforeEach(() => {
    streamPeers = [];
    openPeerIds = [];
    spyOn(Network, 'connect').and.returnValue(true);
    spyOn(Network, 'disconnect').and.callFake((p: IPeerContext) => {
      streamPeers = streamPeers.filter(x => x.peerId !== p.peerId);
      openPeerIds = openPeerIds.filter(id => id !== p.peerId);
      return true;
    });
    spyOn(Network, 'listRoomMemberPeerIds').and.returnValue([]);
    spyOnProperty(Network, 'peers', 'get').and.callFake(() => streamPeers);
    spyOnProperty(Network, 'peerIds', 'get').and.callFake(() => openPeerIds.slice());
    spyOnProperty(Network, 'peerId', 'get').and.returnValue('self');
    RoomConnectHelper.stopMeshKeepalive();
    (RoomConnectHelper as any).connectingSince = new Map();
  });
  afterEach(() => {
    (RoomConnectHelper as any).REMESH_ATTEMPTS = prevAttempts;
    (RoomConnectHelper as any).REMESH_DELAY_MS = prevDelay;
    (RoomConnectHelper as any).REMESH_PEER_WAIT_MS = prevPeerWait;
    RoomConnectHelper.STUCK_CONNECTING_MS_FOR_TEST = 0;
    RoomConnectHelper.stopMeshKeepalive();
  });

  it('retries when the room listing is temporarily alone', async () => {
    (RoomConnectHelper as any).REMESH_ATTEMPTS = 3;
    (RoomConnectHelper as any).REMESH_DELAY_MS = 0;
    const list = spyOn(Network, 'listAllRooms').and.resolveTo([{
      id: 'Ab1',
      name: 'TestRoom',
      hasPassword: false,
      peers: [peer('self')],
      filterByPassword: () => [peer('self')],
    }]);

    await RoomConnectHelper.remeshRoomPeers('Ab1', 'TestRoom', '');
    expect(list).toHaveBeenCalledWith(true);
    expect(list).toHaveBeenCalledTimes(3);
    expect(Network.connect).not.toHaveBeenCalled();
  });

  it('skips lobby list this round when channel members are present', async () => {
    (Network.listRoomMemberPeerIds as jasmine.Spy).and.returnValue(['self', 'other']);
    (Network.connect as jasmine.Spy).and.returnValue(false);
    const list = spyOn(Network, 'listAllRooms').and.resolveTo([]);
    (RoomConnectHelper as any).REMESH_ATTEMPTS = 1;
    (RoomConnectHelper as any).REMESH_DELAY_MS = 0;
    (RoomConnectHelper as any).REMESH_PEER_WAIT_MS = 0;

    await RoomConnectHelper.remeshRoomPeers('Ab1', 'TestRoom', '');

    expect(Network.connect).toHaveBeenCalled();
    expect(list).not.toHaveBeenCalled();
  });

  it('connects channel members before falling back to lobby list', async () => {
    (Network.listRoomMemberPeerIds as jasmine.Spy).and.returnValue(['self', 'other']);
    (Network.connect as jasmine.Spy).and.callFake(() => {
      streamPeers = [peer('other')];
      openPeerIds = ['other'];
      return true;
    });
    const list = spyOn(Network, 'listAllRooms');
    (RoomConnectHelper as any).REMESH_ATTEMPTS = 1;
    (RoomConnectHelper as any).REMESH_DELAY_MS = 0;
    (RoomConnectHelper as any).REMESH_PEER_WAIT_MS = 0;

    await RoomConnectHelper.remeshRoomPeers('Ab1', 'TestRoom', '');

    expect(Network.connect).toHaveBeenCalled();
    expect(list).not.toHaveBeenCalled();
  });

  it('does not treat half-open streams as remesh success', async () => {
    streamPeers = [{ peerId: 'stuck', isOpen: false } as IPeerContext];
    openPeerIds = [];
    (Network.listRoomMemberPeerIds as jasmine.Spy).and.returnValue(['self', 'other']);
    (RoomConnectHelper as any).REMESH_ATTEMPTS = 1;
    (RoomConnectHelper as any).REMESH_DELAY_MS = 0;
    (RoomConnectHelper as any).REMESH_PEER_WAIT_MS = 0;
    const list = spyOn(Network, 'listAllRooms');

    await RoomConnectHelper.remeshRoomPeers('Ab1', 'TestRoom', '');

    expect(Network.connect).toHaveBeenCalled();
    expect(list).not.toHaveBeenCalled();
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
    streamPeers = [other];
    openPeerIds = ['other'];
    EventSystem.trigger('CONNECT_PEER', { peerId: 'other' });
    await done;
  });
});

describe('RoomConnectHelper.healMeshGaps', () => {
  let streamPeers: IPeerContext[];
  let openPeerIds: string[];

  beforeEach(() => {
    streamPeers = [];
    openPeerIds = [];
    spyOn(Network, 'connect').and.callFake((p: IPeerContext) => {
      streamPeers = [...streamPeers, { peerId: p.peerId, isOpen: false } as IPeerContext];
      return true;
    });
    spyOn(Network, 'disconnect').and.callFake((p: IPeerContext) => {
      streamPeers = streamPeers.filter(x => x.peerId !== p.peerId);
      openPeerIds = openPeerIds.filter(id => id !== p.peerId);
      return true;
    });
    spyOn(Network, 'listRoomMemberPeerIds').and.returnValue(['self', 'a', 'b']);
    spyOnProperty(Network, 'peers', 'get').and.callFake(() => streamPeers);
    spyOnProperty(Network, 'peerIds', 'get').and.callFake(() => openPeerIds.slice());
    spyOnProperty(Network, 'peerId', 'get').and.returnValue('self');
    spyOnProperty(Network, 'isOpen', 'get').and.returnValue(true);
    spyOnProperty(Network, 'peer', 'get').and.returnValue({
      peerId: 'self', isRoom: true, userId: 'u1',
    } as IPeerContext);
    RoomConnectHelper.stopMeshKeepalive();
    (RoomConnectHelper as any).connectingSince = new Map();
    RoomConnectHelper.STUCK_CONNECTING_MS_FOR_TEST = 0;
  });

  afterEach(() => {
    RoomConnectHelper.STUCK_CONNECTING_MS_FOR_TEST = 0;
    RoomConnectHelper.stopMeshKeepalive();
  });

  it('connects room members that lack an open DataChannel', async () => {
    openPeerIds = ['a'];
    streamPeers = [{ peerId: 'a', isOpen: true } as IPeerContext];

    await RoomConnectHelper.healMeshGaps();

    expect(Network.connect).toHaveBeenCalled();
    const connectedIds = (Network.connect as jasmine.Spy).calls.allArgs().map(args => args[0].peerId);
    expect(connectedIds).toEqual(['b']);
  });

  it('prunes stuck connecting peers then reconnects them', async () => {
    RoomConnectHelper.STUCK_CONNECTING_MS_FOR_TEST = 50;
    streamPeers = [{ peerId: 'b', isOpen: false } as IPeerContext];
    openPeerIds = [];
    (RoomConnectHelper as any).connectingSince = new Map([['b', Date.now() - 1000]]);

    await RoomConnectHelper.healMeshGaps();

    expect(Network.disconnect).toHaveBeenCalled();
    expect(Network.connect).toHaveBeenCalled();
  });

  it('keeps remeshing after a half-open handshake instead of aborting', async () => {
    streamPeers = [{ peerId: 'other', isOpen: false } as IPeerContext];
    openPeerIds = [];
    (Network.listRoomMemberPeerIds as jasmine.Spy).and.returnValue(['self', 'other']);
    (RoomConnectHelper as any).REMESH_ATTEMPTS = 2;
    (RoomConnectHelper as any).REMESH_DELAY_MS = 0;
    (RoomConnectHelper as any).REMESH_PEER_WAIT_MS = 0;
    RoomConnectHelper.STUCK_CONNECTING_MS_FOR_TEST = 1;
    (RoomConnectHelper as any).connectingSince = new Map([['other', Date.now() - 1000]]);
    const list = spyOn(Network, 'listAllRooms');

    await RoomConnectHelper.remeshRoomPeers('Ab1', 'TestRoom', '');

    expect(Network.disconnect).toHaveBeenCalled();
    expect(list).not.toHaveBeenCalled();
  });
});

describe('RoomConnectHelper.openAndConnect', () => {
  let openPeers: IPeerContext[];
  let resetSpy: jasmine.Spy;
  let abandonSpy: jasmine.Spy;
  const prevStableMs = RoomConnectHelper.JOIN_STABLE_MS;
  const prevDataMs = RoomConnectHelper.JOIN_DATA_MS;
  const prevQuiesceMs = RoomConnectHelper.JOIN_QUIESCE_MS;

  beforeEach(() => {
    RoomConnectHelper.JOIN_STABLE_MS = 0;
    RoomConnectHelper.JOIN_DATA_MS = 0;
    RoomConnectHelper.JOIN_QUIESCE_MS = 0;
    RoomConnectHelper.CONNECT_TIMEOUT_MS_FOR_TEST = 0;
    RoomConnectHelper.lastJoinFailReason = '';
    RoomConnectHelper.clearLobbyRoomSuppression();
    openPeers = [];
    spyOn(Network, 'open');
    spyOn(Network, 'connect').and.returnValue(true);
    spyOn(Network, 'listRoomMemberPeerIds').and.returnValue([]);
    spyOnProperty(Network, 'peers', 'get').and.callFake(() => openPeers);
    spyOnProperty(Network, 'peerIds', 'get').and.callFake(() => openPeers.map(p => p.peerId));
    spyOnProperty(Network, 'peer', 'get').and.returnValue({ userId: 'u1', peerId: 'self', isRoom: true } as IPeerContext);
    spyOnProperty(Network, 'peerId', 'get').and.returnValue('self');
    spyOn(Room, 'clearLocalTabletopForJoin');
    resetSpy = spyOn(RoomConnectHelper, 'resetToLobby');
    abandonSpy = spyOn(RoomConnectHelper, 'abandonFailedJoinProbe').and.callThrough();
  });
  afterEach(() => {
    RoomConnectHelper.JOIN_STABLE_MS = prevStableMs;
    RoomConnectHelper.JOIN_DATA_MS = prevDataMs;
    RoomConnectHelper.JOIN_QUIESCE_MS = prevQuiesceMs;
    RoomConnectHelper.CONNECT_TIMEOUT_MS_FOR_TEST = 0;
    (RoomConnectHelper as any).JOIN_REMESH_MS = 2000;
    RoomConnectHelper.joinInProgress = false;
    RoomConnectHelper.lastJoinFailReason = '';
    RoomConnectHelper.clearLobbyRoomSuppression();
  });

  it('settles tabletop remount after a successful mesh join', async () => {
    const settle = spyOn(RoomConnectHelper, 'settleTabletopAfterMeshJoin').and.stub();
    const result = RoomConnectHelper.openAndConnect(room, '', [peer('live')]);

    EventSystem.trigger('OPEN_NETWORK', { peerId: 'self' });
    openPeers = [peer('live')];
    EventSystem.trigger('CONNECT_PEER', { peerId: 'live' });
    hostTabletop('live');

    await expectAsync(result).toBeResolvedTo(true);
    await new Promise<void>(resolve => queueMicrotask(resolve));
    expect(settle).toHaveBeenCalled();
  });

  it('restores tabletop once on mesh settle without delayed ROOM_PIECES', () => {
    const restore = spyOn(TableSelecter.instance, 'restoreAfterRoomLoad').and.stub();
    const trigger = spyOn(EventSystem, 'trigger').and.callThrough();

    RoomConnectHelper.settleTabletopAfterMeshJoin();

    expect(restore).toHaveBeenCalled();
    const piecesCalls = trigger.calls.allArgs().filter(args => String(args[0]) === 'ROOM_PIECES_REPLACED');
    // Delayed second remount removed; restore owns the single ROOM_PIECES when not stubbed.
    expect(piecesCalls.length).toBe(0);
  });

  it('sets joinOwnedUntil when join probe fails so reopen stays busy', async () => {
    RoomConnectHelper.CONNECT_TIMEOUT_MS_FOR_TEST = 80;
    (Network.connect as jasmine.Spy).and.returnValue(false);
    const result = RoomConnectHelper.openAndConnect(room, '', [peer('ghost')]);

    EventSystem.trigger('OPEN_NETWORK', { peerId: 'self' });

    await expectAsync(result).toBeResolvedTo(false);
    expect(RoomConnectHelper.lastJoinFailReason).toBe('connect_timeout');
    expect(RoomConnectHelper.isJoinOwningNetworkError).toBeTrue();
    expect(RoomConnectHelper.shouldAttemptReopenNow()).toBeFalse();
    (RoomConnectHelper as any).joinOwnedUntil = 0;
  });

  it('does not settle tabletop when join probe fails', async () => {
    RoomConnectHelper.CONNECT_TIMEOUT_MS_FOR_TEST = 80;
    const settle = spyOn(RoomConnectHelper, 'settleTabletopAfterMeshJoin').and.stub();
    (Network.connect as jasmine.Spy).and.returnValue(false);
    const result = RoomConnectHelper.openAndConnect(room, '', [peer('ghost')]);

    EventSystem.trigger('OPEN_NETWORK', { peerId: 'self' });

    await expectAsync(result).toBeResolvedTo(false);
    await new Promise<void>(resolve => queueMicrotask(resolve));
    expect(settle).not.toHaveBeenCalled();
    (RoomConnectHelper as any).joinOwnedUntil = 0;
  });

  it('soft-fails connect() until remesh finds a ready room member', async () => {
    let members: string[] = [];
    (Network.listRoomMemberPeerIds as jasmine.Spy).and.callFake(() => members);
    (Network.connect as jasmine.Spy).and.callFake((p: IPeerContext) => {
      return members.includes(p.peerId);
    });
    (RoomConnectHelper as any).JOIN_REMESH_MS = 30;
    RoomConnectHelper.CONNECT_TIMEOUT_MS_FOR_TEST = 5000;
    const result = RoomConnectHelper.openAndConnect(room, '', [peer('live')]);

    EventSystem.trigger('OPEN_NETWORK', { peerId: 'self' });
    await new Promise<void>(resolve => setTimeout(resolve, 20));
    expect(RoomConnectHelper.joinInProgress).toBeTrue();

    members = ['self', 'live'];
    await new Promise<void>(resolve => setTimeout(resolve, 50));
    openPeers = [peer('live')];
    EventSystem.trigger('CONNECT_PEER', { peerId: 'live' });
    hostTabletop('live');

    await expectAsync(result).toBeResolvedTo(true);
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

  it('extends data wait while meshed, then succeeds when game-table arrives late', async () => {
    RoomConnectHelper.JOIN_DATA_MS = 40;
    RoomConnectHelper.CONNECT_TIMEOUT_MS_FOR_TEST = 5000;
    const result = RoomConnectHelper.openAndConnect(room, '', [peer('live')]);

    EventSystem.trigger('OPEN_NETWORK', { peerId: 'self' });
    openPeers = [peer('live')];
    EventSystem.trigger('CONNECT_PEER', { peerId: 'live' });
    hostCatalog('live');
    await new Promise<void>(resolve => setTimeout(resolve, 100));
    expect(resetSpy).not.toHaveBeenCalled();
    expect(Room.clearLocalTabletopForJoin).not.toHaveBeenCalled();

    hostTabletop('live');
    await expectAsync(result).toBeResolvedTo(true);
    expect(resetSpy).not.toHaveBeenCalled();
  });

  it('on overall timeout while meshed stays in room (never kicks self)', async () => {
    RoomConnectHelper.JOIN_DATA_MS = 40;
    RoomConnectHelper.CONNECT_TIMEOUT_MS_FOR_TEST = 120;
    const result = RoomConnectHelper.openAndConnect(room, '', [peer('live')]);

    EventSystem.trigger('OPEN_NETWORK', { peerId: 'self' });
    openPeers = [peer('live')];
    EventSystem.trigger('CONNECT_PEER', { peerId: 'live' });
    hostCatalog('live');

    await expectAsync(result).toBeResolvedTo(true);
    expect(resetSpy).not.toHaveBeenCalled();
    expect(Room.clearLocalTabletopForJoin).toHaveBeenCalled();
  });

  it('aborts missing tabletop only after becoming alone', async () => {
    RoomConnectHelper.JOIN_DATA_MS = 40;
    RoomConnectHelper.CONNECT_TIMEOUT_MS_FOR_TEST = 5000;
    const result = RoomConnectHelper.openAndConnect(room, '', [peer('live')]);

    EventSystem.trigger('OPEN_NETWORK', { peerId: 'self' });
    openPeers = [peer('live')];
    EventSystem.trigger('CONNECT_PEER', { peerId: 'live' });
    await new Promise<void>(resolve => setTimeout(resolve, 60));
    expect(resetSpy).not.toHaveBeenCalled();

    openPeers = [];
    EventSystem.trigger('DISCONNECT_PEER', { peerId: 'live' });
    await expectAsync(result).toBeResolvedTo(false);
    expect(resetSpy).not.toHaveBeenCalled();
    expect(abandonSpy).toHaveBeenCalled();
    expect(RoomConnectHelper.isLobbyRoomSuppressed('Ab1', 'TestRoom')).toBeTrue();
    expect(RoomConnectHelper.lastJoinFailReason).toBe('all_targets_failed');
  });

  it('fails no_tabletop_data when alone after soft slices', async () => {
    RoomConnectHelper.JOIN_DATA_MS = 40;
    RoomConnectHelper.CONNECT_TIMEOUT_MS_FOR_TEST = 5000;
    const result = RoomConnectHelper.openAndConnect(room, '', [peer('ghost')]);

    EventSystem.trigger('OPEN_NETWORK', { peerId: 'self' });
    openPeers = [peer('ghost')];
    EventSystem.trigger('CONNECT_PEER', { peerId: 'ghost' });
    await new Promise<void>(resolve => setTimeout(resolve, 20));
    openPeers = [];
    EventSystem.trigger('DISCONNECT_PEER', { peerId: 'ghost' });
    await expectAsync(result).toBeResolvedTo(false);
    expect(resetSpy).not.toHaveBeenCalled();
    expect(abandonSpy).toHaveBeenCalled();
    expect(RoomConnectHelper.isLobbyRoomSuppressed('Ab1', 'TestRoom')).toBeTrue();
    expect(['no_tabletop_data', 'all_targets_failed']).toContain(RoomConnectHelper.lastJoinFailReason);
  });

  it('resolves false and suppresses room when all targets fail while alone', async () => {
    const targets = [peer('a'), peer('b')];
    const result = RoomConnectHelper.openAndConnect(room, '', targets);

    EventSystem.trigger('OPEN_NETWORK', { peerId: 'self' });
    openPeers = [peer('a')];
    EventSystem.trigger('CONNECT_PEER', { peerId: 'a' });
    openPeers = [];
    EventSystem.trigger('DISCONNECT_PEER', { peerId: 'a' });
    EventSystem.trigger('DISCONNECT_PEER', { peerId: 'b' });

    await expectAsync(result).toBeResolvedTo(false);
    expect(resetSpy).not.toHaveBeenCalled();
    expect(abandonSpy).toHaveBeenCalled();
    expect(RoomConnectHelper.lastJoinFailReason).toBe('all_targets_failed');
    expect(RoomConnectHelper.isLobbyRoomSuppressed('Ab1', 'TestRoom')).toBeTrue();
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

  it('fails join and suppresses room when the only peer is a ghost that drops', async () => {
    RoomConnectHelper.JOIN_STABLE_MS = 50;
    const targets = [peer('ghost')];
    const result = RoomConnectHelper.openAndConnect(room, '', targets);

    EventSystem.trigger('OPEN_NETWORK', { peerId: 'self' });
    openPeers = [peer('ghost')];
    EventSystem.trigger('CONNECT_PEER', { peerId: 'ghost' });
    openPeers = [];
    EventSystem.trigger('DISCONNECT_PEER', { peerId: 'ghost' });

    await expectAsync(result).toBeResolvedTo(false);
    expect(resetSpy).not.toHaveBeenCalled();
    expect(abandonSpy).toHaveBeenCalled();
    expect(RoomConnectHelper.isLobbyRoomSuppressed('Ab1', 'TestRoom')).toBeTrue();
    expect(Room.clearLocalTabletopForJoin).not.toHaveBeenCalled();
  });

  it('does not hide the lobby room on connect_timeout (retryable network fail)', async () => {
    RoomConnectHelper.CONNECT_TIMEOUT_MS_FOR_TEST = 80;
    const result = RoomConnectHelper.openAndConnect(room, '', [peer('slow')]);

    EventSystem.trigger('OPEN_NETWORK', { peerId: 'self' });
    // Connect started but never CONNECT_PEER / DISCONNECT_PEER — overall timeout.
    await expectAsync(result).toBeResolvedTo(false);
    expect(RoomConnectHelper.lastJoinFailReason).toBe('connect_timeout');
    expect(RoomConnectHelper.isLobbyRoomSuppressed('Ab1', 'TestRoom')).toBeFalse();
    expect(abandonSpy).toHaveBeenCalled();
    expect(resetSpy).not.toHaveBeenCalled();
  });

  it('meshes SkyWay room members even when lobby seed peers are ghosts', async () => {
    (Network.listRoomMemberPeerIds as jasmine.Spy).and.returnValue(['self', 'live']);
    (Network.connect as jasmine.Spy).and.callFake((p: IPeerContext) => p.peerId === 'live');
    const result = RoomConnectHelper.openAndConnect(room, '', [peer('ghost')]);

    EventSystem.trigger('OPEN_NETWORK', { peerId: 'self' });
    openPeers = [peer('live')];
    EventSystem.trigger('CONNECT_PEER', { peerId: 'live' });
    hostTabletop('live');

    await expectAsync(result).toBeResolvedTo(true);
    expect(Network.connect).toHaveBeenCalled();
    const connectedIds = (Network.connect as jasmine.Spy).calls.allArgs().map(a => a[0].peerId);
    expect(connectedIds).toContain('live');
  });
});
