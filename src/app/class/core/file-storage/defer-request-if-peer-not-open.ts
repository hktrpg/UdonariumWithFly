import { Network } from '../system';
import { meshWarnThrottled, netDebug } from '../system/network/net-debug';
import { FileReceiveScheduler, FileResourceKind } from './file-transfer-scheduler';

/** Remesh delay when REQUEST is deferred because the peer DataChannel is not open. */
export const PEER_NOT_OPEN_LAZY_MS = 1500;

/**
 * If peer is not open, abort the outbound receive slot and schedule a remesh.
 * @returns true when deferred (caller must return); false when peer is open.
 */
export function deferRequestIfPeerNotOpen(
  kind: FileResourceKind,
  peerId: string,
  identifier: string | undefined,
  lazySynchronize: (ms: number, peer?: string) => void,
): boolean {
  if (Network.peerIds.includes(peerId)) return false;
  if (identifier) FileReceiveScheduler.abortOutboundRequest(kind, identifier);
  if (kind === 'image') {
    netDebug('image request deferred (peer not open)', peerId.slice(0, 16));
  } else {
    meshWarnThrottled(
      `${kind}-skip-${peerId.slice(0, 12)}`,
      `${kind} request skipped (peer not open)`,
      peerId.slice(0, 16),
    );
  }
  lazySynchronize(PEER_NOT_OPEN_LAZY_MS, peerId);
  return true;
}
