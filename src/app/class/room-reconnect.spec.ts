import {
  applyRelayFanOut,
  buildSurvivalMeshContext,
  isRecoverableNetworkError,
  isStuckConnecting,
  meshGapPeerIds,
  meshStuckBudgetMs,
  poorNetworkCloseDebounceMs,
  RECOVERABLE_NETWORK_ERROR_TYPES,
  refreshConnectingSince,
  relayTargetPeerIds,
  shouldAttemptRoomReopen,
  shouldBootstrapSurvivalMesh,
  shouldLimitDirectMesh,
} from './room-reconnect.util';
import { Network } from './core/system';

describe('room-reconnect.util', () => {
  it('treats SkyWay internal / default as recoverable after cable drop', () => {
    expect(isRecoverableNetworkError('internal')).toBeTrue();
    expect(isRecoverableNetworkError('default')).toBeTrue();
    expect(isRecoverableNetworkError('disconnected')).toBeTrue();
    expect(isRecoverableNetworkError('socket-error')).toBeTrue();
    expect(isRecoverableNetworkError('unavailable-id')).toBeTrue();
  });

  it('does not treat auth / backend failures as simple recoverable', () => {
    expect(isRecoverableNetworkError('server-error')).toBeFalse();
    expect(isRecoverableNetworkError('authentication')).toBeFalse();
    expect(isRecoverableNetworkError('token-expired')).toBeFalse();
    expect(isRecoverableNetworkError('peer-unavailable')).toBeFalse();
  });

  it('still attempts room reopen for token / auth / server errors', () => {
    expect(shouldAttemptRoomReopen('internal')).toBeTrue();
    expect(shouldAttemptRoomReopen('internal-error')).toBeTrue();
    expect(shouldAttemptRoomReopen('event-as-promise-timeout')).toBeTrue();
    expect(shouldAttemptRoomReopen('token-expired')).toBeTrue();
    expect(shouldAttemptRoomReopen('authentication')).toBeTrue();
    expect(shouldAttemptRoomReopen('server-error')).toBeTrue();
    expect(shouldAttemptRoomReopen('rtc-api-fatal-error')).toBeTrue();
    expect(shouldAttemptRoomReopen('rtcApiFatalError')).toBeTrue();
    expect(shouldAttemptRoomReopen('token-api')).toBeTrue();
    expect(shouldAttemptRoomReopen('peer-unavailable')).toBeFalse();
    // Ghost member after sleep/WS drop — delayed reopen, not a hard stop.
    expect(shouldAttemptRoomReopen('already-same-name-member-exist')).toBeTrue();
    expect(shouldAttemptRoomReopen('alreadySameNameMemberExist')).toBeTrue();
    // Keepalive passes OutageKind literal from skyWayRecoveryGate.lastOutageKind.
    expect(shouldAttemptRoomReopen('duplicate-member')).toBeTrue();
  });

  it('RECOVERABLE_NETWORK_ERROR_TYPES includes internal', () => {
    expect(RECOVERABLE_NETWORK_ERROR_TYPES).toContain('internal');
  });

  it('meshGapPeerIds lists room members without an open DataChannel', () => {
    expect(meshGapPeerIds('self', ['self', 'a', 'b'], ['a'])).toEqual(['b']);
    expect(meshGapPeerIds('self', ['self', 'a'], ['a'])).toEqual([]);
    expect(meshGapPeerIds('self', ['', 'a'], [])).toEqual(['a']);
  });

  it('isStuckConnecting respects the budget', () => {
    expect(isStuckConnecting(undefined, 1000, 500)).toBeFalse();
    expect(isStuckConnecting(100, 500, 500)).toBeFalse();
    expect(isStuckConnecting(100, 600, 500)).toBeTrue();
    expect(isStuckConnecting(100, 9999, 0)).toBeFalse();
  });

  it('refreshConnectingSince keeps first-seen time and drops open peers', () => {
    const prev = new Map([['a', 10], ['gone', 5]]);
    const next = refreshConnectingSince(prev, [
      { peerId: 'a', isOpen: false },
      { peerId: 'b', isOpen: false },
      { peerId: 'c', isOpen: true },
    ], 99);
    expect(next.get('a')).toBe(10);
    expect(next.get('b')).toBe(99);
    expect(next.has('c')).toBeFalse();
    expect(next.has('gone')).toBeFalse();
  });

  it('meshStuckBudgetMs extends prune budget on slow effective types', () => {
    expect(meshStuckBudgetMs(45000, '4g')).toBe(45000);
    expect(meshStuckBudgetMs(45000, '3g')).toBe(60000);
    expect(meshStuckBudgetMs(45000, '2g')).toBe(90000);
    expect(meshStuckBudgetMs(0, '2g')).toBe(0);
  });

  it('poorNetworkCloseDebounceMs waits longer on slow effective types', () => {
    expect(poorNetworkCloseDebounceMs('4g')).toBe(8000);
    expect(poorNetworkCloseDebounceMs('3g')).toBe(10000);
    expect(poorNetworkCloseDebounceMs('2g')).toBe(15000);
  });

  it('relayTargetPeerIds lists every other open peer', () => {
    expect(relayTargetPeerIds('hub', ['hub', 'a', 'b'])).toEqual(['a', 'b']);
    expect(relayTargetPeerIds('hub', ['a'])).toEqual(['a']);
    expect(relayTargetPeerIds('hub', ['hub'])).toEqual([]);
  });

  it('buildSurvivalMeshContext uses openPeerIds length and max open ping', () => {
    expect(buildSurvivalMeshContext(
      ['a', 'b'],
      ['self', 'a', 'b', 'c'],
      [
        { isOpen: true, session: { ping: 500 } },
        { isOpen: true, session: { ping: 3200 } },
        { isOpen: false, session: { ping: 9000 } },
      ],
    )).toEqual({
      openCount: 2,
      roomMemberCount: 4,
      bestOpenPing: 3200,
    });
    expect(buildSurvivalMeshContext([], ['self'], [])).toEqual({
      openCount: 0,
      roomMemberCount: 1,
      bestOpenPing: undefined,
    });
  });

  it('applyRelayFanOut fans out to other open peers and decrements ttl', () => {
    const bSend = jasmine.createSpy('bSend');
    const cSend = jasmine.createSpy('cSend');
    const hubSend = jasmine.createSpy('hubSend');
    const container = { ttl: 1 };
    const forwarded = applyRelayFanOut(
      'mobile',
      ['mobile', 'hub', 'b', 'c'],
      undefined,
      [
        { peerId: 'mobile', isOpen: true, send: jasmine.createSpy('mobileSend') },
        { peerId: 'hub', isOpen: true, send: hubSend },
        { peerId: 'b', isOpen: true, send: bSend },
        { peerId: 'c', isOpen: true, send: cSend },
      ],
      undefined,
      container,
    );
    expect(forwarded).toEqual(['hub', 'b', 'c']);
    expect(hubSend).toHaveBeenCalledWith(container);
    expect(bSend).toHaveBeenCalledWith(container);
    expect(cSend).toHaveBeenCalledWith(container);
    expect(container.ttl).toBe(0);
  });

  it('applyRelayFanOut skips peers that are not open', () => {
    const bSend = jasmine.createSpy('bSend');
    const container = { ttl: 1 };
    const forwarded = applyRelayFanOut(
      'mobile',
      ['mobile', 'hub', 'b', 'c'],
      undefined,
      [
        { peerId: 'hub', isOpen: true, send: jasmine.createSpy('hubSend') },
        { peerId: 'b', isOpen: false, send: bSend },
        { peerId: 'c', isOpen: true, send: jasmine.createSpy('cSend') },
      ],
      undefined,
      container,
    );
    expect(forwarded).toEqual(['hub', 'c']);
    expect(bSend).not.toHaveBeenCalled();
  });

  it('applyRelayFanOut rewrites gossip users from relayUserIds', () => {
    const container = { ttl: 1, users: ['stale'] };
    applyRelayFanOut(
      'mobile',
      ['mobile', 'hub'],
      ['hub'],
      [{ peerId: 'hub', isOpen: true, send: jasmine.createSpy('hubSend') }],
      ['u1', 'u2'],
      container,
    );
    expect(container.users).toEqual(['u1', 'u2']);
  });

  it('shouldLimitDirectMesh limits partial mesh on high ping only', () => {
    expect(shouldLimitDirectMesh({ openCount: 1, roomMemberCount: 4, bestOpenPing: 3000 })).toBeFalse();
    expect(shouldLimitDirectMesh({ openCount: 1, roomMemberCount: 5, bestOpenPing: 3000 })).toBeTrue();
    expect(shouldLimitDirectMesh({ openCount: 3, roomMemberCount: 4, bestOpenPing: 3000 })).toBeFalse();
    expect(shouldLimitDirectMesh({ openCount: 3, roomMemberCount: 5, bestOpenPing: 3000 })).toBeFalse();
    expect(shouldLimitDirectMesh({ openCount: 0, roomMemberCount: 4, bestOpenPing: 3000 })).toBeFalse();
    expect(shouldLimitDirectMesh({ openCount: 1, roomMemberCount: 4, bestOpenPing: 100 })).toBeFalse();
  });

  it('shouldBootstrapSurvivalMesh caps first connect on slow link', () => {
    expect(shouldBootstrapSurvivalMesh({ openCount: 0, roomMemberCount: 4 })).toBeFalse();
    expect(shouldBootstrapSurvivalMesh({ openCount: 0, roomMemberCount: 5 })).toBeFalse();
    const prev = Object.getOwnPropertyDescriptor(navigator, 'connection');
    Object.defineProperty(navigator, 'connection', {
      configurable: true,
      get: () => ({ effectiveType: '3g' }),
    });
    try {
      expect(shouldBootstrapSurvivalMesh({ openCount: 0, roomMemberCount: 5 })).toBeTrue();
      expect(shouldBootstrapSurvivalMesh({ openCount: 1, roomMemberCount: 5 })).toBeFalse();
    } finally {
      if (prev) Object.defineProperty(navigator, 'connection', prev);
    }
    expect(shouldBootstrapSurvivalMesh({ openCount: 0, roomMemberCount: 5, bestOpenPing: 2500 })).toBeTrue();
  });
});

