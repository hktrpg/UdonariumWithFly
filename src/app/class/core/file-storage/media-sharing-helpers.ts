import { Network } from '../system';

export const DEFAULT_MAX_SEND_TASKS = 2;

/** Outbound transfer map key: peerId:mediaId */
export function mediaSendTaskKey(sendTo: string, identifier: string): string {
  return `${sendTo}:${identifier}`;
}

/** Peers that may relay REQUEST_* (room members + currently open DataChannels). */
export function meshCandidatePeerIds(): string[] {
  const ids = new Set<string>();
  for (const id of Network.listRoomMemberPeerIds()) {
    if (id && id !== Network.peerId) ids.add(id);
  }
  for (const id of Network.peerIds) ids.add(id);
  return Array.from(ids);
}

export function hasActiveMediaTasks(sendCount: number, receiveCount: number): boolean {
  return sendCount > 0 || receiveCount > 0;
}

export function isSendTaskLimitReached(
  sendCount: number,
  maxSend: number = DEFAULT_MAX_SEND_TASKS,
): boolean {
  return maxSend <= sendCount;
}
