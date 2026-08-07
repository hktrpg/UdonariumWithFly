import { AfterViewInit, ChangeDetectorRef, Component, ElementRef, HostListener, Input, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { ContextMenuAction, ContextMenuService } from 'service/context-menu.service';
import { PointerDeviceService } from 'service/pointer-device.service';
import { TabletopObject } from '@udonarium/tabletop-object';
import { PeerCursor } from '@udonarium/peer-cursor';
import { StringUtil } from '@udonarium/core/system/util/string-util';
import { Network } from '@udonarium/core/system';

@Component({
    selector: 'context-menu',
    templateUrl: './context-menu.component.html',
    styleUrls: ['./context-menu.component.css'],
    standalone: false
})
export class ContextMenuComponent implements OnInit, OnDestroy, AfterViewInit {
  @ViewChild('root', { static: true }) rootElementRef: ElementRef<HTMLElement>;
  @ViewChild('altitudeSlider') altitudeSlider: ElementRef<HTMLElement>;

  @Input() title: string = '';
  @Input() actions: ContextMenuAction[] = [];
  @Input() titleColor: string = PeerCursor.CHAT_DEFAULT_COLOR;
  @Input() titleBold = false;

  @Input() isSubmenu: boolean = false;

  parentMenu: ContextMenuAction;
  subMenu: ContextMenuAction[];

  showSubMenuTimer: NodeJS.Timeout;
  hideSubMenuTimer: NodeJS.Timeout;

  private callbackOnOutsideClick = (e) => this.onOutsideClick(e);

  get altitudeHande(): TabletopObject { 
    for (let action of this.actions) {
      if (action && action.altitudeHande) return action.altitudeHande;
    }
    return null;
  }

  get isAltitudeDisabled(): boolean {
    return this.actions.some(action => action && action.altitudeDisabled);
  }

  get isIconsMenu(): boolean {
    for (let action of this.actions) {
      if(!action || !action.icon) return false;
    }
    return true;
  }
  get isPointerDragging(): boolean { return this.pointerDeviceService.isDragging || this.pointerDeviceService.isTablePickGesture; }

  /** Root mobile bottom action sheet (More / toolbox / token menu). */
  isMobileActionSheet = false;
  sheetResizing = false;
  private static readonly SHEET_HEIGHT_KEY = 'udon.actionSheet.height';
  private sheetResizeStartY = 0;
  private sheetResizeStartH = 0;
  private readonly onSheetResizeMove = (e: PointerEvent) => this.moveSheetResize(e);
  private readonly onSheetResizeUp = () => this.endSheetResize();

  /** Mobile dark chrome: skip default #444 so CSS muted title shows; keep custom peer colors. */
  get titleColorStyle(): string | null {
    if (!this.titleColor) return null;
    const mobile = typeof document !== 'undefined' && document.body.classList.contains('udon-mobile-layout');
    if (mobile && this.titleColor === PeerCursor.CHAT_DEFAULT_COLOR) return null;
    return this.titleColor;
  }

  constructor(
    private elementRef: ElementRef<HTMLElement>,
    public contextMenuService: ContextMenuService,
    private pointerDeviceService: PointerDeviceService,
    private changeDetector: ChangeDetectorRef,
  ) { }

  GuestMode() {
    return Network.GuestMode();
  }


  ngOnInit() {
    if (!this.isSubmenu) {
      this.title = this.contextMenuService.title;
      this.actions = this.contextMenuService.actions;
      this.titleColor = this.contextMenuService.titleColor;
      this.titleBold = this.contextMenuService.titleBold;
    }
  }

  ngAfterViewInit() {
    if (!this.isSubmenu) {
      this.adjustPositionRoot();
      document.addEventListener('touchstart', this.callbackOnOutsideClick, true);
      document.addEventListener('mousedown', this.callbackOnOutsideClick, true);
    } else {
      this.adjustPositionSub();
    }
  }

  ngOnDestroy() {
    document.removeEventListener('touchstart', this.callbackOnOutsideClick, true);
    document.removeEventListener('mousedown', this.callbackOnOutsideClick, true);
    this.endSheetResize();
  }

  onOutsideClick(event) {
    if (this.rootElementRef.nativeElement.contains(event.target) === false) {
      const t = event.target as HTMLElement | null;
      // Let nav / HUD toggles close the menu themselves (mousedown would reopen otherwise).
      if (t?.closest?.('[data-tour-id="menu.more"], [data-tour-id="menu.toolbox"], [data-tour-id="menu.settings"], [data-tour-id="hud.add"]')) return;
      // Map HUD sits above the action sheet — using it should not dismiss toolbox/More.
      if (t?.closest?.('.map-action-hud')) return;
      this.close();
    }
  }

  @HostListener('contextmenu', ['$event'])
  onContextMenu(e: Event) {
    e.stopPropagation();
    e.preventDefault();

    if (this.GuestMode()) return;
  }

  /** Menu labels must not be text-selectable while clicking / dragging. */
  @HostListener('selectstart', ['$event'])
  onSelectStart(e: Event) {
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    e.preventDefault();
  }

  startSheetResize(e: PointerEvent) {
    if (!this.isMobileActionSheet || this.isSubmenu || e.button === 2) return;
    e.preventDefault();
    e.stopPropagation();
    const panel = this.rootElementRef.nativeElement;
    this.sheetResizing = true;
    this.sheetResizeStartY = e.clientY;
    this.sheetResizeStartH = panel.getBoundingClientRect().height;
    document.addEventListener('pointermove', this.onSheetResizeMove, { capture: true });
    document.addEventListener('pointerup', this.onSheetResizeUp, { capture: true });
    document.addEventListener('pointercancel', this.onSheetResizeUp, { capture: true });
  }

  private moveSheetResize(e: PointerEvent) {
    if (!this.sheetResizing) return;
    e.preventDefault();
    const panel = this.rootElementRef.nativeElement;
    const dy = this.sheetResizeStartY - e.clientY; // drag up → taller
    const next = this.clampSheetHeight(this.sheetResizeStartH + dy);
    panel.style.height = `${next}px`;
    panel.style.maxHeight = `${next}px`;
  }

  private endSheetResize() {
    if (!this.sheetResizing) {
      document.removeEventListener('pointermove', this.onSheetResizeMove, true);
      document.removeEventListener('pointerup', this.onSheetResizeUp, true);
      document.removeEventListener('pointercancel', this.onSheetResizeUp, true);
      return;
    }
    this.sheetResizing = false;
    document.removeEventListener('pointermove', this.onSheetResizeMove, true);
    document.removeEventListener('pointerup', this.onSheetResizeUp, true);
    document.removeEventListener('pointercancel', this.onSheetResizeUp, true);
    const panel = this.rootElementRef?.nativeElement;
    if (!panel) return;
    const h = this.clampSheetHeight(panel.getBoundingClientRect().height);
    panel.style.height = `${h}px`;
    panel.style.maxHeight = `${h}px`;
    try {
      sessionStorage.setItem(ContextMenuComponent.SHEET_HEIGHT_KEY, String(Math.round(h)));
    } catch { /* ignore */ }
    this.changeDetector.markForCheck();
  }

  private applySavedSheetHeight(panel: HTMLElement) {
    const max = this.sheetMaxHeight();
    const min = this.sheetMinHeight();
    let h = Math.min(max, Math.round(window.innerHeight * 0.56));
    try {
      const raw = sessionStorage.getItem(ContextMenuComponent.SHEET_HEIGHT_KEY);
      const saved = raw ? parseInt(raw, 10) : NaN;
      if (Number.isFinite(saved)) h = saved;
    } catch { /* ignore */ }
    h = Math.max(min, Math.min(max, h));
    panel.style.height = `${h}px`;
    panel.style.maxHeight = `${h}px`;
  }

  private clampSheetHeight(h: number): number {
    return Math.max(this.sheetMinHeight(), Math.min(this.sheetMaxHeight(), Math.round(h)));
  }

  private sheetMinHeight(): number {
    return 140;
  }

  private sheetMaxHeight(): number {
    const bottom = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--udon-bottom-chrome')) || 56;
    return Math.max(this.sheetMinHeight(), Math.round(window.innerHeight - bottom - 8));
  }

  private adjustPositionRoot() {
    let panel: HTMLElement = this.rootElementRef.nativeElement;
    const isMobile = document.body.classList.contains('udon-mobile-layout');

    // Mobile: bottom action sheet (same chrome family as chat half-sheet / nav).
    // Icon grids (faces etc.) stay floating near the pointer.
    if (isMobile && !this.isIconsMenu) {
      this.isMobileActionSheet = true;
      panel.classList.add('is-mobile-action-sheet');
      panel.style.left = '';
      panel.style.top = '';
      panel.style.right = '';
      panel.style.bottom = '';
      this.applySavedSheetHeight(panel);
      this.changeDetector.detectChanges();
      this.syncAltitudeSliderHeight(panel);
      return;
    }

    this.isMobileActionSheet = false;
    panel.classList.remove('is-mobile-action-sheet');
    panel.style.height = '';
    panel.style.maxHeight = '';

    // Size altitude slider from list content before measuring position (avoids viewport-tall menus).
    this.syncAltitudeSliderHeight(panel);

    // Nudge away from the cursor so the menu does not cover the target token.
    const OFFSET_X = 20;
    const OFFSET_Y = 4;
    panel.style.left = (this.contextMenuService.position.x + OFFSET_X) + 'px';
    panel.style.top = (this.contextMenuService.position.y + OFFSET_Y) + 'px';

    let panelBox = panel.getBoundingClientRect();

    let diffLeft = 0;
    let diffTop = 0;

    // On mobile, reserve bottom nav so the menu is not covered / clipped under it.
    const bottomReserve = isMobile
      ? (parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--udon-bottom-chrome')) || 56)
      : 0;
    const maxBottom = window.innerHeight - bottomReserve;

    if (window.innerWidth < panelBox.right + diffLeft) {
      diffLeft += window.innerWidth - (panelBox.right + diffLeft);
    }
    if (panelBox.left + diffLeft < 0) {
      diffLeft += 0 - (panelBox.left + diffLeft);
    }

    if (maxBottom < panelBox.bottom + diffTop) {
      diffTop += maxBottom - (panelBox.bottom + diffTop);
    }
    if (panelBox.top + diffTop < 0) {
      diffTop += 0 - (panelBox.top + diffTop);
    }

    panel.style.left = panel.offsetLeft + diffLeft + 'px';
    panel.style.top = panel.offsetTop + diffTop + 'px';

    // Re-sync after position clamp (list viewport height may change).
    this.syncAltitudeSliderHeight(panel);
  }

  /** Keep altitude range matched to the action list, not the full viewport. */
  private syncAltitudeSliderHeight(panel: HTMLElement) {
    if (!this.altitudeSlider) return;
    const slider = this.altitudeSlider.nativeElement;
    if (this.isMobileActionSheet) {
      slider.style.height = Math.max(120, panel.clientHeight - 72) + 'px';
      return;
    }
    const actions = panel.querySelector('.sheet-actions') as HTMLElement | null;
    const listH = actions?.scrollHeight || 0;
    const bodyMax = Math.min(320, Math.max(96, window.innerHeight - 64));
    // Match visible list column; never inflate the floating menu to viewport height.
    const h = Math.max(96, Math.min(listH || 160, bodyMax));
    slider.style.height = `${h}px`;
  }

  private adjustPositionSub() {
    let parent: HTMLElement = this.elementRef.nativeElement.parentElement;
    let submenu: HTMLElement = this.rootElementRef.nativeElement;
    const isMobile = document.body.classList.contains('udon-mobile-layout');

    // Inside mobile action sheet: expand inline (no floating sub-panel).
    if (isMobile && parent?.closest?.('.is-mobile-action-sheet')) {
      submenu.classList.add('is-mobile-action-sheet');
      submenu.style.left = '';
      submenu.style.top = '';
      return;
    }

    let parentBox = parent.getBoundingClientRect();
    let submenuBox = submenu.getBoundingClientRect();

    let diffLeft = 0;
    let diffTop = 0;

    const bottomReserve = isMobile
      ? (parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--udon-bottom-chrome')) || 56)
      : 0;
    const maxBottom = window.innerHeight - bottomReserve;

    if (window.innerWidth < submenuBox.right + diffLeft) {
      diffLeft -= parentBox.width + submenuBox.width;
      diffLeft += 8;
    }
    if (submenuBox.left + diffLeft < 0) {
      diffLeft += 0 - (submenuBox.left + diffLeft);
    }

    if (maxBottom < submenuBox.bottom + diffTop) {
      diffTop += maxBottom - (submenuBox.bottom + diffTop);
    }
    if (submenuBox.top + diffTop < 0) {
      diffTop += 0 - (submenuBox.top + diffTop);
    }

    submenu.style.left = submenu.offsetLeft + diffLeft + 'px';
    submenu.style.top = submenu.offsetTop + diffTop + 'px';
  }

  doAction(action: ContextMenuAction) {
    this.showSubMenu(action, { fromClick: true });
    if (action.action == null) return;

    // Capture before action: nested open() (e.g. More → Toolbox) replaces this menu.
    const serialBefore = this.contextMenuService.serial;
    const host = this.rootElementRef?.nativeElement;
    action.action();
    if (serialBefore !== this.contextMenuService.serial) return;
    if (host && !host.isConnected) return;

    this.refreshActionVisual(action);

    // Checkbox / radio stay open so users can toggle several options.
    // Normal one-shot actions close. Explicit keepOpen overrides.
    const stayOpen = action.keepOpen === true
      || (action.keepOpen !== false && !!action.checkBox);
    if (!stayOpen) {
      this.close();
      return;
    }
    this.changeDetector.detectChanges();
  }

  private refreshActionVisual(action: ContextMenuAction) {
    const refreshList = (list: ContextMenuAction[]) => {
      for (const a of list) {
        if (!a) continue;
        if (typeof a.nameUpdate === 'function') {
          a.name = a.nameUpdate() ?? a.name;
        }
        if (a.subActions?.length) refreshList(a.subActions);
      }
    };

    // Prefer live nameUpdate when present (and refresh siblings / nested menus that also use it).
    if (typeof action.nameUpdate === 'function') {
      refreshList(this.actions);
      if (this.subMenu) refreshList(this.subMenu);
      // Radio: force the clicked row selected. nameUpdate may still see pre-action /
      // mid-animation state (e.g. day/night darkness tween), which would leave the
      // wrong ◉ until the menu is reopened.
      if (action.checkBox === 'radio' && action.name) {
        const list = this.subMenu && this.subMenu.includes(action) ? this.subMenu : this.actions;
        for (const a of list) {
          if (!a || a.checkBox !== 'radio' || !a.name) continue;
          if (a === action) a.name = a.name.replace(/^[◉○]/, '◉');
          else a.name = a.name.replace(/^[◉○]/, '○');
        }
      }
      return;
    }

    if (action.checkBox === 'check' && action.name) {
      if (action.name.startsWith('☑')) action.name = '☐' + action.name.substring(1);
      else if (action.name.startsWith('☐')) action.name = '☑' + action.name.substring(1);
      return;
    }
    if (action.checkBox === 'radio' && action.name) {
      const list = this.subMenu && this.subMenu.includes(action) ? this.subMenu : this.actions;
      for (const a of list) {
        if (!a || a.checkBox !== 'radio' || !a.name) continue;
        if (typeof a.nameUpdate === 'function') {
          a.name = a.nameUpdate() ?? a.name;
          continue;
        }
        if (a === action) a.name = a.name.replace(/^[◉○]/, '◉');
        else a.name = a.name.replace(/^[◉○]/, '○');
      }
    }
  }

  showSubMenu(action: ContextMenuAction, opts?: { fromClick?: boolean }) {
    if (this.GuestMode()) return;
    if (action.subActions == null || action.subActions.length < 1) return;

    const host = this.rootElementRef?.nativeElement;
    const mobileSheet = !!(host?.classList?.contains('is-mobile-action-sheet')
      || host?.closest?.('.is-mobile-action-sheet'));

    // Touch action sheets synthesize sticky hover — only expand/collapse from click.
    if (mobileSheet && !opts?.fromClick) return;

    clearTimeout(this.showSubMenuTimer);

    // Second tap on the same row collapses the inline submenu.
    if (opts?.fromClick && this.parentMenu === action && this.subMenu) {
      clearTimeout(this.hideSubMenuTimer);
      this.parentMenu = null;
      this.subMenu = null;
      this.changeDetector.detectChanges();
      return;
    }

    this.hideSubMenu();
    const delay = mobileSheet ? 0 : 250;
    this.showSubMenuTimer = setTimeout(() => {
      this.parentMenu = action;
      this.subMenu = action.subActions;
      clearTimeout(this.hideSubMenuTimer);
      this.changeDetector.detectChanges();
    }, delay);
  }

  hideSubMenu() {
    clearTimeout(this.hideSubMenuTimer);
    this.hideSubMenuTimer = setTimeout(() => {
      this.subMenu = null;
    }, 1200);
  }

  close() {
    if (this.contextMenuService) this.contextMenuService.close();
  }

  actionNameHtmlEscape(str, checkBox=null) {
    if (str == null) return '';
    if (checkBox == 'check') str = str.replace(/^[☑☐]/, '');
    if (checkBox == 'radio') str = str.replace(/^[◉○]/, '');
    return StringUtil.escapeHtml(str).replace(/💭/g, '<span style="text-shadow: #111 0 0 1px">💭</span>');
  }
}
