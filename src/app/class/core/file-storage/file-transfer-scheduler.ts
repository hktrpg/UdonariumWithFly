import { AudioState } from './audio-file';
import {
  FileSyncPriorityTier,
  clearPlayingMusicCache,
  compareFileSyncPriority,
  collectPlayingMusicIdentifiers,
  fileSyncPriorityTier,
  primePlayingMusicCache,
} from './file-sync-priority';
import { ImageState } from './image-file';
import { PdfState } from './pdf-file';
import { VideoState } from './video-file';
import { EventSystem, Network } from '../system';
import { clearZeroTimeout, setZeroTimeout } from '../system/util/zero-timeout';

export type FileResourceKind = 'image' | 'audio' | 'pdf' | 'video';

/** Catalog metadata exchanged during SYNCHRONIZE_* (byteSize optional for backward compat). */
export interface TransferCatalogMeta {
  readonly identifier: string;
  readonly state: number;
  readonly byteSize?: number;
  readonly thumbBytes?: number;
}

interface PendingReceiveRequest {
  kind: FileResourceKind;
  peerId: string;
  identifier: string;
  bytes: number;
  execute: () => void;
}

const DEFAULT_UNKNOWN_BYTES = 999_999_999;
const DEFAULT_THUMB_BYTES = 4_096;
/** Wait before re-requesting after a canceled/failed receive (avoids cancel loops). */
const RECEIVE_RETRY_BACKOFF_MS = 5_000;
const OUTBOUND_PENDING_TIMEOUT_MS = 30_000;

export class FileReceiveScheduler {
  private static readonly MAX_CONCURRENT_RECEIVES = 4;
  private static activeReceives = new Set<string>();
  /** Slots reserved when a REQUEST is sent, before START_*_TRANSMISSION arrives. */
  private static outboundPending = new Set<string>();
  private static pending: PendingReceiveRequest[] = [];
  private static scheduleTimer: number | null = null;
  private static peerRetryTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private static receiveRetryAfter = new Map<string, number>();
  private static networkHooksRegistered = false;
  private static playingMusicPriorityKey = '';

  static ensureNetworkHooks(): void {
    if (FileReceiveScheduler.networkHooksRegistered) return;
    FileReceiveScheduler.networkHooksRegistered = true;
    EventSystem.register(FileReceiveScheduler)
      .on('CONNECT_PEER', () => {
        FileReceiveScheduler.clearPeerRetryTimers();
        FileReceiveScheduler.schedule();
      })
      // Inbound apply uses markForChanged → identifier/aliasName events (not plain UPDATE_GAME_OBJECT).
      .on('UPDATE_GAME_OBJECT/identifier/Jukebox', () => {
        FileReceiveScheduler.onPlayingMusicMaybeChanged();
      })
      .on('UPDATE_GAME_OBJECT/aliasName/jukebox', () => {
        FileReceiveScheduler.onPlayingMusicMaybeChanged();
      })
      .on('UPDATE_GAME_OBJECT', event => {
        if (event.data?.identifier !== 'Jukebox') return;
        FileReceiveScheduler.onPlayingMusicMaybeChanged();
      });
  }

  /** Re-sort pending downloads when room jukebox playing ids change. */
  private static onPlayingMusicMaybeChanged(): void {
    const key = [...collectPlayingMusicIdentifiers()].sort().join('\0');
    if (key === FileReceiveScheduler.playingMusicPriorityKey) return;
    FileReceiveScheduler.playingMusicPriorityKey = key;
    if (FileReceiveScheduler.pending.length < 1) return;
    // Refresh diagnostic log so PLAYING_AUDIO appears after late jukebox sync.
    FileReceiveScheduler.loggedReceiveKeys.clear();
    FileReceiveScheduler.scheduleDeferred();
  }

  private static clearPeerRetryTimers() {
    for (const timer of FileReceiveScheduler.peerRetryTimers.values()) clearTimeout(timer);
    FileReceiveScheduler.peerRetryTimers.clear();
  }

  private static isPeerOpen(peerId: string): boolean {
    return !!peerId && Network.peerIds.includes(peerId);
  }

