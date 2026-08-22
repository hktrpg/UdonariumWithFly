import { AudioState } from './audio-file';
import { AudioStorage } from './audio-storage';
import {
  estimateNextReceiveBytes,
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
  /** True only while file bytes are actively loading (hide when idle). */
  active: boolean;
  /** 0–100 loaded (starts at 0). */
  percentLoaded: number;
  segmentCount: number;
  filledSegments: number;
}

const BAR_SEGMENTS = 20;

interface ChunkProgress {
  loaded: number;
  total: number;
}

export class FileSyncProgress {
  private static readonly transfers = new Map<string, ChunkProgress>();

  static reset(): void {
    FileSyncProgress.transfers.clear();
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

    if (!FileSyncProgress.isActivelyLoading()) {
      return idle;
    }

    const work = FileSyncProgress.measureActiveFileWork();
    if (work.totalBytes < 1) {
      const ratio = FileSyncProgress.chunkOnlyRatio();
      if (ratio == null) return idle;
      const percentLoaded = Math.round(ratio * 100);
      const filledSegments = Math.round(ratio * segmentCount);
      return {
        active: true,
        percentLoaded,
        segmentCount,
        filledSegments: Math.max(0, Math.min(segmentCount, filledSegments)),
      };
    }

    const ratio = Math.max(0, Math.min(1, (work.totalBytes - work.remainingBytes) / work.totalBytes));
    const percentLoaded = Math.round(ratio * 100);
    const filledSegments = Math.round(ratio * segmentCount);

    return {
      active: true,
      percentLoaded,
      segmentCount,
      filledSegments: Math.max(0, Math.min(segmentCount, filledSegments)),
    };
  }

  /** True when file bytes are moving (not merely queued). */
  private static isActivelyLoading(): boolean {
    if (FileSyncProgress.transfers.size > 0) return true;
    if (FileReceiveScheduler.activeReceiveCount() > 0) return true;
    return false;
  }

  private static chunkOnlyRatio(): number | null {
    if (FileSyncProgress.transfers.size < 1) return null;
    let sum = 0;
    for (const chunk of FileSyncProgress.transfers.values()) {
      sum += (chunk.loaded + 1) / chunk.total;
    }
    return sum / FileSyncProgress.transfers.size;
  }

  private static isSyncing(kind: FileResourceKind, identifier: string): boolean {
    if (FileSyncProgress.transfers.has(identifier)) return true;
    return FileReceiveScheduler.isTransferActive(kind, identifier);
  }

  private static measureActiveFileWork(): { totalBytes: number; remainingBytes: number } {
    let totalBytes = 0;
    let remainingBytes = 0;

    const add = (kind: FileResourceKind, localState: number, meta: TransferCatalogMeta) => {
      if (!FileSyncProgress.isSyncing(kind, meta.identifier)) return;
      const estimate = estimateNextReceiveBytes(kind, localState, meta);
      if (estimate <= 0) return;
      totalBytes += estimate;
      const chunk = FileSyncProgress.transfers.get(meta.identifier);
      if (chunk && chunk.total > 0) {
        const doneRatio = Math.max(0, Math.min(1, (chunk.loaded + 1) / chunk.total));
        remainingBytes += estimate * (1 - doneRatio);
      } else {
        remainingBytes += estimate;
      }
    };

    for (const image of ImageStorage.instance.images) {
      if (image.state >= ImageState.COMPLETE) continue;
      add('image', image.state, {
        identifier: image.identifier,
        state: image.state,
        byteSize: image.blob?.size,
        thumbBytes: image.thumbnail?.blob?.size,
      });
    }
    for (const audio of AudioStorage.instance.audios) {
      if (audio.state >= AudioState.COMPLETE) continue;
      add('audio', audio.state, {
        identifier: audio.identifier,
        state: audio.state,
        byteSize: audio.blob?.size,
      });
    }
    for (const pdf of PdfStorage.instance.pdfs) {
      if (pdf.state >= PdfState.COMPLETE) continue;
      add('pdf', pdf.state, {
        identifier: pdf.identifier,
        state: pdf.state,
        byteSize: pdf.blob?.size,
      });
    }
    for (const video of VideoStorage.instance.videos) {
      if (video.state >= VideoState.COMPLETE) continue;
      add('video', video.state, {
        identifier: video.identifier,
        state: video.state,
        byteSize: video.blob?.size,
      });
    }

    return { totalBytes, remainingBytes };
  }
}
