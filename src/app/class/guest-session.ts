/**
 * HKTRPG guest session (local flags; not encoded into peerId).
 * allowGuest (legacy) is advertised via a room-name marker.
 * New rooms use RoomAuth (GM/User/Guest passwords) instead.
 */
export class GuestSession {
  static readonly ALLOW_GUEST_MARKER = '\u2060G';
  /** Legacy RoomAuth marker — strip for display. */
  static readonly AUTH_MARKER = '\u2060A';
  /** Compact RoomAuth marker — strip for display. */
  static readonly AUTH_MARKER_V2 = '\u2060B';

  /** True when this browser joined / acts as guest. */
  static isGuest: boolean = false;

  static GuestMode(): boolean {
    return GuestSession.isGuest;
  }

  static markAllowGuest(roomName: string): string {
    if (!roomName) return roomName;
    if (roomName.includes(GuestSession.ALLOW_GUEST_MARKER)) return roomName;
    return roomName + GuestSession.ALLOW_GUEST_MARKER;
  }

  static isAllowGuestRoomName(roomName: string): boolean {
    return !!roomName && roomName.includes(GuestSession.ALLOW_GUEST_MARKER);
  }

  static displayRoomName(roomName: string): string {
    if (!roomName) return roomName;
    let name = roomName;
    const idxA = name.indexOf(GuestSession.AUTH_MARKER);
    const idxB = name.indexOf(GuestSession.AUTH_MARKER_V2);
    let authIdx = -1;
    if (idxA >= 0 && idxB >= 0) authIdx = Math.min(idxA, idxB);
    else if (idxA >= 0) authIdx = idxA;
    else if (idxB >= 0) authIdx = idxB;
    if (authIdx >= 0) name = name.slice(0, authIdx);
    return name.split(GuestSession.ALLOW_GUEST_MARKER).join('');
  }
}
