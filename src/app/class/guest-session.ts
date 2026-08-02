/**
 * HKTRPG guest session (local flags; not encoded into peerId).
 * allowGuest is advertised via a room-name marker so lobby can discover it
 * without changing skyway2023 PeerContext encoding.
 */
export class GuestSession {
  static readonly ALLOW_GUEST_MARKER = '\u2060G';

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
    return roomName.split(GuestSession.ALLOW_GUEST_MARKER).join('');
  }
}
