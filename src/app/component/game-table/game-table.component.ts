import { AfterViewInit, Component, ElementRef, HostListener, NgZone, OnDestroy, OnInit, ViewChild } from '@angular/core';

import { Card } from '@udonarium/card';
import { CardStack } from '@udonarium/card-stack';
import { ImageFile, ImageState } from '@udonarium/core/file-storage/image-file';
import { GameObject } from '@udonarium/core/synchronize-object/game-object';
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
import { TableWall } from '@udonarium/table-fx/table-wall';
import { TableSelecter } from '@udonarium/table-selecter';
import { Terrain } from '@udonarium/terrain';
import { TextNote } from '@udonarium/text-note';

import { GameTableSettingComponent } from 'component/game-table-setting/game-table-setting.component';
import { ContextMenuAction, ContextMenuSeparator, ContextMenuService } from 'service/context-menu.service';
import { CoordinateService } from 'service/coordinate.service';
import { ImageService } from 'service/image.service';
import { ModalService } from 'service/modal.service';
import { PointerDeviceService } from 'service/pointer-device.service';
import { SceneToolService } from 'service/scene-tool.service';
import { TabletopActionService } from 'service/tabletop-action.service';
import { TabletopKeyboardService } from 'service/tabletop-keyboard.service';
import { TabletopSelectionService } from 'service/tabletop-selection.service';
import { TabletopService } from 'service/tabletop.service';

