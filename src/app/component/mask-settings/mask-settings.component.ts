import { ChangeDetectionStrategy, ChangeDetectorRef, Component, Input, OnChanges, OnDestroy, OnInit, SimpleChanges } from '@angular/core';

import { ImageStorage } from '@udonarium/core/file-storage/image-storage';
import { ObjectStore } from '@udonarium/core/synchronize-object/object-store';
import { EventSystem, Network } from '@udonarium/core/system';
import { GameTable } from '@udonarium/game-table';
import { GameTableMask } from '@udonarium/game-table-mask';
import { ScenePresetList } from '@udonarium/scene-preset-list';
import { TabletopClickAction } from '@udonarium/tabletop-click-action';

import { FileSelecterComponent } from 'component/file-selecter/file-selecter.component';
import { I18nService } from 'service/i18n.service';
import { ModalService } from 'service/modal.service';
import { PanelService } from 'service/panel.service';

@Component({
  selector: 'mask-settings',
  templateUrl: './mask-settings.component.html',
  styleUrls: ['../shared/settings-ui.css', './mask-settings.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: false
})
export class MaskSettingsComponent implements OnInit, OnChanges, OnDestroy {
  @Input() mask: GameTableMask = null;
  @Input() embedded = false;

  isDragOver = false;

  readonly actions: { id: TabletopClickAction; icon: string; labelKey: string }[] = [
    { id: 'none', icon: 'block', labelKey: 'note.actionNone' },
    { id: 'chat', icon: 'chat', labelKey: 'note.actionChat' },
    { id: 'table', icon: 'map', labelKey: 'note.actionTable' },
    { id: 'preset', icon: 'bookmark', labelKey: 'note.actionPreset' },
  ];

  readonly blendOptions = [
    { value: 0, labelKey: 'mask.dynamic.4' },
    { value: 1, labelKey: 'mask.dynamic.5' },
    { value: 2, labelKey: 'mask.dynamic.6' },
  ];

  readonly borderOptions = [
    { value: 0, labelKey: 'mask.dynamic.1' },
    { value: 1, labelKey: 'mask.dynamic.2' },
    { value: 2, labelKey: 'mask.dynamic.3' },
  ];

  get tables(): GameTable[] { return ObjectStore.instance.getObjects(GameTable); }
  get presets() { return ScenePresetList.instance.presets; }

  constructor(
    private changeDetector: ChangeDetectorRef,
    private modalService: ModalService,
    private panelService: PanelService,
    private i18n: I18nService
  ) { }

  GuestMode() { return Network.GuestMode(); }

  ngOnInit() {
    EventSystem.register(this)
      .on('UPDATE_GAME_OBJECT', event => {
        if (this.mask && event.data?.identifier === this.mask.identifier) {
          this.changeDetector.markForCheck();
        }
      })
      .on('UPDATE_OBJECT_CHILDREN', event => {
        if (this.mask && event.data?.identifier === this.mask.identifier) {
          this.changeDetector.markForCheck();
        }
      })
      .on('UPDATE_FILE_RESOURE', () => this.changeDetector.markForCheck());
    if (this.mask) this.mask.complement();
    this.refreshTitle();
  }

  ngOnChanges(changes: SimpleChanges) {
    if (changes['mask'] && this.mask) {
      this.mask.complement();
      this.refreshTitle();
    }
  }

  ngOnDestroy() {
    EventSystem.unregister(this);
  }

  setClickAction(action: TabletopClickAction) {
    if (!this.mask || this.GuestMode()) return;
    this.mask.clickAction = action;
    this.changeDetector.markForCheck();
  }

  setBlendType(value: number) {
    if (!this.mask || this.GuestMode()) return;
    this.mask.blendType = value;
    this.changeDetector.markForCheck();
  }

  setBorderType(value: number) {
    if (!this.mask || this.GuestMode()) return;
    this.mask.borderType = value;
    this.changeDetector.markForCheck();
  }

  openImage() {
    if (!this.mask || this.GuestMode()) return;
    const current = this.mask.imageFile?.identifier || '';
    this.modalService.open<string>(FileSelecterComponent, {
      isAllowedEmpty: true,
      currentImageIdentifires: current ? [current] : []
    }).then(value => {
      if (value == null) return;
      this.mask.setImage(value);
      this.changeDetector.markForCheck();
    });
  }

  clearImage() {
    if (!this.mask || this.GuestMode()) return;
    this.mask.setImage('');
    this.changeDetector.markForCheck();
  }

  onDragOver(e: DragEvent) {
    if (this.GuestMode()) return;
    if (!this.hasImageFile(e)) return;
    e.preventDefault();
    e.stopPropagation();
    this.isDragOver = true;
  }

  onDragLeave(e: DragEvent) {
    e.preventDefault();
    this.isDragOver = false;
  }

  async onDrop(e: DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    this.isDragOver = false;
    if (!this.mask || this.GuestMode()) return;
    const file = this.firstImageFile(e);
    if (!file) return;
    try {
      const image = await ImageStorage.instance.addAsync(file);
      this.mask.setImage(image.identifier);
      this.changeDetector.markForCheck();
    } catch (err) {
      console.warn('mask image drop failed', err);
    }
  }

  resetColors() {
    if (!this.mask || this.GuestMode()) return;
    this.mask.color = '#555555';
    this.mask.bgcolor = '#0a0a0a';
    this.changeDetector.markForCheck();
  }

  private hasImageFile(e: DragEvent): boolean {
    const items = e.dataTransfer?.items;
    if (items) {
      for (let i = 0; i < items.length; i++) {
        if (items[i].kind === 'file' && (items[i].type || '').startsWith('image/')) return true;
      }
    }
    const files = e.dataTransfer?.files;
    if (files) {
      for (let i = 0; i < files.length; i++) {
        if ((files[i].type || '').startsWith('image/')) return true;
      }
    }
    return false;
  }

  private firstImageFile(e: DragEvent): File | null {
    const files = e.dataTransfer?.files;
    if (!files) return null;
    for (let i = 0; i < files.length; i++) {
      if ((files[i].type || '').startsWith('image/')) return files[i];
    }
    return null;
  }

  private refreshTitle() {
    if (this.embedded || !this.mask) return;
    let title = this.i18n.t('mask.panelTitle');
    if (this.mask.name?.length) title += ' - ' + this.mask.name;
    this.panelService.title = title;
  }
}
