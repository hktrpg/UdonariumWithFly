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
  private static readonly SINGLE_NON_CHAT_KEY = 'udonanaumu-panel-single-non-chat';
  private static readonly geometries = new Map<string, PanelGeometry>();
  static geometryReady: Promise<void> = Promise.resolve();

  /**
   * Personal setting: opening a non-chat panel closes other non-chat panels.
   * Default on. Desktop only (mobile sheets already replace each other).
   * Exception: Connection + Lobby are one group and may stay open together.
   */
  static singleNonChatWindow = true;

  /** Tour / geometry ids that share one exclusive slot (do not close each other). */
  private static readonly NON_CHAT_COMPAT_GROUPS: ReadonlyArray<ReadonlyArray<string>> = [
    ['menu.connection', 'menu.lobby'],
  ];

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
      // Drop chat size that was accidentally saved from open()'s shared 450×560 starter.
      const chatG = PanelService.geometries.get('menu.chat');
      if (chatG && chatG.width === 450 && chatG.height === 560) {
        PanelService.geometries.delete('menu.chat');
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

  /** Clear remembered panel sizes/positions (including chat). Next open uses defaults. */
  static clearSavedGeometry() {
    PanelService.geometries.clear();
    localForage.removeItem(PanelService.GEOMETRY_STORAGE_KEY).catch(() => {});
    localForage.removeItem(PanelService.LEGACY_CHAT_GEOMETRY_KEY).catch(() => {});
  }

  /** Close all closable desktop UI panels opened via PanelService.open(). */
  static closeAllPanels() {
    for (const panel of Array.from(PanelService.openPanels)) {
      if (panel.isAbleCloseButton) panel.close();
    }
  }

  /** Close the frontmost closable panel (highest z-index). Returns true if one closed. */
  static closeFrontmostPanel(): boolean {
    let best: PanelService = null;
    let bestZ = -Infinity;
    for (const panel of PanelService.openPanels) {
      if (!panel.isAbleCloseButton || !panel.panelComponentRef) continue;
      const el = panel.panelComponentRef.instance?.draggablePanel?.nativeElement as HTMLElement | undefined;
      if (!el?.isConnected) continue;
      const z = parseInt(el.style.zIndex || '0', 10);
      const zSafe = Number.isFinite(z) ? z : 0;
      if (!best || zSafe >= bestZ) {
        best = panel;
        bestZ = zSafe;
      }
    }
    if (!best) return false;
    best.close();
    return true;
  }

  static isChatPanel(panel: PanelService): boolean {
    return panel.tourPanelId === 'menu.chat' || panel.geometryKey === 'menu.chat';
  }

  static loadSingleNonChatFromStorage() {
    localForage.getItem(PanelService.SINGLE_NON_CHAT_KEY).then(v => {
      // Missing key → default ON. Explicit false turns it off.
      if (v === null || v === undefined) {
        PanelService.singleNonChatWindow = true;
      } else {
        PanelService.singleNonChatWindow = v !== false && v !== 0 && v !== '0';
      }
    }).catch(() => {});
  }

  static setSingleNonChatWindow(v: boolean) {
    PanelService.singleNonChatWindow = !!v;
    // Always persist so “off” is distinct from “never set” (default on).
    localForage.setItem(PanelService.SINGLE_NON_CHAT_KEY, !!v).catch(() => {});
  }

  static panelExclusiveId(panel: { tourPanelId?: string; geometryKey?: string } | null): string {
    if (!panel) return '';
    const raw = (panel.tourPanelId || panel.geometryKey || '').trim();
    // Auto geometry keys when tourPanelId was omitted.
    if (raw === 'panel.peer-menu') return 'menu.connection';
    if (raw === 'panel.lobby') return 'menu.lobby';
    return raw;
  }

  /** True when two non-chat panels may coexist under single-window mode (e.g. Connection + Lobby). */
  static areCompatibleNonChatPanels(aId: string, bId: string): boolean {
    if (!aId || !bId || aId === bId) return false;
    for (const group of PanelService.NON_CHAT_COMPAT_GROUPS) {
      if (group.includes(aId) && group.includes(bId)) return true;
    }
    return false;
  }

  /** Close every closable non-chat panel (optionally keep one instance + its compat group). */
  static closeOtherNonChatPanels(except: PanelService = null, opening: PanelOption = null) {
    const openingId = PanelService.panelExclusiveId(opening || except);
    for (const panel of Array.from(PanelService.openPanels)) {
      if (!panel.isAbleCloseButton) continue;
      if (PanelService.isChatPanel(panel)) continue;
      if (except && panel === except) continue;
      if (openingId && PanelService.areCompatibleNonChatPanels(PanelService.panelExclusiveId(panel), openingId)) {
        continue;
      }
      panel.close();
    }
  }

  /**
   * Safe insets so rearrange / chat defaults do not cover the desktop main menu (menu.main).
   * Vertical menu → reserve left/right; horizontal → top/bottom.
   */
  static getDesktopMenuInsets(gap: number = 8, margin: number = 8): { left: number; top: number; right: number; bottom: number } {
    const insets = { left: margin, top: margin, right: margin, bottom: margin };
    const el = document.querySelector('.draggable-panel[data-geometry-key="menu.main"]') as HTMLElement | null;
    if (!el?.isConnected) return insets;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return insets;

    const vertical = r.height >= r.width;
    if (vertical) {
      const centerX = r.left + r.width / 2;
      if (centerX < window.innerWidth / 2) {
        insets.left = Math.max(insets.left, Math.round(r.right) + gap);
      } else {
        insets.right = Math.max(insets.right, Math.round(window.innerWidth - r.left) + gap);
      }
    } else {
      const centerY = r.top + r.height / 2;
      if (centerY < window.innerHeight / 2) {
        insets.top = Math.max(insets.top, Math.round(r.bottom) + gap);
      } else {
        insets.bottom = Math.max(insets.bottom, Math.round(window.innerHeight - r.top) + gap);
      }
    }
    return insets;
  }

  /**
   * Tile open closable panels: chat column bottom-left (stacked up),
   * then other panels left→right, bottom→top. Skips / avoids the main menu.
   */
  static rearrangePanels() {
    const margin = 8;
    const gap = 8;
    const insets = PanelService.getDesktopMenuInsets(gap, margin);
    const availW = window.innerWidth;
    const availH = window.innerHeight;
    const maxRight = availW - insets.right;
    const maxBottom = availH - insets.bottom;

    const panels: PanelService[] = [];
    for (const panel of PanelService.openPanels) {
      if (!panel.isAbleCloseButton || !panel.panelComponentRef) continue;
      if (panel.geometryKey === 'menu.main') continue;
      const el = panel.panelComponentRef.instance?.draggablePanel?.nativeElement as HTMLElement | undefined;
      if (!el?.isConnected) continue;
      panels.push(panel);
    }
    if (panels.length < 1) return;

    for (const panel of panels) {
      const inst = panel.panelComponentRef.instance as {
        isFullScreen?: boolean;
        isMinimized?: boolean;
        toggleFullScreen?: (e?: Event) => void;
        toggleMinimize?: (e?: Event) => void;
      } | null;
      if (inst?.isFullScreen && typeof inst.toggleFullScreen === 'function') inst.toggleFullScreen();
      if (inst?.isMinimized && typeof inst.toggleMinimize === 'function') inst.toggleMinimize();
    }

    const chats = panels.filter(p => PanelService.isChatPanel(p));
    const others = panels.filter(p => !PanelService.isChatPanel(p));

    let chatRight = insets.left;
    let chatTopMost = maxBottom;

    let chatBottom = maxBottom;
    for (const chat of chats) {
      const w = Math.max(100, chat.width || 100);
      const h = Math.max(100, chat.height || 100);
      chat.left = insets.left;
      chat.top = Math.max(insets.top, chatBottom - h);
      chatBottom = chat.top - gap;
      chatRight = Math.max(chatRight, insets.left + w);
      chatTopMost = Math.min(chatTopMost, chat.top);
      PanelService.applyPanelPosition(chat);
    }

    let startX = chats.length ? chatRight + gap : insets.left;
    let cursorX = startX;
    let cursorBottom = maxBottom;
    let rowHeight = 0;

    for (const panel of others) {
      const w = Math.max(100, panel.width || 100);
      const h = Math.max(100, panel.height || 100);

      // Wrap to next row above when this panel does not fit on the current row.
      if (cursorX > startX && cursorX + w + insets.right > availW) {
        cursorBottom = cursorBottom - rowHeight - gap;
        cursorX = startX;
        rowHeight = 0;
      }
      // If even a fresh row at startX is too narrow (wide chat), wrap to left above chats.
      if (cursorX + w + insets.right > availW) {
        cursorX = insets.left;
        cursorBottom = Math.min(cursorBottom, chatTopMost) - gap;
        rowHeight = 0;
      }

      panel.left = Math.max(insets.left, Math.min(cursorX, Math.max(insets.left, maxRight - w)));
      panel.top = Math.max(insets.top, cursorBottom - h);
      cursorX = panel.left + w + gap;
      rowHeight = Math.max(rowHeight, h);
      PanelService.applyPanelPosition(panel);
    }
  }

  private static applyPanelPosition(panel: PanelService) {
    const key = panel.geometryKey || panel.tourPanelId;
    if (key) {
      PanelService.saveGeometry(key, panel.width, panel.height, panel.left, panel.top);
    }
    const cdr = panel.panelComponentRef?.changeDetectorRef;
    if (cdr) {
      try { cdr.detectChanges(); } catch { /* ignore */ }
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

    // Mobile: peek/half bottom sheet (height remembered). Desktop: restore last size;
    // non-chat panels also restore last left/top (chat applies position before open()).
    let resolved: PanelOption = { ...(option || {}) };
    if (!resolved.geometryKey && !resolved.tourPanelId) {
      const autoKey = PanelService.geometryKeyForComponent(childComponent);
      if (autoKey) resolved.geometryKey = autoKey;
    }
    resolved = this.mobileLayout.adaptPanelOption(resolved);
    if (!this.mobileLayout.isMobile) {
      const geoKey = PanelService.resolveGeometryKey(resolved);
      const isChat = geoKey === 'menu.chat' || resolved.tourPanelId === 'menu.chat';
      resolved = PanelService.applySavedGeometry(resolved, { includePosition: !isChat });
      // Compact map UI still needs enough room for toolbar + all blocks without clipping.
      if (geoKey === 'menu.table') {
        if ((resolved.width ?? 0) < 620) resolved.width = 620;
        if ((resolved.height ?? 0) < 520) resolved.height = 520;
      }
      // Personal setting: one non-chat window at a time (chat windows stay).
      // Connection + Lobby share a group and do not close each other.
      if (PanelService.singleNonChatWindow && !isChat) {
        PanelService.closeOtherNonChatPanels(childPanelService, resolved);
      }
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
      childPanelService.isAbleFullScreenButton = false;
      const isChat = geoKey === 'menu.chat' || resolved.tourPanelId === 'menu.chat';
      const panelInst = panelComponentRef.instance as any;
      if (isChat) {
        // Floating chat on mobile: drag, resize, minimize (−), close (×).
        // Bottom-sheet peek often hid the message list behind the composer.
        childPanelService.isAbleMinimizeButton = true;
        if (panelInst) panelInst.isMobileSheet = false;
        // adaptPanelOption wiped position — restore saved geometry, then clamp into chrome.
        PanelService.applySavedGeometry(resolved, { includePosition: true });
        const leftChrome = this.mobileLayout.leftChromePx;
        const bottomChrome = this.mobileLayout.bottomChromePx;
        const vw = this.mobileLayout.viewportWidth;
        const vh = this.mobileLayout.viewportHeight;
        const maxW = Math.max(200, vw - leftChrome - 16);
        const maxH = Math.max(200, vh - bottomChrome - 24);
        const w = Math.min(Math.max(resolved.width ?? 360, 280), maxW);
        const h = Math.min(Math.max(resolved.height ?? Math.round(maxH * 0.55), 240), maxH);
        const defaultLeft = leftChrome + 8;
        const defaultTop = Math.max(8, vh - h - bottomChrome - 8);
        let left = typeof resolved.left === 'number' && Number.isFinite(resolved.left) ? resolved.left : defaultLeft;
        let top = typeof resolved.top === 'number' && Number.isFinite(resolved.top) ? resolved.top : defaultTop;
        left = Math.max(leftChrome, Math.min(left, leftChrome + maxW - w));
        top = Math.max(8, Math.min(top, vh - bottomChrome - h - 8));
        childPanelService.width = w;
        childPanelService.height = h;
        childPanelService.left = left;
        childPanelService.top = top;
      } else if (panelInst) {
        childPanelService.isAbleMinimizeButton = true;
        panelInst.isMobileSheet = true;
        // Only two snap heights: peek / half (never fullscreen); resize can override.
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
    // Panel CD must run before body CD so ui-panel ngOnInit sets scrollablePanel
    // (chat-tab / chat-window attach scroll listeners in AfterViewInit).
    const runCd = () => {
      if (!panelComponentRef) return;
      try {
        panelCdr.detectChanges();
      } catch (e) {
        console.error('[PanelService] panel detectChanges failed', e);
      }
      try {
        bodyComponentRef?.changeDetectorRef?.detectChanges();
      } catch (e) {
        console.error('[PanelService] body detectChanges failed', e);
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