  private static schedulePeerRetry(peerId: string) {
    if (FileReceiveScheduler.peerRetryTimers.has(peerId)) return;
    FileReceiveScheduler.peerRetryTimers.set(peerId, setTimeout(() => {
      FileReceiveScheduler.peerRetryTimers.delete(peerId);
      FileReceiveScheduler.schedule();
    }, 400));
  }

  static isTransferActive(kind: FileResourceKind, identifier: string): boolean {
    const key = FileReceiveScheduler.receiveKey(kind, identifier);
    return FileReceiveScheduler.activeReceives.has(key) || FileReceiveScheduler.outboundPending.has(key);
  }

  static canEnqueueReceive(kind: FileResourceKind, identifier: string): boolean {
    if (FileReceiveScheduler.isTransferActive(kind, identifier)) return false;
    const key = FileReceiveScheduler.receiveKey(kind, identifier);
    return performance.now() >= (FileReceiveScheduler.receiveRetryAfter.get(key) ?? 0);
  }

  static noteReceiveEnded(kind: FileResourceKind, identifier: string, success: boolean): void {
    const key = FileReceiveScheduler.receiveKey(kind, identifier);
    if (success) {
      FileReceiveScheduler.receiveRetryAfter.delete(key);
      return;
    }
    FileReceiveScheduler.receiveRetryAfter.set(key, performance.now() + RECEIVE_RETRY_BACKOFF_MS);
  }

  static receiveKey(kind: FileResourceKind, identifier: string): string {
    return `${kind}:${identifier}`;
  }

  static activeReceiveCount(): number {
    return FileReceiveScheduler.activeReceives.size;
  }

  static pendingReceiveCount(): number {
    return FileReceiveScheduler.pending.length;
  }

  static outboundPendingCount(): number {
    return FileReceiveScheduler.outboundPending.size;
  }

  static isTransferPending(kind: FileResourceKind, identifier: string): boolean {
    const key = FileReceiveScheduler.receiveKey(kind, identifier);
    return FileReceiveScheduler.pending.some(
      p => FileReceiveScheduler.receiveKey(p.kind, p.identifier) === key,
    );
  }

  static hasFileSyncActivity(): boolean {
    return FileReceiveScheduler.activeReceives.size > 0
      || FileReceiveScheduler.outboundPending.size > 0
      || FileReceiveScheduler.pending.length > 0;
  }

  private static reservedReceiveCount(): number {
    return FileReceiveScheduler.activeReceives.size + FileReceiveScheduler.outboundPending.size;
  }

  static isReceiveBudgetFull(): boolean {
    return FileReceiveScheduler.reservedReceiveCount() >= FileReceiveScheduler.MAX_CONCURRENT_RECEIVES;
  }

  static markReceiveStart(kind: FileResourceKind, identifier: string): void {
    const key = FileReceiveScheduler.receiveKey(kind, identifier);
    FileReceiveScheduler.outboundPending.delete(key);
    FileReceiveScheduler.activeReceives.add(key);
  }

  static markReceiveEnd(kind: FileResourceKind, identifier: string): void {
    const key = FileReceiveScheduler.receiveKey(kind, identifier);
    FileReceiveScheduler.outboundPending.delete(key);
    FileReceiveScheduler.activeReceives.delete(key);
    FileReceiveScheduler.schedule();
  }

  /** REQUEST never left the client (e.g. peer DataChannel not open yet). */
  static abortOutboundRequest(kind: FileResourceKind, identifier: string): void {
    FileReceiveScheduler.outboundPending.delete(FileReceiveScheduler.receiveKey(kind, identifier));
    FileReceiveScheduler.scheduleDeferred();
  }

  /** Queue a download request; thumbs → playing BGM → full images → other media by size. */
  static enqueueReceiveRequest(
    kind: FileResourceKind,
    peerId: string,
    identifier: string,
    bytes: number,
    execute: () => void
  ): void {
    FileReceiveScheduler.ensureNetworkHooks();
    const key = FileReceiveScheduler.receiveKey(kind, identifier);
    if (!FileReceiveScheduler.canEnqueueReceive(kind, identifier)) return;
    FileReceiveScheduler.pending = FileReceiveScheduler.pending.filter(
      p => FileReceiveScheduler.receiveKey(p.kind, p.identifier) !== key
    );
    FileReceiveScheduler.pending.push({ kind, peerId, identifier, bytes, execute });
    FileReceiveScheduler.scheduleDeferred();
  }

