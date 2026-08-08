import { AfterViewInit, Component, ElementRef, NgZone, OnDestroy } from '@angular/core';

import { Network } from '@udonarium/core/system';

@Component({
    selector: 'network-indicator',
    templateUrl: './network-indicator.component.html',
    styleUrls: ['./network-indicator.component.css'],
    standalone: false
})
export class NetworkIndicatorComponent implements AfterViewInit, OnDestroy {
  private hideTimer: ReturnType<typeof setTimeout> = null;
  private pollTimer: ReturnType<typeof setInterval> = null;

  constructor(
    private elementRef: ElementRef,
    private ngZone: NgZone,
  ) { }

  ngAfterViewInit() {
    const el = this.elementRef.nativeElement as HTMLElement;
    el.style.display = 'none';

    const scheduleHide = () => {
      if (this.hideTimer) clearTimeout(this.hideTimer);
      this.hideTimer = setTimeout(() => {
        this.hideTimer = null;
        if (Network.bandwidthUsage >= 3 * 1024) {
          scheduleHide();
          return;
        }
        el.style.display = 'none';
      }, 650);
    };

    // Sample bandwidth instead of listening to every EventSystem event.
    this.ngZone.runOutsideAngular(() => {
      this.pollTimer = setInterval(() => {
        if (Network.bandwidthUsage < 3 * 1024) return;
        el.style.display = 'block';
        scheduleHide();
      }, 250);
    });
  }

  ngOnDestroy() {
    if (this.pollTimer) clearInterval(this.pollTimer);
    if (this.hideTimer) clearTimeout(this.hideTimer);
  }
}
