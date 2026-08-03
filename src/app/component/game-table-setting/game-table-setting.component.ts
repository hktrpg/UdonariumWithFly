import { ChangeDetectorRef, Component, OnDestroy, OnInit } from '@angular/core';

import { ImageFile } from '@udonarium/core/file-storage/image-file';
import { ObjectSerializer } from '@udonarium/core/synchronize-object/object-serializer';
import { ObjectStore } from '@udonarium/core/synchronize-object/object-store';
import { EventSystem, Network } from '@udonarium/core/system';
import { FilterType, GameTable, GridType, WeatherType } from '@udonarium/game-table';
import { ImageTag } from '@udonarium/image-tag';
import { TableSelecter } from '@udonarium/table-selecter';
import { ConfirmationComponent, ConfirmationType } from 'component/confirmation/confirmation.component';

import { FileSelecterComponent } from 'component/file-selecter/file-selecter.component';
import { ChatMessageService } from 'service/chat-message.service';
import { ImageService } from 'service/image.service';
import { I18nService } from 'service/i18n.service';
import { ModalService } from 'service/modal.service';
import { PanelService } from 'service/panel.service';
import { SaveDataService } from 'service/save-data.service';

@Component({
    selector: 'game-table-setting',
    templateUrl: './game-table-setting.component.html',
    styleUrls: ['./game-table-setting.component.css'],
    standalone: false
})
export class GameTableSettingComponent implements OnInit, OnDestroy {
  minSize: number = 1;
  maxSize: number = 100;

  isShowHideImages = false;

  get tableBackgroundImage(): ImageFile {
    return this.imageService.getEmptyOr(this.selectedTable ? this.selectedTable.imageIdentifier : null);
  }

  get tableDistanceviewImage(): ImageFile {
    return this.imageService.getEmptyOr(this.selectedTable ? this.selectedTable.backgroundImageIdentifier : null);
  }
  get tableDistanceviewImage2(): ImageFile {
    return this.imageService.getEmptyOr(this.selectedTable ? this.selectedTable.backgroundImageIdentifier2 : null);
  }

  get tableName(): string { return this.selectedTable.name; }
  set tableName(tableName: string) { if (this.isEditable) this.selectedTable.name = tableName; }

  get tableWidth(): number { return this.selectedTable.width; }
  set tableWidth(tableWidth: number) { if (this.isEditable) this.selectedTable.width = tableWidth; }

  get tableHeight(): number { return this.selectedTable.height; }
  set tableHeight(tableHeight: number) { if (this.isEditable) this.selectedTable.height = tableHeight; }

  get tableGridColor(): string { return this.selectedTable.gridColor; }
  set tableGridColor(tableGridColor: string) { if (this.isEditable) this.selectedTable.gridColor = tableGridColor; }

  get tableGridShow(): boolean { return this.tableSelecter.gridShow; }
  set tableGridShow(tableGridShow: boolean) {
    this.tableSelecter.gridShow = tableGridShow;
    if (tableGridShow) this.tableSelecter.viewTable.gridClipRect = null;
    EventSystem.trigger('UPDATE_GAME_OBJECT', this.tableSelecter.toContext()); // 僅對自己發送事件以觸發格線更新
  }

  get tableGridSnap(): boolean { return this.tableSelecter.gridSnap; }
  set tableGridSnap(tableGridSnap: boolean) {
    this.tableSelecter.gridSnap = tableGridSnap;
  }

  get tableGridType(): GridType { return this.selectedTable.gridType; }
  set tableGridType(gridType: GridType) { if (this.isEditable) this.selectedTable.gridType = Number(gridType); }

  get tableGridNumberShow(): boolean { return this.selectedTable.isShowNumber; }
  set tableGridNumberShow(isShowNumber: boolean) {
    this.selectedTable.isShowNumber = isShowNumber;
    EventSystem.trigger('UPDATE_GAME_OBJECT', this.tableSelecter.toContext()); // 僅對自己發送事件以觸發格線更新
  }

