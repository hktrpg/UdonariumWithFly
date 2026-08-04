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
  /**
   * On mobile, close other sheets before opening (bottom-nav switches).
   * Nested opens (chat palette, tab settings) should leave this unset/false.
   */
  mobileReplace?: boolean;
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
    // any-pointer:coarse catches hybrids; still require no-hover or narrow width so
    // desktop mice with optional touch screens stay on the classic UI.
    this.mq = window.matchMedia(
      [
        '(max-width: 900px) and (any-pointer: coarse)',
        '(any-pointer: coarse) and (hover: none) and (max-width: 1366px)',
      ].join(', ')
    );
    this.refresh();
    if (typeof this.mq.addEventListener === 'function') {
      this.mq.addEventListener('change', this.onChange);
    } else {
      (this.mq as any).addListener?.(this.onChange);
    }
    window.addEventListener('orientationchange', this.onChange);
    window.addEventListener('resize', this.onChange);
    window.visualViewport?.addEventListener('resize', this.onChange);
  }

  ngOnDestroy() {
    if (typeof this.mq.removeEventListener === 'function') {
      this.mq.removeEventListener('change', this.onChange);
    } else {
      (this.mq as any).removeListener?.(this.onChange);
    }
    window.removeEventListener('orientationchange', this.onChange);
    window.removeEventListener('resize', this.onChange);
    window.visualViewport?.removeEventListener('resize', this.onChange);
  }

  get isMobile(): boolean {
    return this.subject.value;
  }

  /** Visible viewport height (avoids iOS 100vh toolbar issues). */
  get viewportHeight(): number {
    return Math.round(window.visualViewport?.height || window.innerHeight);
  }

  /** Safe area + bottom nav reserved for panels / tour bubble / context menus. */
  get bottomChromePx(): number {
    if (!this.isMobile) return 0;
    let safe = 0;
    try {
      const fromVar = getComputedStyle(document.documentElement).getPropertyValue('--udon-safe-bottom');
      safe = parseFloat(fromVar) || 0;
    } catch { /* ignore */ }
    return MOBILE_NAV_HEIGHT + safe;
  }

  /** Fit a desktop panel option into a near-full-screen sheet on mobile. */
  adaptPanelOption<T extends MobilePanelBox>(option: T = {} as T): T {
    if (!this.isMobile) return { ...option };
    const bottom = this.bottomChromePx;
    const w = Math.max(280, window.innerWidth);
    const h = Math.max(240, this.viewportHeight - bottom);
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
    // Expose chrome metrics for CSS / context-menu clamping (env() is hard to read from JS).
    const root = document.documentElement.style;
    if (isMobile) {
      root.setProperty('--udon-bottom-chrome', `${this.bottomChromePx}px`);
    } else {
      root.removeProperty('--udon-bottom-chrome');
    }
  }
}