import { GridLineRender } from './grid-line-render';
import { LightingRender } from './lighting-render';
import { TableMouseGesture } from './table-mouse-gesture';
import { TablePickGesture } from './table-pick-gesture';
import { TableTouchGesture } from './table-touch-gesture';
import { WeatherRender } from './weather-render';

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
  @ViewChild('weatherCanvas', { static: true }) weatherCanvas: ElementRef<HTMLCanvasElement>;
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
  private static readonly PING_MOVE_THRESHOLD_SQ = 8 * 8;
  private drawDragStart: { x: number; y: number } = null;
  private freehandPoints: { x: number; y: number }[] = [];

  get tableSelecter(): TableSelecter { return this.tabletopService.tableSelecter; }
  get currentTable(): GameTable { return this.tabletopService.currentTable; }
  get gridHeight(): number { return this.tabletopService.currentTable.gridHeight; }
  get tablePixelWidth(): number { return this.currentTable.width * this.currentTable.gridSize; }
  get tablePixelHeight(): number { return this.currentTable.height * this.currentTable.gridSize; }
  get drawings(): TableDrawing[] { return this.currentTable?.drawings || []; }
  get lights(): TableLight[] { return this.currentTable?.lights || []; }

  get tableImage(): ImageFile { return this.imageService.getSkeletonOr(this.currentTable.imageIdentifier); }
  get backgroundImage(): ImageFile { return this.imageService.getEmptyOr(this.currentTable.backgroundImageIdentifier); }
  get backgroundImage2(): ImageFile { return this.imageService.getEmptyOr(this.currentTable.backgroundImageIdentifier2); }
  get backgroundFilterType(): FilterType { return this.currentTable.backgroundFilterType; }

  private isTableTransformMode: boolean = false;
  private isTableTransformed: boolean = false;

  get isPointerDragging(): boolean { return this.pointerDeviceService.isDragging; }

  private viewPotisonX: number = 100;
  private viewPotisonY: number = 0;
  private viewPotisonZ: number = 0;

  private viewRotateX: number = 50;
  private viewRotateY: number = 0;
  private viewRotateZ: number = 10;

  private mouseGesture: TableMouseGesture = null;
  private touchGesture: TableTouchGesture = null;
  private pickGesture: TablePickGesture = null;

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
    private contextMenuService: ContextMenuService,
    private pointerDeviceService: PointerDeviceService,
    private coordinateService: CoordinateService,
    private imageService: ImageService,
    private tabletopService: TabletopService,
    private tabletopActionService: TabletopActionService,
    private selectionService: TabletopSelectionService,
    private tabletopKeyboardService: TabletopKeyboardService,
    private modalService: ModalService,
    private sceneTools: SceneToolService,
  ) { }

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
            this.setTransform(100, 0, 0, 50, 0, 10, true);
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

  ngAfterViewInit() {
    this.ngZone.runOutsideAngular(() => {
      this.initializeTableTouchGesture();
      this.initializeTableMouseGesture();
      this.initializeTablePickGesture();
      this.tabletopKeyboardService.initialize();
    });
    this.cancelInput();

    this.setGameTableGrid(this.currentTable.width, this.currentTable.height, this.currentTable.gridSize, this.currentTable.gridType, this.currentTable.gridColor);
    this.setTransform(0, 0, 0, 0, 0, 0);
    this.coordinateService.tabletopOriginElement = this.gameObjects.nativeElement;
    this.lightingRender = new LightingRender(this.fxCanvas.nativeElement);
    this.weatherRender = new WeatherRender(this.weatherCanvas.nativeElement);
    this.refreshFx();
    this.fxTimer = setInterval(() => this.refreshFx(), 200);
  }

  ngOnDestroy() {
    EventSystem.unregister(this);
    this.mouseGesture.destroy();
    this.touchGesture.destroy();
    this.pickGesture.destroy();
    this.tabletopKeyboardService.destroy();
    if (this.fxTimer) clearInterval(this.fxTimer);
    if (this.weatherRender) this.weatherRender.destroy();
    this.clearPingHold();
    if (this._currentTableImageUrl) URL.revokeObjectURL(this._currentTableImageUrl);
    if (this._currentBackgroundImageUrl) URL.revokeObjectURL(this._currentBackgroundImageUrl);
    if (this._currentBackgroundImageUrl2) URL.revokeObjectURL(this._currentBackgroundImageUrl2);
  }

  initializeTableTouchGesture() {
    this.touchGesture = new TableTouchGesture(this.rootElementRef.nativeElement, this.ngZone);
    this.touchGesture.onstart = this.onTableTouchStart.bind(this);
    this.touchGesture.onend = this.onTableTouchEnd.bind(this);
    this.touchGesture.ongesture = this.onTableTouchGesture.bind(this);
    this.touchGesture.ontransform = this.onTableTouchTransform.bind(this);
  }

  initializeTableMouseGesture() {
    this.mouseGesture = new TableMouseGesture(this.rootElementRef.nativeElement);
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

  onTableTouchStart() {
    this.mouseGesture.cancel();
  }

  onTableTouchEnd() {
    this.cancelInput();
  }

  onTableTouchGesture() {
    this.cancelInput();
  }

  onTableTouchTransform(transformX: number, transformY: number, transformZ: number, rotateX: number, rotateY: number, rotateZ: number, event: string, srcEvent: TouchEvent | MouseEvent | PointerEvent) {
    if (!this.isTableTransformMode || document.body !== document.activeElement) return;

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
    // Shift+left = pan map (swapped with former bare-left pan).
    // Bare left on empty table = region select (handled by TablePickGesture).
    if (e.button === 0 && e.shiftKey) {
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

  onTableMouseTransform(transformX: number, transformY: number, transformZ: number, rotateX: number, rotateY: number, rotateZ: number, event: string, srcEvent: TouchEvent | MouseEvent | PointerEvent) {
    if (!this.isTableTransformMode || document.body !== document.activeElement) return;

    if (!this.pointerDeviceService.isAllowedToOpenContextMenu && this.contextMenuService.isShow) {
      this.ngZone.run(() => this.contextMenuService.close());
    }

    if (srcEvent.cancelable) srcEvent.preventDefault();

    //
    let scale = (1000 + Math.abs(this.viewPotisonZ)) / 1000;
    transformX *= scale;
    transformY *= scale;

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
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (!this.contextMenuService.isShow) this.selectionService.clear();
      });
    });
  }

  onTablePickCancelIfNeeded(): boolean {
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
    if (this.sceneTools.mode === 'wall' && this.sceneTools.wallDraftPoints.length >= 2) {
      e.preventDefault();
      if (!GuestSession.isGuest) {
        const wall = TableWall.create(this.sceneTools.wallDraftPoints.slice());
        this.currentTable.appendChild(wall);
        this.sceneTools.resetDrafts();
        this.refreshFx();
      }
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
    let menuActions: ContextMenuAction[] = [];

    if (0 < this.selectionService.size) {
      menuActions.push({
        name: '集中到這裡',
        action: () => {
          this.selectionService.congregate(objectPosition);
        },
      });
      menuActions.push(ContextMenuSeparator);
    }
    Array.prototype.push.apply(menuActions, this.tabletopActionService.makeDefaultContextMenuActions(objectPosition));
    menuActions.push(ContextMenuSeparator);
    menuActions.push({
      name: '地圖設定...', action: () => {
        this.modalService.open(GameTableSettingComponent);
      }
    });
    this.contextMenuService.open(menuPosition, menuActions, this.currentTable.name);
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

  trackByGameObject(index: number, gameObject: GameObject) {
    return gameObject.identifier;
  }

  isCursorHidIn(cursor: PeerCursor): boolean {
    if (cursor.isGMMode) return true;
    for (let character of this.characters) {
      if (character.isHideIn && character.location.name === 'table' && character.owner === cursor.userId) return true;
    }
    return false;
  }

  polylinePoints(d: TableDrawing): string {
    const pts = d.geom?.points || [];
    return pts.map((p: any) => `${p.x},${p.y}`).join(' ');
  }

  private refreshFx() {
    if (!this.lightingRender || !this.currentTable) return;
    const owned = this.characters.filter(c => c.owner === Network.peer?.userId && c.location.name === 'table');
    this.lightingRender.render(this.currentTable, owned, this.isGMMode);
    this.weatherRender?.sync(this.currentTable);
    this.updateOffscreenArrows();
  }

  @HostListener('pointerdown', ['$event'])
  onPointerDown(e: PointerEvent) {
    if (e.button !== 0) return;
    const pos = this.coordinateService.calcTabletopLocalCoordinate();
    // clearPingHold must run before setting origin (it nulls origin/timer).
    this.clearPingHold();
    this.pingHoldOrigin = { x: e.clientX, y: e.clientY };
    this.pingHoldLast = { x: e.clientX, y: e.clientY };
    this.pingHoldShift = e.shiftKey;
    this.pingHoldTimer = setTimeout(() => {
      if (!this.pingHoldOrigin || !this.pingHoldLast) return;
      const dx = this.pingHoldLast.x - this.pingHoldOrigin.x;
      const dy = this.pingHoldLast.y - this.pingHoldOrigin.y;
      if (dx * dx + dy * dy > GameTableComponent.PING_MOVE_THRESHOLD_SQ) return;
      // Token/object drag — never ping after a drag.
      if (this.pointerDeviceService.isDragging) return;
      this.broadcastPing(pos.x, pos.y, this.pingHoldShift ? 'warning' : 'basic');
      this.clearPingHold();
    }, 1000);

    if (GuestSession.isGuest) return;
    if (this.sceneTools.mode === 'light') {
      const light = TableLight.create(pos.x, pos.y, this.currentTable.gridSize * 3);
      this.currentTable.appendChild(light);
      this.sceneTools.setMode('select');
      this.refreshFx();
      return;
    }
    if (this.sceneTools.mode === 'wall') {
      this.sceneTools.wallDraftPoints.push({ x: pos.x, y: pos.y });
      if (this.sceneTools.wallDraftPoints.length >= 2 && e.detail >= 2) {
        const wall = TableWall.create(this.sceneTools.wallDraftPoints.slice());
        this.currentTable.appendChild(wall);
        this.sceneTools.resetDrafts();
        this.refreshFx();
      }
      return;
    }
    if (this.sceneTools.isDrawMode) {
      this.drawDragStart = { x: pos.x, y: pos.y };
      if (this.sceneTools.mode === 'draw-freehand') this.freehandPoints = [{ x: pos.x, y: pos.y }];
      if (this.sceneTools.mode === 'draw-polygon') {
        this.sceneTools.polygonDraftPoints.push({ x: pos.x, y: pos.y });
        if (e.detail >= 2 && this.sceneTools.polygonDraftPoints.length >= 3) {
          this.commitPolygon();
        }
      }
      if (this.sceneTools.mode === 'draw-text') {
        const text = window.prompt('文字內容', '註記');
        if (text) {
          const d = TableDrawing.create('text', Network.peer?.userId || '');
          d.x = pos.x; d.y = pos.y; d.text = text;
          d.strokeColor = this.sceneTools.drawStrokeColor;
          this.currentTable.appendChild(d);
        }
        this.sceneTools.setMode('select');
      }
    }
  }

  @HostListener('pointermove', ['$event'])
  onPointerMove(e: PointerEvent) {
    if (this.pingHoldOrigin) {
      this.pingHoldLast = { x: e.clientX, y: e.clientY };
      const dx = e.clientX - this.pingHoldOrigin.x;
      const dy = e.clientY - this.pingHoldOrigin.y;
      if (dx * dx + dy * dy > GameTableComponent.PING_MOVE_THRESHOLD_SQ) this.clearPingHold();
    }
    if (this.sceneTools.mode === 'draw-freehand' && this.drawDragStart) {
      const pos = this.coordinateService.calcTabletopLocalCoordinate();
      this.freehandPoints.push({ x: pos.x, y: pos.y });
      if (this.freehandPoints.length > 200) this.freehandPoints = this.freehandPoints.filter((_, i) => i % 2 === 0);
    }
  }

  @HostListener('pointerup', ['$event'])
  onPointerUp(e: PointerEvent) {
    this.clearPingHold();
    if (GuestSession.isGuest || !this.drawDragStart) {
      this.drawDragStart = null;
      return;
    }
    const pos = this.coordinateService.calcTabletopLocalCoordinate();
    if (this.sceneTools.mode === 'draw-rect' || this.sceneTools.mode === 'draw-ellipse') {
      const d = TableDrawing.create(this.sceneTools.mode === 'draw-rect' ? 'rect' : 'ellipse', Network.peer?.userId || '');
      d.x = Math.min(this.drawDragStart.x, pos.x);
      d.y = Math.min(this.drawDragStart.y, pos.y);
      d.width = Math.max(8, Math.abs(pos.x - this.drawDragStart.x));
      d.height = Math.max(8, Math.abs(pos.y - this.drawDragStart.y));
      d.strokeColor = this.sceneTools.drawStrokeColor;
      d.fillOpacity = this.sceneTools.drawFillOpacity;
      this.currentTable.appendChild(d);
      this.sceneTools.setMode('select');
    } else if (this.sceneTools.mode === 'draw-freehand' && this.freehandPoints.length > 1) {
      const d = TableDrawing.create('freehand', Network.peer?.userId || '');
      d.geom = { points: this.freehandPoints.slice(0, 200) };
      d.strokeColor = this.sceneTools.drawStrokeColor;
      d.fillOpacity = 0;
      this.currentTable.appendChild(d);
      this.sceneTools.setMode('select');
    }
    this.drawDragStart = null;
    this.freehandPoints = [];
  }

  private commitPolygon() {
    const d = TableDrawing.create('polygon', Network.peer?.userId || '');
    d.geom = { points: this.sceneTools.polygonDraftPoints.slice() };
    d.strokeColor = this.sceneTools.drawStrokeColor;
    d.fillOpacity = this.sceneTools.drawFillOpacity;
    this.currentTable.appendChild(d);
    this.sceneTools.resetDrafts();
    this.sceneTools.setMode('select');
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
