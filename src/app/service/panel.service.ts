import { ComponentRef, Injectable, OnChanges, ViewContainerRef } from '@angular/core';
import { I18nService } from './i18n.service';
import { MobileLayoutService } from './mobile-layout.service';

declare var Type: FunctionConstructor;
interface Type<T> extends Function {
  new(...args: any[]): T;
}

export interface PanelOption {
  title?: string;
  left?: number;
  top?: number;
  width?: number;
  height?: number;
  /** Marks the panel root for guided-tour spotlight (`[data-tour-panel="…"]`). */
  tourPanelId?: string;
  /**
   * On mobile, close other sheets before opening (bottom-nav switches).
   * Nested opens (palette / tab settings) should omit this or set false.
   */
  mobileReplace?: boolean;
  /** full (default), half, or peek bottom sheet. */
  mobileSheet?: 'full' | 'half' | 'peek';
}

@Injectable()
export class PanelService {
  /* Todo */
  static defaultParentViewContainerRef: ViewContainerRef;
  static UIPanelComponentClass: { new(...args: any[]): any } = null;

  /** Dynamically opened panels (not the fixed left-nav panel). */
  private static readonly openPanels = new Set<PanelService>();

  private panelComponentRef: ComponentRef<any>
  title: string = 'Untitled panel';
  left: number = 0;
  top: number = 0;
  width: number = 100;
  height: number = 100;
  isAbleMinimizeButton: boolean = true;
  isAbleFullScreenButton: boolean = true;
  isAbleCloseButton: boolean = true;
  isAbleRotateButton: boolean = false;
  /** Guided tour panel spotlight id (see PanelOption.tourPanelId). */
  tourPanelId: string = null;

  scrollablePanel: HTMLDivElement = null;

  constructor(
    private i18n: I18nService,
    private mobileLayout: MobileLayoutService,
  ) {
    this.title = this.i18n.t('panel.untitled');
  }

  get isShow(): boolean {
    return this.panelComponentRef ? true : false;
  }

  /** Close all closable desktop UI panels opened via PanelService.open(). */
  static closeAllPanels() {
    for (const panel of Array.from(PanelService.openPanels)) {
      if (panel.isAbleCloseButton) panel.close();
    }
  }

  /** Close panels tagged with the same guided-tour id (avoid duplicate PeerMenu etc.). */
  static closePanelsByTourId(tourPanelId: string) {
    if (!tourPanelId) return;
    for (const panel of Array.from(PanelService.openPanels)) {
      if (panel.tourPanelId === tourPanelId) panel.close();
    }
  }

  static isTourPanelOpen(tourPanelId: string): boolean {
    if (!tourPanelId) return false;
    for (const panel of PanelService.openPanels) {
      if (panel.tourPanelId === tourPanelId) return true;
    }
    return false;
  }

  /** Any open dynamic panel's tour id (topmost by z-index), for nav active state. */
  static getTopTourPanelId(): string | null {
    let bestId: string = null;
    let bestZ = -Infinity;
    for (const panel of PanelService.openPanels) {
      if (!panel.tourPanelId || !panel.panelComponentRef) continue;
      const el = panel.panelComponentRef.instance?.draggablePanel?.nativeElement as HTMLElement | undefined;
      if (!el || !el.isConnected) continue;
      const z = parseInt(el.style.zIndex || '0', 10);
      const zSafe = Number.isFinite(z) ? z : 0;
      if (!bestId || zSafe >= bestZ) {
        bestId = panel.tourPanelId;
        bestZ = zSafe;
      }
    }
    return bestId;
  }