describe('Network lastRoomSession', () => {
  afterEach(() => {
    Network.clearLastRoomSession();
  });

  it('remembers and returns a copy of the room session', () => {
    Network.rememberRoomSession({
      userId: 'u1',
      roomId: 'Ab1',
      roomName: 'TestRoom',
      meshPassword: 'mesh',
    });
    const a = Network.getLastRoomSession();
    const b = Network.getLastRoomSession();
    expect(a).toEqual({
      userId: 'u1',
      roomId: 'Ab1',
      roomName: 'TestRoom',
      meshPassword: 'mesh',
    });
    expect(a).not.toBe(b);
    a!.roomId = 'mutated';
    expect(Network.getLastRoomSession()?.roomId).toBe('Ab1');
  });

  it('ignores incomplete room sessions', () => {
    Network.rememberRoomSession({
      userId: 'u1',
      roomId: '',
      roomName: 'x',
      meshPassword: '',
    });
    expect(Network.getLastRoomSession()).toBeNull();
  });

  it('clearLastRoomSession drops stored credentials', () => {
    Network.rememberRoomSession({
      userId: 'u1',
      roomId: 'Ab1',
      roomName: 'TestRoom',
      meshPassword: '',
    });
    Network.clearLastRoomSession();
    expect(Network.getLastRoomSession()).toBeNull();
  });
});
