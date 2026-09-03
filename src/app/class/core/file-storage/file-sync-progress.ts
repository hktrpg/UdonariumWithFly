import { AudioState } from './audio-file';
import { AudioStorage } from './audio-storage';
import {
  FileReceiveScheduler,
  FileResourceKind,
  TransferCatalogMeta,
} from './file-transfer-scheduler';
import { ImageState } from './image-file';
import { ImageStorage } from './image-storage';
import { PdfState } from './pdf-file';
import { PdfStorage } from './pdf-storage';
import { VideoState } from './video-file';
import { VideoStorage } from './video-storage';

export interface FileSyncProgressSnapshot {
  /** True while room file sync is in progress (or briefly at 100% before hide). */
  active: boolean;
  /** 0–100 loaded (monotonic within a session). */
  percentLoaded: number;
  segmentCount: number;
  filledSegments: number;
}

const BAR_SEGMENTS = 20;
/** Keep the bar at 100% briefly so the user sees completion before hide. */
const SESSION_COMPLETE_HOLD_MS = 800;

interface ChunkProgress {
  loaded: number;
  total: number;
}

export class FileSyncProgress {
  private static readonly transfers = new Map<string, ChunkProgress>();
  private static prevIncompleteKeys = new Set<string>();
  private static completedFileCount = 0;
  private static displayPercent = 0;
  private static sessionStarted = false;
  private static sessionEndAt: number | null = null;

  static reset(): void {
    FileSyncProgress.transfers.clear();
    FileSyncProgress.prevIncompleteKeys.clear();
    FileSyncProgress.completedFileCount = 0;
    FileSyncProgress.displayPercent = 0;
    FileSyncProgress.sessionStarted = false;
    FileSyncProgress.sessionEndAt = null;
  }

  static noteChunkProgress(identifier: string, loaded: number, total: number): void {
    if (!identifier || total < 1) return;
    FileSyncProgress.transfers.set(identifier, { loaded, total });
  }

  static clearTransfer(identifier: string): void {
    if (!identifier) return;
    FileSyncProgress.transfers.delete(identifier);
  }

  static snapshot(segmentCount: number = BAR_SEGMENTS): FileSyncProgressSnapshot {
    const idle: FileSyncProgressSnapshot = {
      active: false,
      percentLoaded: 0,
      segmentCount,
      filledSegments: 0,
    };

    FileSyncProgress.updateSession();

    if (FileSyncProgress.sessionEndAt != null) {
      if (performance.now() - FileSyncProgress.sessionEndAt < SESSION_COMPLETE_HOLD_MS) {
        return FileSyncProgress.buildSnapshot(100, segmentCount);
      }
      FileSyncProgress.resetSessionState();
      return idle;
    }

    if (!FileSyncProgress.sessionStarted) {
      return idle;
    }

    const percentLoaded = Math.round(FileSyncProgress.displayPercent * 100);
    return FileSyncProgress.buildSnapshot(percentLoaded, segmentCount);
  }

  private static buildSnapshot(percentLoaded: number, segmentCount: number): FileSyncProgressSnapshot {
    const clamped = Math.max(0, Math.min(100, percentLoaded));
    const ratio = clamped / 100;
    const filledSegments = Math.round(ratio * segmentCount);
    return {
      active: true,
      percentLoaded: clamped,
      segmentCount,
      filledSegments: Math.max(0, Math.min(segmentCount, filledSegments)),
    };
  }

  private static resetSessionState(): void {
    FileSyncProgress.prevIncompleteKeys.clear();
    FileSyncProgress.completedFileCount = 0;
    FileSyncProgress.displayPercent = 0;
    FileSyncProgress.sessionStarted = false;
    FileSyncProgress.sessionEndAt = null;
  }