  get tableDistanceviewFilter(): FilterType { return this.selectedTable.backgroundFilterType; }
  set tableDistanceviewFilter(filterType: FilterType) { if (this.isEditable) this.selectedTable.backgroundFilterType = filterType; }

  get tableDarkness(): number { return this.selectedTable?.darkness ?? 0; }
  set tableDarkness(v: number) { if (this.isEditable) this.selectedTable.darkness = Number(v); }
  get tableGlobalIllumination(): number { return this.selectedTable?.globalIllumination ?? 1; }
  set tableGlobalIllumination(v: number) { if (this.isEditable) this.selectedTable.globalIllumination = Number(v); }
  get tableWeatherType(): WeatherType { return this.selectedTable?.weatherType || 'none'; }
  set tableWeatherType(v: WeatherType) { if (this.isEditable) this.selectedTable.weatherType = v; }
  get tableWeatherIntensity(): number { return this.selectedTable?.weatherIntensity ?? 0.5; }
  set tableWeatherIntensity(v: number) { if (this.isEditable) this.selectedTable.weatherIntensity = Number(v); }
  get tableVisionEnabled(): boolean { return !!this.selectedTable?.visionEnabled; }
  set tableVisionEnabled(v: boolean) { if (this.isEditable) this.selectedTable.visionEnabled = !!v; }

