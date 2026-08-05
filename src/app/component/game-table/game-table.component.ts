import { AfterViewInit, ChangeDetectorRef, Component, ElementRef, HostListener, NgZone, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { Subscription } from 'rxjs';

import { Card } from '@udonarium/card';
import { CardStack } from '@udonarium/card-stack';
import { ImageFile, ImageState } from '@udonarium/core/file-storage/image-file';
import { GameObject } from '@udonarium/core/synchronize-object/game-object';
import { ObjectStore } from '@udonarium/core/synchronize-object/object-store';
import { EventSystem, Network } from '@udonarium/core/system';
import { DiceSymbol } from '@udonarium/dice-symbol';
import { GameCharacter } from '@udonarium/game-character';
import { FilterType, GameTable, GridType } from '@udonarium/game-table';
import { GameTableMask } from '@udonarium/game-table-mask';
import { GuestSession } from '@udonarium/guest-session';
import { PeerCursor } from '@udonarium/peer-cursor';
import { RangeArea } from '@udonarium/range';
import { PresetSound, SoundEffect } from '@udonarium/sound-effect';
import { TableDrawing } from '@udonarium/table-fx/table-drawing';
import { TableLight } from '@udonarium/table-fx/table-light';
import { SceneToolPermission } from '@udonarium/table-fx/scene-tool-permission';
import { TableWall } from '@udonarium/table-fx/table-wall';
import { TableSelecter } from '@udonarium/table-selecter';
import { Terrain } from '@udonarium/terrain';
import { TextNote } from '@udonarium/text-note';

import { GameTableSettingComponent } from 'component/game-table-setting/game-table-setting.component';
import { SceneToolsComponent } from 'component/scene-tools/scene-tools.component';
import { ContextMenuAction, ContextMenuSeparator, ContextMenuService } from 'service/context-menu.service';
import { CoordinateService } from 'service/coordinate.service';
import { ImageService } from 'service/image.service';
import { ModalService } from 'service/modal.service';
import { PanelService } from 'service/panel.service';
import { PointerCoordinate, PointerDeviceService } from 'service/pointer-device.service';
import { SceneToolService } from 'service/scene-tool.service';
import { TabletopActionService } from 'service/tabletop-action.service';
import { TabletopKeyboardService } from 'service/tabletop-keyboard.service';
import { TabletopSelectionService } from 'service/tabletop-selection.service';
import { TabletopService } from 'service/tabletop.service';
import { TokenPathMoveService } from 'service/token-path-move.service';
import { I18nService } from 'service/i18n.service';
import { MobileLayoutService } from 'service/mobile-layout.service';

import { GridLineRender } from './grid-line-render';
import { LightOccluder, LightingRender } from './lighting-render';
import { TableMouseGesture } from './table-mouse-gesture';
import { TablePickGesture } from './table-pick-gesture';
import { TableTouchGesture } from './table-touch-gesture';
import { WeatherRender } from './weather-render';

/** Formal touch interaction mode (mobile gesture state machine). */
enum TableTouchMode {
  Idle = 'idle',
  Pan = 'pan',
  ObjectDrag = 'object-drag',
  Pinch = 'pinch',
}

interface TablePingView {
  id: string;
  x: number;
  y: number;
  type: 'basic' | 'warning';
  color: string;
  expire: number;
}

@Component({
    selector: 'game-table',
    templateUrl: './game-table.component.html',
    styleUrls: ['./game-table.component.css'],
    standalone: false
})
export class GameTableComponent implements OnInit, OnDestroy, AfterViewInit {
  @ViewChild('root', { static: true }) rootElementRef: ElementRef<HTMLElement>;
  @ViewChild('gameTable', { static: true }) gameTable: ElementRef<HTMLElement>;
  @ViewChild('gameObjects', { static: true }) gameObjects: ElementRef<HTMLElement>;
  @ViewChild('gridCanvas', { static: true }) gridCanvas: ElementRef<HTMLCanvasElement>;
  @ViewChild('fxCanvas', { static: true }) fxCanvas: ElementRef<HTMLCanvasElement>;
  @ViewChild('weatherCanvasLow', { static: true }) weatherCanvasLow: ElementRef<HTMLCanvasElement>;
  @ViewChild('weatherCanvasMid', { static: true }) weatherCanvasMid: ElementRef<HTMLCanvasElement>;
  @ViewChild('weatherCanvasHigh', { static: true }) weatherCanvasHigh: ElementRef<HTMLCanvasElement>;
  @ViewChild('pickArea', { static: true }) pickArea: ElementRef<HTMLElement>;
  @ViewChild('pickCursor', { static: true }) pickCursor: ElementRef<HTMLElement>;

  readonly Math = Math;
  pings: TablePingView[] = [];
  offscreenArrows: { x: number; y: number; deg: number; color: string }[] = [];

  private lightingRender: LightingRender = null;
  private weatherRender: WeatherRender = null;
  private fxTimer: any = null;
  private pingHoldTimer: any = null;
  private pingHoldOrigin: { x: number; y: number } = null;
  private pingHoldLast: { x: number; y: number } = null;
  private pingHoldShift = false;
  /** Local multi-touch tracking (PointerDevice can keep stale multi-touch after touchend). */
  private activePointerIds = new Set<number>();
  private static readonly PING_MOVE_THRESHOLD_SQ = 8 * 8;
  private drawDragStart: { x: number; y: number } = null;
  private drawDragCurrent: { x: number; y: number } = null;
  private freehandPoints: { x: number; y: number }[] = [];
  private drawDraftRaf: number = 0;
  /** Bumps so live draft SVG rebinds while drawing. */
  drawDraftTick = 0;
  private static readonly FREEHAND_MIN_DIST_SQ = 2.5 * 2.5;
  private static readonly FREEHAND_MAX_POINTS = 1200;
  private static readonly SCENE_MARQUEE_MIN_SQ = 6 * 6;
  private static readonly PATH_CLICK_MOVE_SQ = 8 * 8;
  /** Scene-select marquee in tabletop coordinates. */
  private sceneMarqueeStart: { x: number; y: number } = null;
  private sceneMarqueeCurrent: { x: number; y: number } = null;
  /** True once drag exceeds threshold — commit as box select instead of click. */
  private sceneMarqueeActive = false;
  /** Path gesture candidate: Ctrl+click adds a waypoint; plain click starts move. */
  private pathClickOrigin: { clientX: number; clientY: number; x: number; y: number; mode: 'add' | 'go' } = null;

  get tableSelecter(): TableSelecter { return this.tabletopService.tableSelecter; }
  get currentTable(): GameTable { return this.tabletopService.currentTable; }
  get gridHeight(): number { return this.tabletopService.currentTable.gridHeight; }

  /** CSS translateZ for volumetric weather sheets (0=near floor … 2=high). */
  weatherLayerZ(layer: number): number {
    const gh = this.gridHeight;
    const g = this.currentTable?.gridSize || 50;
    const lifts = [g * 0.12, g * 1.6, g * 3.6];
    return gh + (lifts[Math.max(0, Math.min(2, layer | 0))] || lifts[0]);
  }

  /** Weather canvas extends past the map so rain/snow/fog spill outside. */
  get weatherPad(): number {
    return WeatherRender.marginFor(this.tablePixelWidth, this.tablePixelHeight);
  }
  get weatherPixelWidth(): number { return this.tablePixelWidth + this.weatherPad * 2; }
  get weatherPixelHeight(): number { return this.tablePixelHeight + this.weatherPad * 2; }
  get tablePixelWidth(): number { return this.currentTable.width * this.currentTable.gridSize; }
  get tablePixelHeight(): number { return this.currentTable.height * this.currentTable.gridSize; }
  get drawings(): TableDrawing[] { return this.currentTable?.drawings || []; }
  get lights(): TableLight[] { return this.currentTable?.lights || []; }
  get walls(): TableWall[] { return this.currentTable?.walls || []; }
  get wallDraftPoints(): { x: number; y: number }[] { return this.sceneTools.wallDraftPoints; }
  get polygonDraftPoints(): { x: number; y: number }[] { return this.sceneTools.polygonDraftPoints; }
  get freehandDraftPoints(): { x: number; y: number }[] { return this.freehandPoints; }
  get drawStrokeColor(): string { return this.sceneTools.drawStrokeColor; }
  get drawStrokeWidth(): number { return this.sceneTools.drawStrokeWidth; }
  get drawStrokeOpacity(): number { return this.sceneTools.drawStrokeOpacity; }
  get drawFillOpacity(): number { return this.sceneTools.drawFillOpacity; }
  get showSceneEditOverlay(): boolean { return this.sceneTools.showEditOverlay; }

  get lightDraft(): { x: number; y: number; bright: number; dim: number } | null {
    if (this.sceneTools.mode !== 'light' || !this.drawDragStart || !this.drawDragCurrent) return null;
    const dim = Math.max(8, Math.hypot(this.drawDragCurrent.x - this.drawDragStart.x, this.drawDragCurrent.y - this.drawDragStart.y));
    const ratio = this.sceneTools.lightDimGrid > 0
      ? Math.min(1, this.sceneTools.lightBrightGrid / this.sceneTools.lightDimGrid)
      : 0.5;
    return {
      x: this.drawDragStart.x,
      y: this.drawDragStart.y,
      dim,
      bright: Math.max(0, dim * ratio),
    };
  }

  get selectedLightGuide(): { x: number; y: number; bright: number; dim: number } | null {
    const l = this.sceneTools.selectedLight;
    if (!l || !this.showSceneEditOverlay) return null;
    return { x: l.x, y: l.y, bright: Math.max(0, l.brightRadius), dim: Math.max(1, l.dimRadius) };
  }

  get shapeDraft(): { kind: 'rect' | 'ellipse'; x: number; y: number; width: number; height: number } | null {
    if (!this.drawDragStart || !this.drawDragCurrent) return null;
    if (this.sceneTools.mode !== 'draw-rect' && this.sceneTools.mode !== 'draw-ellipse') return null;
    const x = Math.min(this.drawDragStart.x, this.drawDragCurrent.x);
    const y = Math.min(this.drawDragStart.y, this.drawDragCurrent.y);
    const width = Math.max(1, Math.abs(this.drawDragCurrent.x - this.drawDragStart.x));
    const height = Math.max(1, Math.abs(this.drawDragCurrent.y - this.drawDragStart.y));
    return {
      kind: this.sceneTools.mode === 'draw-rect' ? 'rect' : 'ellipse',
      x, y, width, height,
    };
  }

  get sceneMarquee(): { x: number; y: number; width: number; height: number } | null {
    if (!this.sceneMarqueeActive || !this.sceneMarqueeStart || !this.sceneMarqueeCurrent) return null;
    const x = Math.min(this.sceneMarqueeStart.x, this.sceneMarqueeCurrent.x);
    const y = Math.min(this.sceneMarqueeStart.y, this.sceneMarqueeCurrent.y);
    const width = Math.abs(this.sceneMarqueeCurrent.x - this.sceneMarqueeStart.x);
    const height = Math.abs(this.sceneMarqueeCurrent.y - this.sceneMarqueeStart.y);
    return { x, y, width: Math.max(1, width), height: Math.max(1, height) };
  }

  get polygonRubberPoints(): { x: number; y: number }[] {
    const pts = this.polygonDraftPoints;
    if (!pts.length) return pts;
    if (this.drawDragCurrent) return pts.concat([this.drawDragCurrent]);
    return pts;
  }

  get tableImage(): ImageFile { return this.imageService.getSkeletonOr(this.currentTable.imageIdentifier); }
  get backgroundImage(): ImageFile { return this.imageService.getEmptyOr(this.currentTable.backgroundImageIdentifier); }
  get backgroundImage2(): ImageFile { return this.imageService.getEmptyOr(this.currentTable.backgroundImageIdentifier2); }
  get backgroundFilterType(): FilterType { return this.currentTable.backgroundFilterType; }

  private isTableTransformMode: boolean = false;
  private isTableTransformed: boolean = false;

  get isPointerDragging(): boolean { return this.pointerDeviceService.isDragging; }

  /** Default table view (「回到最初的視點」) — desktop. */
  private static readonly DEFAULT_VIEW_POS_X = 221.6;
  private static readonly DEFAULT_VIEW_POS_Y = -123.8;
  private static readonly DEFAULT_VIEW_POS_Z = 0;
  private static readonly DEFAULT_VIEW_ROT_X = 46;
  private static readonly DEFAULT_VIEW_ROT_Y = 0;
  private static readonly DEFAULT_VIEW_ROT_Z = 0;
  /** Phone/tablet default — framed for bottom chrome + smaller viewport. */
  private static readonly MOBILE_DEFAULT_VIEW_POS_X = -141.29;
  private static readonly MOBILE_DEFAULT_VIEW_POS_Y = -96.92;
  private static readonly MOBILE_DEFAULT_VIEW_POS_Z = 0;
  private static readonly MOBILE_DEFAULT_VIEW_ROT_X = 46;
  private static readonly MOBILE_DEFAULT_VIEW_ROT_Y = 0;
  private static readonly MOBILE_DEFAULT_VIEW_ROT_Z = 0;
  /** Slider -100..100 → viewPotisonZ (matches touch clamp ~±750). */
  private static readonly ZOOM_SLIDER_TO_Z = 7.5;

  private viewPotisonX: number = GameTableComponent.DEFAULT_VIEW_POS_X;
  private viewPotisonY: number = GameTableComponent.DEFAULT_VIEW_POS_Y;
  private viewPotisonZ: number = GameTableComponent.DEFAULT_VIEW_POS_Z;

  /** Public -100..100 zoom control (synced from pinch / wheel / slider). */
  zoomSliderValue = 0;

  /** Mobile map HUD: free position + collapse (session). */
  private static readonly MAP_HUD_POS_KEY = 'udon.mapHud.pos';
  private static readonly MAP_HUD_COLLAPSED_KEY = 'udon.mapHud.collapsed';
  mapHudCollapsed = sessionStorage.getItem(GameTableComponent.MAP_HUD_COLLAPSED_KEY) === '1';
  mapHudLeft: number | null = null;
  mapHudTop: number | null = null;
  private mapHudDragging = false;
  private mapHudDragOffsetX = 0;
  private mapHudDragOffsetY = 0;
  private readonly onMapHudPointerMove = (e: PointerEvent) => this.moveMapHudDrag(e);
  private readonly onMapHudPointerUp = () => this.endMapHudDrag();

  private viewRotateX: number = GameTableComponent.DEFAULT_VIEW_ROT_X;
  private viewRotateY: number = GameTableComponent.DEFAULT_VIEW_ROT_Y;
  private viewRotateZ: number = GameTableComponent.DEFAULT_VIEW_ROT_Z;

  private mouseGesture: TableMouseGesture = null;
  private touchGesture: TableTouchGesture = null;
  private pickGesture: TablePickGesture = null;
  private touchLayoutSub: Subscription = null;
  /** Touch gesture FSM — Idle | Pan | ObjectDrag | Pinch. */
  private touchMode: TableTouchMode = TableTouchMode.Idle;

  /** Top-right pose overlay for wheel/view/object angle debugging. */
  showDebugPose = sessionStorage.getItem('udon.debugPose') === '1';
  private debugPoseTimer: ReturnType<typeof setInterval> | null = null;

  get characters(): GameCharacter[] { return this.tabletopService.characters; }
  get tableMasks(): GameTableMask[] { return this.tabletopService.tableMasks; }
  get cards(): Card[] { return this.tabletopService.cards; }
  get cardStacks(): CardStack[] { return this.tabletopService.cardStacks; }
  get ranges(): RangeArea[] { return this.tabletopService.ranges; }
  get terrains(): Terrain[] { return this.tabletopService.terrains; }
  get textNotes(): TextNote[] { return this.tabletopService.textNotes; }
  get diceSymbols(): DiceSymbol[] { return this.tabletopService.diceSymbols; }
  get peerCursors(): PeerCursor[] { return this.tabletopService.peerCursors; }

  get isStealthMode(): boolean { return GameCharacter.isStealthMode; }
  get isGMMode(): boolean { return PeerCursor.myCursor && PeerCursor.myCursor.isGMMode; }
  get canCreateScene(): boolean { return SceneToolPermission.instance.canCreate; }
  get canModifyScene(): boolean { return SceneToolPermission.instance.canModify; }
  get canUseSceneTools(): boolean { return SceneToolPermission.instance.canOpenPanel; }
  get canCreateCurrentMode(): boolean {
    return SceneToolPermission.instance.canUseCreateMode(this.sceneTools.mode);
  }

  get clipCss(): string {
    const rect = this.currentTable.gridClipRect;
    return rect ? `rect(${rect.top}px, ${rect.right}px, ${rect.bottom}px, ${rect.left}px)` : 'auto';
  }

  private _currentTable: GameTable;
  private _currentTableImage: ImageFile;
  private _currentTableImageUrl: string = '';
  private _currentTableImageState = 0;
  private _currentBackgroundImage :ImageFile;
  private _currentBackgroundImageUrl: string = '';
  private _currentBackgroundImageState = 0;
  private _currentBackgroundImage2 :ImageFile;
  private _currentBackgroundImageUrl2: string = '';
  private _currentBackgroundImageState2 = 0;
  isBackgroundImageLoaded = false;
  isBackgroundImageLoaded2 = false;
  get tableImageUrls(): string[] {
    let revokeTableImageUrl = '';
    let revokeBackgroundImageUrl = '';
    let revokeBackgroundImageUrl2 = '';
    const isFlash = (this.currentTable?.identifier != this._currentTable?.identifier);
    this._currentTable = this.currentTable;
    if (isFlash || this._currentTableImage?.identifier != this.tableImage.identifier || this._currentTableImageState != this.tableImage.state) {
      this._currentTableImage = this.tableImage;
      if (this.tableImage.state === ImageState.THUMBNAIL || this.tableImage.state === ImageState.COMPLETE) {
        this._currentTableImageState = this.tableImage.state;
        if (this._currentTableImageUrl) revokeTableImageUrl = this._currentTableImageUrl;
        this._currentTableImageUrl = URL.createObjectURL(this.tableImage.blob);
      } else {
        this._currentTableImageUrl = this.tableImage.url;
      }
    }
    if (isFlash || this._currentBackgroundImage?.identifier != this.backgroundImage.identifier || this._currentBackgroundImageState != this.backgroundImage.state) {
      this._currentBackgroundImage = this.backgroundImage;
      if (this.backgroundImage.state === ImageState.THUMBNAIL || this.backgroundImage.state === ImageState.COMPLETE) {
        this._currentBackgroundImageState = this.backgroundImage.state;
        if (this._currentBackgroundImageUrl) revokeBackgroundImageUrl = this._currentBackgroundImageUrl;
        this.isBackgroundImageLoaded = false;
        this._currentBackgroundImageUrl = URL.createObjectURL(this.backgroundImage.blob);
      } else {
        this._currentBackgroundImageUrl = this.backgroundImage.url;
      }
    }
    if (isFlash || this._currentBackgroundImage2?.identifier != this.backgroundImage2.identifier || this._currentBackgroundImageState2 != this.backgroundImage2.state) {
      this._currentBackgroundImage2 = this.backgroundImage2;
      if (this.backgroundImage2.state === ImageState.THUMBNAIL || this.backgroundImage2.state === ImageState.COMPLETE) {
        this._currentBackgroundImageState2 = this.backgroundImage2.state;
        if (this._currentBackgroundImageUrl2) revokeBackgroundImageUrl2 = this._currentBackgroundImageUrl2;
        this.isBackgroundImageLoaded2 = false;
        this._currentBackgroundImageUrl2 = URL.createObjectURL(this.backgroundImage2.blob);
      } else {
        this._currentBackgroundImageUrl2 = this.backgroundImage2.url;
      }
    }
    if (revokeTableImageUrl || revokeBackgroundImageUrl || revokeBackgroundImageUrl2) {
      queueMicrotask(() => { 
        if (revokeTableImageUrl) URL.revokeObjectURL(revokeTableImageUrl);
        if (revokeBackgroundImageUrl) URL.revokeObjectURL(revokeBackgroundImageUrl);
        if (revokeBackgroundImageUrl2) URL.revokeObjectURL(revokeBackgroundImageUrl2);
      });
    }
    return [this._currentTableImageUrl, this._currentBackgroundImageUrl, this._currentBackgroundImageUrl2];
  }
  
  get tableImageUrl(): string { return this.tableImageUrls[0]; }
  get backgroundImageUrl(): string { return this.tableImageUrls[1]; }
  get backgroundImageUrl2(): string { return this.tableImageUrls[2]; }
  
  private _currentBackgroundImageCss = '';
  get backgroundImageCss(): string {
    if (this._currentBackgroundImageCss && ((this.backgroundImageUrl && !this.isBackgroundImageLoaded) || (this.backgroundImageUrl2 && !this.isBackgroundImageLoaded2))) return this._currentBackgroundImageCss;
    let ret: string[] = [];
    if (this.backgroundImageUrl) ret.push(`url(${this.backgroundImageUrl})`);
    if (this.backgroundImageUrl2 && (!this.backgroundImageUrl || (this.backgroundImageUrl && this.isBackgroundImageLoaded))) ret.push(`url(${this.backgroundImageUrl2})`);
    this._currentBackgroundImageCss = ret.join(',');
    return this._currentBackgroundImageCss;
  }

  constructor(
    private ngZone: NgZone,
    private changeDetector: ChangeDetectorRef,
    private contextMenuService: ContextMenuService,
    private pointerDeviceService: PointerDeviceService,
    private coordinateService: CoordinateService,
    private imageService: ImageService,
    private tabletopService: TabletopService,
    private tabletopActionService: TabletopActionService,
    private selectionService: TabletopSelectionService,
    private tabletopKeyboardService: TabletopKeyboardService,
    private modalService: ModalService,
    private panelService: PanelService,
    private sceneTools: SceneToolService,
    private tokenPath: TokenPathMoveService,
    private i18n: I18nService,
    private mobileLayout: MobileLayoutService,
  ) { }

  get pathWaypoints() { return this.tokenPath.waypoints; }
  get showPathMoveHud(): boolean {
    return this.tokenPath.hasDraft || this.tokenPath.isAnimating;
  }
  get showViewZoomControl(): boolean {
    return false; // zoom lives inside map-action-hud
  }
  get showMapActionHud(): boolean {
    return this.mobileLayout.isMobile;
  }
  get isGuestHud(): boolean {
    return Network.GuestMode();
  }
  get showVisionBanner(): boolean {
    if (PeerCursor.myCursor?.isGMMode) return false;
    const table = this.currentTable;
    if (!table?.visionEnabled) return false;
    const userId = Network.peer?.userId;
    if (!userId) return false;
    return !ObjectStore.instance.getObjects(GameCharacter).some(ch => ch.providesVisionTo(userId));
  }
  get pathPointsAttr(): string {
    const pts: string[] = [];
    if (this.tokenPath.origin) {
      pts.push(`${this.tokenPath.origin.x},${this.tokenPath.origin.y}`);
    }
    for (const p of this.tokenPath.waypoints) {
      pts.push(`${p.x},${p.y}`);
    }
    return pts.join(' ');
  }

  ngOnInit() {
    EventSystem.register(this)
      .on('UPDATE_GAME_OBJECT', event => {
        if (event.data.identifier !== this.currentTable.identifier && event.data.identifier !== this.tableSelecter.identifier) return;
        console.log('UPDATE_GAME_OBJECT GameTableComponent ' + this.currentTable.identifier);

        this.setGameTableGrid(this.currentTable.width, this.currentTable.height, this.currentTable.gridSize, this.currentTable.gridType, this.currentTable.gridColor, this.currentTable.isShowNumber);
        this.refreshFx();
      })
      .on('TABLE_PING', event => {
        this.ngZone.run(() => this.spawnPing(event.data));
      })
      .on('SCENE_TOOL_COMMIT_POLYGON', () => {
        this.ngZone.run(() => this.commitPolygon(false));
      })
      .on('SCENE_TOOLS_PANEL', () => {
        this.ngZone.run(() => this.changeDetector.markForCheck());
      })
      .on('DRAG_LOCKED_OBJECT', event => {
        this.isTableTransformMode = true;
        this.pointerDeviceService.isDragging = false;
        let opacity: number = this.tableSelecter.gridShow ? 1.0 : 0.0;
        this.gridCanvas.nativeElement.style.opacity = opacity + '';
      })
      .on('RESET_POINT_OF_VIEW', event => {
        this.isTableTransformMode = false;
        this.pointerDeviceService.isDragging = false;

        this.setTransform(this.viewPotisonX, this.viewPotisonY, this.viewPotisonZ, this._rightRotate(this.viewRotateX), this._rightRotate(this.viewRotateY, true), this._rightRotate(this.viewRotateZ), true);
        setTimeout(() => {
          this.gridCanvas.nativeElement.style.opacity = '0.0';
          this.gameTable.nativeElement.style.transition = '0.1s ease-out';
          setTimeout(() => {
            this.gameTable.nativeElement.style.transition = null;
          }, 100);
          if (event && event.data == 'top') {
            this.setTransform(0, 0, 0, 0, 0, 0, true);
          } else {
            this.applyDefaultPointOfView();
          }
        }, 50);
        this.removeFocus();
      })
      .on('FOCUS_TABLETOP_OBJECT', event => {
        setTimeout(() => {
          //console.log(`move table to focus (${event.data.x}, ${event.data.y})`);
          this.gameTable.nativeElement.style.transition = '0.1s ease-out';
          setTimeout(() => {
            this.gameTable.nativeElement.style.transition = null;
          }, 100);
          /* 
          Porting from Udonarium Lily
          Copyright (c) 2020 entyu

          MIT License
          https://opensource.org/licenses/mit-license.php
          */
          // 座標轉換
          let centerX = this.gridCanvas.nativeElement.clientWidth / 2;
          let centerY = this.gridCanvas.nativeElement.clientHeight / 2;
          let movedX = event.data.x - centerX;
          let movedY = event.data.y - centerY;
          let movedZ = event.data.z;
          // z 軸旋轉
          let rotateZRad = this.viewRotateZ / 180 * Math.PI;
          let rotatedMovedX = movedX * Math.cos(rotateZRad) - movedY * Math.sin(rotateZRad);
          let zRotatedMovedY = movedX * Math.sin(rotateZRad) + movedY * Math.cos(rotateZRad);
          // x 軸旋轉
          let rotateXRad = this.viewRotateX / 180 * Math.PI;
          let rotatedMovedY = zRotatedMovedY * Math.cos(rotateXRad);
          let rotatedMovedZ = zRotatedMovedY * Math.sin(rotateXRad) + movedZ;
          // 移動
          this.setTransform(
            100 - rotatedMovedX - this.viewPotisonX, -rotatedMovedY - this.viewPotisonY, -rotatedMovedZ - this.viewPotisonZ, 0, 0, 0
          );
        }, 50);
      });
    this.tabletopActionService.makeDefaultTable();
    this.tabletopActionService.makeDefaultTabletopObjects();
  }

  private _rightRotate(rotate: number, just: boolean=false): number {
    let tmp = rotate % 360;
    if (!just) {
      if (tmp > 180) {
        tmp = tmp - 360;
      } else if (tmp < -180) {
        tmp = tmp + 360;
      }
    }
    return tmp;
  }

  /** Initial / reset camera: mobile uses a tighter frame for bottom chrome. */
  private applyDefaultPointOfView() {
    if (this.mobileLayout.isMobile) {
      this.setTransform(
        GameTableComponent.MOBILE_DEFAULT_VIEW_POS_X,
        GameTableComponent.MOBILE_DEFAULT_VIEW_POS_Y,
        GameTableComponent.MOBILE_DEFAULT_VIEW_POS_Z,
        GameTableComponent.MOBILE_DEFAULT_VIEW_ROT_X,
        GameTableComponent.MOBILE_DEFAULT_VIEW_ROT_Y,
        GameTableComponent.MOBILE_DEFAULT_VIEW_ROT_Z,
        true,
      );
      return;
    }
    this.setTransform(
      GameTableComponent.DEFAULT_VIEW_POS_X,
      GameTableComponent.DEFAULT_VIEW_POS_Y,
      GameTableComponent.DEFAULT_VIEW_POS_Z,
      GameTableComponent.DEFAULT_VIEW_ROT_X,
      GameTableComponent.DEFAULT_VIEW_ROT_Y,
      GameTableComponent.DEFAULT_VIEW_ROT_Z,
      true,
    );
  }

  ngAfterViewInit() {
    this.ngZone.runOutsideAngular(() => {
      this.initializeTableTouchGesture();
      this.initializeTableMouseGesture();
      this.initializeTablePickGesture();
      this.tabletopKeyboardService.initialize();
    });
    this.cancelInput();

    this.setGameTableGrid(this.currentTable.width, this.currentTable.height, this.currentTable.gridSize, this.currentTable.gridType, this.currentTable.gridColor);
    this.applyDefaultPointOfView();
    this.coordinateService.tabletopOriginElement = this.gameObjects.nativeElement;
    this.lightingRender = new LightingRender(this.fxCanvas.nativeElement);
    this.weatherRender = new WeatherRender([
      this.weatherCanvasLow.nativeElement,
      this.weatherCanvasMid.nativeElement,
      this.weatherCanvasHigh.nativeElement,
    ]);
    this.refreshFx();
    this.fxTimer = setInterval(() => this.refreshFx(), 200);
    if (this.showDebugPose) {
      this.startDebugPoseRefresh();
      queueMicrotask(() => this.refreshDebugPoseDom());
    }
    this.restoreMapHudLayout();
    document.addEventListener('pointermove', this.onMapHudPointerMove);
    document.addEventListener('pointerup', this.onMapHudPointerUp);
  }

  ngOnDestroy() {
    EventSystem.unregister(this);
    this.mouseGesture.destroy();
    this.touchGesture.destroy();
    this.pickGesture.destroy();
    this.tabletopKeyboardService.destroy();
    this.touchLayoutSub?.unsubscribe();
    this.touchLayoutSub = null;
    if (this.fxTimer) clearInterval(this.fxTimer);
    if (this.debugPoseTimer) clearInterval(this.debugPoseTimer);
    if (this.weatherRender) this.weatherRender.destroy();
    this.clearPingHold();
    this.clearDrawDragState();
    document.removeEventListener('pointermove', this.onMapHudPointerMove);
    document.removeEventListener('pointerup', this.onMapHudPointerUp);
    if (this._currentTableImageUrl) URL.revokeObjectURL(this._currentTableImageUrl);
    if (this._currentBackgroundImageUrl) URL.revokeObjectURL(this._currentBackgroundImageUrl);
    if (this._currentBackgroundImageUrl2) URL.revokeObjectURL(this._currentBackgroundImageUrl2);
  }

  initializeTableTouchGesture() {
    this.touchGesture = new TableTouchGesture(this.rootElementRef.nativeElement, this.ngZone);
    // Phones/pads: 1-finger drag always pans (no right-click). Pinch = zoom.
    this.touchGesture.simplePan = this.mobileLayout.isMobile;
    this.touchGesture.onstart = this.onTableTouchStart.bind(this);
    this.touchGesture.onend = this.onTableTouchEnd.bind(this);
    this.touchGesture.ongesture = this.onTableTouchGesture.bind(this);
    this.touchGesture.ontransform = this.onTableTouchTransform.bind(this);
    this.touchLayoutSub?.unsubscribe();
    this.touchLayoutSub = this.mobileLayout.isMobile$.subscribe(isMobile => {
      if (this.touchGesture) this.touchGesture.simplePan = isMobile;
    });
  }

  initializeTableMouseGesture() {
    this.mouseGesture = new TableMouseGesture(
      this.rootElementRef.nativeElement,
      () => this.selectionService.size > 0 || this.sceneTools.selectionCount > 0,
      () => !this.mobileLayout.isMobile,
    );
    this.mouseGesture.onstart = this.onTableMouseStart.bind(this);
    this.mouseGesture.onend = this.onTableMouseEnd.bind(this);
    this.mouseGesture.ontransform = this.onTableMouseTransform.bind(this);
  }

  initializeTablePickGesture() {
    this.pickGesture = new TablePickGesture(
      this.rootElementRef.nativeElement,
      this.gameObjects.nativeElement,
      this.pickCursor.nativeElement,
      this.pickArea.nativeElement,
      this.pointerDeviceService,
      this.selectionService,
    );

    this.pickGesture.onstart = this.onTablePickStart.bind(this);
    this.pickGesture.onend = this.onTablePickEnd.bind(this);
    this.pickGesture.oncancelifneeded = this.onTablePickCancelIfNeeded.bind(this);
    this.pickGesture.onpick = this.onTablePick.bind(this);
  }

  onTableTouchStart(srcEvent: TouchEvent | MouseEvent | PointerEvent = null) {
    this.mouseGesture.cancel();
    // Touching a movable/interactive object: claim object-drag (don't wait for mouse-gesture order).
    if (this.isTouchOnTableObject(srcEvent)) {
      this.touchMode = TableTouchMode.ObjectDrag;
      this.isTableTransformMode = false;
      this.pointerDeviceService.isDragging = true;
      return;
    }
    // Empty table: enable pan immediately and blur inputs so focus gate doesn't block.
    this.touchMode = TableTouchMode.Pan;
    this.isTableTransformMode = true;
    this.pointerDeviceService.isDragging = false;
    this.removeFocus();
  }

  onTableTouchEnd() {
    this.touchMode = TableTouchMode.Idle;
    this.cancelInput();
  }

  onTableTouchGesture() {
    // Object grab / non-transform touch: do not clear isDragging via cancelInput.
    if (this.touchMode === TableTouchMode.ObjectDrag || this.pointerDeviceService.isDragging || !this.isTableTransformMode) return;
    this.cancelInput();
  }

  onTableTouchTransform(transformX: number, transformY: number, transformZ: number, rotateX: number, rotateY: number, rotateZ: number, event: string, srcEvent: TouchEvent | MouseEvent | PointerEvent) {
    // Object drag wins over map pan/pinch.
    if (this.touchMode === TableTouchMode.ObjectDrag || this.pointerDeviceService.isDragging) return;
    if (!this.isTableTransformMode) return;
    // Cancel ping only for multi-touch / pinch / rotate — not 1-finger pan jitter
    // (pan1p threshold is 0; movement cancel uses PING_MOVE_THRESHOLD_SQ instead).
    const touchCount = srcEvent instanceof TouchEvent ? srcEvent.touches.length : 0;
    if (touchCount > 1 || event === 'pinch' || event === 'rotate' || event === 'tappinch') {
      this.clearPingHold();
    }
    if (event === 'pinch' || Math.abs(transformZ) > 0) this.touchMode = TableTouchMode.Pinch;
    else if (this.touchMode === TableTouchMode.Idle) this.touchMode = TableTouchMode.Pan;
    // Desktop keeps the strict focus gate; touch already blurred on empty-table start.
    if (document.body !== document.activeElement && !(srcEvent instanceof TouchEvent)) return;

    if (!this.pointerDeviceService.isAllowedToOpenContextMenu && this.contextMenuService.isShow) {
      this.ngZone.run(() => this.contextMenuService.close());
    }

    if (srcEvent.cancelable) srcEvent.preventDefault();

    //
    let scale = (1000 + Math.abs(this.viewPotisonZ)) / 1000;
    transformX *= scale;
    transformY *= scale;
    if (80 < rotateX + this.viewRotateX) rotateX += 80 - (rotateX + this.viewRotateX);
    if (rotateX + this.viewRotateX < 0) rotateX += 0 - (rotateX + this.viewRotateX);
    if (750 < transformZ + this.viewPotisonZ) transformZ += 750 - (transformZ + this.viewPotisonZ);

    this.setTransform(transformX, transformY, transformZ, rotateX, rotateY, rotateZ);
    this.isTableTransformed = true;
  }

  onTableMouseStart(e: any) {
    // Ctrl+left with a selected token = path waypoints (not pan).
    // Plain left with draft = start move (handled in pointerup).
    // Right-click with draft = undo last waypoint (handled in contextmenu; drag pans).
    if (e.button === 0 && e.ctrlKey && this.tokenPath.canDraft()) {
      this.isTableTransformMode = false;
      this.pointerDeviceService.isDragging = false;
    } else if (e.button === 0 && !e.ctrlKey && !e.shiftKey && this.tokenPath.hasDraft && !this.tokenPath.isAnimating) {
      this.isTableTransformMode = false;
      this.pointerDeviceService.isDragging = false;
    } else if (e.button === 0 && e.ctrlKey) {
      // Ctrl+left = pan map when no path draft applies.
      this.isTableTransformMode = true;
      this.pointerDeviceService.isDragging = false;
    } else if (e.button === 1 || e.button === 2) {
      this.isTableTransformMode = true;
    } else if (e.target.contains(this.gameObjects.nativeElement)) {
      this.isTableTransformMode = false;
    } else {
      this.isTableTransformMode = false;
      this.pointerDeviceService.isDragging = true;
      this.gridCanvas.nativeElement.style.opacity = 1.0 + '';
    }

    if (!document.activeElement.contains(e.target)) {
      this.removeSelectionRanges();
      this.removeFocus();
    }
  }

  onTableMouseEnd(e: any) {
    this.cancelInput();
  }

  onTableMouseTransform(transformX: number, transformY: number, transformZ: number, rotateX: number, rotateY: number, rotateZ: number, event: string, srcEvent: TouchEvent | MouseEvent | PointerEvent | KeyboardEvent) {
    const isKeyboard = srcEvent instanceof KeyboardEvent;
    if (isKeyboard) {
      // Desktop empty-selection WASD / QE: always apply view transform.
      if (this.mobileLayout.isMobile) return;
      if (this.selectionService.size > 0 || this.sceneTools.selectionCount > 0) return;
      this.removeFocus();
      this.isTableTransformMode = true;
    } else if (!this.isTableTransformMode || document.body !== document.activeElement) {
      return;
    }

    if (!this.pointerDeviceService.isAllowedToOpenContextMenu && this.contextMenuService.isShow) {
      this.ngZone.run(() => this.contextMenuService.close());
    }

    if (srcEvent.cancelable) srcEvent.preventDefault();

    const scale = (1000 + Math.abs(this.viewPotisonZ)) / 1000;

    // Keyboard WASD: strafe on yaw; W/S walk on the pitched table plane (Y+Z)
    // so forward/back feels like moving into / out of the scene.
    if (
      isKeyboard
      && (transformX !== 0 || transformY !== 0)
      && rotateX === 0 && rotateY === 0 && rotateZ === 0
    ) {
      const lx = transformX;
      const ly = transformY;
      const pitch = this.viewRotateX * Math.PI / 180;
      const yaw = -this.viewRotateZ * Math.PI / 180;
      const cosYaw = Math.cos(yaw);
      const sinYaw = Math.sin(yaw);
      const forwardY = ly * Math.cos(pitch);
      const forwardZ = ly * Math.sin(pitch);
      transformX = (lx * cosYaw - forwardY * sinYaw) * scale;
      transformY = (lx * sinYaw + forwardY * cosYaw) * scale;
      transformZ = forwardZ * scale;
      // Keep zoom band usable while walking in depth.
      if (750 < transformZ + this.viewPotisonZ) transformZ += 750 - (transformZ + this.viewPotisonZ);
      if (transformZ + this.viewPotisonZ < -750) transformZ += -750 - (transformZ + this.viewPotisonZ);
    } else {
      transformX *= scale;
      transformY *= scale;
    }

    this.setTransform(transformX, transformY, transformZ, rotateX, rotateY, rotateZ);
    this.isTableTransformed = true;
  }

  onTablePickStart() {
    this.isTableTransformMode = false;
    // Only cue audio when picking an object / magnetic gather — not bare empty clicks.
    if (this.pickGesture.isMagneticMode || this.pickGesture.isPickObjectMode) {
      SoundEffect.playLocal(PresetSound.selectionStart);
    }

    if (!this.pickGesture.isMagneticMode) {
      let opacity: number = this.tableSelecter.gridShow ? 1.0 : 0.0;
      this.gridCanvas.nativeElement.style.opacity = opacity + '';
    }
  }

  onTablePickEnd() {
    if (this.pickGesture.isKeepSelection) {
      // Region select finished: play only if something was actually selected.
      if (this.pickGesture.isPickRegionMode && this.selectionService.size > 0) {
        SoundEffect.playLocal(PresetSound.selectionStart);
      }
      return;
    }
    // Path waypoint clicks must keep the token selected for more Ctrl+clicks.
    if (this.pathClickOrigin || this.tokenPath.hasDraft) return;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (!this.contextMenuService.isShow) this.selectionService.clear();
      });
    });
  }

  onTablePickCancelIfNeeded(): boolean {
    // Scene tools take pointer while a tool is active — don't steal picks.
    if (this.canUseSceneTools && this.sceneTools.isBlockingPick) return true;
    // Ctrl+click path waypoints: pointerdown sets pathClickOrigin before mousedown.
    if (this.pathClickOrigin) return true;
    return this.isTableTransformMode;
  }

  onTablePick() {
    if (!this.pointerDeviceService.isAllowedToOpenContextMenu && this.contextMenuService.isShow) {
      this.ngZone.run(() => this.contextMenuService.close());
    }
  }

  cancelInput() {
    this.mouseGesture.cancel();
    this.isTableTransformMode = true;
    this.pointerDeviceService.isDragging = false;
    let opacity: number = this.tableSelecter.gridShow ? 1.0 : 0.0;
    this.gridCanvas.nativeElement.style.opacity = opacity + '';
  }

  GuestMode() {
    return Network.GuestMode();
  }

  @HostListener('contextmenu', ['$event'])
  onContextMenu(e: any) {
    // Mobile empty-table: add-menu is HUD-only; long-press is reserved for ping.
    if (this.mobileLayout.isMobile && !this.isTouchOnTableObject(e)) {
      e.preventDefault();
      return;
    }
    // Opening a real menu cancels a pending ping-hold.
    this.clearPingHold();
    // Right-click removes the last path waypoint while a draft exists.
    if (this.tokenPath.hasDraft && !this.tokenPath.isAnimating) {
      if (!this.pointerDeviceService.isAllowedToOpenContextMenu) return;
      e.preventDefault();
      e.stopPropagation();
      this.ngZone.run(() => {
        this.tokenPath.undoLastWaypoint();
        this.changeDetector.detectChanges();
      });
      return;
    }
    if (this.canCreateCurrentMode && this.sceneTools.mode === 'wall' && this.sceneTools.wallDraftPoints.length >= 2) {
      e.preventDefault();
      const wall = TableWall.create(this.sceneTools.wallDraftPoints.slice());
      this.currentTable.appendChild(wall);
      this.sceneTools.trackCreated(wall);
      this.sceneTools.resetDrafts();
      this.sceneTools.selectWall(wall);
      this.refreshFx();
      return;
    }
    if (this.sceneTools.mode === 'draw-polygon' && this.sceneTools.polygonDraftPoints.length) {
      e.preventDefault();
      this.sceneTools.polygonDraftPoints.pop();
      return;
    }

    if (!document.activeElement.contains(this.gameObjects.nativeElement)) return;
    e.preventDefault();

    if (!this.pointerDeviceService.isAllowedToOpenContextMenu) return;
    if (this.GuestMode()) return;

    let menuPosition = this.pointerDeviceService.pointers[0];
    let objectPosition = this.coordinateService.calcTabletopLocalCoordinate();
    let extraActions: ContextMenuAction[] = [];

    if (0 < this.selectionService.size) {
      extraActions.push({
        name: this.i18n.t('gt.congregate'),
        action: () => {
          this.selectionService.congregate(objectPosition);
        },
      });
      extraActions.push(ContextMenuSeparator);
    }
    Array.prototype.push.apply(extraActions, this.tabletopActionService.makeDefaultContextMenuActions(objectPosition));
    const sceneCreates = this.makeSceneCreateMenuActions(objectPosition);
    if (sceneCreates.length) {
      extraActions.push(ContextMenuSeparator);
      Array.prototype.push.apply(extraActions, sceneCreates);
    }
    if (SceneToolPermission.instance.canOpenMenu('menu.table')) {
      extraActions.push(ContextMenuSeparator);
      extraActions.push({
        name: this.i18n.t('gt.mapSettings'), action: () => {
          this.panelService.open(GameTableSettingComponent, this.mobileLayout.adaptPanelOption({
            width: 610, height: 540, left: 100,
            mobileReplace: true,
            tourPanelId: 'menu.table',
            title: this.i18n.t('table.title'),
          }));
        }
      });
    }
    EventSystem.trigger('OPEN_TOOLBOX', {
      x: menuPosition.x,
      y: menuPosition.y,
      extraActions
    });
  }

  private makeSceneCreateMenuActions(position: PointerCoordinate): ContextMenuAction[] {
    const perm = SceneToolPermission.instance;
    if (!perm.canOpenPanel) return [];
    const actions: ContextMenuAction[] = [];
    if (perm.canCreateKind('light')) {
      actions.push({
        name: this.i18n.t('scene.ctx.addLight'),
        action: () => this.createSceneLightAt(position),
      });
    }
    if (perm.canCreateKind('wall')) {
      actions.push({
        name: this.i18n.t('scene.ctx.addWall'),
        action: () => this.beginSceneWallAt(position),
      });
    }
    if (perm.canCreateKind('draw-freehand')) {
      actions.push({
        name: this.i18n.t('scene.ctx.addFreehand'),
        action: () => this.beginSceneFreehand(),
      });
    }
    if (perm.canCreateKind('draw-text')) {
      actions.push({
        name: this.i18n.t('scene.ctx.addText'),
        action: () => this.createSceneTextAt(position),
      });
    }
    return actions;
  }

  private ensureSceneToolsPanel() {
    if (this.sceneTools.isPanelOpen) return;
    this.panelService.open(SceneToolsComponent, this.mobileLayout.adaptPanelOption({
      width: 380, height: 560, left: 100,
      mobileReplace: true,
      tourPanelId: 'menu.sceneTools',
      title: this.i18n.t(PeerCursor.myCursor?.isGMMode ? 'scene.titleGm' : 'scene.title'),
    }));
  }

  /** Scene-tools panel idles on open; run after that microtask. */
  private runAfterSceneToolsReady(fn: () => void) {
    const alreadyOpen = this.sceneTools.isPanelOpen;
    this.ensureSceneToolsPanel();
    if (alreadyOpen) {
      fn();
      return;
    }
    setTimeout(fn, 0);
  }

  private createSceneLightAt(position: PointerCoordinate) {
    if (!SceneToolPermission.instance.canCreateKind('light') || !this.currentTable) return;
    this.runAfterSceneToolsReady(() => {
      const grid = this.currentTable.gridSize || 50;
      const dim = Math.max(grid * 0.5, this.sceneTools.lightDimGrid * grid);
      const ratio = this.sceneTools.lightDimGrid > 0
        ? Math.min(1, this.sceneTools.lightBrightGrid / this.sceneTools.lightDimGrid)
        : 0.5;
      const light = TableLight.create(position.x, position.y, dim);
      light.brightRadius = Math.max(0, dim * ratio);
      light.color = this.sceneTools.lightColor;
      light.intensity = this.sceneTools.lightIntensity;
      light.name = this.sceneTools.lightName || this.i18n.t('scene.defaultLightName');
      this.currentTable.appendChild(light);
      this.sceneTools.trackCreated(light);
      this.sceneTools.selectLight(light);
      this.sceneTools.enterSelect();
      this.refreshFx();
      SoundEffect.play(PresetSound.piecePut);
      this.changeDetector.detectChanges();
    });
  }

  private createSceneTextAt(position: PointerCoordinate) {
    if (!SceneToolPermission.instance.canCreateKind('draw-text') || !this.currentTable) return;
    this.runAfterSceneToolsReady(() => {
      const d = TableDrawing.create('text', Network.peer?.userId || '');
      d.x = position.x;
      d.y = position.y;
      d.text = this.sceneTools.draftText || this.i18n.t('scene.defaultNote');
      d.fontSize = this.sceneTools.draftFontSize || 18;
      this.applyDrawStyle(d, false);
      this.currentTable.appendChild(d);
      this.sceneTools.trackCreated(d);
      this.sceneTools.selectDrawing(d);
      this.sceneTools.enterSelect();
      SoundEffect.play(PresetSound.piecePut);
      this.changeDetector.detectChanges();
    });
  }

  private beginSceneWallAt(position: PointerCoordinate) {
    if (!SceneToolPermission.instance.canCreateKind('wall')) return;
    this.runAfterSceneToolsReady(() => {
      this.sceneTools.setMode('wall');
      this.sceneTools.wallDraftPoints = [{ x: position.x, y: position.y }];
      this.scheduleDrawDraftRefresh();
      this.changeDetector.detectChanges();
    });
  }

  private beginSceneFreehand() {
    if (!SceneToolPermission.instance.canCreateKind('draw-freehand')) return;
    this.runAfterSceneToolsReady(() => {
      this.sceneTools.setMode('draw-freehand');
      this.changeDetector.detectChanges();
    });
  }

  @HostListener('document:mousedown', ['$event'])
  onDocumentMouseDown(e: MouseEvent) {
    this.isTableTransformed = false;
  }

  @HostListener('document:touchstart', ['$event'])
  onDocumentTouchStart(e: TouchEvent) {
    this.isTableTransformed = false;
  }

  @HostListener('document:contextmenu', ['$event'])
  onDocumentContextMenu(e: MouseEvent) {
    if (this.isTableTransformed && !this.pointerDeviceService.isAllowedToOpenContextMenu) e.preventDefault();
  }

  @HostListener('window:keydown', ['$event'])
  onDebugPoseHotkey(e: KeyboardEvent) {
    if (!(e.ctrlKey || e.metaKey) || !e.shiftKey) return;
    if (e.code !== 'KeyD') return;
    const tag = (e.target as HTMLElement)?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    e.preventDefault();
    this.setShowDebugPose(!this.showDebugPose);
  }

  setShowDebugPose(show: boolean) {
    this.showDebugPose = show;
    sessionStorage.setItem('udon.debugPose', show ? '1' : '0');
    if (show) {
      this.startDebugPoseRefresh();
      // One Angular pass to mount the panel; further updates are DOM-only.
      this.changeDetector.markForCheck();
      queueMicrotask(() => this.refreshDebugPoseDom());
    }
  }

  private startDebugPoseRefresh() {
    if (this.debugPoseTimer) return;
    // Outside Angular — never NgZone.run here (global CD hits closed sheets with null objects).
    this.ngZone.runOutsideAngular(() => {
      this.debugPoseTimer = setInterval(() => this.refreshDebugPoseDom(), 100);
    });
  }

  private refreshDebugPoseDom() {
    if (!this.showDebugPose) return;
    const el = document.getElementById('udon-debug-pose-body');
    if (el) el.textContent = this.debugPoseText;
  }

  private fmtDebug(n: number): string {
    if (!Number.isFinite(n)) return '—';
    return (Math.round(n * 100) / 100).toFixed(2);
  }

  private debugObjectLabel(object: { aliasName?: string; identifier?: string; name?: string }): string {
    const name = typeof (object as any).name === 'string' ? (object as any).name.trim() : '';
    const alias = object.aliasName || '?';
    const id = (object.identifier || '').slice(0, 8);
    return name ? `${alias} “${name}” (${id})` : `${alias} (${id})`;
  }

  get debugPoseText(): string {
    const lines: string[] = [
      `view.rotX  ${this.fmtDebug(this.viewRotateX)}°`,
      `view.rotY  ${this.fmtDebug(this.viewRotateY)}°`,
      `view.rotZ  ${this.fmtDebug(this.viewRotateZ)}°`,
      `view.pos   ${this.fmtDebug(this.viewPotisonX)}, ${this.fmtDebug(this.viewPotisonY)}, ${this.fmtDebug(this.viewPotisonZ)}`,
      `sel.count  ${this.selectionService.size}`,
    ];
    const objs = this.selectionService.objects;
    if (objs.length < 1) {
      lines.push('', '(no selection — Alt+wheel = view)');
    } else {
      for (const o of objs) {
        lines.push('', `# ${this.debugObjectLabel(o)}`);
        lines.push(`  x,y     ${this.fmtDebug(o.location.x)}, ${this.fmtDebug(o.location.y)}`);
        lines.push(`  posZ    ${this.fmtDebug(o.posZ)}`);
        if (o.isAltitudeIndicate || 'altitude' in o) {
          lines.push(`  alt     ${this.fmtDebug(o.altitude)}`);
        }
        if ('rotate' in o) lines.push(`  rotate  ${this.fmtDebug(+(o as any).rotate || 0)}°`);
        if ('roll' in o) lines.push(`  roll    ${this.fmtDebug(+(o as any).roll || 0)}°`);
      }
    }
    return lines.join('\n');
  }

  private setTransform(transformX: number, transformY: number, transformZ: number, rotateX: number, rotateY: number, rotateZ: number, isAbsolute: boolean=false) {
    if (isAbsolute) {
      this.viewRotateX = rotateX;
      this.viewRotateY = rotateY;
      this.viewRotateZ = rotateZ;
      this.viewPotisonX = transformX;
      this.viewPotisonY = transformY;
      this.viewPotisonZ = transformZ;
    } else {
      this.viewRotateX += rotateX;
      this.viewRotateY += rotateY;
      this.viewRotateZ += rotateZ;
      this.viewPotisonX += transformX;
      this.viewPotisonY += transformY;
      this.viewPotisonZ += transformZ;
    }

    this.syncZoomSliderFromZ();

    if (isAbsolute || rotateX != 0 || rotateY != 0 || rotateX != 0) {
      this.ngZone.run(() => {
        EventSystem.trigger('TABLE_VIEW_ROTATE', {
          x: this.viewRotateX,
          y: this.viewRotateY,
          z: this.viewRotateZ
        });
      });
    }

    this.gameTable.nativeElement.style.transform = `translateZ(${this.viewPotisonZ.toFixed(4)}px) translateY(${this.viewPotisonY.toFixed(4)}px) translateX(${this.viewPotisonX.toFixed(4)}px) rotateY(${this.viewRotateY.toFixed(4)}deg) rotateX(${this.viewRotateX.toFixed(4) + 'deg) rotateZ(' + this.viewRotateZ.toFixed(4)}deg)`;
  }

  /** Map viewPotisonZ → slider -100..100 (pinch / wheel / reset). */
  private syncZoomSliderFromZ() {
    const next = Math.round(Math.min(100, Math.max(-100, this.viewPotisonZ / GameTableComponent.ZOOM_SLIDER_TO_Z)));
    if (next === this.zoomSliderValue) return;
    this.ngZone.run(() => {
      this.zoomSliderValue = next;
      this.changeDetector.markForCheck();
    });
  }

  /** Top-right zoom slider (-100..100). */
  onZoomSliderInput(ev: Event) {
    const raw = Number((ev.target as HTMLInputElement)?.value);
    if (!Number.isFinite(raw)) return;
    const v = Math.min(100, Math.max(-100, raw));
    this.zoomSliderValue = v;
    // Map to the same Z band used by touch zoom (~±750).
    const z = Math.min(750, Math.max(-750, v * GameTableComponent.ZOOM_SLIDER_TO_Z));
    this.removeFocus();
    this.setTransform(this.viewPotisonX, this.viewPotisonY, z, this.viewRotateX, this.viewRotateY, this.viewRotateZ, true);
  }

  resetZoomSlider() {
    this.zoomSliderValue = 0;
    this.setTransform(this.viewPotisonX, this.viewPotisonY, 0, this.viewRotateX, this.viewRotateY, this.viewRotateZ, true);
  }

  /** Map HUD: open chat half-sheet. */
  hudOpenChat() {
    EventSystem.trigger('OPEN_CHAT', null);
  }

  /** Map HUD: open add-object menu at view center. */
  hudOpenAddMenu(ev: Event) {
    ev.stopPropagation();
    const tablePos = this.coordinateService.calcTabletopLocalCoordinate();
    const rect = (ev.currentTarget as HTMLElement)?.getBoundingClientRect?.();
    const x = rect ? rect.left + rect.width / 2 : (this.pointerDeviceService.pointers[0]?.x ?? window.innerWidth / 2);
    const y = rect ? rect.top : (this.pointerDeviceService.pointers[0]?.y ?? window.innerHeight / 2);
    EventSystem.trigger('OPEN_TOOLBOX', {
      x,
      y,
      extraActions: this.tabletopActionService.makeDefaultContextMenuActions(tablePos),
    });
  }

  /** Map HUD: ping at current pointer / table focus. */
  hudPing(warning = false) {
    const pos = this.coordinateService.calcTabletopLocalCoordinate();
    this.broadcastPing(pos.x, pos.y, warning ? 'warning' : 'basic');
  }

  toggleMapHudCollapsed() {
    this.mapHudCollapsed = !this.mapHudCollapsed;
    try {
      sessionStorage.setItem(GameTableComponent.MAP_HUD_COLLAPSED_KEY, this.mapHudCollapsed ? '1' : '0');
    } catch { /* ignore */ }
    this.changeDetector.markForCheck();
  }

  startMapHudDrag(ev: PointerEvent) {
    ev.preventDefault();
    ev.stopPropagation();
    const host = (ev.currentTarget as HTMLElement)?.closest?.('.map-action-hud') as HTMLElement
      || document.querySelector('.map-action-hud') as HTMLElement;
    if (!host) return;
    const rect = host.getBoundingClientRect();
    if (this.mapHudLeft == null || this.mapHudTop == null) {
      this.mapHudLeft = rect.left;
      this.mapHudTop = rect.top;
    }
    this.mapHudDragging = true;
    this.mapHudDragOffsetX = ev.clientX - this.mapHudLeft;
    this.mapHudDragOffsetY = ev.clientY - this.mapHudTop;
    (ev.currentTarget as HTMLElement)?.setPointerCapture?.(ev.pointerId);
  }

  private moveMapHudDrag(ev: PointerEvent) {
    if (!this.mapHudDragging || this.mapHudLeft == null || this.mapHudTop == null) return;
    this.mapHudLeft = ev.clientX - this.mapHudDragOffsetX;
    this.mapHudTop = ev.clientY - this.mapHudDragOffsetY;
    this.clampMapHudPosition();
    this.changeDetector.detectChanges();
  }

  private endMapHudDrag() {
    if (!this.mapHudDragging) return;
    this.mapHudDragging = false;
    this.persistMapHudLayout();
  }

  private restoreMapHudLayout() {
    try {
      const raw = sessionStorage.getItem(GameTableComponent.MAP_HUD_POS_KEY);
      if (!raw) return;
      const pos = JSON.parse(raw) as { left?: number; top?: number };
      if (typeof pos.left === 'number' && typeof pos.top === 'number') {
        this.mapHudLeft = pos.left;
        this.mapHudTop = pos.top;
        this.clampMapHudPosition();
      }
    } catch { /* ignore */ }
  }

  private persistMapHudLayout() {
    if (this.mapHudLeft == null || this.mapHudTop == null) return;
    try {
      sessionStorage.setItem(
        GameTableComponent.MAP_HUD_POS_KEY,
        JSON.stringify({ left: this.mapHudLeft, top: this.mapHudTop }),
      );
    } catch { /* ignore */ }
  }

  private clampMapHudPosition() {
    if (this.mapHudLeft == null || this.mapHudTop == null) return;
    const maxLeft = Math.max(0, window.innerWidth - 56);
    const maxTop = Math.max(0, window.innerHeight - 40);
    this.mapHudLeft = Math.min(maxLeft, Math.max(0, this.mapHudLeft));
    this.mapHudTop = Math.min(maxTop, Math.max(0, this.mapHudTop));
  }

  private setGameTableGrid(width: number, height: number, gridSize: number = 50, gridType: GridType = GridType.SQUARE, gridColor: string = '#000000e6', isShowNumber = true) {
    this.gameTable.nativeElement.style.width = width * gridSize + 'px';
    this.gameTable.nativeElement.style.height = height * gridSize + 'px';

    let render = new GridLineRender(this.gridCanvas.nativeElement);
    render.render(width, height, gridSize, gridType, gridColor, isShowNumber);

    let opacity: number = this.tableSelecter.gridShow ? 1.0 : 0.0;
    this.gridCanvas.nativeElement.style.opacity = opacity + '';
  }

  private removeSelectionRanges() {
    let selection = window.getSelection();
    if (!selection.isCollapsed) {
      selection.removeAllRanges();
    }
  }

  private removeFocus() {
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
  }

  /** True when the touch target is a tabletop object that should drag, not pan the map. */
  private isTouchOnTableObject(srcEvent: TouchEvent | MouseEvent | PointerEvent | null): boolean {
    const t = srcEvent?.target;
    if (!(t instanceof Element)) return false;
    return !!t.closest(
      '[appMovable], [appRotable], [appResizable], game-character, card, card-stack, dice-symbol, text-note, terrain, game-table-mask, range'
    );
  }

  trackByGameObject(index: number, gameObject: GameObject) {
    return gameObject.identifier;
  }

  isCursorHidIn(cursor: PeerCursor): boolean {
    if (cursor.isGMMode) return true;
    for (let character of this.characters) {
      if (character.isHideIn && character.isVisibleOnTable && character.owner === cursor.userId) return true;
    }
    return false;
  }

  polylinePoints(d: TableDrawing): string {
    const pts = d.geom?.points || [];
    return pts.map((p: any) => `${p.x},${p.y}`).join(' ');
  }

  wallPointsAttr(w: TableWall): string {
    return (w.points || []).map(p => `${p.x},${p.y}`).join(' ');
  }

  draftPointsAttr(pts: { x: number; y: number }[]): string {
    return (pts || []).map(p => `${p.x},${p.y}`).join(' ');
  }

  isDrawingSelected(d: TableDrawing): boolean {
    return this.sceneTools.isDrawingSelected(d);
  }

  isWallSelected(w: TableWall): boolean {
    return this.sceneTools.isWallSelected(w);
  }

  isLightSelected(l: TableLight): boolean {
    return this.sceneTools.isLightSelected(l);
  }

  private refreshFx() {
    if (!this.lightingRender || !this.currentTable) return;
    const onTable = this.characters.filter(c => c.location?.name === 'table');
    const userId = Network.peer?.userId || '';
    const visionChars = onTable.filter(c => c.providesVisionTo(userId));
    this.lightingRender.render(
      this.currentTable,
      visionChars,
      onTable,
      this.collectLightOccluders(),
      this.isGMMode,
    );
    this.weatherRender?.sync(this.currentTable);
    this.updateOffscreenArrows();
    this.changeDetector.markForCheck();
  }

  /** Characters / masks / terrains that cast shadows into lights & vision (default on). */
  private collectLightOccluders(): LightOccluder[] {
    const table = this.currentTable;
    if (!table) return [];
    const grid = table.gridSize || 50;
    const out: LightOccluder[] = [];

    for (const ch of this.characters) {
      if (ch.location?.name !== 'table') continue;
      const s = Math.max(grid * 0.35, (ch.size || 1) * grid);
      out.push({ id: ch.identifier, points: this.rectOccluder(ch.location.x, ch.location.y, s, s) });
    }
    for (const mask of this.tableMasks) {
      if (mask.location?.name !== 'table') continue;
      if (mask.affectsLight === false) continue;
      const w = Math.max(1, (mask.width || 1) * grid);
      const h = Math.max(1, (mask.height || 1) * grid);
      out.push({ id: mask.identifier, points: this.rectOccluder(mask.location.x, mask.location.y, w, h) });
    }
    for (const terrain of this.terrains) {
      if (terrain.location?.name !== 'table') continue;
      if (terrain.affectsLight === false) continue;
      const w = Math.max(1, (terrain.width || 1) * grid);
      const d = Math.max(1, (terrain.depth || 1) * grid);
      out.push({
        id: terrain.identifier,
        points: this.rectOccluder(terrain.location.x, terrain.location.y, w, d, terrain.rotate || 0),
      });
    }
    return out;
  }

  private rectOccluder(
    x: number,
    y: number,
    w: number,
    h: number,
    rotateDeg: number = 0,
  ): { x: number; y: number }[] {
    const corners = [
      { x: x, y: y },
      { x: x + w, y: y },
      { x: x + w, y: y + h },
      { x: x, y: y + h },
    ];
    if (!rotateDeg) return corners;
    const rad = rotateDeg * Math.PI / 180;
    const cx = x + w / 2;
    const cy = y + h / 2;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    return corners.map(p => {
      const dx = p.x - cx;
      const dy = p.y - cy;
      return { x: cx + dx * cos - dy * sin, y: cy + dx * sin + dy * cos };
    });
  }

  @HostListener('pointerdown', ['$event'])
  onPointerDown(e: PointerEvent) {
    if (e.button !== 0) return;
    this.activePointerIds.add(e.pointerId);
    // Second+ finger: cancel ping hold so two-finger pan/pinch can take over.
    if (e.pointerType === 'touch' && (e.isPrimary === false || this.activePointerIds.size > 1)) {
      this.clearPingHold();
      return;
    }
    // Use event page coords (PointerDevice may still be stale before touchstart).
    const pos = this.tablePosFromClient(e.pageX, e.pageY);
    // clearPingHold must run before setting origin (it nulls origin/timer).
    this.clearPingHold();

    // Ctrl+left: add waypoint. Plain left with draft: start moving.
    if (e.ctrlKey && this.tokenPath.canDraft()) {
      this.pathClickOrigin = { clientX: e.clientX, clientY: e.clientY, x: pos.x, y: pos.y, mode: 'add' };
      return;
    }
    if (!e.ctrlKey && !e.shiftKey && this.tokenPath.hasDraft && !this.tokenPath.isAnimating) {
      this.pathClickOrigin = { clientX: e.clientX, clientY: e.clientY, x: pos.x, y: pos.y, mode: 'go' };
      return;
    }

    // Empty-table hold → ping. Mobile ~0.55s (same feel as old long-press);
    // desktop ~1s. Mobile add-menu is HUD-only (see onContextMenu).
    const pingPageX = e.pageX;
    const pingPageY = e.pageY;
    this.pingHoldOrigin = { x: e.clientX, y: e.clientY };
    this.pingHoldLast = { x: e.clientX, y: e.clientY };
    this.pingHoldShift = e.shiftKey;
    const pingHoldMs = this.mobileLayout.isMobile ? 550 : 1000;
    this.pingHoldTimer = setTimeout(() => {
      if (!this.pingHoldOrigin || !this.pingHoldLast) return;
      const dx = this.pingHoldLast.x - this.pingHoldOrigin.x;
      const dy = this.pingHoldLast.y - this.pingHoldOrigin.y;
      if (dx * dx + dy * dy > GameTableComponent.PING_MOVE_THRESHOLD_SQ) return;
      if (this.pointerDeviceService.isDragging) return;
      // Don't ping while placing scene tools.
      if (this.canUseSceneTools && this.sceneTools.isBlockingPick) return;
      // Multi-touch in progress — leave room for two-finger gestures.
      if (this.activePointerIds.size > 1) return;
      // Mobile: basic ping only (warning stays on HUD); desktop Shift = warning.
      const warning = !this.mobileLayout.isMobile && this.pingHoldShift;
      const tablePos = this.tablePosFromClient(pingPageX, pingPageY);
      this.broadcastPing(tablePos.x, tablePos.y, warning ? 'warning' : 'basic');
      this.clearPingHold();
    }, pingHoldMs);

    if (!this.canUseSceneTools) return;

    // Scene select: drag a marquee to multi-select; short click hits one object.
    if (this.sceneTools.isSceneSelectMode) {
      if (!this.canModifyScene) return;
      e.preventDefault();
      e.stopPropagation();
      this.selectionService.clear();
      this.clearSceneMarquee();
      this.pickGesture?.cancel();
      const tablePos = this.tablePosFromClient(e.pageX, e.pageY);
      this.sceneMarqueeStart = { x: tablePos.x, y: tablePos.y };
      this.sceneMarqueeCurrent = { x: tablePos.x, y: tablePos.y };
      this.sceneMarqueeActive = false;
      this.scheduleDrawDraftRefresh();
      return;
    }

    // Idle scene tools: do not intercept tabletop interaction.
    if (!this.sceneTools.isBlockingPick) return;
    if (!this.canCreateCurrentMode) return;

    if (this.sceneTools.mode === 'light') {
      this.drawDragStart = { x: pos.x, y: pos.y };
      this.drawDragCurrent = { x: pos.x, y: pos.y };
      this.scheduleDrawDraftRefresh();
      return;
    }
    if (this.sceneTools.mode === 'wall') {
      this.sceneTools.wallDraftPoints.push({ x: pos.x, y: pos.y });
      // Double-click finishes wall (also available via panel button / right-click).
      if (this.sceneTools.wallDraftPoints.length >= 2 && e.detail >= 2) {
        const wall = TableWall.create(this.sceneTools.wallDraftPoints.slice());
        this.currentTable.appendChild(wall);
        this.sceneTools.trackCreated(wall);
        this.sceneTools.resetDrafts();
        this.sceneTools.selectWall(wall);
        this.refreshFx();
      }
      return;
    }
    if (this.sceneTools.isDrawMode) {
      if (this.sceneTools.mode === 'draw-text') {
        const d = TableDrawing.create('text', Network.peer?.userId || '');
        d.x = pos.x;
        d.y = pos.y;
        d.text = this.sceneTools.draftText || this.i18n.t('scene.defaultNote');
        d.fontSize = this.sceneTools.draftFontSize || 18;
        this.applyDrawStyle(d, false);
        this.currentTable.appendChild(d);
        this.sceneTools.trackCreated(d);
        this.sceneTools.selectDrawing(d);
        return;
      }
      if (this.sceneTools.mode === 'draw-polygon') {
        this.sceneTools.polygonDraftPoints.push({ x: pos.x, y: pos.y });
        this.drawDragCurrent = { x: pos.x, y: pos.y };
        this.scheduleDrawDraftRefresh();
        if (e.detail >= 2 && this.sceneTools.polygonDraftPoints.length >= 3) {
          this.commitPolygon(false);
        }
        return;
      }
      this.drawDragStart = { x: pos.x, y: pos.y };
      this.drawDragCurrent = { x: pos.x, y: pos.y };
      if (this.sceneTools.mode === 'draw-freehand') {
        this.freehandPoints = [{ x: pos.x, y: pos.y }];
      }
      this.scheduleDrawDraftRefresh();
    }
  }

  @HostListener('pointermove', ['$event'])
  onPointerMove(e: PointerEvent) {
    if (this.pingHoldOrigin) {
      // Two-finger gesture started — release ping hold.
      if (this.activePointerIds.size > 1) {
        this.clearPingHold();
      } else {
        this.pingHoldLast = { x: e.clientX, y: e.clientY };
        const dx = e.clientX - this.pingHoldOrigin.x;
        const dy = e.clientY - this.pingHoldOrigin.y;
        if (dx * dx + dy * dy > GameTableComponent.PING_MOVE_THRESHOLD_SQ) this.clearPingHold();
      }
    }
    this.updateSceneMarqueeFromEvent(e);
    this.updateDrawDraftFromPointer();
  }

  @HostListener('document:pointermove', ['$event'])
  onDocumentPointerMove(e: PointerEvent) {
    if (this.sceneMarqueeStart) {
      this.updateSceneMarqueeFromEvent(e);
      return;
    }
    if (!this.drawDragStart && this.sceneTools.mode !== 'draw-polygon' && this.sceneTools.mode !== 'light') return;
    this.updateDrawDraftFromPointer();
  }

  @HostListener('pointerup', ['$event'])
  onPointerUp(e: PointerEvent) {
    this.activePointerIds.delete(e.pointerId);
    this.clearPingHold();
    if (this.finishPathClick(e)) return;
    if (this.sceneMarqueeStart) {
      this.commitSceneMarquee();
      return;
    }
    this.commitDrawDrag();
  }

  @HostListener('pointercancel', ['$event'])
  onPointerCancel(e: PointerEvent) {
    this.activePointerIds.delete(e.pointerId);
    this.clearPingHold();
  }

  @HostListener('document:pointerup', ['$event'])
  onDocumentPointerUp(e: PointerEvent) {
    this.activePointerIds.delete(e.pointerId);
    if (this.finishPathClick(e)) {
      this.clearPingHold();
      return;
    }
    if (this.sceneMarqueeStart) {
      this.clearPingHold();
      this.commitSceneMarquee();
      return;
    }
    if (!this.drawDragStart) return;
    this.clearPingHold();
    this.commitDrawDrag();
  }

  /** Resolve path add / go click; returns true if this pointerup was a path gesture. */
  private finishPathClick(e: PointerEvent): boolean {
    if (!this.pathClickOrigin) return false;
    const origin = this.pathClickOrigin;
    this.pathClickOrigin = null;
    const dx = e.clientX - origin.clientX;
    const dy = e.clientY - origin.clientY;
    if (dx * dx + dy * dy > GameTableComponent.PATH_CLICK_MOVE_SQ) return true;
    if (origin.mode === 'add') {
      if (this.tokenPath.addWaypoint(origin.x, origin.y)) {
        this.changeDetector.detectChanges();
      }
      return true;
    }
    // Plain click: add this position as the final waypoint, then start moving.
    this.ngZone.run(async () => {
      this.tokenPath.addWaypoint(origin.x, origin.y);
      await this.tokenPath.commit();
      this.changeDetector.detectChanges();
    });
    return true;
  }

  @HostListener('dragover', ['$event'])
  onInventoryCharacterDragOver(e: DragEvent) {
    if (!this.readInventoryCharacterDragIds(e).length) return;
    e.preventDefault();
    if (e.dataTransfer) {
      const types = Array.from(e.dataTransfer.types || []);
      e.dataTransfer.dropEffect = types.includes(GameCharacter.INVENTORY_TEMP_COPY_MIME) ? 'copy' : 'move';
    }
  }

  @HostListener('drop', ['$event'])
  onInventoryCharacterDrop(e: DragEvent) {
    const ids = this.readInventoryCharacterDragIds(e);
    if (!ids.length || ids[0] === '__pending__') return;
    e.preventDefault();
    e.stopPropagation();
    if (GuestSession.isGuest) return;

    const pos = this.coordinateService.calcTabletopLocalCoordinate(
      { x: e.clientX, y: e.clientY, z: 0 },
      this.gameObjects?.nativeElement || this.coordinateService.tabletopOriginElement
    );
    const grid = this.currentTable?.gridSize || 50;
    const isTemp = this.readInventoryTempCopy(e);
    let placed = 0;

    for (let i = 0; i < ids.length; i++) {
      const ch = ObjectStore.instance.get(ids[i]);
      if (!(ch instanceof GameCharacter)) continue;
      if (!ch.isVisible && !this.isGMMode) continue;

      const col = i % 5;
      const row = Math.floor(i / 5);
      const x = pos.x - (ch.size * grid) / 2 + col * grid;
      const y = pos.y - (ch.size * grid) / 2 + row * grid;

      if (isTemp) {
        GameCharacter.createTemporaryCopy(ch, { x, y, posZ: ch.posZ });
      } else {
        EventSystem.call('FAREWELL_STAND_IMAGE', { characterIdentifier: ch.identifier });
        ch.addToTable(undefined, { x, y, posZ: ch.posZ });
      }
      placed++;
    }

    if (placed > 0) {
      SoundEffect.play(PresetSound.piecePut);
      EventSystem.call('UPDATE_INVENTORY', true);
    }
  }

  private readInventoryTempCopy(e: DragEvent): boolean {
    if (!e.dataTransfer) return false;
    if (e.dataTransfer.getData(GameCharacter.INVENTORY_TEMP_COPY_MIME)) return true;
    const types = Array.from(e.dataTransfer.types || []);
    return types.includes(GameCharacter.INVENTORY_TEMP_COPY_MIME);
  }

  private readInventoryCharacterDragIds(e: DragEvent): string[] {
    if (!e.dataTransfer) return [];
    const typed = e.dataTransfer.getData(GameCharacter.INVENTORY_DRAG_MIME);
    if (typed) return this.parseInventoryDragPayload(typed);
    // During dragover some browsers only expose types, not data.
    if (e.type === 'dragover') {
      const types = Array.from(e.dataTransfer.types || []);
      if (types.includes(GameCharacter.INVENTORY_DRAG_MIME)) return ['__pending__'];
      if (types.includes(GameCharacter.INVENTORY_TEMP_COPY_MIME)) return ['__pending__'];
      const plainHint = types.includes('text/plain');
      return plainHint ? ['__pending__'] : [];
    }
    const plain = e.dataTransfer.getData('text/plain') || '';
    const m = /^udonarium-character:(.+)$/.exec(plain);
    return m ? this.parseInventoryDragPayload(m[1]) : [];
  }

  private parseInventoryDragPayload(payload: string): string[] {
    return payload.split(',').map(s => s.trim()).filter(Boolean);
  }

  @HostListener('document:keydown', ['$event'])
  onDocumentKeydown(e: KeyboardEvent) {
    if (!this.canUseSceneTools) return;
    if (this.isTypingTarget(e.target)) return;

    if (e.key === 'Escape') {
      if (this.sceneMarqueeStart) {
        e.preventDefault();
        this.clearSceneMarquee();
        this.scheduleDrawDraftRefresh();
        return;
      }
      if (
        this.drawDragStart
        || this.freehandPoints.length
        || this.sceneTools.polygonDraftPoints.length
        || this.sceneTools.wallDraftPoints.length
      ) {
        e.preventDefault();
        this.cancelDrawDraft();
      }
      return;
    }

    if (e.key === 'Enter') {
      if (!this.canCreateCurrentMode) return;
      if (this.tryCommitSceneDraft()) e.preventDefault();
    }
  }

  private isTypingTarget(target: EventTarget | null): boolean {
    const el = target as HTMLElement | null;
    if (!el) return false;
    const tag = el.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
    return !!el.isContentEditable;
  }

  /** Finish in-progress wall / polygon / freehand / shape / light draft. */
  private tryCommitSceneDraft(): boolean {
    if (this.sceneTools.mode === 'wall' && this.sceneTools.wallDraftPoints.length >= 2) {
      const wall = TableWall.create(this.sceneTools.wallDraftPoints.slice());
      this.currentTable.appendChild(wall);
      this.sceneTools.trackCreated(wall);
      this.sceneTools.resetDrafts();
      this.sceneTools.selectWall(wall);
      this.refreshFx();
      return true;
    }
    if (this.sceneTools.mode === 'draw-polygon' && this.sceneTools.polygonDraftPoints.length >= 3) {
      this.commitPolygon(false);
      return true;
    }
    if (
      (this.sceneTools.mode === 'draw-freehand' && this.freehandPoints.length > 1)
      || ((this.sceneTools.mode === 'draw-rect' || this.sceneTools.mode === 'draw-ellipse' || this.sceneTools.mode === 'light')
        && this.drawDragStart)
    ) {
      this.commitDrawDrag();
      return true;
    }
    return false;
  }

  private updateDrawDraftFromPointer() {
    if (!this.canCreateCurrentMode) return;
    const mode = this.sceneTools.mode;
    if (mode === 'draw-freehand' && this.drawDragStart) {
      const pos = this.coordinateService.calcTabletopLocalCoordinate();
      const before = this.freehandPoints.length;
      this.appendFreehandPoint(pos.x, pos.y);
      if (this.freehandPoints.length !== before) this.scheduleDrawDraftRefresh();
      return;
    }
    if ((mode === 'draw-rect' || mode === 'draw-ellipse' || mode === 'light') && this.drawDragStart) {
      const pos = this.coordinateService.calcTabletopLocalCoordinate();
      if (this.drawDragCurrent?.x === pos.x && this.drawDragCurrent?.y === pos.y) return;
      this.drawDragCurrent = { x: pos.x, y: pos.y };
      this.scheduleDrawDraftRefresh();
      return;
    }
    if (mode === 'draw-polygon' && this.sceneTools.polygonDraftPoints.length) {
      const pos = this.coordinateService.calcTabletopLocalCoordinate();
      if (this.drawDragCurrent?.x === pos.x && this.drawDragCurrent?.y === pos.y) return;
      this.drawDragCurrent = { x: pos.x, y: pos.y };
      this.scheduleDrawDraftRefresh();
    }
  }

  private appendFreehandPoint(x: number, y: number) {
    const last = this.freehandPoints[this.freehandPoints.length - 1];
    if (last) {
      const dx = x - last.x;
      const dy = y - last.y;
      if (dx * dx + dy * dy < GameTableComponent.FREEHAND_MIN_DIST_SQ) return;
    }
    this.freehandPoints.push({ x, y });
    if (this.freehandPoints.length > GameTableComponent.FREEHAND_MAX_POINTS) {
      this.freehandPoints = this.thinPolyline(this.freehandPoints, Math.floor(GameTableComponent.FREEHAND_MAX_POINTS * 0.7));
    }
  }

  private thinPolyline(pts: { x: number; y: number }[], target: number): { x: number; y: number }[] {
    if (pts.length <= target) return pts;
    const stride = Math.ceil(pts.length / target);
    const out: { x: number; y: number }[] = [];
    for (let i = 0; i < pts.length; i += stride) out.push(pts[i]);
    const last = pts[pts.length - 1];
    if (out[out.length - 1] !== last) out.push(last);
    return out;
  }

  private simplifyPolyline(pts: { x: number; y: number }[], minDist: number): { x: number; y: number }[] {
    if (pts.length <= 2) return pts.slice();
    const minSq = minDist * minDist;
    const out = [pts[0]];
    for (let i = 1; i < pts.length - 1; i++) {
      const prev = out[out.length - 1];
      const dx = pts[i].x - prev.x;
      const dy = pts[i].y - prev.y;
      if (dx * dx + dy * dy >= minSq) out.push(pts[i]);
    }
    out.push(pts[pts.length - 1]);
    return out;
  }

  private scheduleDrawDraftRefresh() {
    if (this.drawDraftRaf) return;
    this.drawDraftRaf = requestAnimationFrame(() => {
      this.drawDraftRaf = 0;
      this.drawDraftTick++;
      this.changeDetector.detectChanges();
    });
  }

  private applyDrawStyle(d: TableDrawing, withFill: boolean) {
    d.strokeColor = this.sceneTools.drawStrokeColor;
    d.strokeWidth = this.sceneTools.drawStrokeWidth;
    d.strokeOpacity = this.sceneTools.drawStrokeOpacity;
    if (withFill) {
      d.fillColor = this.sceneTools.drawStrokeColor;
      d.fillOpacity = this.sceneTools.drawFillOpacity;
    } else {
      d.fillOpacity = 0;
    }
  }

  private commitDrawDrag() {
    if (!this.drawDragStart) return;
    if (!this.canCreateCurrentMode) {
      this.clearDrawDragState();
      return;
    }
    const pos = this.coordinateService.calcTabletopLocalCoordinate();
    if (this.sceneTools.mode === 'light') {
      const dragged = Math.hypot(pos.x - this.drawDragStart.x, pos.y - this.drawDragStart.y);
      // Short click uses panel defaults; drag sets dim radius by distance.
      const dim = dragged < 8
        ? Math.max(this.currentTable.gridSize * 0.5, this.sceneTools.lightDimGrid * this.currentTable.gridSize)
        : Math.max(this.currentTable.gridSize * 0.5, dragged);
      const ratio = this.sceneTools.lightDimGrid > 0
        ? Math.min(1, this.sceneTools.lightBrightGrid / this.sceneTools.lightDimGrid)
        : 0.5;
      const light = TableLight.create(this.drawDragStart.x, this.drawDragStart.y, dim);
      light.brightRadius = Math.max(0, dim * ratio);
      light.color = this.sceneTools.lightColor;
      light.intensity = this.sceneTools.lightIntensity;
      light.name = this.sceneTools.lightName || this.i18n.t('scene.defaultLightName');
      this.currentTable.appendChild(light);
      this.sceneTools.trackCreated(light);
      this.sceneTools.selectLight(light);
      this.refreshFx();
    } else if (this.sceneTools.mode === 'draw-rect' || this.sceneTools.mode === 'draw-ellipse') {
      const width = Math.abs(pos.x - this.drawDragStart.x);
      const height = Math.abs(pos.y - this.drawDragStart.y);
      if (width >= 4 || height >= 4) {
        const d = TableDrawing.create(this.sceneTools.mode === 'draw-rect' ? 'rect' : 'ellipse', Network.peer?.userId || '');
        d.x = Math.min(this.drawDragStart.x, pos.x);
        d.y = Math.min(this.drawDragStart.y, pos.y);
        d.width = Math.max(8, width);
        d.height = Math.max(8, height);
        this.applyDrawStyle(d, true);
        this.currentTable.appendChild(d);
        this.sceneTools.trackCreated(d);
        this.sceneTools.selectDrawing(d);
      }
    } else if (this.sceneTools.mode === 'draw-freehand' && this.freehandPoints.length > 1) {
      const points = this.simplifyPolyline(this.freehandPoints, 2);
      const d = TableDrawing.create('freehand', Network.peer?.userId || '');
      d.geom = { points };
      this.applyDrawStyle(d, false);
      // Bound freehand for hit-test / list
      let minX = points[0].x, minY = points[0].y, maxX = points[0].x, maxY = points[0].y;
      for (const p of points) {
        if (p.x < minX) minX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.x > maxX) maxX = p.x;
        if (p.y > maxY) maxY = p.y;
      }
      d.x = minX;
      d.y = minY;
      d.width = Math.max(1, maxX - minX);
      d.height = Math.max(1, maxY - minY);
      this.currentTable.appendChild(d);
      this.sceneTools.trackCreated(d);
      this.sceneTools.selectDrawing(d);
    }
    this.clearDrawDragState();
  }

  private cancelDrawDraft() {
    this.clearDrawDragState();
    this.sceneTools.resetDrafts();
    this.scheduleDrawDraftRefresh();
  }

  private clearDrawDragState() {
    this.drawDragStart = null;
    this.drawDragCurrent = null;
    this.freehandPoints = [];
    if (this.drawDraftRaf) {
      cancelAnimationFrame(this.drawDraftRaf);
      this.drawDraftRaf = 0;
    }
    this.drawDraftTick++;
  }

  private commitPolygon(switchToSelect: boolean) {
    if (this.sceneTools.polygonDraftPoints.length < 3) return;
    const d = TableDrawing.create('polygon', Network.peer?.userId || '');
    d.geom = { points: this.sceneTools.polygonDraftPoints.slice() };
    this.applyDrawStyle(d, true);
    this.currentTable.appendChild(d);
    this.sceneTools.trackCreated(d);
    this.sceneTools.resetDrafts();
    this.drawDragCurrent = null;
    this.sceneTools.selectDrawing(d);
    if (switchToSelect) this.sceneTools.idle();
    this.scheduleDrawDraftRefresh();
  }

  /** Hit-test scene objects under cursor (select mode). */
  private trySelectSceneObject(x: number, y: number): boolean {
    const pad = 12;
    const perm = SceneToolPermission.instance;
    // Drawings (top-most last)
    if (perm.canModifyKind('drawing')) {
      for (let i = this.drawings.length - 1; i >= 0; i--) {
        const d = this.drawings[i];
        if (this.hitDrawing(d, x, y, pad)) {
          this.sceneTools.selectDrawing(d);
          return true;
        }
      }
    }
    if (perm.canModifyKind('light')) {
      for (let i = this.lights.length - 1; i >= 0; i--) {
        const l = this.lights[i];
        const dx = l.x - x, dy = l.y - y;
        if (dx * dx + dy * dy <= 16 * 16) {
          this.sceneTools.selectLight(l);
          return true;
        }
      }
    }
    if (perm.canModifyKind('wall')) {
      for (let i = this.walls.length - 1; i >= 0; i--) {
        const w = this.walls[i];
        if (this.hitWall(w, x, y, pad)) {
          this.sceneTools.selectWall(w);
          return true;
        }
      }
    }
    return false;
  }

  /** Map page coords → tabletop local (always via origin; ignore hover target). */
  private tablePosFromClient(pageX: number, pageY: number): { x: number; y: number } {
    const origin = this.gameObjects?.nativeElement || this.coordinateService.tabletopOriginElement;
    const pos = this.coordinateService.calcTabletopLocalCoordinate(
      { x: pageX, y: pageY, z: 0 },
      origin
    );
    return { x: pos.x, y: pos.y };
  }

  private updateSceneMarqueeFromEvent(e: PointerEvent) {
    if (!this.sceneMarqueeStart || !this.sceneTools.isSceneSelectMode) return;
    const pos = this.tablePosFromClient(e.pageX, e.pageY);
    if (this.sceneMarqueeCurrent?.x === pos.x && this.sceneMarqueeCurrent?.y === pos.y) return;
    this.sceneMarqueeCurrent = { x: pos.x, y: pos.y };
    if (!this.sceneMarqueeActive) {
      const dx = pos.x - this.sceneMarqueeStart.x;
      const dy = pos.y - this.sceneMarqueeStart.y;
      if (dx * dx + dy * dy >= GameTableComponent.SCENE_MARQUEE_MIN_SQ) {
        this.sceneMarqueeActive = true;
      }
    }
    this.scheduleDrawDraftRefresh();
  }

  private commitSceneMarquee() {
    const start = this.sceneMarqueeStart;
    const current = this.sceneMarqueeCurrent;
    const wasActive = this.sceneMarqueeActive;
    this.clearSceneMarquee();
    if (!start || !current || !this.sceneTools.isSceneSelectMode || !this.canModifyScene) {
      this.scheduleDrawDraftRefresh();
      return;
    }
    if (wasActive) {
      const rect = {
        x: Math.min(start.x, current.x),
        y: Math.min(start.y, current.y),
        width: Math.abs(current.x - start.x),
        height: Math.abs(current.y - start.y),
      };
      this.selectSceneObjectsInRect(rect);
    } else {
      // Short click: pick one scene object or clear selection.
      if (!this.trySelectSceneObject(start.x, start.y)) {
        this.sceneTools.clearSelection();
      }
    }
    this.scheduleDrawDraftRefresh();
    this.changeDetector.detectChanges();
  }

  private clearSceneMarquee() {
    this.sceneMarqueeStart = null;
    this.sceneMarqueeCurrent = null;
    this.sceneMarqueeActive = false;
  }

  private selectSceneObjectsInRect(rect: { x: number; y: number; width: number; height: number }) {
    const perm = SceneToolPermission.instance;
    const drawings: TableDrawing[] = [];
    const lights: TableLight[] = [];
    const walls: TableWall[] = [];
    if (perm.canModifyKind('drawing')) {
      for (const d of this.drawings) {
        if (this.boundsIntersects(rect, this.drawingBounds(d))) drawings.push(d);
      }
    }
    if (perm.canModifyKind('light')) {
      for (const l of this.lights) {
        if (this.pointInRect(l.x, l.y, rect, 8)) lights.push(l);
      }
    }
    if (perm.canModifyKind('wall')) {
      for (const w of this.walls) {
        if (this.boundsIntersects(rect, this.pointsBounds(w.points || []))) walls.push(w);
      }
    }
    this.sceneTools.setMultiSelection(drawings, lights, walls);
    if (this.sceneTools.selectionCount > 0) {
      SoundEffect.playLocal(PresetSound.selectionStart);
    }
  }

  private drawingBounds(d: TableDrawing): { x: number; y: number; width: number; height: number } {
    if (d.type === 'text') {
      const w = Math.max(40, (d.text?.length || 1) * (d.fontSize || 18) * 0.6);
      const h = (d.fontSize || 18) + 8;
      return { x: d.x, y: d.y, width: w, height: h };
    }
    if (d.type === 'rect' || d.type === 'ellipse') {
      return { x: d.x, y: d.y, width: Math.abs(d.width || 0), height: Math.abs(d.height || 0) };
    }
    const pts = d.geom?.points || [];
    if (pts.length) return this.pointsBounds(pts);
    return { x: d.x || 0, y: d.y || 0, width: Math.abs(d.width || 0), height: Math.abs(d.height || 0) };
  }

  private pointsBounds(pts: { x: number; y: number }[]): { x: number; y: number; width: number; height: number } {
    if (!pts.length) return { x: 0, y: 0, width: 0, height: 0 };
    let minX = pts[0].x, minY = pts[0].y, maxX = pts[0].x, maxY = pts[0].y;
    for (const p of pts) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
    return { x: minX, y: minY, width: Math.max(1, maxX - minX), height: Math.max(1, maxY - minY) };
  }

  private boundsIntersects(
    a: { x: number; y: number; width: number; height: number },
    b: { x: number; y: number; width: number; height: number }
  ): boolean {
    return a.x <= b.x + b.width && a.x + a.width >= b.x && a.y <= b.y + b.height && a.y + a.height >= b.y;
  }

  private pointInRect(
    x: number, y: number,
    rect: { x: number; y: number; width: number; height: number },
    pad = 0
  ): boolean {
    return x >= rect.x - pad && x <= rect.x + rect.width + pad
      && y >= rect.y - pad && y <= rect.y + rect.height + pad;
  }

  private hitDrawing(d: TableDrawing, x: number, y: number, pad: number): boolean {
    if (d.type === 'text') {
      const w = Math.max(40, (d.text?.length || 1) * (d.fontSize || 18) * 0.6);
      const h = (d.fontSize || 18) + 8;
      return x >= d.x - pad && x <= d.x + w + pad && y >= d.y - pad && y <= d.y + h + pad;
    }
    if (d.type === 'rect' || d.type === 'ellipse') {
      return x >= d.x - pad && x <= d.x + d.width + pad && y >= d.y - pad && y <= d.y + d.height + pad;
    }
    const pts: { x: number; y: number }[] = d.geom?.points || [];
    for (let i = 1; i < pts.length; i++) {
      if (this.distToSegment(x, y, pts[i - 1].x, pts[i - 1].y, pts[i].x, pts[i].y) <= pad) return true;
    }
    return false;
  }

  private hitWall(w: TableWall, x: number, y: number, pad: number): boolean {
    const pts = w.points || [];
    for (let i = 1; i < pts.length; i++) {
      if (this.distToSegment(x, y, pts[i - 1].x, pts[i - 1].y, pts[i].x, pts[i].y) <= pad) return true;
    }
    return false;
  }

  private distToSegment(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
    const dx = x2 - x1, dy = y2 - y1;
    const len2 = dx * dx + dy * dy;
    if (len2 <= 0) return Math.hypot(px - x1, py - y1);
    let t = ((px - x1) * dx + (py - y1) * dy) / len2;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
  }

  private clearPingHold() {
    if (this.pingHoldTimer) clearTimeout(this.pingHoldTimer);
    this.pingHoldTimer = null;
    this.pingHoldOrigin = null;
    this.pingHoldLast = null;
    this.pingHoldShift = false;
  }

  private broadcastPing(x: number, y: number, type: 'basic' | 'warning') {
    const data = {
      x, y, type,
      color: '#e11d48',
      peerId: Network.peerId,
      name: PeerCursor.myCursor?.name || ''
    };
    EventSystem.call('TABLE_PING', data);
    this.spawnPing(data);
    if (PresetSound.ping) SoundEffect.play(PresetSound.ping);
  }

  private spawnPing(data: any) {
    const rawType = data.type === 'warning' || data.type === 'drag' ? 'warning' : 'basic';
    const ping: TablePingView = {
      id: `${Date.now()}_${Math.random()}`,
      x: data.x,
      y: data.y,
      type: rawType,
      color: '#e11d48',
      expire: Date.now() + 2800,
    };
    this.pings = [...this.pings, ping];
    EventSystem.trigger('TABLE_PING_SPAWNED', { type: rawType, x: data.x, y: data.y });
    setTimeout(() => {
      this.pings = this.pings.filter(p => p.id !== ping.id);
      this.updateOffscreenArrows();
    }, 2800);
    this.updateOffscreenArrows();
  }

  private updateOffscreenArrows() {
    const root = this.rootElementRef?.nativeElement;
    if (!root) { this.offscreenArrows = []; return; }
    const rect = root.getBoundingClientRect();
    const arrows = [];
    for (const ping of this.pings) {
      // Approximate: if ping table coords far from view center, show edge arrow
      const sx = rect.left + rect.width / 2 + (ping.x - this.tablePixelWidth / 2) * 0.2 + this.viewPotisonX * 0.1;
      const sy = rect.top + rect.height / 2 + (ping.y - this.tablePixelHeight / 2) * 0.15 + this.viewPotisonY * 0.1;
      if (sx > rect.left + 20 && sx < rect.right - 20 && sy > rect.top + 20 && sy < rect.bottom - 20) continue;
      const cx = Math.min(rect.right - 24, Math.max(rect.left + 24, sx));
      const cy = Math.min(rect.bottom - 24, Math.max(rect.top + 24, sy));
      const deg = Math.atan2(sy - (rect.top + rect.height / 2), sx - (rect.left + rect.width / 2)) * 180 / Math.PI + 90;
      arrows.push({ x: cx - rect.left, y: cy - rect.top, deg, color: ping.color });
    }
    this.offscreenArrows = arrows;
  }
}
