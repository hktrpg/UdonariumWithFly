import { ComponentRef, Injectable, OnChanges, ViewContainerRef } from '@angular/core';
import { I18nService } from './i18n.service';
import { MobileLayoutService } from './mobile-layout.service';

import * as localForage from 'localforage';

declare var Type: FunctionConstructor;
interface Type<T> extends Function {
  new(...args: any[]): T;
}

export interface PanelGeometry {
  width: number;
  height: number;
  left?: number;
  top?: number;
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
   * Persist width/height under this key (local). Defaults to normalized tourPanelId.
   * Use for panels without a unique tour id (e.g. character / card sheets).
   */
  geometryKey?: string;
  /**
   * On mobile, close other sheets before opening (bottom-nav switches).
   * Nested opens (palette / tab settings) should omit this or set false.
   */
  mobileReplace?: boolean;
  /**
   * Bottom-sheet height hint on mobile.
   * `half` / unset / `full` → restore last snap; `peek` forces peek. Never fullscreen.
   */
  mobileSheet?: 'full' | 'half' | 'peek';
}

@Injectable()
export class PanelService {
  /* Todo */
  static defaultParentViewContainerRef: ViewContainerRef;
  static UIPanelComponentClass: { new(...args: any[]): any } = null;

  /** Dynamically opened panels (not the fixed left-nav panel). */
  private static readonly openPanels = new Set<PanelService>();

  private static readonly GEOMETRY_STORAGE_KEY = 'udonanaumu-panel-geometry-v1';
  /** Legacy chat-only geometry (migrated into GEOMETRY_STORAGE_KEY / menu.chat). */
  private static readonly LEGACY_CHAT_GEOMETRY_KEY = 'udonanaumu-chat-window-geometry-v2';
  private static readonly geometries = new Map<string, PanelGeometry>();
  static geometryReady: Promise<void> = Promise.resolve();

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
  /** Size persistence key when tourPanelId is absent or per-instance. */
  geometryKey: string = null;

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

  /** Guided tour / singleton id for a character's chat palette panel. */
  static tourIdChatPalette(characterId: string): string {
    return characterId ? `char.palette.${characterId}` : '';
  }

  /** Guided tour / singleton id for a character's stand settings panel. */
  static tourIdStandSetting(characterId: string): string {
    return characterId ? `char.stand.${characterId}` : '';
  }

  /** Shared size key for object detail sheets (character / card / note / …). */
  static sheetGeometryKey(aliasName: string): string {
    return `sheet.${aliasName || 'object'}`;
  }

  /**
   * Stable key from Angular component selector (survives minification).
   * Used when open() has neither tourPanelId nor geometryKey.
   */
  static geometryKeyForComponent(childComponent: Type<any>): string {
    if (!childComponent) return '';
    const cmp = (childComponent as any).ɵcmp;
    const selector = cmp?.selectors?.[0]?.[0];
    if (typeof selector === 'string' && selector.length > 0) {
      return `panel.${selector}`;
    }
    if (typeof childComponent.name === 'string' && childComponent.name.length > 0) {
      return `panel.${childComponent.name}`;
    }
    return '';
  }

  /**
   * Collapse per-character tour ids so palette/stand size is shared across characters.
   */
  static normalizeGeometryKey(tourPanelIdOrKey: string): string {
    if (!tourPanelIdOrKey) return '';
    if (tourPanelIdOrKey.startsWith('char.palette.')) return 'char.palette';
    if (tourPanelIdOrKey.startsWith('char.stand.')) return 'char.stand';
    return tourPanelIdOrKey;
  }

  static resolveGeometryKey(option: PanelOption | { tourPanelId?: string; geometryKey?: string }): string {
    if (!option) return '';
    return PanelService.normalizeGeometryKey(option.geometryKey || option.tourPanelId || '');
  }

  /** Apply remembered width/height (and optionally left/top) onto option. */
  static applySavedGeometry(option: PanelOption, opts?: { includePosition?: boolean }): PanelOption {
    if (!option) return option;
    const key = PanelService.resolveGeometryKey(option);
    if (!key) return option;
    const g = PanelService.geometries.get(key);
    if (!g) return option;
    if (g.width >= 100) option.width = g.width;
    if (g.height >= 100) option.height = g.height;
    if (opts?.includePosition) {
      if (typeof g.left === 'number' && Number.isFinite(g.left)) option.left = g.left;
      if (typeof g.top === 'number' && Number.isFinite(g.top)) option.top = g.top;
    }
    return option;
  }