  transitionDay() {
    if (!this.isEditable) return;
    this.animateDarkness(0);
  }
  transitionNight() {
    if (!this.isEditable) return;
    this.animateDarkness(0.85);
  }
  private animateDarkness(target: number) {
    const table = this.selectedTable;
    if (!table) return;
    const start = table.darkness;
    const t0 = performance.now();
    const dur = 800;
    const step = (now: number) => {
      const p = Math.min(1, (now - t0) / dur);
      table.darkness = start + (target - start) * p;
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  get tableSelecter(): TableSelecter { return TableSelecter.instance; }

  selectedTable: GameTable = null;
  selectedTableXml: string = '';

  get isEmpty(): boolean { return this.tableSelecter ? (this.tableSelecter.viewTable ? false : true) : true; }
  get isDeleted(): boolean {
    if (!this.selectedTable) return true;
    return ObjectStore.instance.get<GameTable>(this.selectedTable.identifier) == null;
  }
  get isEditable(): boolean {
    return !this.isEmpty && !this.isDeleted;
  }

  isSaveing: boolean = false;
  progresPercent: number = 0;

  constructor(
    private changeDetector: ChangeDetectorRef,
    private modalService: ModalService,
    private saveDataService: SaveDataService,
    private imageService: ImageService,
    private panelService: PanelService,
    private chatMessageService: ChatMessageService,
    private i18n: I18nService,
  ) { }

  GuestMode() {
    return Network.GuestMode();
  }


  ngOnInit() {
    Promise.resolve().then(() => this.refreshPanelTitle());
    this.selectedTable = this.tableSelecter.viewTable;
    EventSystem.register(this)
      .on('DELETE_GAME_OBJECT', 2000, event => {
        if (!this.selectedTable || event.data.identifier !== this.selectedTable.identifier) return;
        let object = ObjectStore.instance.get(event.data.identifier);
        if (object !== null) {
          this.selectedTableXml = object.toXml();
        }
      })
      .on('LOCALE_CHANGED', () => this.refreshPanelTitle());
  }

  ngOnDestroy() {
    EventSystem.unregister(this);
  }

  private refreshPanelTitle() {
    this.modalService.title = this.panelService.title = this.i18n.t('table.title');
  }

  selectGameTable(identifier: string) {
    if (this.GuestMode()) return;
    EventSystem.call('SELECT_GAME_TABLE', { identifier: identifier }, Network.peerId);
    this.selectedTable = ObjectStore.instance.get<GameTable>(identifier);
    this.selectedTableXml = '';
  }

  getGameTables(): GameTable[] {
    return ObjectStore.instance.getObjects(GameTable);
  }

  createGameTable() {
    if (this.GuestMode()) return;
    let gameTable = new GameTable();
    gameTable.name = this.i18n.t('table.defaultName');
    gameTable.imageIdentifier = 'testTableBackgroundImage_image';
    gameTable.initialize();
    this.selectGameTable(gameTable.identifier);
  }

  confirm() {
    this.panelService.close();
  }

  async save() {
    if (this.GuestMode()) return;
    if (!this.selectedTable || this.isSaveing) return;
    this.isSaveing = true;
    this.progresPercent = 0;

    this.selectedTable.selected = true;
    await this.saveDataService.saveGameObjectAsync(this.selectedTable, 'fly_map_' + this.selectedTable.name, percent => {
      this.progresPercent = percent;
    });

    setTimeout(() => {
      this.isSaveing = false;
      this.progresPercent = 0;
    }, 500);
  }

  delete() {
    if (this.GuestMode()) return;
    if (!this.isEmpty && this.selectedTable) {
      this.selectedTableXml = this.selectedTable.toXml();
      this.selectedTable.destroy();
    }
  }

  restore() {
    if (this.GuestMode()) return;
    if (this.selectedTable && this.selectedTableXml) {
      let restoreTable = ObjectSerializer.instance.parseXml(this.selectedTableXml);
      this.selectGameTable(restoreTable.identifier);
      this.selectedTableXml = '';
    }
  }

  getHidden(image: ImageFile): boolean {
    const imageTag = ImageTag.get(image.identifier);
    return imageTag ? imageTag.hide : false;
  }
  
  openBgImageModal() {
    if (this.GuestMode()) return;
    if (this.isDeleted) return;
    let currentImageIdentifires: string[] = [];
    if (this.selectedTable && this.selectedTable.imageIdentifier) currentImageIdentifires = [this.selectedTable.imageIdentifier];
    this.modalService.open<string>(FileSelecterComponent, { currentImageIdentifires: currentImageIdentifires }).then(value => {
      if (!this.selectedTable || !value) return;
      this.selectedTable.imageIdentifier = value;
    });
  }

  openDistanceViewImageModal() {
    if (this.GuestMode()) return;
    if (this.isDeleted) return;
    let currentImageIdentifires: string[] = [];
    if (this.selectedTable && this.selectedTable.backgroundImageIdentifier) currentImageIdentifires = [this.selectedTable.backgroundImageIdentifier];
    this.modalService.open<string>(FileSelecterComponent, { isAllowedEmpty: true, currentImageIdentifires: currentImageIdentifires }).then(value => {
      if (!this.selectedTable || !value) return;
      this.selectedTable.backgroundImageIdentifier = value;
    });
  }

  openDistanceViewImageModal2() {
    if (this.GuestMode()) return;
    if (this.isDeleted) return;
    let currentImageIdentifires: string[] = [];
    if (this.selectedTable && this.selectedTable.backgroundImageIdentifier2) currentImageIdentifires = [this.selectedTable.backgroundImageIdentifier2];
    this.modalService.open<string>(FileSelecterComponent, { isAllowedEmpty: true, currentImageIdentifires: currentImageIdentifires }).then(value => {
      if (!this.selectedTable || !value) return;
      this.selectedTable.backgroundImageIdentifier2 = value;
    });
  }

  onShowHiddenImages($event: Event) {
    if (this.isShowHideImages) {
      this.isShowHideImages = false;
    } else {
      $event.preventDefault();
      this.modalService.open(ConfirmationComponent, {
        title: this.i18n.t('table.confirmShowHidden.title'),
        text: this.i18n.t('table.confirmShowHidden.text'),
        help: this.i18n.t('table.confirmShowHidden.help'),
        type: ConfirmationType.OK_CANCEL,
        materialIcon: 'visibility',
        action: () => {
          this.chatMessageService.sendOperationLog(this.i18n.t('table.operationShowHidden'));
          this.isShowHideImages = true;
          (<HTMLInputElement>$event.target).checked = true;
          this.changeDetector.markForCheck();
        } 
      });
    }
  }
}