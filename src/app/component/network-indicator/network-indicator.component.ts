import { AfterViewInit, ChangeDetectorRef, Component, ElementRef, NgZone, OnDestroy } from '@angular/core';

import { FileSyncProgress } from '@udonarium/core/file-storage/file-sync-progress';
import { Network } from '@udonarium/core/system';

const SHOW_THRESHOLD = 12 * 1024;
const SHOW_MIN_MS = 400;
const BAR_SEGMENTS = 20;

@Component({
    selector: 'network-indicator',
    templateUrl: './network-indicator.component.html',
    styleUrls: ['./network-indicator.component.css'],
    standalone: false
})
export class NetworkIndicatorComponent implements AfterViewInit, OnDestroy {
  private hideTimer: ReturnType<typeof setTimeout> = null;
  private pollTimer: ReturnType<typeof setInterval> = null;
  private showSince = 0;

  visible = false;
  fileSyncMode = false;
  percentLoaded = 0;
  filledSegments: boolean[] = [];

  constructor(
    private elementRef: ElementRef,
    private ngZone: NgZone,
    private changeDetector: ChangeDetectorRef,
  ) {
    this.filledSegments = Array.from({ length: BAR_SEGMENTS }, () => false);
  }

  ngAfterViewInit() {
    const el = this.elementRef.nativeElement as HTMLElement;

    const isBandwidthBusy = () =>
      Network.bandwidthPeak >= SHOW_THRESHOLD || Network.bandwidthUsage >= SHOW_THRESHOLD;

    const applyView = (show: boolean, fileMode: boolean, loaded: number, filled: number) => {
      this.visible = show;
      this.fileSyncMode = fileMode;
      this.percentLoaded = loaded;
      for (let i = 0; i < BAR_SEGMENTS; i++) {
        this.filledSegments[i] = i < filled;
      }
      el.classList.toggle('sync-visible', show);
      el.classList.toggle('file-sync', fileMode);
      this.changeDetector.markForCheck();
    };

    const scheduleHide = () => {
      if (this.hideTimer) clearTimeout(this.hideTimer);
      this.hideTimer = setTimeout(() => {
        this.hideTimer = null;
        if (isBandwidthBusy()) {
          Network.clearBandwidthPeak();
          scheduleHide();
          return;
        }
        const snap = FileSyncProgress.snapshot(BAR_SEGMENTS);
        if (snap.active) {
          this.ngZone.run(() => applyView(true, true, snap.percentLoaded, snap.filledSegments));
          scheduleHide();
          return;
        }
        this.ngZone.run(() => applyView(false, false, 0, 0));
        this.showSince = 0;
      }, 650);
    };

    this.ngZone.runOutsideAngular(() => {
      this.pollTimer = setInterval(() => {
        const snap = FileSyncProgress.snapshot(BAR_SEGMENTS);
        const fileBusy = snap.active;
        const bandwidthBusy = isBandwidthBusy();
        if (!fileBusy && !bandwidthBusy) {
          if (this.visible) {
            this.ngZone.run(() => applyView(false, false, 0, 0));
            this.showSince = 0;
          }
          return;
        }

        const now = performance.now();
        const fileMode = fileBusy;
        if (!this.visible) {
          if (this.showSince === 0) this.showSince = now;
          if (!fileMode && bandwidthBusy && now - this.showSince < SHOW_MIN_MS) return;
        }

        this.ngZone.run(() => {
          applyView(true, fileMode, snap.percentLoaded, snap.filledSegments);
        });
        if (bandwidthBusy) Network.clearBandwidthPeak();
        scheduleHide();
      }, 250);
    });
  }

  ngOnDestroy() {
    if (this.pollTimer) clearInterval(this.pollTimer);
    if (this.hideTimer) clearTimeout(this.hideTimer);
  }
}
