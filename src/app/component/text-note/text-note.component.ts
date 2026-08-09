import {
  AfterViewChecked,
  AfterViewInit,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  ElementRef,
  HostListener,
  Input,
  NgZone,
  OnChanges,
  OnDestroy,
  ViewChild
} from '@angular/core';
import { ImageFile } from '@udonarium/core/file-storage/image-file';
import { renderPdfPage } from '@udonarium/core/file-storage/pdf-render';
import { PdfStorage } from '@udonarium/core/file-storage/pdf-storage';
import { ObjectStore } from '@udonarium/core/synchronize-object/object-store';
import { EventSystem, Network } from '@udonarium/core/system';
import { MathUtil } from '@udonarium/core/system/util/math-util';
import { StringUtil } from '@udonarium/core/system/util/string-util';
import { PeerCursor } from '@udonarium/peer-cursor';
import { PresetSound, SoundEffect } from '@udonarium/sound-effect';
import { TableSelecter } from '@udonarium/table-selecter';
import { TextNote } from '@udonarium/text-note';
import { buildNoteHandoutPayload } from 'component/note-handout/note-handout.component';
import { NoteSettingsComponent } from 'component/note-settings/note-settings.component';
import { OpenUrlComponent } from 'component/open-url/open-url.component';
import { InputHandler } from 'directive/input-handler';
import { MovableOption } from 'directive/movable.directive';
import { RotableOption } from 'directive/rotable.directive';
import { PAPER_STYLES } from '@udonarium/table-fx/push-pin.util';
import { CharacterFxMenuService } from 'service/character-fx-menu.service';
import { ContextMenuAction, ContextMenuSeparator, ContextMenuService, contextMenuToggleCheck } from 'service/context-menu.service';
import { I18nService } from 'service/i18n.service';
import { ModalService } from 'service/modal.service';
import { PanelOption, PanelService } from 'service/panel.service';
import { CoordinateService } from 'service/coordinate.service';
import { PointerDeviceService } from 'service/pointer-device.service';
import { SelectionState, TabletopSelectionService } from 'service/tabletop-selection.service';
import { TabletopActionService } from 'service/tabletop-action.service';

