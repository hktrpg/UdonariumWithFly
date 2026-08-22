import {
  isRecoverableNetworkError,
  isStuckConnecting,
  meshGapPeerIds,
  RECOVERABLE_NETWORK_ERROR_TYPES,
  refreshConnectingSince,
  shouldAttemptRoomReopen,
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
    expect(shouldAttemptRoomReopen('peer-unavailable')).toBeFalse();
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
