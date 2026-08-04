import { Injectable, NgZone, OnDestroy } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

/** Bottom / side nav chrome height or width. */
export const MOBILE_NAV_HEIGHT = 56;
export const TABLET_RAIL_WIDTH = 72;

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
  /** full = near fullscreen; half = bottom sheet (chat). */
  mobileSheet?: 'full' | 'half';
}

export type MobileChromeMode = 'desktop' | 'phone' | 'tablet-portrait' | 'tablet-landscape';

/**
 * Compact / touch-first layout for phones and tablets.
 * Desktop (fine pointer + hover, or wide enough with mouse) keeps the classic UI.
 */
@Injectable({ providedIn: 'root' })
export class MobileLayoutService implements OnDestroy {
  private readonly mq: MediaQueryList;
  private readonly subject = new BehaviorSubject<boolean>(false);
  private readonly chromeSubject = new BehaviorSubject<MobileChromeMode>('desktop');
  private readonly keyboardSubject = new BehaviorSubject<number>(0);
  readonly isMobile$ = this.subject.asObservable();
  readonly chromeMode$ = this.chromeSubject.asObservable();
  readonly keyboardInset$ = this.keyboardSubject.asObservable();

  private readonly onChange = () => this.refresh();
  private readonly onViewport = () => this.refreshKeyboardInset();

  constructor(private ngZone: NgZone) {
    this.mq = window.matchMedia(
      [
        '(max-width: 900px) and (any-pointer: coarse)',
        '(any-pointer: coarse) and (hover: none) and (max-width: 1366px)',
      ].join(', ')
    );
    this.refresh();
    this.refreshKeyboardInset();
    if (typeof this.mq.addEventListener === 'function') {
      this.mq.addEventListener('change', this.onChange);
    } else {
      (this.mq as any).addListener?.(this.onChange);
    }
    window.addEventListener('orientationchange', this.onChange);
    window.addEventListener('resize', this.onChange);
    window.visualViewport?.addEventListener('resize', this.onChange);
    window.visualViewport?.addEventListener('resize', this.onViewport);
    window.visualViewport?.addEventListener('scroll', this.onViewport);
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
    window.visualViewport?.removeEventListener('resize', this.onViewport);
    window.visualViewport?.removeEventListener('scroll', this.onViewport);
  }

  get isMobile(): boolean {
    return this.subject.value;
  }

  get chromeMode(): MobileChromeMode {
    return this.chromeSubject.value;
  }

  /** Phone-sized compact layout (bottom nav). */
  get isPhone(): boolean {
    return this.chromeMode === 'phone';
  }

  /** Tablet portrait — bottom nav, more room. */
  get isTabletPortrait(): boolean {
    return this.chromeMode === 'tablet-portrait';
  }

  /** Tablet landscape — left icon rail. */
  get isTabletLandscape(): boolean {
    return this.chromeMode === 'tablet-landscape';
  }

  get keyboardInsetPx(): number {
    return this.keyboardSubject.value;
  }

  /** Visible viewport height (avoids iOS 100vh toolbar issues). */
  get viewportHeight(): number {
    return Math.round(window.visualViewport?.height || window.innerHeight);
  }

  get viewportWidth(): number {
    return Math.round(window.visualViewport?.width || window.innerWidth);
  }

  /** Safe area + bottom nav reserved for panels / tour bubble / context menus. */
  get bottomChromePx(): number {
    if (!this.isMobile) return 0;
    if (this.isTabletLandscape) return this.keyboardInsetPx;
    return MOBILE_NAV_HEIGHT + this.readSafeBottom() + this.keyboardInsetPx;
  }

  get leftChromePx(): number {
    if (!this.isTabletLandscape) return 0;
    return TABLET_RAIL_WIDTH;
  }

