import { CryptoUtil } from './core/system/util/crypto-util';
import { EventSystem } from './core/system';
import { GuestSession } from './guest-session';
import { PeerCursor } from './peer-cursor';
import { translate } from 'i18n';

/** Join / create identity. */
export type RoomRole = 'gm' | 'user' | 'guest';

export type RoleGateMode = 'open' | 'password' | 'disabled';

export interface RoleGate {
  mode: RoleGateMode;
  digest: string;
}

export interface RoomAuthInfo {
  /** True when room uses GM/User/Guest password gates (new format). */
  isRoleAuth: boolean;
  gm: RoleGate;
  user: RoleGate;
  guest: RoleGate;
}

export interface RoomJoinResult {
  role: RoomRole;
  password: string;
}

/**
 * Role passwords are advertised as digests in the room name (like guest marker).
 * Network/skyway password stays empty for role-auth rooms so each role can have
 * an independent password (or none). Legacy single-password rooms are unchanged.
 */
export class RoomAuth {
  static readonly AUTH_MARKER = '\u2060A';
  private static readonly DIGEST_LEN = 7;

  static encode(
    displayName: string,
    roomId: string,
    passwords: { gm?: string; user?: string; guest?: string },
  ): string {
    const clean = RoomAuth.sanitizeDisplayName(displayName || translate('room.defaultName'));
    const blob =
      RoomAuth.encodeGate(roomId, clean, 'gm', passwords.gm) +
      RoomAuth.encodeGate(roomId, clean, 'user', passwords.user) +
      RoomAuth.encodeGate(roomId, clean, 'guest', passwords.guest);
    return clean + RoomAuth.AUTH_MARKER + blob;
  }

  static parse(roomName: string): RoomAuthInfo {
    const empty: RoomAuthInfo = {
      isRoleAuth: false,
      gm: { mode: 'open', digest: '' },
      user: { mode: 'open', digest: '' },
      guest: { mode: 'disabled', digest: '' },
    };
    if (!roomName || !roomName.includes(RoomAuth.AUTH_MARKER)) {
      // Legacy: guest allowed via GuestSession marker.
      if (GuestSession.isAllowGuestRoomName(roomName)) {
        empty.guest = { mode: 'open', digest: '' };
      }
      return empty;
    }
    const idx = roomName.indexOf(RoomAuth.AUTH_MARKER);
    const blob = roomName.slice(idx + RoomAuth.AUTH_MARKER.length);
    let i = 0;
    const gm = RoomAuth.readGate(blob, i); i = gm.next;
    const user = RoomAuth.readGate(blob, i); i = user.next;
    const guest = RoomAuth.readGate(blob, i);
    return {
      isRoleAuth: true,
      gm: gm.gate,
      user: user.gate,
      guest: guest.gate,
    };
  }

  static displayRoomName(roomName: string): string {
    if (!roomName) return roomName;
    let name = roomName;
    const authIdx = name.indexOf(RoomAuth.AUTH_MARKER);
    if (authIdx >= 0) name = name.slice(0, authIdx);
    return GuestSession.displayRoomName(name);
  }

  static isRoleAuthRoom(roomName: string): boolean {
    return !!roomName && roomName.includes(RoomAuth.AUTH_MARKER);
  }

  static isRoleAvailable(roomName: string, role: RoomRole): boolean {
    const info = RoomAuth.parse(roomName);
    if (!info.isRoleAuth) {
      if (role === 'guest') return GuestSession.isAllowGuestRoomName(roomName);
      if (role === 'user' || role === 'gm') return true;
      return false;
    }
    return info[role].mode !== 'disabled';
  }

  static roleNeedsPassword(roomName: string, role: RoomRole): boolean {
    const info = RoomAuth.parse(roomName);
    if (!info.isRoleAuth) return false;
    return info[role].mode === 'password';
  }

  static verify(roomId: string, roomName: string, role: RoomRole, password: string): boolean {
    const info = RoomAuth.parse(roomName);
    if (!info.isRoleAuth) return false;
    const gate = info[role];
    if (gate.mode === 'disabled') return false;
    if (gate.mode === 'open') return true;
    const display = RoomAuth.displayRoomName(roomName);
    return RoomAuth.calcDigest(roomId, display, role, password || '') === gate.digest;
  }

  static hasAnyRolePassword(roomName: string): boolean {
    const info = RoomAuth.parse(roomName);
    if (!info.isRoleAuth) return false;
    return [info.gm, info.user, info.guest].some(g => g.mode === 'password');
  }

  static applyIdentity(role: RoomRole) {
    GuestSession.isGuest = role === 'guest';
    if (!PeerCursor.myCursor) return;
    const wasGM = PeerCursor.myCursor.isGMMode;
    PeerCursor.isGMHold = false;
    PeerCursor.myCursor.isGMMode = role === 'gm';
    if (wasGM !== PeerCursor.myCursor.isGMMode) {
      EventSystem.trigger('CHANGE_GM_MODE', null);
    }
  }

  private static sanitizeDisplayName(name: string): string {
    return name
      .split(RoomAuth.AUTH_MARKER).join('')
      .split(GuestSession.ALLOW_GUEST_MARKER).join('')
      .trim() || translate('room.defaultName');
  }

  private static encodeGate(roomId: string, display: string, role: RoomRole, password: string): string {
    // Empty string = open (no password). All three roles are always available on new rooms.
    if (!password) return '*';
    return '1' + RoomAuth.calcDigest(roomId, display, role, password);
  }

  private static readGate(blob: string, start: number): { gate: RoleGate; next: number } {
    if (start >= blob.length) return { gate: { mode: 'disabled', digest: '' }, next: start };
    const flag = blob.charAt(start);
    if (flag === '*') return { gate: { mode: 'open', digest: '' }, next: start + 1 };
    if (flag === '0') return { gate: { mode: 'disabled', digest: '' }, next: start + 1 };
    if (flag === '1') {
      const digest = blob.slice(start + 1, start + 1 + RoomAuth.DIGEST_LEN);
      return { gate: { mode: 'password', digest }, next: start + 1 + RoomAuth.DIGEST_LEN };
    }
    return { gate: { mode: 'disabled', digest: '' }, next: start + 1 };
  }

  private static calcDigest(roomId: string, displayName: string, role: RoomRole, password: string): string {
    return CryptoUtil.sha256Hex(`${role}\n${roomId}\n${displayName}\n${password}`).slice(0, RoomAuth.DIGEST_LEN);
  }
}