  private static updateSession(): void {
    const incompleteKeys = FileSyncProgress.collectIncompleteKeys();

    for (const key of FileSyncProgress.prevIncompleteKeys) {
      if (!incompleteKeys.has(key)) {
        FileSyncProgress.completedFileCount++;
      }
    }
    FileSyncProgress.prevIncompleteKeys = incompleteKeys;

    if (incompleteKeys.size > 0) {
      FileSyncProgress.sessionStarted = true;
      FileSyncProgress.sessionEndAt = null;
      FileSyncProgress.displayPercent = Math.max(
        FileSyncProgress.displayPercent,
        FileSyncProgress.measureSessionRatio(incompleteKeys),
      );
      return;
    }

    if (FileSyncProgress.sessionStarted && FileSyncProgress.sessionEndAt == null) {
      FileSyncProgress.sessionEndAt = performance.now();
      FileSyncProgress.displayPercent = 1;
    }
  }

  private static measureSessionRatio(incompleteKeys: Set<string>): number {
    const incompleteCount = incompleteKeys.size;
    const total = FileSyncProgress.completedFileCount + incompleteCount;
    if (total < 1) return 0;

    let inFlight = 0;
    for (const key of incompleteKeys) {
      const sep = key.indexOf(':');
      const kind = key.slice(0, sep) as FileResourceKind;
      const identifier = key.slice(sep + 1);
      const chunk = FileSyncProgress.transfers.get(identifier);
      if (chunk && chunk.total > 0) {
        inFlight += (chunk.loaded + 1) / chunk.total;
        continue;
      }
      if (FileReceiveScheduler.isTransferActive(kind, identifier)) {
        inFlight += 0.02;
        continue;
      }
      if (FileReceiveScheduler.isTransferPending(kind, identifier)) {
        // Queued but not started yet — avoid a long stuck-at-0% gap after join.
        inFlight += 0.01;
        continue;
      }
      inFlight += FileSyncProgress.partialLocalCredit(kind, identifier);
    }
    inFlight = Math.min(inFlight, incompleteCount);

    return Math.max(0, Math.min(1, (FileSyncProgress.completedFileCount + inFlight) / total));
  }

  /**
   * Credit already-usable local state (e.g. image thumbnail on screen while full
   * blob is still downloading). Without this, visible thumbs still report 0%.
   */
  private static partialLocalCredit(kind: FileResourceKind, identifier: string): number {
    if (kind !== 'image') return 0;
    // Prefer `images` (same source as collectIncompleteKeys) so progress matches
    // what the bar is counting — including test doubles that only mock `images`.
    const image = ImageStorage.instance.images.find(i => i.identifier === identifier)
      ?? ImageStorage.instance.get(identifier);
    if (!image) return 0;
    if (image.state >= ImageState.THUMBNAIL) return 0.35;
    return 0;
  }

  private static collectIncompleteKeys(): Set<string> {
    const keys = new Set<string>();

    const add = (kind: FileResourceKind, completeState: number, localState: number, meta: TransferCatalogMeta) => {
      if (localState >= completeState) return;
      keys.add(`${kind}:${meta.identifier}`);
    };

    for (const image of ImageStorage.instance.images) {
      add('image', ImageState.COMPLETE, image.state, {
        identifier: image.identifier,
        state: image.state,
        byteSize: image.blob?.size,
        thumbBytes: image.thumbnail?.blob?.size,
      });
    }
    for (const audio of AudioStorage.instance.audios) {
      add('audio', AudioState.COMPLETE, audio.state, {
        identifier: audio.identifier,
        state: audio.state,
        byteSize: audio.blob?.size,
      });
    }
    for (const pdf of PdfStorage.instance.pdfs) {
      add('pdf', PdfState.COMPLETE, pdf.state, {
        identifier: pdf.identifier,
        state: pdf.state,
        byteSize: pdf.blob?.size,
      });
    }
    for (const video of VideoStorage.instance.videos) {
      add('video', VideoState.COMPLETE, video.state, {
        identifier: video.identifier,
        state: video.state,
        byteSize: video.blob?.size,
      });
    }

    return keys;
  }
}
