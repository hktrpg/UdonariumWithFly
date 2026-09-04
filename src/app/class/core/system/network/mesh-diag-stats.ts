import { AudioState } from '@udonarium/core/file-storage/audio-file';
import { AudioStorage } from '@udonarium/core/file-storage/audio-storage';
import { FileSyncProgress } from '@udonarium/core/file-storage/file-sync-progress';
import {
  FileReceiveScheduler,
  catalogByteSize,
} from '@udonarium/core/file-storage/file-transfer-scheduler';
import { ImageState } from '@udonarium/core/file-storage/image-file';
import { ImageStorage } from '@udonarium/core/file-storage/image-storage';
import { PdfState } from '@udonarium/core/file-storage/pdf-file';
import { PdfStorage } from '@udonarium/core/file-storage/pdf-storage';
import { VideoState } from '@udonarium/core/file-storage/video-file';
import { VideoStorage } from '@udonarium/core/file-storage/video-storage';
import { ObjectStore } from '@udonarium/core/synchronize-object/object-store';

import { Network } from './network';

export type MediaKindStats = {
  complete: number;
  incomplete: number;
  bytes: number;
};

export type RoomMediaStats = {
  image: MediaKindStats;
  audio: MediaKindStats;
  pdf: MediaKindStats;
  video: MediaKindStats;
  totalBytes: number;
};

export type MeshLoadStats = {
  bandwidthUsageBytes: number;
  bandwidthPeakBytes: number;
  fileSyncPending: number;
  fileSyncActive: number;
  fileSyncOutbound: number;
  fileSyncHold: boolean;
  fileSyncProgressPercent: number;
  fileSyncPendingKnownBytes: number;
  fileSyncPendingUnknown: number;
  fileSyncPendingByKind: Record<string, number>;
  objectCount: number;
  joinInProgress?: boolean;
  reopenInFlight?: boolean;
  reconnecting?: boolean;
};

export type JoinDiagBits = {
  joinInProgress: boolean;
  reopenInFlight: boolean;
  reconnecting: boolean;
};

/** Avoid importing RoomConnectHelper here (cycle via net-debug). */
let joinDiagProvider: (() => JoinDiagBits) | null = null;

export function registerJoinDiagProvider(provider: (() => JoinDiagBits) | null): void {
  joinDiagProvider = provider;
}

/** Format bytes for mesh diag lines (KB/MB). */
export function formatDiagBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '?';
  if (bytes < 1024) return `${Math.round(bytes)}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)}MB`;
}

function emptyKind(): MediaKindStats {
  return { complete: 0, incomplete: 0, bytes: 0 };
}

/**
 * Local room media footprint (complete blob sizes + incomplete counts).
 * Catalog/URL-only assets are counted incomplete with 0 bytes.
 */
export function collectRoomMediaStats(): RoomMediaStats {
  const image = emptyKind();
  for (const img of ImageStorage.instance.images) {
    if (img.state === ImageState.COMPLETE) {
      image.complete++;
      image.bytes += catalogByteSize(img.blob, catalogByteSize(img.thumbnail?.blob));
    } else {
      image.incomplete++;
    }
  }

  const audio = emptyKind();
  for (const a of AudioStorage.instance.audios) {
    if (a.state === AudioState.COMPLETE) {
      audio.complete++;
      audio.bytes += catalogByteSize(a.blob);
    } else {
      audio.incomplete++;
    }
  }

  const pdf = emptyKind();
  for (const p of PdfStorage.instance.pdfs) {
    if (p.state === PdfState.COMPLETE) {
      pdf.complete++;
      pdf.bytes += catalogByteSize(p.blob);
    } else {
      pdf.incomplete++;
    }
  }

  const video = emptyKind();
  for (const v of VideoStorage.instance.videos) {
    if (v.state === VideoState.COMPLETE) {
      video.complete++;
      video.bytes += catalogByteSize(v.blob);
    } else {
      video.incomplete++;
    }
  }

  return {
    image,
    audio,
    pdf,
    video,
    totalBytes: image.bytes + audio.bytes + pdf.bytes + video.bytes,
  };
}

