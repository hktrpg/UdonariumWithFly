import { Injectable, NgZone, OnDestroy } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

/** Bottom nav height used when clamping mobile panels. */
export const MOBILE_NAV_HEIGHT = 56;

export interface MobilePanelBox {
  title?: string;
  left?: number;
  top?: number;
  width?: number;
  height?: number;
  tourPanelId?: string;
}

/**
 * Compact / touch-first layout for phones and tablets.
 * Desktop (fine pointer + hover, or wide enough with mouse) keeps the classic UI.
 */
@Injectable({ providedIn: 'root' })
export class MobileLayoutService implements OnDestroy {
  private readonly mq: MediaQueryList;
  private readonly subject = new BehaviorSubject<boolean>(false);
  readonly isMobile$ = this.subject.asObservable();

  private readonly onChange = () => this.refresh();

  constructor(private ngZone: NgZone) {
    // Phones always; tablets (coarse + no hover) up to iPad landscape; narrow windows.
    this.mq = window.matchMedia(
      '(max-width: 900px), ((pointer: coarse) and (hover: none) and (max-width: 1366px))'
    );
    this.refresh();
    if (typeof this.mq.addEventListener === 'function') {
      this.mq.addEventListener('change', this.onChange);
    } else {
      // Safari < 14
      (this.mq as any).addListener?.(this.onChange);
    }
    window.addEventListener('orientationchange', this.onChange);
    window.addEventListener('resize', this.onChange);
  }

  ngOnDestroy() {
    if (typeof this.mq.removeEventListener === 'function') {
      this.mq.removeEventListener('change', this.onChange);
    } else {
      (this.mq as any).removeListener?.(this.onChange);
    }
    window.removeEventListener('orientationchange', this.onChange);
    window.removeEventListener('resize', this.onChange);
  }

  get isMobile(): boolean {
    return this.subject.value;
  }

  /** Safe area + bottom nav reserved for panels / tour bubble. */
  get bottomChromePx(): number {
    if (!this.isMobile) return 0;
    return MOBILE_NAV_HEIGHT;
  }

  /** Fit a desktop panel option into a near-full-screen sheet on mobile. */
  adaptPanelOption<T extends MobilePanelBox>(option: T = {} as T): T {
    if (!this.isMobile) return { ...option };
    const bottom = this.bottomChromePx;
    const w = Math.max(280, window.innerWidth);
    const h = Math.max(240, window.innerHeight - bottom);
    return {
      ...option,
      left: 0,
      top: 0,
      width: w,
      height: h,
    };
  }

  private refresh() {
    const next = !!this.mq.matches;
    if (next === this.subject.value) {
      this.syncBodyClass(next);
      return;
    }
    this.ngZone.run(() => {
      this.subject.next(next);
      this.syncBodyClass(next);
    });
  }

  private syncBodyClass(isMobile: boolean) {
    document.body.classList.toggle('udon-mobile-layout', isMobile);
    document.documentElement.classList.toggle('udon-mobile-layout', isMobile);
  }
}
