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
  /** full = near fullscreen; half / peek = bottom sheet (chat / combat). */
  mobileSheet?: 'full' | 'half' | 'peek';
}

export type MobileChromeMode = 'desktop' | 'phone' | 'tablet-portrait' | 'tablet-landscape';
/** Play = map-first session; Edit = table/assets/scene tools. Desktop ignores. */
export type MobileUiMode = 'play' | 'edit';

const UI_MODE_KEY = 'udon.mobileUiMode';

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
  private readonly uiModeSubject = new BehaviorSubject<MobileUiMode>(MobileLayoutService.readStoredUiMode());
  readonly isMobile$ = this.subject.asObservable();
  readonly chromeMode$ = this.chromeSubject.asObservable();
  readonly keyboardInset$ = this.keyboardSubject.asObservable();
  readonly uiMode$ = this.uiModeSubject.asObservable();

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

  get uiMode(): MobileUiMode {
    return this.uiModeSubject.value;
  }

  get isPlay(): boolean {
    return this.uiMode === 'play';
  }

  get isEdit(): boolean {
    return this.uiMode === 'edit';
  }

  /** Switch Play ↔ Edit (mobile only). Clears sheets via caller. */
  setUiMode(mode: MobileUiMode) {
    if (mode === this.uiModeSubject.value) return;
    try { sessionStorage.setItem(UI_MODE_KEY, mode); } catch { /* ignore */ }
    this.ngZone.run(() => this.uiModeSubject.next(mode));
    this.syncUiModeClass();
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

  /** Height fraction for peek / half sheets. */
  sheetHeightPx(sheet: 'peek' | 'half' | 'full'): number {
    const vh = this.viewportHeight;
    if (sheet === 'peek') return Math.max(140, Math.round(vh * 0.22));
    if (sheet === 'half') return Math.max(220, Math.round(vh * 0.48));
    return Math.max(240, vh - (this.isTabletLandscape ? this.keyboardInsetPx : MOBILE_NAV_HEIGHT + this.keyboardInsetPx));
  }

  /** Fit a desktop panel option into a sheet on mobile. */
  adaptPanelOption<T extends MobilePanelBox>(option: T = {} as T): T {
    if (!this.isMobile) return { ...option };
    const sheet = option.mobileSheet || 'full';
    const left = this.leftChromePx;
    const w = Math.max(280, this.viewportWidth - left);
    if (sheet === 'half' || sheet === 'peek') {
      const h = this.sheetHeightPx(sheet);
      const reserveBottom = this.isTabletLandscape
        ? this.keyboardInsetPx
        : MOBILE_NAV_HEIGHT + this.readSafeBottom() + this.keyboardInsetPx;
      return {
        ...option,
        left,
        top: Math.max(0, this.viewportHeight - h - reserveBottom),
        width: w,
        height: h,
      };
    }
    const fullH = this.sheetHeightPx('full');
    return {
      ...option,
      left,
      top: 0,
      width: w,
      height: fullH,
    };
  }

  private static readStoredUiMode(): MobileUiMode {
    try {
      return sessionStorage.getItem(UI_MODE_KEY) === 'edit' ? 'edit' : 'play';
    } catch {
      return 'play';
    }
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
    this.syncUiModeClass();
  }

  private syncUiModeClass() {
    const root = document.documentElement;
    const mobile = this.isMobile;
    const play = mobile && this.isPlay;
    const edit = mobile && this.isEdit;
    root.classList.toggle('udon-mobile-play', play);
    root.classList.toggle('udon-mobile-edit', edit);
    document.body.classList.toggle('udon-mobile-play', play);
    document.body.classList.toggle('udon-mobile-edit', edit);
  }

  private syncChromeCssVars(isMobile: boolean, mode: MobileChromeMode) {
    const root = document.documentElement;
    if (isMobile) {
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