  /** Topmost open panel chrome for a tour id (by z-index, then DOM order). */
  static getTourPanelElement(tourPanelId: string): HTMLElement | null {
    if (!tourPanelId) return null;
    let best: HTMLElement = null;
    let bestZ = -Infinity;
    for (const panel of PanelService.openPanels) {
      if (panel.tourPanelId !== tourPanelId || !panel.panelComponentRef) continue;
      const el = panel.panelComponentRef.instance?.draggablePanel?.nativeElement as HTMLElement | undefined;
      if (!el || !el.isConnected) continue;
      const z = parseInt(el.style.zIndex || '0', 10);
      const zSafe = Number.isFinite(z) ? z : 0;
      if (!best || zSafe >= bestZ) {
        best = el;
        bestZ = zSafe;
      }
    }
    if (best) return best;
    // Fallback for panels that set the attribute but are not yet in openPanels timing edge cases.
    const nodes = document.querySelectorAll(`[data-tour-panel="${tourPanelId}"]`);
    return (nodes.item(nodes.length - 1) as HTMLElement) || null;
  }

  open<T>(childComponent: Type<T>, option?: PanelOption, parentViewContainerRef?: ViewContainerRef): T {
    if (!parentViewContainerRef) {
      parentViewContainerRef = PanelService.defaultParentViewContainerRef;
    }

    // Only bottom-nav switches replace sheets. Nested opens (palette, settings) keep the parent.
    if (this.mobileLayout.isMobile && option?.mobileReplace) {
      PanelService.closeAllPanels();
    }

    const injector = parentViewContainerRef.injector;

    let panelComponentRef: ComponentRef<any> = parentViewContainerRef.createComponent(PanelService.UIPanelComponentClass, { index: parentViewContainerRef.length, injector: injector });

    // Avoid NG0100: createComponent already CD-checked the panel with the default title.
    const panelCdr = panelComponentRef.changeDetectorRef;
    panelCdr.detach();

    const childPanelService: PanelService = panelComponentRef.injector.get(PanelService);
    childPanelService.panelComponentRef = panelComponentRef;
    PanelService.openPanels.add(childPanelService);

    // Mobile: near-full-screen sheet. Desktop options pass through unchanged.
    const resolved = this.mobileLayout.adaptPanelOption(option || {});
    if (resolved.title) childPanelService.title = resolved.title;
    if (resolved.top != null) childPanelService.top = resolved.top;
    if (resolved.left != null) childPanelService.left = resolved.left;
    if (resolved.width != null) childPanelService.width = resolved.width;
    if (resolved.height != null) childPanelService.height = resolved.height;
    if (resolved.tourPanelId) childPanelService.tourPanelId = resolved.tourPanelId;

    if (this.mobileLayout.isMobile) {
      childPanelService.isAbleRotateButton = false;
      childPanelService.isAbleMinimizeButton = false;
      childPanelService.isAbleFullScreenButton = false;
      const panelInst = panelComponentRef.instance as any;
      if (panelInst) {
        panelInst.isMobileSheet = true;
        const sheet = resolved.mobileSheet || 'half';
        panelInst.isMobileSheetHalf = sheet === 'half' || sheet === 'peek';
        panelInst.mobileSheetSnap = sheet === 'peek' ? 'peek' : sheet === 'half' ? 'half' : 'full';
      }
    }

    let bodyComponentRef: ComponentRef<any> = panelComponentRef.instance.content.createComponent(childComponent);

    panelCdr.reattach();
    panelCdr.detectChanges();

    panelComponentRef.onDestroy(() => {
      PanelService.openPanels.delete(childPanelService);
      childPanelService.panelComponentRef = null;
      panelComponentRef = null;
    });

    bodyComponentRef.onDestroy(() => {
      bodyComponentRef = null;
    });

    let panelOnChanges = panelComponentRef.instance as OnChanges;
    let bodyOnChanges = bodyComponentRef.instance as OnChanges;
    if (panelOnChanges?.ngOnChanges != null || bodyOnChanges?.ngOnChanges != null) {
      queueMicrotask(() => {
        if (bodyComponentRef && bodyOnChanges?.ngOnChanges != null) bodyOnChanges?.ngOnChanges({});
        if (panelComponentRef && panelOnChanges?.ngOnChanges != null) panelOnChanges?.ngOnChanges({});
      });
    }

    return <T>bodyComponentRef.instance;
  }

  close() {
    if (this.panelComponentRef) {
      this.panelComponentRef.destroy();
      this.panelComponentRef = null;
    }
  }
}
