import { ChangeDetectionStrategy, ChangeDetectorRef, Component, Input, OnChanges, OnDestroy, OnInit, SimpleChanges } from '@angular/core';

import { EventSystem, Network } from '@udonarium/core/system';
import { PresetSound, SoundEffect } from '@udonarium/sound-effect';
import { SlopeDirection, Terrain, TerrainViewState } from '@udonarium/terrain';

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

  openImage(name: 'floor' | 'wall') {
    if (!this.terrain || this.GuestMode()) return;
    const current = this.terrain.imageDataElement?.getFirstElementByName(name)?.value + '' || '';
    this.modalService.open<string>(FileSelecterComponent, {
      isAllowedEmpty: true,
      currentImageIdentifires: current && current !== 'null' ? [current] : []
    }).then(value => {
      if (!this.terrain || value == null) return;
      const el = this.terrain.imageDataElement?.getFirstElementByName(name);
      if (el) el.value = value;
      this.changeDetector.markForCheck();
    });
  }

  clone() {
    if (!this.terrain || this.GuestMode()) return;
    const cloneObject = this.terrain.clone() as Terrain;
    cloneObject.location.x += 50;
    cloneObject.location.y += 50;
    if (this.terrain.parent) this.terrain.parent.appendChild(cloneObject);
    cloneObject.isLocked = false;
    cloneObject.update();
    SoundEffect.play(PresetSound.blockPut);
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

  setMode(value: number) {
    if (!this.terrain || this.GuestMode()) return;
    this.terrain.mode = value;
    this.changeDetector.markForCheck();
  }

  setSlopeDirection(value: number) {
    if (!this.terrain || this.GuestMode()) return;
    this.terrain.slopeDirection = value;
    this.changeDetector.markForCheck();
  }

  private refreshTitle() {
    if (!this.terrain) return;
    let title = this.i18n.t('terrain.panelTitle');
    if (this.terrain.name?.length) title += ' - ' + this.terrain.name;
    this.panelService.title = title;
  }
}