  /** Coalesce enqueue bursts (e.g. image + audio + pdf sync) into one priority-ordered dispatch. */
  static scheduleDeferred(): void {
    if (FileReceiveScheduler.scheduleTimer != null) return;
    FileReceiveScheduler.scheduleTimer = setZeroTimeout(() => {
      FileReceiveScheduler.scheduleTimer = null;
      FileReceiveScheduler.schedule();
    });
  }

  static schedule(): void {
    primePlayingMusicCache();
    try {
      FileReceiveScheduler.pending.sort((a, b) => compareFileSyncPriority(
        a.kind, a.identifier, a.bytes,
        b.kind, b.identifier, b.bytes,
      ));
      FileReceiveScheduler.yieldHigherTiersForPhase();
      FileReceiveScheduler.logReceiveQueueOrderOnce();
      while (!FileReceiveScheduler.isReceiveBudgetFull() && FileReceiveScheduler.pending.length > 0) {
        const phase = FileReceiveScheduler.lowestActivePhaseTier();
        const nextIndex = FileReceiveScheduler.pending.findIndex(
          p => fileSyncPriorityTier(p.kind, p.identifier) === phase
            && !FileReceiveScheduler.outboundPending.has(FileReceiveScheduler.receiveKey(p.kind, p.identifier))
            && !FileReceiveScheduler.activeReceives.has(FileReceiveScheduler.receiveKey(p.kind, p.identifier))
            && FileReceiveScheduler.isPeerOpen(p.peerId)
        );
        if (nextIndex < 0) {
          const waitingPeer = FileReceiveScheduler.pending.find(
            p => fileSyncPriorityTier(p.kind, p.identifier) === phase
              && !FileReceiveScheduler.isPeerOpen(p.peerId)
              && !FileReceiveScheduler.outboundPending.has(FileReceiveScheduler.receiveKey(p.kind, p.identifier))
              && !FileReceiveScheduler.activeReceives.has(FileReceiveScheduler.receiveKey(p.kind, p.identifier))
          );
          if (waitingPeer) FileReceiveScheduler.schedulePeerRetry(waitingPeer.peerId);
          break;
        }
        const next = FileReceiveScheduler.pending.splice(nextIndex, 1)[0];
        const key = FileReceiveScheduler.receiveKey(next.kind, next.identifier);
        FileReceiveScheduler.outboundPending.add(key);
        setTimeout(() => {
          if (FileReceiveScheduler.outboundPending.delete(key)) {
            FileReceiveScheduler.schedule();
          }
        }, OUTBOUND_PENDING_TIMEOUT_MS);
        next.execute();
      }
    } finally {
      clearPlayingMusicCache();
    }
  }

  /** Lowest priority tier still waiting or in flight — higher tiers must wait. */
  private static lowestActivePhaseTier(): FileSyncPriorityTier {
    let min = FileSyncPriorityTier.DEFAULT;
    let found = false;
    const consider = (tier: FileSyncPriorityTier) => {
      found = true;
      if (tier < min) min = tier;
    };
    for (const p of FileReceiveScheduler.pending) {
      consider(fileSyncPriorityTier(p.kind, p.identifier));
    }
    for (const key of FileReceiveScheduler.activeReceives) {
      consider(FileReceiveScheduler.tierForReceiveKey(key));
    }
    for (const key of FileReceiveScheduler.outboundPending) {
      consider(FileReceiveScheduler.tierForReceiveKey(key));
    }
    return found ? min : FileSyncPriorityTier.DEFAULT;
  }

  private static tierForReceiveKey(key: string): FileSyncPriorityTier {
    const colon = key.indexOf(':');
    if (colon < 1) return FileSyncPriorityTier.DEFAULT;
    const kind = key.slice(0, colon) as FileResourceKind;
    const id = key.slice(colon + 1);
    return fileSyncPriorityTier(kind, id);
  }

