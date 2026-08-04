import { Component, NgZone, OnDestroy, OnInit } from '@angular/core';

import { ObjectStore } from '@udonarium/core/synchronize-object/object-store';
import { EventSystem, Network } from '@udonarium/core/system';
import { StringUtil } from '@udonarium/core/system/util/string-util';
import { PeerCursor } from '@udonarium/peer-cursor';
import { ScenarioText, SCENARIO_TEXT_MAX_BYTES } from '@udonarium/scenario-text';
import { ScenarioTextList } from '@udonarium/scenario-text-list';
import { ChatWindowComponent } from 'component/chat-window/chat-window.component';
import { ChatMessageService } from 'service/chat-message.service';
import { I18nService } from 'service/i18n.service';
import { ModalService } from 'service/modal.service';
import { PanelService } from 'service/panel.service';

@Component({
  selector: 'app-scenario-text',
  templateUrl: './scenario-text.component.html',
  styleUrls: ['../shared/settings-ui.css', './scenario-text.component.css'],
  standalone: false
})
export class ScenarioTextComponent implements OnInit, OnDestroy {
  selected: ScenarioText = null;
  readonly maxBytes = SCENARIO_TEXT_MAX_BYTES;
  private lazyUpdateTimer: NodeJS.Timeout = null;

  get list(): ScenarioTextList { return ScenarioTextList.instance; }
  get items(): ScenarioText[] { return this.list.items; }

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
      this.modalService.title = this.panelService.title = this.i18n.t('scenarioText.title');
    });
    EventSystem.register(this)
      .on('UPDATE_GAME_OBJECT', () => this.lazyUpdate())
      .on('DELETE_GAME_OBJECT', () => this.lazyUpdate())
      .on('LOCALE_CHANGED', () => {
        this.modalService.title = this.panelService.title = this.i18n.t('scenarioText.title');
      });
  }

  ngOnDestroy() {
    EventSystem.unregister(this);
  }

  create() {
    if (this.GuestMode()) return;
    this.selected = this.list.addItem();
  }

  select(item: ScenarioText) { this.selected = item; }

  remove(item: ScenarioText) {
    if (this.GuestMode() || !item) return;
    if (this.selected === item) this.selected = null;
    item.destroy();
  }

  send(item: ScenarioText) {
    if (this.GuestMode() || !item) return;
    this.postToActiveTab(item, item.body);
  }

  sendSelection(textarea: HTMLTextAreaElement) {
    if (this.GuestMode() || !this.selected || !textarea) return;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    if (start === end) return;
    const picked = (textarea.value || '').substring(start, end);
    this.postToActiveTab(this.selected, picked);
  }

  private postToActiveTab(item: ScenarioText, text: string) {
    if (!item || !(text || '').trim()) return;
    const tab = this.resolveTab();
    if (!tab) return;
    const title = (item.title || '').trim() || this.i18n.t('scenarioText.untitled');
    tab.addMessage({
      from: Network.peer.userId,
      name: title,
      imageIdentifier: PeerCursor.myCursor?.imageIdentifier || '',
      timestamp: Date.now(),
      tag: '',
      text: StringUtil.cr(text),
      color: PeerCursor.myCursor?.color || '',
    });
  }

  private resolveTab() {
    const id = ChatWindowComponent.activeChatTabIdentifier;
    if (id) {
      const tab = ObjectStore.instance.get(id);
      if (tab) return tab as any;
    }
    return this.chatMessageService.chatTabs[0];
  }

  private lazyUpdate() {
    if (this.lazyUpdateTimer) return;
    this.lazyUpdateTimer = setTimeout(() => { this.lazyUpdateTimer = null; }, 80);
  }
}
