/** Last successful room open — used to rejoin after SkyWay fatal closes the peer. */
export type LastRoomSession = {
  userId: string;
  roomId: string;
  roomName: string;
  /** SkyWay channel password (mesh or legacy). */
  meshPassword: string;
};

/** Transient errors where auto-reopen is safe (not backend/auth config). */
export const RECOVERABLE_NETWORK_ERROR_TYPES = [
  'disconnected',
  'socket-error',
  'unavailable-id',
  /** SkyWay SDK: updateMemberTtl / restartIce / event lost after cable drop. */
  'internal',
  /** formatFatalError fallback when SDK name is missing. */
  'default',
] as const;

export function isRecoverableNetworkError(errorType: string): boolean {
  return (RECOVERABLE_NETWORK_ERROR_TYPES as readonly string[]).includes(errorType);
}