/** Current transfer / memory-ish load signals for bug reports. */
export function collectMeshLoadStats(): MeshLoadStats {
  const pendingBytes = FileReceiveScheduler.pendingReceiveBytes();
  const sync = FileSyncProgress.snapshot(20);
  const stats: MeshLoadStats = {
    bandwidthUsageBytes: Network.instance.bandwidthUsage || 0,
    bandwidthPeakBytes: Network.instance.bandwidthPeak || 0,
    fileSyncPending: FileReceiveScheduler.pendingReceiveCount(),
    fileSyncActive: FileReceiveScheduler.activeReceiveCount(),
    fileSyncOutbound: FileReceiveScheduler.outboundPendingCount(),
    fileSyncHold: FileReceiveScheduler.isJoinProbeHold(),
    fileSyncProgressPercent: sync.active ? sync.percentLoaded : 0,
    fileSyncPendingKnownBytes: pendingBytes.knownBytes,
    fileSyncPendingUnknown: pendingBytes.unknownCount,
    fileSyncPendingByKind: FileReceiveScheduler.pendingReceiveCountsByKind(),
    objectCount: ObjectStore.instance.getObjects().length,
  };
  try {
    const join = joinDiagProvider?.();
    if (join) {
      stats.joinInProgress = join.joinInProgress;
      stats.reopenInFlight = join.reopenInFlight;
      stats.reconnecting = join.reconnecting;
    }
  } catch {
    // ignore provider failures
  }
  return stats;
}

/** Lines appended to mesh diag export. */
export function formatMeshDiagStatsLines(): string[] {
  const lines: string[] = [];
  try {
    const media = collectRoomMediaStats();
    lines.push('room-data (local complete blobs):');
    lines.push(
      `  image: ${media.image.complete} files ${formatDiagBytes(media.image.bytes)}`
        + (media.image.incomplete ? ` (incomplete=${media.image.incomplete})` : ''),
    );
    lines.push(
      `  audio: ${media.audio.complete} files ${formatDiagBytes(media.audio.bytes)}`
        + (media.audio.incomplete ? ` (incomplete=${media.audio.incomplete})` : ''),
    );
    lines.push(
      `  pdf: ${media.pdf.complete} files ${formatDiagBytes(media.pdf.bytes)}`
        + (media.pdf.incomplete ? ` (incomplete=${media.pdf.incomplete})` : ''),
    );
    lines.push(
      `  video: ${media.video.complete} files ${formatDiagBytes(media.video.bytes)}`
        + (media.video.incomplete ? ` (incomplete=${media.video.incomplete})` : ''),
    );
    lines.push(`  total: ${formatDiagBytes(media.totalBytes)}`);

    const load = collectMeshLoadStats();
    const byKind = Object.entries(load.fileSyncPendingByKind)
      .filter(([, n]) => n > 0)
      .map(([k, n]) => `${k}=${n}`)
      .join(',') || '-';
    lines.push('load:');
    lines.push(
      `  bandwidth: usage=${formatDiagBytes(load.bandwidthUsageBytes)}`
        + ` peak=${formatDiagBytes(load.bandwidthPeakBytes)}`,
    );
    lines.push(
      `  fileSync: pending=${load.fileSyncPending} active=${load.fileSyncActive}`
        + ` outbound=${load.fileSyncOutbound} hold=${load.fileSyncHold}`
        + ` progress=${load.fileSyncProgressPercent}%`,
    );
    lines.push(
      `  fileSyncQueue: known=${formatDiagBytes(load.fileSyncPendingKnownBytes)}`
        + ` unknownFiles=${load.fileSyncPendingUnknown} byKind={${byKind}}`,
    );
    lines.push(`  objects: ${load.objectCount}`);
    if (load.joinInProgress != null || load.reopenInFlight != null || load.reconnecting != null) {
      lines.push(
        `  session: join=${load.joinInProgress === true}`
          + ` reopen=${load.reopenInFlight === true}`
          + ` reconnecting=${load.reconnecting === true}`,
      );
    }
  } catch (e) {
    lines.push(`stats-error: ${e instanceof Error ? e.message : String(e)}`);
  }
  return lines;
}
