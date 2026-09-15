import { Injectable, OnDestroy } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import {
  MOBILE_LOW_TIER_TOTAL_BYTES,
  ResourcePolicy,
  ResourceTier,
  applyResourcePolicy,
  getResourcePolicy,
} from '@udonarium/core/file-storage/resource-policy';
import {
  collectMeshLoadStats,
  collectRoomMediaStats,
} from '@udonarium/core/system/network/mesh-diag-stats';
import {
  deviceMemoryGb,
  hardwareConcurrency,
  isStandalonePwa,
} from '@udonarium/core/platform-detect';
import { GameTable } from '@udonarium/game-table';
import { ObjectStore } from '@udonarium/core/synchronize-object/object-store';
import { MobileLayoutService } from './mobile-layout.service';

export type ResourceSnapshot = {
  tier: ResourceTier;
  totalBlobBytes: number;
  imageCount: number;
  incompleteCount: number;
  tableCanvasPixels: number;
  isStandalonePwa: boolean;
};

@Injectable({ providedIn: 'root' })
export class DeviceResourceProfileService implements OnDestroy {
  private readonly policySubject = new BehaviorSubject<ResourcePolicy>(getResourcePolicy());
  readonly policy$ = this.policySubject.asObservable();
  private lastSnapshot: ResourceSnapshot | null = null;

  constructor(private mobileLayout: MobileLayoutService) { }

  ngOnDestroy(): void {
    this.policySubject.complete();
  }

  getPolicy(): ResourcePolicy {
    return getResourcePolicy();
  }

  getSnapshot(): ResourceSnapshot | null {
    return this.lastSnapshot;
  }

  /** Recompute tier from device + room load; desktop stays on `high`. */
  scanAndApply(): ResourceSnapshot {
    const media = collectRoomMediaStats();
    const incompleteCount =
      media.image.incomplete + media.audio.incomplete + media.pdf.incomplete + media.video.incomplete;
    const tier = this.resolveTier(media.totalBytes);
    const policy = applyResourcePolicy(tier);
    this.policySubject.next(policy);

    const snapshot: ResourceSnapshot = {
      tier,
      totalBlobBytes: media.totalBytes,
      imageCount: media.image.complete + media.image.incomplete,
      incompleteCount,
      tableCanvasPixels: this.estimateTableCanvasPixels(),
      isStandalonePwa: isStandalonePwa(),
    };
    this.lastSnapshot = snapshot;
    return snapshot;
  }

  private resolveTier(totalBlobBytes: number): ResourceTier {
    if (!this.mobileLayout.isMobile) return 'high';

    const mem = deviceMemoryGb();
    const standalone = isStandalonePwa();
    const lowMemory = mem !== null && mem <= 4;
    const heavyRoom = totalBlobBytes >= MOBILE_LOW_TIER_TOTAL_BYTES;
    const weakCpu = hardwareConcurrency() <= 4;

    if (lowMemory || heavyRoom || (standalone && weakCpu)) return 'low';
    return 'medium';
  }

  private estimateTableCanvasPixels(): number {
    let maxPixels = 0;
    for (const table of ObjectStore.instance.getObjects(GameTable)) {
      const gs = Math.max(1, table.gridSize || 1);
      const w = Math.max(0, table.width || 0) * gs;
      const h = Math.max(0, table.height || 0) * gs;
      const px = w * h;
      if (px > maxPixels) maxPixels = px;
    }
    return maxPixels;
  }

  /** For diagnostics export alongside mesh stats. */
  formatSummaryLines(): string[] {
    const snap = this.lastSnapshot;
    const load = collectMeshLoadStats();
    if (!snap) return ['device-resource: (not scanned)'];
    const policy = getResourcePolicy();
    return [
      `device-resource tier=${snap.tier} standalonePwa=${snap.isStandalonePwa}`,
      `  blobs=${snap.totalBlobBytes} images=${snap.imageCount} incomplete=${snap.incompleteCount}`,
      `  tableCanvasPx=${snap.tableCanvasPixels}`,
      `  policy concurrent=${policy.maxConcurrentReceives}/${policy.maxConcurrentHydrate} pdfMaxW=${policy.pdfMaxWidthPx}`,
      `  fileSync active=${load.fileSyncActive} pending=${load.fileSyncPending}`,
    ];
  }
}