  static saveGeometry(tourPanelIdOrKey: string, width: number, height: number, left?: number, top?: number) {
    const key = PanelService.normalizeGeometryKey(tourPanelIdOrKey);
    if (!key || !(width >= 100) || !(height >= 100)) return;
    const prev = PanelService.geometries.get(key);
    const next: PanelGeometry = {
      width: Math.round(width),
      height: Math.round(height),
    };
    const leftOk = typeof left === 'number' && Number.isFinite(left);
    const topOk = typeof top === 'number' && Number.isFinite(top);
    if (leftOk) next.left = Math.round(left);
    else if (prev && typeof prev.left === 'number') next.left = prev.left;
    if (topOk) next.top = Math.round(top);
    else if (prev && typeof prev.top === 'number') next.top = prev.top;
    PanelService.geometries.set(key, next);
    const payload: { [id: string]: PanelGeometry } = {};
    PanelService.geometries.forEach((value, id) => { payload[id] = value; });
    localForage.setItem(PanelService.GEOMETRY_STORAGE_KEY, payload).catch(e => console.log(e));
  }

  static loadGeometryFromStorage(): Promise<void> {
    PanelService.geometryReady = Promise.all([
      localForage.getItem<{ [id: string]: PanelGeometry }>(PanelService.GEOMETRY_STORAGE_KEY),
      localForage.getItem<PanelGeometry>(PanelService.LEGACY_CHAT_GEOMETRY_KEY),
    ]).then(([map, legacyChat]) => {
      PanelService.geometries.clear();
      if (map && typeof map === 'object') {
        for (const id of Object.keys(map)) {
          const g = map[id];
          if (g && typeof g.width === 'number' && typeof g.height === 'number' && g.width >= 100 && g.height >= 100) {
            PanelService.geometries.set(id, {
              width: Math.round(g.width),
              height: Math.round(g.height),
              left: typeof g.left === 'number' && Number.isFinite(g.left) ? Math.round(g.left) : undefined,
              top: typeof g.top === 'number' && Number.isFinite(g.top) ? Math.round(g.top) : undefined,
            });
          }
        }
      }
      // One-time migrate chat window geometry into the shared store.
      if (legacyChat && typeof legacyChat.width === 'number' && typeof legacyChat.height === 'number'
        && legacyChat.width >= 100 && legacyChat.height >= 100 && !PanelService.geometries.has('menu.chat')) {
        PanelService.geometries.set('menu.chat', {
          width: Math.round(legacyChat.width),
          height: Math.round(legacyChat.height),
          left: typeof legacyChat.left === 'number' && Number.isFinite(legacyChat.left) ? Math.round(legacyChat.left) : undefined,
          top: typeof legacyChat.top === 'number' && Number.isFinite(legacyChat.top) ? Math.round(legacyChat.top) : undefined,
        });
        const payload: { [id: string]: PanelGeometry } = {};
        PanelService.geometries.forEach((value, id) => { payload[id] = value; });
        localForage.setItem(PanelService.GEOMETRY_STORAGE_KEY, payload).catch(e => console.log(e));
      }
    }).catch(e => console.log(e));
    return PanelService.geometryReady;
  }