  /** Fit a desktop panel option into a sheet on mobile. */
  adaptPanelOption<T extends MobilePanelBox>(option: T = {} as T): T {
    if (!this.isMobile) return { ...option };
    const sheet = option.mobileSheet || 'full';
    const left = this.leftChromePx;
    const w = Math.max(280, this.viewportWidth - left);
    if (sheet === 'half') {
      const h = Math.max(220, Math.round(this.viewportHeight * 0.48));
      // Phone: sit above bottom nav; tablet landscape: sit above keyboard only.
      const reserveBottom = this.isTabletLandscape ? this.keyboardInsetPx : MOBILE_NAV_HEIGHT + this.keyboardInsetPx;
      return {
        ...option,
        left,
        top: Math.max(0, this.viewportHeight - h - reserveBottom),
        width: w,
        height: h,
      };
    }
    // CSS !important sizes the sheet; JS size is a fallback before paint.
    const fullH = this.isTabletLandscape
      ? Math.max(240, this.viewportHeight - this.keyboardInsetPx)
      : Math.max(240, this.viewportHeight - MOBILE_NAV_HEIGHT - this.keyboardInsetPx);
    return {
      ...option,
      left,
      top: 0,
      width: w,
      height: fullH,
    };
  }

  private refresh() {
    const mobile = !!this.mq.matches;
    const mode = this.resolveChromeMode(mobile);
    const modeChanged = mode !== this.chromeSubject.value;
    const mobileChanged = mobile !== this.subject.value;
    if (!modeChanged && !mobileChanged) {
      this.syncBodyClass(mobile, mode);
      return;
    }
    this.ngZone.run(() => {
      if (mobileChanged) this.subject.next(mobile);
      if (modeChanged) this.chromeSubject.next(mode);
      this.syncBodyClass(mobile, mode);
    });
  }

  private resolveChromeMode(mobile: boolean): MobileChromeMode {
    if (!mobile) return 'desktop';
    const w = window.innerWidth;
    const h = window.innerHeight;
    const tablet = Math.min(w, h) >= 600 && Math.max(w, h) >= 900;
    if (tablet && w > h) return 'tablet-landscape';
    if (tablet) return 'tablet-portrait';
    return 'phone';
  }

  private refreshKeyboardInset() {
    const vv = window.visualViewport;
    if (!vv || !this.isMobile) {
      if (this.keyboardSubject.value !== 0) {
        this.ngZone.run(() => this.keyboardSubject.next(0));
        document.documentElement.style.setProperty('--udon-keyboard-inset', '0px');
        this.syncChromeCssVars(this.isMobile, this.chromeMode);
      }
      return;
    }
    const inset = Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop));
    // Ignore tiny jitter / browser chrome.
    const next = inset > 80 ? inset : 0;
    if (next === this.keyboardSubject.value) return;
    this.ngZone.run(() => this.keyboardSubject.next(next));
    document.documentElement.style.setProperty('--udon-keyboard-inset', `${next}px`);
    this.syncChromeCssVars(true, this.chromeMode);
  }

  private syncBodyClass(isMobile: boolean, mode: MobileChromeMode) {
    const root = document.documentElement;
    document.body.classList.toggle('udon-mobile-layout', isMobile);
    root.classList.toggle('udon-mobile-layout', isMobile);
    root.classList.toggle('udon-tablet-landscape', mode === 'tablet-landscape');
    root.classList.toggle('udon-tablet-portrait', mode === 'tablet-portrait');
    root.classList.toggle('udon-phone', mode === 'phone');
    this.syncChromeCssVars(isMobile, mode);
  }

  private syncChromeCssVars(isMobile: boolean, mode: MobileChromeMode) {
    const root = document.documentElement;
    if (isMobile) {
      // bottomChromePx includes keyboard inset when open.
      const bottom =
        mode === 'tablet-landscape'
          ? this.keyboardInsetPx
          : MOBILE_NAV_HEIGHT + this.readSafeBottom() + this.keyboardInsetPx;
      root.style.setProperty('--udon-bottom-chrome', `${bottom}px`);
      root.style.setProperty('--udon-left-chrome', `${mode === 'tablet-landscape' ? TABLET_RAIL_WIDTH : 0}px`);
    } else {
      root.style.removeProperty('--udon-bottom-chrome');
      root.style.removeProperty('--udon-left-chrome');
      root.style.setProperty('--udon-keyboard-inset', '0px');
    }
  }

  private readSafeBottom(): number {
    try {
      const fromVar = getComputedStyle(document.documentElement).getPropertyValue('--udon-safe-bottom');
      return parseFloat(fromVar) || 0;
    } catch {
      return 0;
    }
  }
}
