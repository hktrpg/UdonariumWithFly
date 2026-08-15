import { ChangeDetectionStrategy, ChangeDetectorRef, Component, Input, OnChanges, OnDestroy, OnInit, SimpleChanges } from '@angular/core';

import { EventSystem, Network } from '@udonarium/core/system';
import { SlopeDirection, Terrain, TerrainViewState } from '@udonarium/terrain';
import {
  SLOPE_DEG_MAX,
  SLOPE_DEG_MIN,
  TERRAIN_SIZE_MIN,
  TerrainFaceName,
  setSlopeDegrees,
  slopeDegrees,
} from '@udonarium/terrain-surface';

import { FileSelecterComponent } from 'component/file-selecter/file-selecter.component';
import { I18nService } from 'service/i18n.service';
import { ModalService } from 'service/modal.service';
import { PanelService } from 'service/panel.service';
import { SaveDataService } from 'service/save-data.service';

@Component({
  selector: 'terrain-settings',
  templateUrl: './terrain-settings.component.html',
  styleUrls: ['../shared/settings-ui.css', '../shared/object-settings.css', './terrain-settings.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: false
})
export class TerrainSettingsComponent implements OnInit, OnChanges, OnDestroy {
  @Input() terrain: Terrain = null;

  isSaveing = false;
  progresPercent = 0;
  showFaceImages = false;
  /** When resizing run length, keep incline degrees and rewrite height. */
  lockSlopeDegrees = true;

  readonly sizeMin = TERRAIN_SIZE_MIN;
  readonly slopeDegMin = SLOPE_DEG_MIN;
  readonly slopeDegMax = SLOPE_DEG_MAX;

  readonly modeOptions = [
    { value: TerrainViewState.ALL, labelKey: 'terrain.settings.modeAll' },
    { value: TerrainViewState.FLOOR, labelKey: 'terrain.settings.modeFloor' },
    { value: TerrainViewState.WALL, labelKey: 'terrain.settings.modeWall' },
  ];

  readonly slopeOptions = [
    { value: SlopeDirection.NONE, labelKey: 'terrain.settings.slopeNone' },
    { value: SlopeDirection.TOP, labelKey: 'terrain.settings.slopeTop' },
    { value: SlopeDirection.BOTTOM, labelKey: 'terrain.settings.slopeBottom' },
    { value: SlopeDirection.LEFT, labelKey: 'terrain.settings.slopeLeft' },
    { value: SlopeDirection.RIGHT, labelKey: 'terrain.settings.slopeRight' },
  ];

  readonly faceSlots: { face: TerrainFaceName; labelKey: string }[] = [
    { face: 'underside', labelKey: 'terrain.settings.faceUnderside' },
    { face: 'wallTop', labelKey: 'terrain.settings.faceWallTop' },
    { face: 'wallBottom', labelKey: 'terrain.settings.faceWallBottom' },
    { face: 'wallLeft', labelKey: 'terrain.settings.faceWallLeft' },
    { face: 'wallRight', labelKey: 'terrain.settings.faceWallRight' },
  ];

  constructor(
    private changeDetector: ChangeDetectorRef,
    private modalService: ModalService,
    private panelService: PanelService,
    private saveDataService: SaveDataService,
    private i18n: I18nService
  ) { }

  GuestMode() { return Network.GuestMode(); }

  ngOnInit() {
    EventSystem.register(this)
      .on('DELETE_GAME_OBJECT', event => {
        if (this.terrain && event.data?.identifier === this.terrain.identifier) this.panelService.close();
      })
      .on('UPDATE_GAME_OBJECT', event => {
        if (this.terrain && event.data?.identifier === this.terrain.identifier) {
          this.refreshTitle();
          this.changeDetector.markForCheck();
        }
      })
      .on('UPDATE_FILE_RESOURE', () => this.changeDetector.markForCheck())
      .on('LOCALE_CHANGED', () => this.refreshTitle());
    this.terrain?.complement();
    this.refreshTitle();
  }

  ngOnChanges(changes: SimpleChanges) {
    if (changes['terrain'] && this.terrain) {
      this.terrain.complement();
      this.refreshTitle();
    }
  }

  ngOnDestroy() {
    EventSystem.unregister(this);
  }

  get slopeDeg(): number {
    if (!this.terrain?.isSlope) return 0;
    return Math.round(slopeDegrees(this.terrain) * 10) / 10;
  }

  setSlopeDeg(value: number) {
    if (!this.terrain || this.GuestMode()) return;
    setSlopeDegrees(this.terrain, +value);
    this.changeDetector.markForCheck();
  }

  onWidthChange(value: number) {
    if (!this.terrain || this.GuestMode()) return;
    const prevDeg = this.terrain.isSlope ? slopeDegrees(this.terrain) : 0;
    this.terrain.width = Math.max(TERRAIN_SIZE_MIN, +value || TERRAIN_SIZE_MIN);
    if (this.lockSlopeDegrees && this.terrain.isSlope && prevDeg >= SLOPE_DEG_MIN) {
      setSlopeDegrees(this.terrain, prevDeg);
    }
    this.changeDetector.markForCheck();
  }

  onDepthChange(value: number) {
    if (!this.terrain || this.GuestMode()) return;
    const prevDeg = this.terrain.isSlope ? slopeDegrees(this.terrain) : 0;
    this.terrain.depth = Math.max(TERRAIN_SIZE_MIN, +value || TERRAIN_SIZE_MIN);
    if (this.lockSlopeDegrees && this.terrain.isSlope && prevDeg >= SLOPE_DEG_MIN) {
      setSlopeDegrees(this.terrain, prevDeg);
    }
    this.changeDetector.markForCheck();
  }

  onHeightChange(value: number) {
    if (!this.terrain || this.GuestMode()) return;
    this.terrain.height = Math.max(0, +value || 0);
    this.changeDetector.markForCheck();
  }

  facePreviewUrl(face: TerrainFaceName): string {
    if (!this.terrain) return '';
    // Own override if set, else fallback face (wall/floor) via Terrain.faceImage.
    return this.terrain.faceImage(face)?.url || '';
  }

  faceIsOverride(face: TerrainFaceName): boolean {
    return !!this.terrain?.hasOwnFaceImage(face);
  }

  openImage(name: TerrainFaceName) {
    if (!this.terrain || this.GuestMode()) return;
    this.terrain.ensureFaceImageElements();
    const current = this.terrain.imageDataElement?.getFirstElementByName(name)?.value + '' || '';
    this.modalService.open<string>(FileSelecterComponent, {
      isAllowedEmpty: true,
      currentImageIdentifires: current && current !== 'null' ? [current] : []
    }).then(value => {
      if (!this.terrain || value == null) return;
      this.terrain.setFaceImage(name, value);
      this.changeDetector.markForCheck();
    });
  }

  async saveToXML() {
    if (!this.terrain || this.isSaveing) return;
    this.isSaveing = true;
    this.progresPercent = 0;
    await this.saveDataService.saveGameObjectAsync(this.terrain, 'fly_xml_' + (this.terrain.name || 'terrain'), percent => {
      this.progresPercent = percent;
      this.changeDetector.markForCheck();
    });
    setTimeout(() => {
      this.isSaveing = false;
      this.progresPercent = 0;
      this.changeDetector.markForCheck();
    }, 500);
  }

  importXml() {
    if (this.GuestMode()) return;
    this.saveDataService.pickAndLoadXmlOrZip();
  }

  setMode(value: number) {
    if (!this.terrain || this.GuestMode()) return;
    this.terrain.mutateAppearance(() => { this.terrain.mode = value; });
    this.changeDetector.markForCheck();
  }

  setSlopeDirection(value: number) {
    if (!this.terrain || this.GuestMode()) return;
    const prevDeg = this.terrain.isSlope ? slopeDegrees(this.terrain) : 0;
    this.terrain.mutateAppearance(() => {
      this.terrain.slopeDirection = value;
      this.terrain.isSlope = value !== SlopeDirection.NONE;
    });
    if (value !== SlopeDirection.NONE && this.lockSlopeDegrees && prevDeg >= SLOPE_DEG_MIN) {
      setSlopeDegrees(this.terrain, prevDeg);
    }
    this.changeDetector.markForCheck();
  }

  setAppearanceFlag(key:
    'isSlope' | 'isSurfaceShading' | 'isDropShadow' | 'isInteract' |
    'affectsLight' | 'isLocked' | 'isAltitudeIndicate' | 'mirrorWallTop' | 'mirrorWallLeft', value: boolean) {
    if (!this.terrain || this.GuestMode()) return;
    this.terrain.mutateAppearance(() => {
      (this.terrain as any)[key] = value;
      if (key === 'isSlope' && !value) this.terrain.slopeDirection = SlopeDirection.NONE;
    });
    this.changeDetector.markForCheck();
  }

  private refreshTitle() {
    if (!this.terrain) return;
    let title = this.i18n.t('terrain.panelTitle');
    if (this.terrain.name?.length) title += ' - ' + this.terrain.name;
    this.panelService.title = title;
  }
}
