import { PeerContext } from './core/system/network/peer-context';
import { RoomAuth } from './room-auth';

describe('RoomAuth V3 mesh lock', () => {
  const roomId = 'Ab1';
  const display = '普通房間7685';
  const passwords = { gm: 'abc', user: 'def', guest: 'ghi' };

  it('encodes mesh lock when all enabled roles have passwords', () => {
    const { roomName, meshPassword } = RoomAuth.encode(display, roomId, passwords);
    expect(RoomAuth.isRoleAuthRoom(roomName)).toBeTrue();
    expect(RoomAuth.isMeshLocked(roomName)).toBeTrue();
    expect(RoomAuth.displayRoomName(roomName)).toBe(display);
    expect(meshPassword.length).toBeGreaterThan(0);
  });

  it('roundtrips mesh password for each role', () => {
    const { roomName, meshPassword } = RoomAuth.encode(display, roomId, passwords);
    for (const role of ['gm', 'user', 'guest'] as const) {
      expect(RoomAuth.verify(roomId, roomName, role, passwords[role])).toBeTrue();
      expect(RoomAuth.resolveMeshPassword(roomId, roomName, role, passwords[role])).toBe(meshPassword);
    }
    expect(RoomAuth.resolveMeshPassword(roomId, roomName, 'user', 'wrong')).not.toBe(meshPassword);
  });

  it('keeps peerId within SkyWay length for typical CJK + 3 passwords', () => {
    const { roomName, meshPassword } = RoomAuth.encode(display, roomId, passwords);
    const peer = PeerContext.create('testUserId01', roomId, roomName, meshPassword);
    expect(peer.peerId.length).toBeLessThanOrEqual(64);
    expect(peer.roomName).toBe(roomName);
    expect(peer.meshPassword).toBe(meshPassword);
    expect(peer.channelPassword).toBe(meshPassword);
    expect(peer.password).toBe('');
  });

  it('does not mesh-lock when any enabled role is open', () => {
    const { roomName, meshPassword } = RoomAuth.encode(display, roomId, {
      gm: 'abc',
      user: '',
      guest: { mode: 'disabled' },
    });
    expect(RoomAuth.isMeshLocked(roomName)).toBeFalse();
    expect(meshPassword).toBe('');
  });

  it('is deterministic for the same inputs', () => {
    const a = RoomAuth.encode(display, roomId, passwords);
    const b = RoomAuth.encode(display, roomId, passwords);
    expect(a.roomName).toBe(b.roomName);
    expect(a.meshPassword).toBe(b.meshPassword);
  });
});