  static getGeometry(tourPanelIdOrKey: string): PanelGeometry | null {
    const key = PanelService.normalizeGeometryKey(tourPanelIdOrKey);
    return key ? (PanelService.geometries.get(key) || null) : null;
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

  static openPanelsByTourId(tourPanelId: string): number {
    if (!tourPanelId) return 0;
    let n = 0;
    for (const panel of PanelService.openPanels) {
      if (panel.tourPanelId === tourPanelId) n++;
    }
    return n;
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

  /** True when this tour panel is the frontmost among all dynamically opened panels. */
  static isTourPanelTopmost(tourPanelId: string): boolean {
    const el = PanelService.getTourPanelElement(tourPanelId);
    if (!el) return false;
    let bestEl: HTMLElement = null;
    let bestZ = -Infinity;
    for (const panel of PanelService.openPanels) {
      if (!panel.panelComponentRef) continue;
      const panelEl = panel.panelComponentRef.instance?.draggablePanel?.nativeElement as HTMLElement | undefined;
      if (!panelEl?.isConnected) continue;
      const z = parseInt(panelEl.style.zIndex || '0', 10);
      const zSafe = Number.isFinite(z) ? z : 0;
      if (!bestEl || zSafe >= bestZ) {
        bestEl = panelEl;
        bestZ = zSafe;
      }
    }
    return bestEl === el;
  }

  /**
   * Raise the tour panel above other `.draggable-panel` peers (same stacking as appDraggable).
   * Restores minimize if needed. Returns false if no matching panel.
   */
  static bringTourPanelToFront(tourPanelId: string): boolean {
    if (!tourPanelId) return false;
    let best: PanelService = null;
    let bestEl: HTMLElement = null;
    let bestZ = -Infinity;
    for (const panel of PanelService.openPanels) {
      if (panel.tourPanelId !== tourPanelId || !panel.panelComponentRef) continue;
      const el = panel.panelComponentRef.instance?.draggablePanel?.nativeElement as HTMLElement | undefined;
      if (!el?.isConnected) continue;
      const z = parseInt(el.style.zIndex || '0', 10);
      const zSafe = Number.isFinite(z) ? z : 0;
      if (!best || zSafe >= bestZ) {
        best = panel;
        bestEl = el;
        bestZ = zSafe;
      }
    }
    if (!best || !bestEl) return false;

    const instance = best.panelComponentRef.instance as { isMinimized?: boolean; toggleMinimize?: (e?: Event) => void } | null;
    if (instance?.isMinimized && typeof instance.toggleMinimize === 'function') {
      instance.toggleMinimize();
    }

    const stacks = bestEl.ownerDocument.querySelectorAll<HTMLElement>('.draggable-panel');
    let topZindex = 0;
    let bottomZindex = 99999;
    stacks.forEach(elm => {
      const zIndex = parseInt(elm.style.zIndex || '0', 10);
      const zSafe = Number.isFinite(zIndex) ? zIndex : 0;
      if (topZindex < zSafe) topZindex = zSafe;
      if (zSafe < bottomZindex) bottomZindex = zSafe;
    });
    const selfZ = parseInt(bestEl.style.zIndex || '0', 10);
    const selfSafe = Number.isFinite(selfZ) ? selfZ : 0;
    if (topZindex <= selfSafe) return true;

    stacks.forEach(elm => {
      const zIndex = parseInt(elm.style.zIndex || '0', 10);
      const zSafe = Number.isFinite(zIndex) ? zIndex : 0;
      elm.style.zIndex = (zSafe - bottomZindex) + '';
    });
    bestEl.style.zIndex = (topZindex + 1) + '';
    return true;
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

    // Mobile: peek/half bottom sheet (height remembered). Desktop: restore last size for every panel type.
    // Position is left to the caller (chat restores left/top itself, then may nudge duplicates).
    let resolved: PanelOption = { ...(option || {}) };
    if (!resolved.geometryKey && !resolved.tourPanelId) {
      const autoKey = PanelService.geometryKeyForComponent(childComponent);
      if (autoKey) resolved.geometryKey = autoKey;
    }
    resolved = this.mobileLayout.adaptPanelOption(resolved);
    if (!this.mobileLayout.isMobile) {
      resolved = PanelService.applySavedGeometry(resolved);
    }
    if (resolved.title) childPanelService.title = resolved.title;
    if (resolved.top != null) childPanelService.top = resolved.top;
    if (resolved.left != null) childPanelService.left = resolved.left;
    if (resolved.width != null) childPanelService.width = resolved.width;
    if (resolved.height != null) childPanelService.height = resolved.height;
    if (resolved.tourPanelId) childPanelService.tourPanelId = resolved.tourPanelId;
    // Always keep a persistence key (normalized tour id, explicit key, or auto selector key).
    const geoKey = PanelService.resolveGeometryKey(resolved);
    if (geoKey) childPanelService.geometryKey = geoKey;

    if (this.mobileLayout.isMobile) {
      childPanelService.isAbleRotateButton = false;
      childPanelService.isAbleMinimizeButton = false;
      childPanelService.isAbleFullScreenButton = false;
      const panelInst = panelComponentRef.instance as any;
      if (panelInst) {
        panelInst.isMobileSheet = true;
        // Only two heights: peek / half (never fullscreen).
        const sheet = this.mobileLayout.resolveSheetSnap(resolved.mobileSheet);
        panelInst.isMobileSheetHalf = true;
        panelInst.mobileSheetSnap = sheet;
      }
    }

    let bodyComponentRef: ComponentRef<any> = panelComponentRef.instance.content.createComponent(childComponent);

    panelCdr.reattach();
    // Defer CD until after the caller assigns @Input (e.g. character / tabletopObject).
    // Sync detectChanges() here ran with null inputs and broke panels (standList TypeError → untitled).
    // Isolate body CD so a child template error does not leave the panel chrome undraggable.
    const runCd = () => {
      if (!panelComponentRef) return;
      try {
        bodyComponentRef?.changeDetectorRef?.detectChanges();
      } catch (e) {
        console.error('[PanelService] body detectChanges failed', e);
      }
      try {
        panelCdr.detectChanges();
      } catch (e) {
        console.error('[PanelService] panel detectChanges failed', e);
      }
      const panelOnChanges = panelComponentRef.instance as OnChanges;
      const bodyOnChanges = bodyComponentRef?.instance as OnChanges;
      if (bodyComponentRef && bodyOnChanges?.ngOnChanges != null) {
        try { bodyOnChanges.ngOnChanges({}); } catch (e) { console.error(e); }
      }
      if (panelOnChanges?.ngOnChanges != null) {
        try { panelOnChanges.ngOnChanges({}); } catch (e) { console.error(e); }
      }
    };
    queueMicrotask(runCd);

    panelComponentRef.onDestroy(() => {
      PanelService.openPanels.delete(childPanelService);
      childPanelService.panelComponentRef = null;
      panelComponentRef = null;
    });

    bodyComponentRef.onDestroy(() => {
      bodyComponentRef = null;
    });

    return <T>bodyComponentRef.instance;
  }

  close() {
    if (this.panelComponentRef) {
      this.panelComponentRef.destroy();
      this.panelComponentRef = null;
    }
  }
}
