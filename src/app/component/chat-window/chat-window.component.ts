import { AfterViewInit, ChangeDetectorRef, Component, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { ChatMessage } from '@udonarium/chat-message';
import { ChatTab } from '@udonarium/chat-tab';
import { AudioPlayer } from '@udonarium/core/file-storage/audio-player';
import { ObjectStore } from '@udonarium/core/synchronize-object/object-store';
import { EventSystem, Network } from '@udonarium/core/system';
import { GameCharacter } from '@udonarium/game-character';
import { PeerCursor } from '@udonarium/peer-cursor';
import { ChatLogOutputComponent } from 'component/chat-log-output/chat-log-output.component';
import { ChatTabSettingComponent } from 'component/chat-tab-setting/chat-tab-setting.component';
import { ChatTabComponent } from 'component/chat-tab/chat-tab.component';
import { ChatMessageService } from 'service/chat-message.service';
import { I18nService } from 'service/i18n.service';
import { PanelOption, PanelService } from 'service/panel.service';
import { PointerDeviceService } from 'service/pointer-device.service';

import * as localForage from 'localforage';

@Component({
    selector: 'chat-window',
    templateUrl: './chat-window.component.html',
    styleUrls: ['./chat-window.component.css'],
    standalone: false
})
export class ChatWindowComponent implements OnInit, OnDestroy, AfterViewInit {
  @ViewChild('chatTabComponemt', { static: false }) chatTabComponemt: ChatTabComponent;
  sendFrom: string = 'Guest';
  
  static readonly CHAT_IS_NOTICE_ON_LOCAL_STORAGE_KEY = 'udonanaumu-chat-is-notice-on-local-storage';
  static readonly CHAT_IS_LEFT_ONLY_LOCAL_STORAGE_KEY = 'udonanaumu-chat-left-only-local-storage';

  /** Default ON: play notice when someone chats. */
  static isNoticeOn = true;
  static setChatNotice(isNoticeOn: boolean) {
    localForage.setItem(ChatWindowComponent.CHAT_IS_NOTICE_ON_LOCAL_STORAGE_KEY, !!isNoticeOn).catch(e => console.log(e));
    ChatWindowComponent.isNoticeOn = !!isNoticeOn;
  }
  get isNoticeOn(): boolean {
    return ChatWindowComponent.isNoticeOn;
  }
  set isNoticeOn(isNoticeOn: boolean) {
    ChatWindowComponent.setChatNotice(isNoticeOn);
  }

  static isLeftOnly = false;
  static setChatLeftOnly(isLeftOnly: boolean) {
    if (isLeftOnly) {
      localForage.setItem(ChatWindowComponent.CHAT_IS_LEFT_ONLY_LOCAL_STORAGE_KEY, isLeftOnly).catch(e => console.log(e));
    } else {
      localForage.removeItem(ChatWindowComponent.CHAT_IS_LEFT_ONLY_LOCAL_STORAGE_KEY).catch(e => console.log(e));
    }
    ChatWindowComponent.isLeftOnly = isLeftOnly;
  }
  get isLeftOnly(): boolean {
    return ChatWindowComponent.isLeftOnly;
  }
  set isLeftOnly(isLeftOnly: boolean) {
    ChatWindowComponent.setChatLeftOnly(isLeftOnly);
  }

  /** Default ON = normal chat bubbles. OFF = compact list. */
  private _isCompact = false;
  get isCompact(): boolean {
    return this._isCompact;
  }
  set isCompact(isCompact: boolean) {
    this._isCompact = isCompact;
    this.chatTabComponemt?.onScroll();
  }
  get isCompactOff(): boolean {
    return !this._isCompact;
  }
  toggleCompact() {
    this.isCompact = !this._isCompact;
  }

  /** Default ON = full toolbar. OFF = clarify (精簡). */
  public static ClarifyMode: boolean = false;
  ClarifyModeActive(): boolean {
    return ChatWindowComponent.ClarifyMode;
  }
  get isClarifyOff(): boolean {
    return !ChatWindowComponent.ClarifyMode;
  }
  toggleClarifyMode() {
    ChatWindowComponent.ClarifyMode = !ChatWindowComponent.ClarifyMode;
  }

  /** Default ON = BGM audible. OFF = mute BGM. */
  get isMusicOn(): boolean {
    return !AudioPlayer.isMute;
  }

  toggleMusic() {
    this.setMute(AudioPlayer.MAIN_IS_MUTE_LOCAL_STORAGE_KEY, 'isMute', !AudioPlayer.isMute);
  }

  /** Default ON = SE audible. OFF = mute sound effects. */
  get isSoundEffectOn(): boolean {
    return !AudioPlayer.isSoundEffectMute;
  }

  toggleSoundEffect() {
    this.setMute(AudioPlayer.SOUND_EFFECT_IS_MUTE_LOCAL_STORAGE_KEY, 'isSoundEffectMute', !AudioPlayer.isSoundEffectMute);
  }

  private setMute(
    storageKey: string,
    prop: 'isMute' | 'isSoundEffectMute',
    muted: boolean,
  ) {
    AudioPlayer[prop] = muted;
    if (muted) {
      localForage.setItem(storageKey, true).catch(e => console.log(e));
    } else {
      localForage.removeItem(storageKey).catch(e => console.log(e));
    }
    EventSystem.trigger('CHANGE_JUKEBOX_VOLUME', null);
  }

  get gameType(): string { return !this.chatMessageService.gameType ? 'DiceBot' : this.chatMessageService.gameType; }
  set gameType(gameType: string) { this.chatMessageService.gameType = gameType; }

  private _chatTabidentifier: string = '';
  get chatTabidentifier(): string { return this._chatTabidentifier; }
  set chatTabidentifier(chatTabidentifier: string) {
    let hasChanged: boolean = this._chatTabidentifier !== chatTabidentifier;
    this._chatTabidentifier = chatTabidentifier;
    this.updatePanelTitle();
    if (hasChanged) {
      this.scrollToBottom(true);
    }
  }

  get chatTab(): ChatTab { return ObjectStore.instance.get<ChatTab>(this.chatTabidentifier); }
  isAutoScroll: boolean = true;
  scrollToBottomTimer: NodeJS.Timeout | null = null;

  constructor(
    public chatMessageService: ChatMessageService,
    private i18n: I18nService,
    private panelService: PanelService,
    private pointerDeviceService: PointerDeviceService,
    private changeDetector: ChangeDetectorRef,
  ) { }

  GuestMode() {
    return Network.GuestMode();
  }


  ngOnInit() {
    const preferred = GameCharacter.preferredChatCharacter();
    this.sendFrom = preferred?.identifier || PeerCursor.myCursor.identifier;
    this._chatTabidentifier = 0 < this.chatMessageService.chatTabs.length ? this.chatMessageService.chatTabs[0].identifier : '';

    EventSystem.register(this)
      .on('MESSAGE_ADDED', event => {
        if (event.data.tabIdentifier !== this.chatTabidentifier) return;
        let message = ObjectStore.instance.get<ChatMessage>(event.data.messageIdentifier);
        if (message && message.isSendFromSelf) {
          this.isAutoScroll = true;
        } else {
          this.checkAutoScroll();
        }
        if (this.isAutoScroll && this.chatTab) this.chatTab.markForRead();
      })
      .on('CHANGE_JUKEBOX_VOLUME', event => {
        this.changeDetector.markForCheck();
      })
      .on('LOCALE_CHANGED', () => {
        this.updatePanelTitle();
      });
    Promise.resolve().then(() => this.updatePanelTitle());
  }

  ngAfterViewInit() {
    queueMicrotask(() => this.scrollToBottom(true));
  }

  ngOnDestroy() {
    EventSystem.unregister(this);
  }

  // @TODO 做法應再斟酌
  scrollToBottom(isForce: boolean = false) {
    if (isForce) this.isAutoScroll = true;
    if (!this.isAutoScroll) return;
    let event = new CustomEvent('scrolltobottom', {});
    this.panelService.scrollablePanel.dispatchEvent(event);
    if (this.scrollToBottomTimer != null) return;
    this.scrollToBottomTimer = setTimeout(() => {
      if (this.chatTab) this.chatTab.markForRead();
      this.scrollToBottomTimer = null;
      this.isAutoScroll = false;
      if (this.panelService.scrollablePanel) {
        this.panelService.scrollablePanel.scrollTop = this.panelService.scrollablePanel.scrollHeight;
      }
    }, 0);
  }

  // @TODO
  checkAutoScroll() {
    if (!this.panelService.scrollablePanel) return;
    let top = this.panelService.scrollablePanel.scrollHeight - this.panelService.scrollablePanel.clientHeight;
    if (top - 150 <= this.panelService.scrollablePanel.scrollTop) {
      this.isAutoScroll = true;
    } else {
      this.isAutoScroll = false;
    }
  }

  updatePanelTitle() {
    if (this.chatTab && this.chatTab.name !== '') {
      this.panelService.title = this.i18n.t('chat.titleWithTab', { tabName: this.chatTab.name });
    } else {
      this.panelService.title = this.i18n.t('chat.title');
    }
  }

  onSelectedTab(identifier: string) {
    this.updatePanelTitle();
  }

  showTabSetting() {
    if (this.GuestMode()) return;
    let coordinate = this.pointerDeviceService.pointers[0];
    let option: PanelOption = { left: coordinate.x - 250, top: coordinate.y - 175, width: 460, height: 330 };
    let component = this.panelService.open<ChatTabSettingComponent>(ChatTabSettingComponent, option);
    component.selectedTab = this.chatTab;
  }

  showLogOutput() {
    if (this.GuestMode()) return;
    let coordinate = this.pointerDeviceService.pointers[0];
    let option: PanelOption = { left: coordinate.x - 250, top: coordinate.y - 175, width: 540, height: 300 };
    let component = this.panelService.open<ChatLogOutputComponent>(ChatLogOutputComponent, option);
    component.selectedTabs = this.chatTab ? [this.chatTab] : [];
    component.selectTabsApplay();
  }

  sendChat(value: { text: string, gameType: string, sendFrom: string, sendTo: string,
    color?: string, isInverse?:boolean, isHollow?: boolean, isBlackPaint?: boolean, aura?: number, isUseFaceIcon?: boolean, characterIdentifier?: string, standIdentifier?: string, standName?: string, isUseStandImage?: boolean }) {
    if (this.chatTab) {
      this.chatMessageService.sendMessage(
        this.chatTab, 
        value.text, 
        value.gameType, 
        value.sendFrom, 
        value.sendTo,
        value.color, 
        value.isInverse,
        value.isHollow,
        value.isBlackPaint,
        value.aura,
        value.isUseFaceIcon,
        value.characterIdentifier,
        value.standIdentifier,
        value.standName,
        value.isUseStandImage
      );
    }
  }

  trackByChatTab(index: number, chatTab: ChatTab) {
    return chatTab.identifier;
  }
}
