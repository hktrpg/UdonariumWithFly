import {
  AfterViewInit,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  ElementRef,
  HostListener,
  Input,
  NgZone,
  OnChanges,
  OnDestroy
} from '@angular/core';
import { ImageFile, ImageState } from '@udonarium/core/file-storage/image-file';
import { EventSystem, Network } from '@udonarium/core/system';
import { StringUtil } from '@udonarium/core/system/util/string-util';
import { MathUtil } from '@udonarium/core/system/util/math-util';
import { PresetSound, SoundEffect } from '@udonarium/sound-effect';
import { SlopeDirection, Terrain, TerrainViewState } from '@udonarium/terrain';
import { TableSelecter } from '@udonarium/table-selecter';
import { TerrainSettingsComponent } from 'component/terrain-settings/terrain-settings.component';
import { OpenUrlComponent } from 'component/open-url/open-url.component';
import { InputHandler } from 'directive/input-handler';
import { MovableOption } from 'directive/movable.directive';
import { RotableOption } from 'directive/rotable.directive';
import { ModalService } from 'service/modal.service';
import { ContextMenuAction, ContextMenuSeparator, ContextMenuService, contextMenuToggleCheck } from 'service/context-menu.service';
import { I18nService } from 'service/i18n.service';
import { CoordinateService } from 'service/coordinate.service';
import { ImageService } from 'service/image.service';
import { PanelOption, PanelService } from 'service/panel.service';
import { PointerDeviceService } from 'service/pointer-device.service';
import { TabletopActionService } from 'service/tabletop-action.service';
import { SelectionState, TabletopSelectionService } from 'service/tabletop-selection.service';

