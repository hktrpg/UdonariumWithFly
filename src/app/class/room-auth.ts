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
 *
 * Markers:
 * - \u2060A — legacy (7-hex digests)
 * - \u2060B — compact (4-hex digests) — used for new rooms to keep peerId short
 */
export class RoomAuth {
  static readonly AUTH_MARKER = '\u2060A';
  static readonly AUTH_MARKER_V2 = '\u2060B';
  private static readonly DIGEST_LEN = 7;
  private static readonly DIGEST_LEN_V2 = 3;

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
    // Compact marker keeps peerId under SkyWay length limits more reliably.
    return clean + RoomAuth.AUTH_MARKER_V2 + blob;
  }

  static parse(roomName: string): RoomAuthInfo {
    const empty: RoomAuthInfo = {
      isRoleAuth: false,
      gm: { mode: 'open', digest: '' },
      user: { mode: 'open', digest: '' },
      guest: { mode: 'disabled', digest: '' },
    };
    const markerInfo = RoomAuth.detectMarker(roomName);
    if (!markerInfo) {
      // Legacy: guest allowed via GuestSession marker.
      if (GuestSession.isAllowGuestRoomName(roomName)) {
        empty.guest = { mode: 'open', digest: '' };
      }
      return empty;
    }
    const blob = roomName.slice(markerInfo.index + markerInfo.marker.length);
    let i = 0;
    const gm = RoomAuth.readGate(blob, i, markerInfo.digestLen); i = gm.next;
    const user = RoomAuth.readGate(blob, i, markerInfo.digestLen); i = user.next;
    const guest = RoomAuth.readGate(blob, i, markerInfo.digestLen);
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
    const markerInfo = RoomAuth.detectMarker(name);
    if (markerInfo) name = name.slice(0, markerInfo.index);
    return GuestSession.displayRoomName(name);
  }

  static isRoleAuthRoom(roomName: string): boolean {
    return !!RoomAuth.detectMarker(roomName);
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
    const markerInfo = RoomAuth.detectMarker(roomName);
    const digestLen = markerInfo ? markerInfo.digestLen : RoomAuth.DIGEST_LEN_V2;
    return RoomAuth.calcDigest(roomId, display, role, password || '', digestLen) === gate.digest;
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

  private static detectMarker(roomName: string): { marker: string; digestLen: number; index: number } | null {
    if (!roomName) return null;
    const idxV2 = roomName.indexOf(RoomAuth.AUTH_MARKER_V2);
    const idxV1 = roomName.indexOf(RoomAuth.AUTH_MARKER);
    if (idxV2 >= 0 && (idxV1 < 0 || idxV2 < idxV1)) {
      return { marker: RoomAuth.AUTH_MARKER_V2, digestLen: RoomAuth.DIGEST_LEN_V2, index: idxV2 };
    }
    if (idxV1 >= 0) {
      return { marker: RoomAuth.AUTH_MARKER, digestLen: RoomAuth.DIGEST_LEN, index: idxV1 };
    }
    return null;
  }

  private static sanitizeDisplayName(name: string): string {
    return name
      .split(RoomAuth.AUTH_MARKER_V2).join('')
      .split(RoomAuth.AUTH_MARKER).join('')
      .split(GuestSession.ALLOW_GUEST_MARKER).join('')
      .trim() || translate('room.defaultName');
  }

  private static encodeGate(roomId: string, display: string, role: RoomRole, password: string): string {
    // Empty string = open (no password). All three roles are always available on new rooms.
    if (!password) return '*';
    return '1' + RoomAuth.calcDigest(roomId, display, role, password, RoomAuth.DIGEST_LEN_V2);
  }

  private static readGate(blob: string, start: number, digestLen: number): { gate: RoleGate; next: number } {
    if (start >= blob.length) return { gate: { mode: 'disabled', digest: '' }, next: start };
    const flag = blob.charAt(start);
    if (flag === '*') return { gate: { mode: 'open', digest: '' }, next: start + 1 };
    if (flag === '0') return { gate: { mode: 'disabled', digest: '' }, next: start + 1 };
    if (flag === '1') {
      const digest = blob.slice(start + 1, start + 1 + digestLen);
      return { gate: { mode: 'password', digest }, next: start + 1 + digestLen };
    }
    return { gate: { mode: 'disabled', digest: '' }, next: start + 1 };
  }

  private static calcDigest(roomId: string, displayName: string, role: RoomRole, password: string, digestLen: number): string {
    return CryptoUtil.sha256Hex(`${role}\n${roomId}\n${displayName}\n${password}`).slice(0, digestLen);
  }
}
