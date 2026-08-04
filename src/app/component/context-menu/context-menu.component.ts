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
  }

  onOutsideClick(event) {
    if (this.rootElementRef.nativeElement.contains(event.target) === false) {
      this.close();
    }
  }

  @HostListener('contextmenu', ['$event'])
  onContextMenu(e: Event) {
    e.stopPropagation();
    e.preventDefault();

    if (this.GuestMode()) return;
  }

  private adjustPositionRoot() {
    let panel: HTMLElement = this.rootElementRef.nativeElement;

    // Nudge away from the cursor so the menu does not cover the target token.
    const OFFSET_X = 20;
    const OFFSET_Y = 4;
    panel.style.left = (this.contextMenuService.position.x + OFFSET_X) + 'px';
    panel.style.top = (this.contextMenuService.position.y + OFFSET_Y) + 'px';

    let panelBox = panel.getBoundingClientRect();

    let diffLeft = 0;
    let diffTop = 0;

    if (window.innerWidth < panelBox.right + diffLeft) {
      diffLeft += window.innerWidth - (panelBox.right + diffLeft);
    }
    if (panelBox.left + diffLeft < 0) {
      diffLeft += 0 - (panelBox.left + diffLeft);
    }

    if (window.innerHeight < panelBox.bottom + diffTop) {
      diffTop += window.innerHeight - (panelBox.bottom + diffTop);
    }
    if (panelBox.top + diffTop < 0) {
      diffTop += 0 - (panelBox.top + diffTop);
    }

    panel.style.left = panel.offsetLeft + diffLeft + 'px';
    panel.style.top = panel.offsetTop + diffTop + 'px';

    if (this.altitudeSlider) {
      this.altitudeSlider.nativeElement.style.height = (panel.clientHeight - 72) + 'px';
    }
  }

  private adjustPositionSub() {
    let parent: HTMLElement = this.elementRef.nativeElement.parentElement;
    let submenu: HTMLElement = this.rootElementRef.nativeElement;

    let parentBox = parent.getBoundingClientRect();
    let submenuBox = submenu.getBoundingClientRect();

    let diffLeft = 0;
    let diffTop = 0;

    if (window.innerWidth < submenuBox.right + diffLeft) {
      diffLeft -= parentBox.width + submenuBox.width;
      diffLeft += 8;
    }
    if (submenuBox.left + diffLeft < 0) {
      diffLeft += 0 - (submenuBox.left + diffLeft);
    }

    if (window.innerHeight < submenuBox.bottom + diffTop) {
      diffTop += window.innerHeight - (submenuBox.bottom + diffTop);
    }
    if (submenuBox.top + diffTop < 0) {
      diffTop += 0 - (submenuBox.top + diffTop);
    }

    submenu.style.left = submenu.offsetLeft + diffLeft + 'px';
    submenu.style.top = submenu.offsetTop + diffTop + 'px';
  }

  doAction(action: ContextMenuAction) {
    this.showSubMenu(action);
    if (action.action == null) return;

    action.action();
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

  showSubMenu(action: ContextMenuAction) {
    if (this.GuestMode()) return;
    this.hideSubMenu();
    clearTimeout(this.showSubMenuTimer);
    if (action.subActions == null || action.subActions.length < 1) return;
    this.showSubMenuTimer = setTimeout(() => {
      this.parentMenu = action;
      this.subMenu = action.subActions;
      clearTimeout(this.hideSubMenuTimer);
    }, 250);
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
