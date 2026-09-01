import { ChangeDetectionStrategy, ChangeDetectorRef, Component, Input, OnChanges, OnDestroy, OnInit, SimpleChanges } from '@angular/core';

import { Card } from '@udonarium/card';
import { EventSystem, Network } from '@udonarium/core/system';

import { FileSelecterComponent } from 'component/file-selecter/file-selecter.component';
import { I18nService } from 'service/i18n.service';
import { ModalService } from 'service/modal.service';
import { PanelService } from 'service/panel.service';
import { SaveDataService } from 'service/save-data.service';
import { canRevealCardCaption } from 'service/card-caption-text';

@Component({
  selector: 'card-settings',
  templateUrl: './card-settings.component.html',
  styleUrls: ['../shared/settings-ui.css', '../shared/object-settings.css', './card-settings.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: false
})
export class CardSettingsComponent implements OnInit, OnChanges, OnDestroy {
  @Input() card: Card = null;

  isSaveing = false;
  progresPercent = 0;

  constructor(
    private changeDetector: ChangeDetectorRef,
    private modalService: ModalService,
    private panelService: PanelService,
    private saveDataService: SaveDataService,
    private i18n: I18nService
  ) { }

  GuestMode() { return Network.GuestMode(); }

  get isVisible(): boolean {
    return canRevealCardCaption(this.card);
  }

  get cardName(): string {
    if (!this.card) return '';
    if (!this.isVisible) return this.i18n.t('card.back');
    return this.card.name ?? '';
  }
  set cardName(value: string) {
    if (!this.card || this.GuestMode() || !this.isVisible) return;
    const el = this.card.commonDataElement?.getFirstElementByName('name');
    if (el) el.value = value;
  }

  ngOnInit() {
    EventSystem.register(this)
      .on('DELETE_GAME_OBJECT', event => {
        if (this.card && event.data?.identifier === this.card.identifier) this.panelService.close();
      })
      .on('UPDATE_GAME_OBJECT', event => {
        if (this.card && event.data?.identifier === this.card.identifier) {
          this.refreshTitle();
          this.changeDetector.markForCheck();
        }
      })
      .on('UPDATE_FILE_RESOURE', () => this.changeDetector.markForCheck())
      .on('CHANGE_GM_CARD_PEEK', () => {
        this.refreshTitle();
        this.changeDetector.markForCheck();
      })
      .on('LOCALE_CHANGED', () => this.refreshTitle());
    this.card?.complement();
    this.refreshTitle();
  }

  ngOnChanges(changes: SimpleChanges) {
    if (changes['card'] && this.card) {
      this.card.complement();
      this.refreshTitle();
    }
  }

  ngOnDestroy() {
    EventSystem.unregister(this);
  }

  openImage(name: 'front' | 'back') {
    if (!this.card || this.GuestMode()) return;
    if (name === 'front' && !this.isVisible) return;
    const current = this.card.imageDataElement?.getFirstElementByName(name)?.value + '' || '';
    this.modalService.open<string>(FileSelecterComponent, {
      isAllowedEmpty: false,
      currentImageIdentifires: current ? [current] : []
    }).then(value => {
      if (!this.card || !value) return;
      const el = this.card.imageDataElement?.getFirstElementByName(name);
      if (el) el.value = value;
      this.changeDetector.markForCheck();
    });
  }

  async saveToXML() {
    if (!this.card || this.isSaveing) return;
    this.isSaveing = true;
    this.progresPercent = 0;
    const objectName = this.isVisible ? (this.card.name || 'card') : this.i18n.t('sheet.cardBack');
    await this.saveDataService.saveGameObjectAsync(this.card, 'fly_xml_' + objectName, percent => {
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

  private refreshTitle() {
    if (!this.card) return;
    let title = this.i18n.t('card.panelTitle');
    const name = this.isVisible ? this.card.name : this.i18n.t('card.back');
    if (name?.length) title += ' - ' + name;
    this.panelService.title = title;
  }
}