@Component({
    selector: 'terrain',
    templateUrl: './terrain.component.html',
    styleUrls: ['./terrain.component.css'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    standalone: false
})
export class TerrainComponent implements OnChanges, OnDestroy, AfterViewInit {
  @Input() terrain: Terrain = null;
  @Input() is3D: boolean = false;

  get name(): string { return this.terrain.name; }
  get mode(): TerrainViewState { return this.terrain.mode; }
  set mode(mode: TerrainViewState) { this.terrain.mutateAppearance(() => { this.terrain.mode = mode; }); }

  get isLocked(): boolean { return this.terrain.isLocked; }
  set isLocked(isLocked: boolean) { this.terrain.mutateAppearance(() => { this.terrain.isLocked = isLocked; }); }
  get hasWall(): boolean { return this.terrain.hasWall; }
  get hasFloor(): boolean { return this.terrain.hasFloor; }

  get wallImage(): ImageFile { return this.imageService.getSkeletonOr(this.terrain.wallImage); }
  get floorImage(): ImageFile { return this.imageService.getSkeletonOr(this.terrain.floorImage); }

  get height(): number { return MathUtil.clampMin(this.terrain.height); }
  get width(): number { return MathUtil.clampMin(this.terrain.width); }
  get depth(): number { return MathUtil.clampMin(this.terrain.depth); }
  get altitude(): number { return this.terrain.altitude; }
  set altitude(altitude: number) { this.terrain.altitude = altitude; }

  get is2DMode(): boolean { return !!TableSelecter.instance?.viewTable?.is2DMode; }

  get isDropShadow(): boolean { return this.terrain.isDropShadow; }
  set isDropShadow(isDropShadow: boolean) {
    this.terrain.mutateAppearance(() => { this.terrain.isDropShadow = isDropShadow; });
  }
  get isSurfaceShading(): boolean { return this.terrain.isSurfaceShading; }
  set isSurfaceShading(isSurfaceShading: boolean) {
    this.terrain.mutateAppearance(() => { this.terrain.isSurfaceShading = isSurfaceShading; });
  }

  get isInteract(): boolean { return this.terrain.isInteract; }
  set isInteract(isInteract: boolean) {
    this.terrain.mutateAppearance(() => { this.terrain.isInteract = isInteract; });
  }

  get isSlope(): boolean { return this.terrain.isSlope; }
  set isSlope(isSlope: boolean) {
    this.terrain.mutateAppearance(() => {
      this.terrain.isSlope = isSlope;
      if (!isSlope) this.terrain.slopeDirection = SlopeDirection.NONE;
    });
  }

  get slopeDirection(): number {
    if (!this.terrain.isSlope) return SlopeDirection.NONE;
    if (this.terrain.isSlope && this.terrain.slopeDirection === SlopeDirection.NONE) return SlopeDirection.BOTTOM;
    return this.terrain.slopeDirection;
  }
  set slopeDirection(slopeDirection: number) {
    this.terrain.mutateAppearance(() => {
      this.terrain.isSlope = (slopeDirection != SlopeDirection.NONE);
      this.terrain.slopeDirection = slopeDirection;
    });
  }
  
  get isAltitudeIndicate(): boolean { return this.terrain.isAltitudeIndicate; }
  set isAltitudeIndicate(isAltitudeIndicate: boolean) {
    this.terrain.mutateAppearance(() => { this.terrain.isAltitudeIndicate = isAltitudeIndicate; });
  }


  get isVisibleFloor(): boolean { return 0 < this.width * this.depth; }
  get isVisibleWallTopBottom(): boolean { return 0 < this.width * this.height; }
  get isVisibleWallLeftRight(): boolean { return 0 < this.depth * this.height; }

  get selectionState(): SelectionState { return this.selectionService.state(this.terrain); }
  get isSelected(): boolean { return this.selectionState !== SelectionState.NONE; }
  get isMagnetic(): boolean { return this.selectionState === SelectionState.MAGNETIC; }

  gridSize: number = 50;

  get isWallExist(): boolean {
    return this.hasWall && this.wallImage && this.wallImage.url && this.wallImage.url.length > 0;
  }

  get terreinAltitude(): number {
    let ret = this.altitude;
    if (this.altitude < 0 || (!this.isSlope && !this.isWallExist)) ret += this.height;
    return ret;
  }

  private _tmpImages: ImageFile[] = [];
  private _tmpImageUrls: string[] = ['', ''];
  private _tmpImageState: number[] = [0, 0];
  private _tmpUrl(pos: number) {
    const imageFiles = [this.floorImage, this.wallImage];
    let revokeUrl = '';
    if (this._tmpImages[pos]?.identifier != imageFiles[pos].identifier || this._tmpImageState[pos] != imageFiles[pos].state) {
      this._tmpImages[pos] = imageFiles[pos];
      if (this._tmpImages[pos].state === ImageState.THUMBNAIL || this._tmpImages[pos].state === ImageState.COMPLETE) {
        this._tmpImageState[pos] = this._tmpImages[pos].state;
        if (this._tmpImageUrls[pos]) revokeUrl = this._tmpImageUrls[pos];
        this._tmpImageUrls[pos] = URL.createObjectURL(this._tmpImages[pos].blob);
      } else {
        this._tmpImageUrls[pos] = this._tmpImages[pos].url;
      }
    }
    if (revokeUrl) queueMicrotask(() => URL.revokeObjectURL(revokeUrl));
    return this._tmpImageUrls[pos];
  }

  get wallImageUrl(): string { return this._tmpUrl(1); }
  get floorImageUrl(): string { return this._tmpUrl(0); }

  movableOption: MovableOption = {};
  rotableOption: RotableOption = {};

  math = Math;
  slopeDirectionState = SlopeDirection;

  private input: InputHandler = null;

  constructor(
    private ngZone: NgZone,
    private imageService: ImageService,
    private tabletopActionService: TabletopActionService,
    private contextMenuService: ContextMenuService,
    private elementRef: ElementRef<HTMLElement>,
    private panelService: PanelService,
    private changeDetector: ChangeDetectorRef,
    private selectionService: TabletopSelectionService,
    private pointerDeviceService: PointerDeviceService,
    private modalService: ModalService,
    private coordinateService: CoordinateService,
    private i18n: I18nService
  ) { }

  GuestMode() {
    return Network.GuestMode();
  }


  viewRotateZ = 10;

  ngOnChanges(): void {
    EventSystem.unregister(this);
    EventSystem.register(this)
      .on(`UPDATE_GAME_OBJECT/identifier/${this.terrain?.identifier}`, event => {
        this.changeDetector.markForCheck();
      })
      .on(`UPDATE_OBJECT_CHILDREN/identifier/${this.terrain?.identifier}`, event => {
        this.changeDetector.markForCheck();
      })
      .on('SYNCHRONIZE_FILE_LIST', event => {
        this.changeDetector.markForCheck();
      })
      .on('UPDATE_FILE_RESOURE', event => {
        this.changeDetector.markForCheck();
      })
      .on<object>('TABLE_VIEW_ROTATE', -1000, event => {
        this.ngZone.run(() => {
          this.viewRotateZ = event.data['z'];
          this.changeDetector.markForCheck();
        });
      })
      .on(`UPDATE_SELECTION/identifier/${this.terrain?.identifier}`, event => {
        this.changeDetector.markForCheck();
      });
    this.movableOption = {
      tabletopObject: this.terrain,
      colideLayers: ['terrain']
    };
    this.rotableOption = {
      tabletopObject: this.terrain
    };
  }

  ngAfterViewInit() {
    this.ngZone.runOutsideAngular(() => {
      this.input = new InputHandler(this.elementRef.nativeElement);
    });
    this.input.onStart = this.onInputStart.bind(this);
  }

  ngOnDestroy() {
    this.input.destroy();
    EventSystem.unregister(this);
    for (const url of this._tmpImageUrls) {
      if (url) URL.revokeObjectURL(url);
    }
  }

  @HostListener('dragstart', ['$event'])
  onDragstart(e) {
    e.stopPropagation();
    e.preventDefault();
  }

  onInputStart(e: any) {
    this.input.cancel();

    // TODO: 想更好的做法
    if (this.isLocked) {
      EventSystem.trigger('DRAG_LOCKED_OBJECT', { srcEvent: e });
    }
  }

  @HostListener('contextmenu', ['$event'])
  onContextMenu(e: Event) {
    e.stopPropagation();
    e.preventDefault();


    if (this.GuestMode()) return;
    if (!this.pointerDeviceService.isAllowedToOpenContextMenu) return;

    this.tabletopActionService.ensureObjectSelected(this.terrain);
    let menuPosition = this.pointerDeviceService.pointers[0];
    let menuActions: ContextMenuAction[] = [];
    let title = this.name;

    if (this.isMultiSelectedTerrains()) {
      menuActions = this.makeSelectionContextMenu();
      title = this.i18n.t('terrain.selectedCount', { count: this.selectedTerrains().length });
    } else {
      menuActions = menuActions.concat(this.makeSelectionContextMenu());
      menuActions = menuActions.concat(this.makeContextMenu());
    }
    menuActions = this.tabletopActionService.withClipboardMenuPrefix(menuActions);

    this.contextMenuService.open(menuPosition, menuActions, title);
  }

  onMove() {
    this.contextMenuService.close();
    SoundEffect.play(PresetSound.blockPick);
  }

  onMoved() {
    SoundEffect.play(PresetSound.blockPut);
  }

  get floorModCss() {
    let ret = '';
    let tmp = 0;
    switch (this.slopeDirection) {
      case SlopeDirection.TOP:
        tmp = Math.atan(this.height / this.depth);
        ret = ' rotateX(' + tmp + 'rad) scaleY(' + (1 / Math.cos(tmp)) + ')';
        break;
      case SlopeDirection.BOTTOM:
        tmp = Math.atan(this.height / this.depth);
        ret = ' rotateX(' + -tmp + 'rad) scaleY(' + (1 / Math.cos(tmp)) + ')';
        break;
      case SlopeDirection.LEFT:
        tmp = Math.atan(this.height / this.width);
        ret = ' rotateY(' + -tmp + 'rad) scaleX(' + (1 / Math.cos(tmp)) + ')';
        break;
      case SlopeDirection.RIGHT:
        tmp = Math.atan(this.height / this.width);
        ret = ' rotateY(' + tmp + 'rad) scaleX(' + (1 / Math.cos(tmp)) + ')';
        break;
    }
    return ret;
  }

  get floorBrightness() {
    let ret = 1.0;
    if (!this.isSurfaceShading) return ret;
    switch (this.slopeDirection) {
      case SlopeDirection.TOP:
        ret = 0.4;
        break;
      case SlopeDirection.BOTTOM:
        ret = 1.0;
        break;
      case SlopeDirection.LEFT:
        ret = 0.6;
        break;
      case SlopeDirection.RIGHT:
        ret = 0.9;
        break;
    }
    return ret;
  }

  private selectedTerrains(): Terrain[] {
    return this.selectionService.objects.filter(
      object => object.aliasName === this.terrain.aliasName
    ) as Terrain[];
  }

  private isMultiSelectedTerrains(): boolean {
    return this.isSelected && this.selectedTerrains().length > 1;
  }

  private makeSelectionContextMenu(): ContextMenuAction[] {
    if (this.selectionService.size <= 1) return [];

    let actions: ContextMenuAction[] = [];

    let objectPosition = this.coordinateService.calcTabletopLocalCoordinate();
    actions.push({ name: this.i18n.t('terrain.menu.1'), hotkey: 'T', action: () => this.selectionService.congregate(objectPosition) });

    if (this.isMultiSelectedTerrains()) {
      let selectedGameTableMasks = () => this.selectedTerrains();
      actions.push(
        {
          name: this.i18n.t('terrain.menu.2'), action: null, subActions: [
            {
              name: this.i18n.t('terrain.menu.3'), action: () => {
                selectedGameTableMasks().forEach(terrain => {
                  terrain.mutateAppearance(() => { terrain.isLocked = true; });
                });
                SoundEffect.play(PresetSound.lock);
              }
            },
            {
              name: this.i18n.t('terrain.menu.4'), action: () => {
                selectedGameTableMasks().forEach(terrain => {
                  let cloneObject = terrain.clone();
                  cloneObject.location.x += this.gridSize;
                  cloneObject.location.y += this.gridSize;
                  cloneObject.isLocked = false;
                  if (terrain.parent) terrain.parent.appendChild(cloneObject);
                });
                SoundEffect.play(PresetSound.blockPut);
              }
            }
          ]
        },
        ContextMenuSeparator,
        {
          name: this.i18n.t('char.clearSelection'),
          action: () => this.selectionService.clear()
        },
      );
    }
    actions.push(ContextMenuSeparator);
    return actions;
  }

  private makeContextMenu(): ContextMenuAction[] {
    let objectPosition = this.coordinateService.calcTabletopLocalCoordinate();
    let actions: ContextMenuAction[] = [
      contextMenuToggleCheck({
        get: () => this.isLocked,
        set: (v) => {
          this.isLocked = v;
          SoundEffect.play(v ? PresetSound.lock : PresetSound.unlock);
        },
        on: this.i18n.t('terrain.menu.5'),
        off: this.i18n.t('terrain.menu.6'),
        hotkey: 'L',
      }),
      (this.isLocked ? null : { name: this.i18n.t('terrain.overlapOrder', { flatOnly: this.height === 0 ? '' : this.i18n.t('terrain.dynamic.1') }), action: null, subActions: [
        {
          name: this.i18n.t('terrain.menu.7'), action: () => {
            if (!this.isLocked) {
              const parent = this.terrain.parent;
              if (parent) parent.appendChild(this.terrain);
            }
          },
          disabled: this.isLocked
        },
        {
          name: this.i18n.t('terrain.menu.8'), action: () => {
            if (!this.isLocked) {
              const parent = this.terrain.parent;
              if (parent) parent.prependChild(this.terrain);
            }
          },
          disabled: this.isLocked
        }],
        disabled: this.isLocked || this.height != 0
      }),
      ContextMenuSeparator,
      { name: this.i18n.t('terrain.menu.9'), action: null, subActions: [
        {
          name: `${ this.slopeDirection == SlopeDirection.NONE ? '◉' : '○' } ${this.i18n.t('terrain.slope.none')}`, action: () => {
            this.slopeDirection = SlopeDirection.NONE;
          },
          checkBox: 'radio'
        },
        ContextMenuSeparator,
        {
          name: `${ this.slopeDirection == SlopeDirection.TOP ? '◉' : '○' } ${this.i18n.t('terrain.slope.top')}`, action: () => {
            this.slopeDirection = SlopeDirection.TOP;
          },
          checkBox: 'radio'
        },
        {
          name: `${ this.slopeDirection == SlopeDirection.BOTTOM ? '◉' : '○' } ${this.i18n.t('terrain.slope.bottom')}`, action: () => {
            this.slopeDirection = SlopeDirection.BOTTOM;
          },
          checkBox: 'radio'
        },
        {
          name: `${ this.slopeDirection == SlopeDirection.LEFT ? '◉' : '○' } ${this.i18n.t('terrain.slope.left')}`, action: () => {
            this.slopeDirection = SlopeDirection.LEFT;
          },
          checkBox: 'radio'
        },
        {
          name: `${ this.slopeDirection == SlopeDirection.RIGHT ? '◉' : '○' } ${this.i18n.t('terrain.slope.right')}`, action: () => {
            this.slopeDirection = SlopeDirection.RIGHT;
          },
          checkBox: 'radio'
        }
      ]},
      { name: this.i18n.t('terrain.menu.10'), action: null, subActions: [
        {
          name: `${ this.hasWall && this.isSurfaceShading ? '◉' : '○' } ${this.i18n.t('terrain.wall.normal')}`, action: () => {
            this.mode = TerrainViewState.ALL;
            this.isSurfaceShading = true;
          },
          checkBox: 'radio'
        },
        {
          name: `${ this.hasWall && !this.isSurfaceShading ? '◉' : '○' } ${this.i18n.t('terrain.wall.noShade')}`, action: () => {
            this.mode = TerrainViewState.ALL;
            this.isSurfaceShading = false;
          },
          checkBox: 'radio'
        },
        {
          name: `${ !this.hasWall ? '◉' : '○' } ${this.i18n.t('terrain.wall.hidden')}`, action: () => {
            this.mode = TerrainViewState.FLOOR;
            if (this.depth * this.width === 0) {
              this.terrain.width = this.width <= 0 ? 1 : this.width;
              this.terrain.depth = this.depth <= 0 ? 1 : this.depth;
            }
          },
          checkBox: 'radio'
        },
      ]},
      ContextMenuSeparator,
      /*
      (this.isInteract
        ? {
          name: this.i18n.t('terrain.menu.11'), action: () => {
            this.isInteract = false;
            SoundEffect.play(PresetSound.unlock);
          },
                checkBox: 'check'
        } : {
          name: this.i18n.t('terrain.menu.12'), action: () => {
            this.isInteract = true;
            SoundEffect.play(PresetSound.lock);
          },
                checkBox: 'check'
        }),
      ContextMenuSeparator,
      */
      contextMenuToggleCheck({
        get: () => !!this.terrain.affectsLight,
        set: (v) => {
          this.terrain.mutateAppearance(() => { this.terrain.affectsLight = v; });
        },
        on: this.i18n.t('terrain.menu.13'),
        off: this.i18n.t('terrain.menu.14'),
      }),
      contextMenuToggleCheck({
        get: () => this.isDropShadow,
        set: (v) => { this.isDropShadow = v; },
        on: this.i18n.t('terrain.menu.15'),
        off: this.i18n.t('terrain.menu.16'),
      }),
      ...(this.is2DMode ? [] : [
        contextMenuToggleCheck({
          get: () => this.isAltitudeIndicate,
          set: (v) => { this.isAltitudeIndicate = v; },
          on: this.i18n.t('terrain.menu.17'),
          off: this.i18n.t('terrain.menu.18'),
        }),
        {
          name: this.i18n.t('terrain.menu.19'), action: () => {
            if (this.altitude != 0) {
              this.altitude = 0;
              SoundEffect.play(PresetSound.sweep);
            }
          },
          altitudeHande: this.terrain
        },
      ]),
      ContextMenuSeparator,
      { name: this.i18n.t('terrain.menu.20'), action: () => { this.showDetail(this.terrain); } },
      (this.terrain.getUrls().length <= 0 ? null : {
        name: this.i18n.t('terrain.menu.21'), action: null,
        subActions: this.terrain.getUrls().map((urlElement) => {
          const url = urlElement.value.toString();
          return {
            name: urlElement.name ? urlElement.name : url,
            action: () => {
              if (StringUtil.sameOrigin(url)) {
                window.open(url.trim(), '_blank', 'noopener');
              } else {
                this.modalService.open(OpenUrlComponent, { url: url, title: this.terrain.name, subTitle: urlElement.name });
              } 
            },
            disabled: !StringUtil.validUrl(url),
            error: !StringUtil.validUrl(url) ? this.i18n.t('common.invalidUrl') : null,
            isOuterLink: StringUtil.validUrl(url) && !StringUtil.sameOrigin(url)
          };
        })
      }),
      (this.terrain.getUrls().length <= 0 ? null : ContextMenuSeparator),
      {
        name: this.i18n.t('terrain.menu.22'), action: () => {
          let cloneObject = this.terrain.clone();
          cloneObject.location.x += this.gridSize;
          cloneObject.location.y += this.gridSize;
          cloneObject.isLocked = false;
          if (this.terrain.parent) this.terrain.parent.appendChild(cloneObject);
          SoundEffect.play(PresetSound.blockPut);
        }
      },
      {
        name: this.i18n.t('terrain.menu.23'), action: () => {
          this.terrain.destroy();
          SoundEffect.play(PresetSound.sweep);
        },
        hotkey: 'Del',
      },
      ContextMenuSeparator,
      { name: this.i18n.t('terrain.menu.24'), action: null, subActions: this.tabletopActionService.makeDefaultContextMenuActions(objectPosition) }
    ];

    return actions;
  }

  onDoubleClick(e: Event) {
    e.stopPropagation();
    this.showDetail(this.terrain);
  }

  private showDetail(gameObject: Terrain) {
    if (this.GuestMode()) return;
    EventSystem.trigger('SELECT_TABLETOP_OBJECT', { identifier: gameObject.identifier, className: gameObject.aliasName });
    let title = this.i18n.t('terrain.panelTitle');
    if (gameObject.name.length) title += ' - ' + gameObject.name;
    const tourId = PanelService.tourIdObjectDetail(gameObject.identifier);
    if (PanelService.bringTourPanelToFront(tourId, { title })) return;
    let coordinate = this.pointerDeviceService.pointers[0];
    let option: PanelOption = {
      title: title, left: coordinate.x - 210, top: coordinate.y - 180, width: 420, height: 400,
      tourPanelId: tourId,
      geometryKey: PanelService.sheetGeometryKey(gameObject.aliasName),
    };
    let component = this.panelService.open<TerrainSettingsComponent>(TerrainSettingsComponent, option);
    component.terrain = gameObject;
  }
}