  /**
   * If a lower-tier file is still pending (e.g. thumb / playing BGM just appeared),
   * drop higher-tier outbound reservations so the lower tier can take slots.
   */
  private static yieldHigherTiersForPhase(): void {
    if (FileReceiveScheduler.pending.length < 1) return;
    let pendingMin = FileSyncPriorityTier.DEFAULT;
    for (const p of FileReceiveScheduler.pending) {
      const tier = fileSyncPriorityTier(p.kind, p.identifier);
      if (tier < pendingMin) pendingMin = tier;
    }
    for (const key of [...FileReceiveScheduler.outboundPending]) {
      if (FileReceiveScheduler.tierForReceiveKey(key) > pendingMin) {
        FileReceiveScheduler.outboundPending.delete(key);
      }
    }
  }

  private static loggedReceiveKeys = new Set<string>();

  /**
   * Log pending receive order only when new file(s) enter the queue.
   * Shrinking the queue (dispatch progress) must not re-log 73→72→71…
   */
  private static logReceiveQueueOrderOnce(): void {
    if (FileReceiveScheduler.pending.length < 1) {
      FileReceiveScheduler.loggedReceiveKeys.clear();
      return;
    }
    let hasNew = false;
    for (const p of FileReceiveScheduler.pending) {
      const key = FileReceiveScheduler.receiveKey(p.kind, p.identifier);
      if (!FileReceiveScheduler.loggedReceiveKeys.has(key)) {
        hasNew = true;
        break;
      }
    }
    if (!hasNew) return;
    for (const p of FileReceiveScheduler.pending) {
      FileReceiveScheduler.loggedReceiveKeys.add(
        FileReceiveScheduler.receiveKey(p.kind, p.identifier),
      );
    }
    const rows = FileReceiveScheduler.pending.map((p, index) => ({
      order: index + 1,
      tier: FileSyncPriorityTier[fileSyncPriorityTier(p.kind, p.identifier)],
      kind: p.kind,
      id: p.identifier,
      bytes: p.bytes,
      size: formatByteSize(p.bytes),
    }));
    console.log(`[file-sync] receive order (${rows.length} file(s))`, rows);
  }

  /** @internal Test helper — clears queued transfers between specs. */
  static resetForTests(): void {
    EventSystem.unregister(FileReceiveScheduler);
    FileReceiveScheduler.networkHooksRegistered = false;
    FileReceiveScheduler.activeReceives.clear();
    FileReceiveScheduler.outboundPending.clear();
    FileReceiveScheduler.pending = [];
    FileReceiveScheduler.receiveRetryAfter.clear();
    FileReceiveScheduler.playingMusicPriorityKey = '';
    FileReceiveScheduler.loggedReceiveKeys.clear();
    FileReceiveScheduler.clearPeerRetryTimers();
    if (FileReceiveScheduler.scheduleTimer != null) {
      clearZeroTimeout(FileReceiveScheduler.scheduleTimer);
      FileReceiveScheduler.scheduleTimer = null;
    }
  }

  static sortByNextReceiveBytes<T extends TransferCatalogMeta>(
    kind: FileResourceKind,
    items: T[],
    localStateFor: (item: T) => number
  ): T[] {
    primePlayingMusicCache();
    try {
      return items.slice().sort((a, b) => {
        const bytesA = estimateNextReceiveBytes(kind, localStateFor(a), a);
        const bytesB = estimateNextReceiveBytes(kind, localStateFor(b), b);
        return compareFileSyncPriority(kind, a.identifier, bytesA, kind, b.identifier, bytesB);
      });
    } finally {
      clearPlayingMusicCache();
    }
  }
}

export function estimateNextReceiveBytes(
  kind: FileResourceKind,
  localState: number,
  meta: TransferCatalogMeta
): number {
  if (kind === 'image') {
    if (localState < ImageState.THUMBNAIL) {
      return meta.thumbBytes ?? meta.byteSize ?? DEFAULT_THUMB_BYTES;
    }
    return meta.byteSize ?? meta.thumbBytes ?? DEFAULT_THUMB_BYTES;
  }
  if (kind === 'audio' && localState >= AudioState.COMPLETE) return 0;
  if (kind === 'pdf' && localState >= PdfState.COMPLETE) return 0;
  if (kind === 'video' && localState >= VideoState.COMPLETE) return 0;
  return meta.byteSize ?? DEFAULT_UNKNOWN_BYTES;
}

export function catalogByteSize(blob: Blob | null | undefined, fallback = 0): number {
  return blob?.size ?? fallback;
}

function formatByteSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '?';
  if (bytes >= DEFAULT_UNKNOWN_BYTES) return 'unknown';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}
