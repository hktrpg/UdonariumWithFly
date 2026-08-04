import { Component, NgZone, OnDestroy, OnInit } from '@angular/core';

import { ObjectStore } from '@udonarium/core/synchronize-object/object-store';
import { EventSystem, Network } from '@udonarium/core/system';
import { ScenePreset } from '@udonarium/scene-preset';
import { ScenePresetList } from '@udonarium/scene-preset-list';
import { TableSelecter } from '@udonarium/table-selecter';
import { ChatWindowComponent } from 'component/chat-window/chat-window.component';
import { ChatMessageService } from 'service/chat-message.service';
import { I18nService } from 'service/i18n.service';
import { ModalService } from 'service/modal.service';
import { PanelService } from 'service/panel.service';

@Component({
  selector: 'app-scene-preset',
  templateUrl: './scene-preset.component.html',
  styleUrls: ['../shared/settings-ui.css', './scene-preset.component.css'],
  standalone: false
})
export class ScenePresetComponent implements OnInit, OnDestroy {
  selected: ScenePreset = null;
  skipBgm = false;
  skipText = false;
  private lazyUpdateTimer: NodeJS.Timeout = null;

  get list(): ScenePresetList { return ScenePresetList.instance; }
  get presets(): ScenePreset[] { return this.list.presets; }

  constructor(
    private panelService: PanelService,
    private modalService: ModalService,
    private chatMessageService: ChatMessageService,
    private ngZone: NgZone,
    private i18n: I18nService
  ) { }

  GuestMode() { return Network.GuestMode(); }

  ngOnInit() {
    Promise.resolve().then(() => {
      this.modalService.title = this.panelService.title = this.i18n.t('scenePreset.title');
    });
    EventSystem.register(this)
      .on('UPDATE_GAME_OBJECT', () => this.lazyNgZoneUpdate())
      .on('DELETE_GAME_OBJECT', () => this.lazyNgZoneUpdate())
      .on('LOCALE_CHANGED', () => {
        this.modalService.title = this.panelService.title = this.i18n.t('scenePreset.title');
      });
  }

  ngOnDestroy() {
    EventSystem.unregister(this);
  }

  create() {
    if (this.GuestMode()) return;
    this.selected = this.list.createFromCurrent(this.i18n.t('scenePreset.defaultTitle'));
  }

  overwrite(preset: ScenePreset) {
    if (this.GuestMode() || !preset) return;
    this.list.writeSnapshot(preset);
  }

  rebind(preset: ScenePreset) {
    if (this.GuestMode() || !preset) return;
    const table = TableSelecter.instance.viewTable;
    if (table) preset.tableIdentifier = table.identifier;
  }

  apply(preset: ScenePreset) {
    if (this.GuestMode() || !preset || !preset.isValid) return;
    const chatTab = this.resolveActiveChatTab();
    this.list.applyPreset(preset, {
      skipBgm: this.skipBgm,
      skipText: this.skipText,
      chatTab
    });
  }

  remove(preset: ScenePreset) {
    if (this.GuestMode() || !preset) return;
    if (this.selected === preset) this.selected = null;
    preset.destroy();
  }

  select(preset: ScenePreset) {
    this.selected = preset;
  }

  moveUp(preset: ScenePreset) {
    if (this.GuestMode() || !preset) return;
    const parent = preset.parent;
    if (!parent) return;
    const idx = parent.children.indexOf(preset);
    if (idx <= 0) return;
    parent.insertBefore(preset, parent.children[idx - 1]);
  }

  moveDown(preset: ScenePreset) {
    if (this.GuestMode() || !preset) return;
    const parent = preset.parent;
    if (!parent) return;
    const idx = parent.children.indexOf(preset);
    if (idx < 0 || idx >= parent.children.length - 1) return;
    parent.insertBefore(parent.children[idx + 1], preset);
  }

  private resolveActiveChatTab() {
    const id = ChatWindowComponent.activeChatTabIdentifier;
    if (id) {
      const tab = ObjectStore.instance.get(id);
      if (tab) return tab as any;
    }
    return this.chatMessageService.chatTabs[0];
  }

  private lazyNgZoneUpdate() {
    if (this.lazyUpdateTimer !== null) return;
    this.lazyUpdateTimer = setTimeout(() => {
      this.lazyUpdateTimer = null;
      this.ngZone.run(() => { });
    }, 100);
  }
}