@Component({
  selector: 'text-note',
  templateUrl: './text-note.component.html',
  styleUrls: ['./text-note.component.css', '../shared/clue-board.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: false
})
export class TextNoteComponent implements OnChanges, OnDestroy, AfterViewInit, AfterViewChecked {
  @ViewChild('textArea') textAreaElementRef: ElementRef<HTMLTextAreaElement>;
  @ViewChild('pdfCanvas') pdfCanvasRef: ElementRef<HTMLCanvasElement>;
  @ViewChild('resizeGrab') resizeGrabRef: ElementRef<HTMLElement>;

  @Input() textNote: TextNote = null;
  @Input() is3D: boolean = false;

  get title(): string { return this.textNote.title; }
  get text(): string { this.calcFitHeightIfNeeded(); return this.textNote.text; }
  set text(text: string) { this.calcFitHeightIfNeeded(); this.textNote.text = text; }
  get color(): string { return this.textNote.color; }
  set color(color: string) { this.textNote.color = color; }

  get textShadowCss(): string {
    const shadow = StringUtil.textShadowColor(this.color, '#f2f2f2', '#000000');
    return `${shadow} 0px 0px 0.5px, ${shadow} 0px 0px 0.5px, ${shadow} 0px 0px 0.5px, ${shadow} 0px 0px 0.5px`;
  }

  get fontSize(): number { this.calcFitHeightIfNeeded(); return this.textNote.fontSize; }
  get imageFile(): ImageFile { return this.textNote.imageFile; }
  get rotate(): number { return this.textNote.rotate; }
  set rotate(rotate: number) { this.textNote.rotate = rotate; }
  get height(): number { return MathUtil.clampMin(this.textNote.height); }
  get width(): number { return MathUtil.clampMin(this.textNote.width); }
  get altitude(): number { return this.textNote.altitude; }
  set altitude(altitude: number) { this.textNote.altitude = altitude; }

  get textNoteAltitude(): number {
    let ret = this.altitude;
    if (this.isUpright && this.altitude < 0) {
      if (-this.height <= this.altitude) return 0;
      ret += this.height;
    }
    return +ret.toFixed(1);
  }

  /** Room 2D mode: notes lie flat on the board (no billboard upright). */
  get is2DMode(): boolean { return !!TableSelecter.instance?.viewTable?.is2DMode; }
  get isUpright(): boolean { return this.is2DMode ? false : this.textNote.isUpright; }
  set isUpright(isUpright: boolean) {
    if (this.is2DMode) return; // 2D boards always render flat; keep stored preference for 3D maps
    this.textNote.isUpright = isUpright;
  }
  get isAltitudeIndicate(): boolean { return this.textNote.isAltitudeIndicate; }
  set isAltitudeIndicate(isAltitudeIndicate: boolean) { this.textNote.isAltitudeIndicate = isAltitudeIndicate; }
  get isLocked(): boolean { return this.textNote.isLocked; }
  set isLocked(isLocked: boolean) { this.textNote.isLocked = isLocked; }
  get isShowTitle(): boolean { return this.textNote.isShowTitle; }
  set isShowTitle(isShowTitle: boolean) { this.textNote.isShowTitle = isShowTitle; }
  get titleBgColor(): string {
    const c = this.textNote.titleBgColor || '#1e1e1e';
    return /^#[0-9a-fA-F]{6}$/.test(c) ? c : '#1e1e1e';
  }
  /** Contrast text on the title bar. */
  get titleFgColor(): string {
    return StringUtil.textShadowColor(this.titleBgColor, '#f2f2f2', '#222222');
  }
  get isWhiteOut(): boolean { return this.textNote.isWhiteOut; }
  set isWhiteOut(isWhiteOut: boolean) { this.textNote.isWhiteOut = isWhiteOut; }
  get isGhosted(): boolean { return !!this.textNote?.isGhosted; }
  get contentKind() { return this.textNote?.contentKind || 'text'; }
  get isPdfContent(): boolean { return this.contentKind === 'pdf'; }
  get isVideoContent(): boolean { return this.contentKind === 'video'; }
  get isImageContent(): boolean { return this.contentKind === 'image'; }
  get isTextContent(): boolean { return this.contentKind === 'text'; }
  get videoSrc(): string { return this.textNote?.resolvedVideoUrl || ''; }
  get paperStyle(): string { return this.textNote?.paperStyle || 'none'; }
  get pushPin(): boolean { return !!this.textNote?.pushPin; }
  get pushPinAngle(): number { return this.textNote?.pushPinAngle || 0; }
  get pushPinColor(): string { return this.textNote?.pushPinColor || 'red'; }

  get isEditorSelected(): boolean {
    return !!this.textAreaElementRef?.nativeElement && document.activeElement === this.textAreaElementRef.nativeElement;
  }
  get isActive(): boolean { return this.isEditorSelected; }
  get selectionState(): SelectionState { return this.selectionService.state(this.textNote); }
  get isSelected(): boolean { return this.selectionState !== SelectionState.NONE; }
  get isMagnetic(): boolean { return this.selectionState === SelectionState.MAGNETIC; }
  get rubiedText(): string { return StringUtil.rubyToHtml(StringUtil.escapeHtml(this.text)); }

  private callbackOnMouseUp = (e) => this.onMouseUp(e);
  gridSize = 50;
  math = Math;
  private calcFitHeightTimer: NodeJS.Timeout = null;
  movableOption: MovableOption = {};
  rotableOption: RotableOption = {};
  viewRotateZ = 10;
  private input: InputHandler = null;
  private resizeInput: InputHandler = null;
  private resizeBoundEl: HTMLElement = null;
  private dragStarted = false;
  private needsPdfRender = false;
  private lastPdfKey = '';
  private selfPreviewOpen = false;
  private isHovering = false;
  private ctrlHeld = false;
  private resizeStartW = 1;
  private resizeStartH = 1;
  private resizeStartTable = { x: 0, y: 0 };

  get isInverse(): boolean {
    const rotate = Math.abs(this.viewRotateZ + this.rotate) % 360;
    return 90 < rotate && rotate < 270;
  }

  constructor(
    private ngZone: NgZone,
    private contextMenuService: ContextMenuService,
    private elementRef: ElementRef<HTMLElement>,
    private panelService: PanelService,
    private changeDetector: ChangeDetectorRef,
    private pointerDeviceService: PointerDeviceService,
    private modalService: ModalService,
    private selectionService: TabletopSelectionService,
    private tabletopActionService: TabletopActionService,
    private characterFxMenu: CharacterFxMenuService,
    private coordinateService: CoordinateService,
    private i18n: I18nService
  ) { }

  GuestMode() { return Network.GuestMode(); }

  ngOnChanges(): void {
    EventSystem.unregister(this);
    EventSystem.register(this)
      .on(`UPDATE_GAME_OBJECT/identifier/${this.textNote?.identifier}`, () => {
        this.queuePdfRender();
        this.changeDetector.markForCheck();
      })
      .on(`UPDATE_OBJECT_CHILDREN/identifier/${this.textNote?.identifier}`, () => this.changeDetector.markForCheck())
      .on('SYNCHRONIZE_FILE_LIST', () => { this.queuePdfRender(); this.changeDetector.markForCheck(); })
      .on('UPDATE_FILE_RESOURE', () => this.changeDetector.markForCheck())
      .on('UPDATE_PDF_RESOURE', () => { this.queuePdfRender(); this.changeDetector.markForCheck(); })
      .on('UPDATE_VIDEO_RESOURE', () => this.changeDetector.markForCheck())
      .on('SYNCHRONIZE_VIDEO_LIST', () => this.changeDetector.markForCheck())
      .on<object>('TABLE_VIEW_ROTATE', -1000, event => {
        this.ngZone.run(() => {
          this.viewRotateZ = event.data['z'];
          this.changeDetector.markForCheck();
        });
      })
      .on(`UPDATE_SELECTION/identifier/${this.textNote?.identifier}`, () => this.changeDetector.markForCheck())
      .on('SELECT_GAME_TABLE', () => this.changeDetector.markForCheck());
    this.movableOption = {
      tabletopObject: this.textNote,
      transformCssOffset: 'translateZ(0.17px)',
      colideLayers: ['terrain']
    };
    this.rotableOption = {
      tabletopObject: this.textNote,
      grabbingSelecter: '.rotate-grab',
    };
    this.queuePdfRender();
  }

  ngAfterViewInit() {
    this.ngZone.runOutsideAngular(() => {
      this.input = new InputHandler(this.elementRef.nativeElement);
    });
    this.input.onStart = this.onInputStart.bind(this);
    this.bindResizeHandle();
  }

  ngAfterViewChecked() {
    if (this.needsPdfRender && this.isPdfContent && this.pdfCanvasRef?.nativeElement) {
      this.needsPdfRender = false;
      this.renderPdf();
    }
    this.bindResizeHandle();
  }

  ngOnDestroy() {
    this.closeSelfPreview();
    EventSystem.unregister(this);
    this.input?.destroy();
    this.resizeInput?.destroy();
    this.resizeInput = null;
  }

  private bindResizeHandle() {
    const el = this.resizeGrabRef?.nativeElement || null;
    if (!el) {
      this.resizeInput?.destroy();
      this.resizeInput = null;
      this.resizeBoundEl = null;
      return;
    }
    if (this.resizeBoundEl === el && this.resizeInput) return;
    this.resizeInput?.destroy();
    this.resizeBoundEl = el;
    this.ngZone.runOutsideAngular(() => {
      this.resizeInput = new InputHandler(el);
      this.resizeInput.onStart = (ev) => this.onResizeStart(ev);
      this.resizeInput.onMove = () => this.onResizeMove();
      this.resizeInput.onEnd = () => this.onResizeEnd();
    });
  }

  private onResizeStart(ev: MouseEvent | TouchEvent) {
    ev?.stopPropagation?.();
    if (this.GuestMode() || this.isLocked || this.textNote?.isSizeLocked) {
      this.resizeInput?.cancel();
      return;
    }
    const table = this.coordinateService.calcTabletopLocalCoordinate();
    this.resizeStartTable = { x: table.x, y: table.y };
    this.resizeStartW = this.width;
    this.resizeStartH = this.height;
  }

  private onResizeMove() {
    if (this.GuestMode() || this.isLocked || this.textNote?.isSizeLocked) return;
    const cur = this.coordinateService.calcTabletopLocalCoordinate();
    const dx = cur.x - this.resizeStartTable.x;
    const dy = cur.y - this.resizeStartTable.y;
    const rad = (-(this.rotate || 0) * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const localDx = dx * cos - dy * sin;
    // Flat notes tip so paper height grows with table +Y; flip if upright billboard.
    const localDy = this.isUpright ? -(dx * sin + dy * cos) : (dx * sin + dy * cos);
    let w = MathUtil.clampMin(this.resizeStartW + localDx / this.gridSize);
    let h = MathUtil.clampMin(this.resizeStartH + localDy / this.gridSize);
    w = Math.min(40, Math.max(1, Math.round(w * 2) / 2));
    h = Math.min(40, Math.max(1, Math.round(h * 2) / 2));
    this.ngZone.run(() => {
      // Free width/height — no aspect lock for A4 / sticky.
      this.textNote.width = w;
      this.textNote.height = h;
      this.changeDetector.markForCheck();
    });
  }

  private onResizeEnd() {
    this.changeDetector.markForCheck();
  }

  @HostListener('dragstart', ['$event'])
  onDragstart(e) {
    e.stopPropagation();
    e.preventDefault();
  }

  onInputStart(e: any) {
    this.dragStarted = false;
    this.input.cancel();
    if (this.isLocked) {
      EventSystem.trigger('DRAG_LOCKED_OBJECT', { srcEvent: e });
    }
  }

  @HostListener('mouseenter', ['$event'])
  onMouseEnter(e: MouseEvent) {
    this.isHovering = true;
    this.ctrlHeld = !!(e.ctrlKey || e.metaKey);
    this.syncSelfPreview();
  }

  @HostListener('mousemove', ['$event'])
  onMouseMove(e: MouseEvent) {
    this.isHovering = true;
    this.ctrlHeld = !!(e.ctrlKey || e.metaKey);
    this.syncSelfPreview();
  }

  @HostListener('mouseleave')
  onMouseLeave() {
    this.isHovering = false;
    // Hack: keep Ctrl preview until Ctrl is released (mouse leave alone does not close).
  }

  @HostListener('window:keydown', ['$event'])
  onWindowKeyDown(e: KeyboardEvent) {
    if (e.key !== 'Control' && e.key !== 'Meta') return;
    this.ctrlHeld = true;
    this.syncSelfPreview();
  }

  @HostListener('window:keyup', ['$event'])
  onWindowKeyUp(e: KeyboardEvent) {
    if (e.key !== 'Control' && e.key !== 'Meta') return;
    this.ctrlHeld = false;
    this.closeSelfPreview();
  }

  @HostListener('window:blur')
  onWindowBlur() {
    this.ctrlHeld = false;
    this.closeSelfPreview();
  }

  @HostListener('mousedown', ['$event'])
  onMouseDown(e: any) {
    if (this.GuestMode()) return;
    if (e.ctrlKey || e.metaKey) return;
    if (this.isActive || this.isLocked) return;
    e.preventDefault();
    this.textNote.toTopmost();
    if (e.button === 2) {
      EventSystem.trigger('DRAG_LOCKED_OBJECT', { srcEvent: e });
      return;
    }
    this.addMouseEventListeners();
  }

  onMouseUp(e: any) {
    if (this.pointerDeviceService.isAllowedToOpenContextMenu && this.isTextContent && this.textAreaElementRef?.nativeElement) {
      const selection = window.getSelection();
      if (!selection.isCollapsed) selection.removeAllRanges();
      this.textAreaElementRef.nativeElement.focus();
    }
    this.removeMouseEventListeners();
    e.preventDefault();
  }

  onRotateMouseDown(e: any) {
    e.stopPropagation();
    e.preventDefault();
  }

  @HostListener('contextmenu', ['$event'])
  onContextMenu(e: Event) {
    this.removeMouseEventListeners();
    if (this.GuestMode()) return;
    if (this.isActive) return;
    e.stopPropagation();
    e.preventDefault();
    if (!this.pointerDeviceService.isAllowedToOpenContextMenu) return;
    const position = this.pointerDeviceService.pointers[0];
    let menuActions: ContextMenuAction[] = [];
    menuActions = menuActions.concat(this.makeSelectionContextMenu());
    menuActions = menuActions.concat(this.makeContextMenu());
    this.contextMenuService.open(position, menuActions, this.title);
  }

  onMove() {
    this.dragStarted = true;
    this.contextMenuService.close();
    SoundEffect.play(PresetSound.cardPick);
  }

  onMoved() {
    SoundEffect.play(PresetSound.cardPut);
  }

  prevPdfPage(e: Event) {
    e.stopPropagation();
    e.preventDefault();
    this.textNote.prevPdfPage();
    this.queuePdfRender();
  }

  nextPdfPage(e: Event) {
    e.stopPropagation();
    e.preventDefault();
    this.textNote.nextPdfPage();
    this.queuePdfRender();
  }

  private makeSelectionContextMenu(): ContextMenuAction[] {
    if (this.selectionService.size <= 1) return [];
    const objectPosition = { x: this.textNote.location.x, y: this.textNote.location.y, z: this.textNote.posZ };
    return [
      { name: this.i18n.t('textNote.menu.1'), hotkey: 'T', action: () => this.selectionService.congregate(objectPosition) },
      ContextMenuSeparator,
    ];
  }

  private makeContextMenu(): ContextMenuAction[] {
    const objectPosition = {
      x: this.textNote.location.x + (this.width * this.gridSize) / 2,
      y: this.textNote.location.y + (this.height * this.gridSize) / 2,
      z: this.textNote.posZ
    };

    const actions: ContextMenuAction[] = [
      {
        name: this.isLocked ? this.i18n.t('textNote.menu.2') : this.i18n.t('textNote.menu.3'),
        nameUpdate: () => this.isLocked ? this.i18n.t('textNote.menu.2') : this.i18n.t('textNote.menu.3'),
        action: () => {
          this.isLocked = !this.isLocked;
          SoundEffect.play(this.isLocked ? PresetSound.lock : PresetSound.unlock);
          this.changeDetector.markForCheck();
        },
        checkBox: 'check',
        hotkey: 'L',
      },
      {
        name: this.textNote.isSelfOnly
          ? this.i18n.t('note.showEveryone')
          : this.i18n.t('note.selfOnly'),
        nameUpdate: () => this.textNote.isSelfOnly
          ? this.i18n.t('note.showEveryone')
          : this.i18n.t('note.selfOnly'),
        action: () => {
          this.textNote.setSelfOnly(!this.textNote.isSelfOnly);
          this.changeDetector.markForCheck();
        },
      },
      contextMenuToggleCheck({
        get: () => this.textNote.isFlipped,
        set: v => { this.textNote.isFlipped = v; },
        on: this.i18n.t('note.flipped'),
        off: this.i18n.t('note.frontFace'),
      }),
      {
        name: this.i18n.t('fx.paperStyle'),
        action: null,
        subActions: PAPER_STYLES.map(id => ({
          name: `${this.paperStyle === id ? '◉' : '○'} ${this.i18n.t(`fx.paperStyle.${id}`)}`,
          action: () => {
            this.textNote.applyPaperStyle(id);
            this.changeDetector.markForCheck();
          },
          nameUpdate: () => `${this.paperStyle === id ? '◉' : '○'} ${this.i18n.t(`fx.paperStyle.${id}`)}`,
          checkBox: 'radio' as const,
        })),
      },
      this.characterFxMenu.makePushPinMenu(this.textNote),
      this.characterFxMenu.makeClueLinkMenu(this.textNote),
      ContextMenuSeparator,
      {
        name: this.isUpright ? this.i18n.t('textNote.menu.4') : this.i18n.t('textNote.menu.5'),
        nameUpdate: () => this.isUpright ? this.i18n.t('textNote.menu.4') : this.i18n.t('textNote.menu.5'),
        action: () => { this.isUpright = !this.isUpright; this.changeDetector.markForCheck(); },
        checkBox: 'check',
        disabled: this.is2DMode,
        tip: this.is2DMode ? this.i18n.t('note.upright2dLocked') : undefined,
      },
      {
        name: this.isShowTitle ? this.i18n.t('textNote.menu.6') : this.i18n.t('textNote.menu.7'),
        nameUpdate: () => this.isShowTitle ? this.i18n.t('textNote.menu.6') : this.i18n.t('textNote.menu.7'),
        action: () => { this.isShowTitle = !this.isShowTitle; this.changeDetector.markForCheck(); },
        checkBox: 'check'
      },
      {
        name: this.isWhiteOut ? this.i18n.t('textNote.menu.8') : this.i18n.t('textNote.menu.9'),
        nameUpdate: () => this.isWhiteOut ? this.i18n.t('textNote.menu.8') : this.i18n.t('textNote.menu.9'),
        action: () => { this.isWhiteOut = !this.isWhiteOut; this.changeDetector.markForCheck(); },
        checkBox: 'check'
      },
      ContextMenuSeparator,
      {
        name: this.isAltitudeIndicate ? this.i18n.t('textNote.menu.10') : this.i18n.t('textNote.menu.11'),
        nameUpdate: () => this.isAltitudeIndicate ? this.i18n.t('textNote.menu.10') : this.i18n.t('textNote.menu.11'),
        action: () => { this.isAltitudeIndicate = !this.isAltitudeIndicate; this.changeDetector.markForCheck(); },
        checkBox: 'check'
      },
      {
        name: this.i18n.t('textNote.menu.12'),
        action: () => {
          if (this.altitude != 0) {
            this.altitude = 0;
            SoundEffect.play(PresetSound.sweep);
            this.changeDetector.markForCheck();
          }
        },
        altitudeHande: this.textNote
      },
      ContextMenuSeparator,
      {
        name: this.i18n.t('note.moveTo'),
        action: null,
        subActions: [
          {
            name: this.i18n.t('inv.placeOnCurrentMap'),
            action: () => { this.textNote.addToTable(); SoundEffect.play(PresetSound.cardPut); },
            disabled: this.textNote.isVisibleOnTable
          },
          {
            name: this.i18n.t('inv.moveToCurrentMapOnly'),
            action: () => { this.textNote.moveToTableOnly(); SoundEffect.play(PresetSound.cardPut); },
            disabled: !(this.textNote.location?.name === 'table' && !this.textNote.isVisibleOnTable)
          },
          {
            name: this.i18n.t('inv.removeFromCurrentMap'),
            action: () => {
              this.textNote.removeFromTable();
              this.selectionService.remove(this.textNote);
              SoundEffect.play(PresetSound.cardPut);
            },
            disabled: !this.textNote.isVisibleOnTable
          },
          ContextMenuSeparator,
          {
            name: this.i18n.t('note.moveToCommon'),
            action: () => {
              this.textNote.setLocation('common');
              this.selectionService.remove(this.textNote);
              SoundEffect.play(PresetSound.cardPut);
            }
          },
          {
            name: this.i18n.t('note.moveToPersonal'),
            action: () => {
              this.textNote.setLocation(Network.peerId);
              this.selectionService.remove(this.textNote);
              SoundEffect.play(PresetSound.cardPut);
            }
          },
          {
            name: this.i18n.t('note.moveToGraveyard'),
            action: () => {
              this.textNote.setLocation('graveyard');
              this.selectionService.remove(this.textNote);
              SoundEffect.play(PresetSound.sweep);
            }
          },
        ]
      },
      ContextMenuSeparator,
      { name: this.i18n.t('textNote.menu.13'), action: () => { this.showDetail(this.textNote); } },
    ];

    if (PeerCursor.myCursor?.isGMMode) {
      actions.push({
        name: this.i18n.t('note.showPlayers'),
        action: () => this.showHandoutToAll()
      });
      const peers = ObjectStore.instance.getObjects<PeerCursor>(PeerCursor)
        .filter(p => p.peerId && p.peerId !== PeerCursor.myCursor?.peerId);
      if (peers.length) {
        actions.push({
          name: this.i18n.t('note.showPlayersPick'),
          action: null,
          subActions: peers.map(peer => ({
            name: peer.name || peer.peerId,
            action: () => this.showHandoutToPeer(peer.peerId)
          }))
        });
      }
    }

    actions.push(
      (this.textNote.getUrls().length <= 0 ? null : {
        name: this.i18n.t('textNote.menu.14'), action: null,
        subActions: this.textNote.getUrls().map((urlElement) => {
          const url = urlElement.value.toString();
          return {
            name: urlElement.name ? urlElement.name : url,
            action: () => {
              if (StringUtil.sameOrigin(url)) {
                window.open(url.trim(), '_blank', 'noopener');
              } else {
                this.modalService.open(OpenUrlComponent, { url: url, title: this.textNote.title, subTitle: urlElement.name });
              }
            },
            disabled: !StringUtil.validUrl(url),
            error: !StringUtil.validUrl(url) ? this.i18n.t('common.invalidUrl') : null,
            isOuterLink: StringUtil.validUrl(url) && !StringUtil.sameOrigin(url)
          };
        })
      }),
      (this.textNote.getUrls().length <= 0 ? null : ContextMenuSeparator),
      {
        name: this.i18n.t('textNote.menu.15'), action: () => {
          const cloneObject = this.textNote.clone();
          cloneObject.isLocked = false;
          cloneObject.location.x += this.gridSize;
          cloneObject.location.y += this.gridSize;
          cloneObject.toTopmost();
          SoundEffect.play(PresetSound.cardPut);
        }
      },
      {
        name: this.i18n.t('textNote.menu.16'), action: () => {
          this.textNote.destroy();
          SoundEffect.play(PresetSound.sweep);
        },
        hotkey: 'Del',
      },
      ContextMenuSeparator,
      {
        name: this.i18n.t('textNote.menu.17'),
        action: null,
        subActions: this.tabletopActionService.makeDefaultContextMenuActions(objectPosition)
      },
    );

    return actions.filter(a => a != null);
  }

  calcFitHeightIfNeeded() {
    if (this.calcFitHeightTimer || !this.isTextContent) return;
    this.ngZone.runOutsideAngular(() => {
      this.calcFitHeightTimer = setTimeout(() => {
        this.calcFitHeight();
        this.calcFitHeightTimer = null;
      }, 0);
    });
  }

  calcFitHeight() {
    const textArea = this.textAreaElementRef?.nativeElement;
    if (!textArea) return;
    textArea.style.height = '0';
    if (textArea.scrollHeight > textArea.offsetHeight) {
      textArea.style.height = textArea.scrollHeight + 'px';
    }
  }

  lastNewLineAdjust(str: string): string {
    if (str == null) return '';
    return (!this.isSelected && str.lastIndexOf('\n') == str.length - 1) ? str + '\n' : str;
  }

  private addMouseEventListeners() {
    document.body.addEventListener('mouseup', this.callbackOnMouseUp, false);
  }

  private removeMouseEventListeners() {
    document.body.removeEventListener('mouseup', this.callbackOnMouseUp, false);
  }

  onDoubleClick(e: Event) {
    e.stopPropagation();
    this.showDetail(this.textNote);
  }

  private showDetail(gameObject: TextNote) {
    if (this.GuestMode()) return;
    EventSystem.trigger('SELECT_TABLETOP_OBJECT', { identifier: gameObject.identifier, className: gameObject.aliasName });
    const coordinate = this.pointerDeviceService.pointers[0];
    let title = this.i18n.t('note.detailTitle');
    if (gameObject.title.length) title += ' - ' + gameObject.title;
    const option: PanelOption = { title: title, left: coordinate.x - 280, top: coordinate.y - 180, width: 420, height: 440 };
    const component = this.panelService.open<NoteSettingsComponent>(NoteSettingsComponent, option);
    component.note = gameObject;
    component.embedded = false;
  }

  activate() {
    if (!this.isLocked && this.isTextContent) this.textAreaElementRef?.nativeElement?.focus();
  }

  private handoutPayload() {
    return buildNoteHandoutPayload(this.textNote, this.i18n.t('note.untitled'));
  }

  private showHandoutToAll() {
    const data = this.handoutPayload();
    if (!data.imageUrl && !data.pdfIdentifier && !data.videoUrl && !data.videoIdentifier && !data.text) {
      data.text = this.textNote.title || this.i18n.t('note.untitled');
    }
    EventSystem.call('SHOW_NOTE_HANDOUT', data);
    EventSystem.trigger('SHOW_NOTE_HANDOUT', data);
  }

  private showHandoutToPeer(peerId: string) {
    const data = this.handoutPayload();
    if (!data.imageUrl && !data.pdfIdentifier && !data.videoUrl && !data.videoIdentifier && !data.text) {
      data.text = this.textNote.title || this.i18n.t('note.untitled');
    }
    if (!peerId) return;
    EventSystem.call('SHOW_NOTE_HANDOUT', data, peerId);
    if (peerId === PeerCursor.myCursor?.peerId) EventSystem.trigger('SHOW_NOTE_HANDOUT', data);
  }

  private syncSelfPreview() {
    // Open only on hover+Ctrl; once open, stay until Ctrl release.
    if (this.isHovering && this.ctrlHeld) this.openSelfPreview();
    else if (!this.ctrlHeld) this.closeSelfPreview();
  }

  private openSelfPreview() {
    if (!this.textNote) return;
    const data = this.handoutPayload();
    data.preview = true;
    if (!data.imageUrl && !data.pdfIdentifier && !data.videoUrl && !data.videoIdentifier && !data.text) {
      data.text = this.textNote.title || this.i18n.t('note.untitled');
    }
    if (this.selfPreviewOpen) return;
    this.selfPreviewOpen = true;
    this.ngZone.run(() => EventSystem.trigger('SHOW_NOTE_HANDOUT', data));
  }

  private closeSelfPreview() {
    if (!this.selfPreviewOpen) return;
    this.selfPreviewOpen = false;
    EventSystem.trigger('HIDE_NOTE_HANDOUT', { noteIdentifier: this.textNote?.identifier });
  }

  private queuePdfRender() {
    if (!this.isPdfContent) return;
    const key = `${this.textNote.pdfIdentifier}:${this.textNote.pdfPage}`;
    if (key !== this.lastPdfKey) this.needsPdfRender = true;
  }

  private async renderPdf() {
    const canvas = this.pdfCanvasRef?.nativeElement;
    const pdf = PdfStorage.instance.get(this.textNote.pdfIdentifier);
    if (!canvas || !pdf?.url) return;
    try {
      const maxW = Math.max(120, this.width * this.gridSize);
      const result = await renderPdfPage(canvas, pdf.url, this.textNote.pdfPage, this.textNote.pdfIdentifier, maxW);
      this.lastPdfKey = `${this.textNote.pdfIdentifier}:${result.page}`;
      if (this.textNote.pdfPageCount !== result.pageCount) this.textNote.pdfPageCount = result.pageCount;
      if (this.textNote.pdfPage !== result.page) this.textNote.pdfPage = result.page;
      this.changeDetector.markForCheck();
    } catch (err) {
      console.warn('text-note PDF render failed', err);
    }
  }
}
