import { AfterViewInit, ChangeDetectorRef, Component, OnDestroy, OnInit, ViewChild } from '@angular/core';
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
  static activeChatTabIdentifier: string = '';
  @ViewChild('chatTabComponemt', { static: false }) chatTabComponemt: ChatTabComponent;
  sendFrom: string = 'Guest';
  
  static readonly CHAT_IS_NOTICE_ON_LOCAL_STORAGE_KEY = 'udonanaumu-chat-is-notice-on-local-storage';
  static readonly CHAT_IS_LEFT_ONLY_LOCAL_STORAGE_KEY = 'udonanaumu-chat-left-only-local-storage';
  static readonly CHAT_AUTO_POPUP_LOCAL_STORAGE_KEY = 'udonanaumu-chat-auto-popup-local-storage';
  static readonly CHAT_GEOMETRY_LOCAL_STORAGE_KEY = 'udonanaumu-chat-window-geometry-v2';
  /** Designed defaults: prior 700×400 @ (100,450); height −30%. */
  static readonly DEFAULT_WIDTH = 700;
  static readonly DEFAULT_HEIGHT = 265;
  static readonly DEFAULT_LEFT = 100;
  static readonly DEFAULT_TOP = 450;
  static savedWidth = ChatWindowComponent.DEFAULT_WIDTH;
  static savedHeight = ChatWindowComponent.DEFAULT_HEIGHT;
  static savedLeft = ChatWindowComponent.DEFAULT_LEFT;
  static savedTop = ChatWindowComponent.DEFAULT_TOP;
  static geometryReady: Promise<void> = Promise.resolve();

  static applySavedGeometry(option: PanelOption): PanelOption {
    option.width = ChatWindowComponent.savedWidth;
    option.height = ChatWindowComponent.savedHeight;
    option.left = ChatWindowComponent.savedLeft;
    option.top = ChatWindowComponent.savedTop;
    return option;
  }

  static saveGeometry(width: number, height: number, left?: number, top?: number) {
    if (!(width >= 100) || !(height >= 100)) return;
    const w = Math.round(width);
    const h = Math.round(height);
    ChatWindowComponent.savedWidth = w;
    ChatWindowComponent.savedHeight = h;
    if (typeof left === 'number' && Number.isFinite(left)) {
      ChatWindowComponent.savedLeft = Math.round(left);
    }
    if (typeof top === 'number' && Number.isFinite(top)) {
      ChatWindowComponent.savedTop = Math.round(top);
    }
    localForage.setItem(ChatWindowComponent.CHAT_GEOMETRY_LOCAL_STORAGE_KEY, {
      width: ChatWindowComponent.savedWidth,
      height: ChatWindowComponent.savedHeight,
      left: ChatWindowComponent.savedLeft,
      top: ChatWindowComponent.savedTop,
    }).catch(e => console.log(e));
  }

  static loadGeometryFromStorage(): Promise<void> {
    ChatWindowComponent.geometryReady = localForage.getItem<{
      width: number; height: number; left?: number; top?: number;
    }>(ChatWindowComponent.CHAT_GEOMETRY_LOCAL_STORAGE_KEY).then(g => {
      if (g && typeof g.width === 'number' && typeof g.height === 'number' && g.width >= 100 && g.height >= 100) {
        ChatWindowComponent.savedWidth = Math.round(g.width);
        ChatWindowComponent.savedHeight = Math.round(g.height);
        if (typeof g.left === 'number' && Number.isFinite(g.left)) {
          ChatWindowComponent.savedLeft = Math.round(g.left);
        }
        if (typeof g.top === 'number' && Number.isFinite(g.top)) {
          ChatWindowComponent.savedTop = Math.round(g.top);
        }
      }
    }).catch(e => console.log(e));
    return ChatWindowComponent.geometryReady;
  }

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

  /** Default OFF: auto-open chat when someone speaks and no chat window is open. */
  static isAutoPopup = false;
  static setChatAutoPopup(isAutoPopup: boolean) {
    if (isAutoPopup) {
      localForage.setItem(ChatWindowComponent.CHAT_AUTO_POPUP_LOCAL_STORAGE_KEY, true).catch(e => console.log(e));
    } else {
      localForage.removeItem(ChatWindowComponent.CHAT_AUTO_POPUP_LOCAL_STORAGE_KEY).catch(e => console.log(e));
    }
    ChatWindowComponent.isAutoPopup = !!isAutoPopup;
  }
  get isAutoPopup(): boolean {
    return ChatWindowComponent.isAutoPopup;
  }
  set isAutoPopup(isAutoPopup: boolean) {
    ChatWindowComponent.setChatAutoPopup(isAutoPopup);
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
  get chatTabs(): ChatTab[] {
    return this.chatMessageService.chatTabs.filter(tab => tab.canView());
  }

  get chatTabidentifier(): string { return this._chatTabidentifier; }
  set chatTabidentifier(chatTabidentifier: string) {
    let hasChanged: boolean = this._chatTabidentifier !== chatTabidentifier;
    this._chatTabidentifier = chatTabidentifier;
    ChatWindowComponent.activeChatTabIdentifier = chatTabidentifier || '';
    this.updatePanelTitle();
    if (hasChanged) {
      this.scheduleScrollToBottom(true);
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
    this._chatTabidentifier = 0 < this.chatTabs.length ? this.chatTabs[0].identifier : '';
    ChatWindowComponent.activeChatTabIdentifier = this._chatTabidentifier;

    EventSystem.register(this)
      .on('MESSAGE_ADDED', event => {
        if (event.data.tabIdentifier !== this.chatTabidentifier) return;
        // Always follow new messages on the active tab (mobile + desktop).
        this.isAutoScroll = true;
        if (this.chatTab) this.chatTab.markForRead();
        this.scrollToBottom(true);
        // Virtual list needs a second pass after DOM height updates.
        setTimeout(() => this.scrollToBottom(true), 50);
      })
      .on('DELETE_GAME_OBJECT', event => {
        if (this.chatTabidentifier === event.data.identifier || !this.chatTab) {
          this.selectMainChatTab();
        }
      })
      .on('UPDATE_GAME_OBJECT', event => {
        // After room sync / ZIP load replaces ChatTabList, reselect main if current tab is gone.
        if (!this.chatTab || !this.chatTab.canView()) this.selectMainChatTab();
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
    this.scheduleScrollToBottom(true);
    this.bindScrollTracking();
  }

  ngOnDestroy() {
    EventSystem.unregister(this);
    this.unbindScrollTracking();
    if (this.openScrollRetryTimers.length) {
      this.openScrollRetryTimers.forEach(t => clearTimeout(t));
      this.openScrollRetryTimers = [];
    }
    EventSystem.trigger('CHAT_PANEL_CHANGED', null);
  }

  private scrollTrackBound = false;
  private onPanelScroll = () => this.checkAutoScroll();
  private openScrollRetryTimers: ReturnType<typeof setTimeout>[] = [];

  private bindScrollTracking() {
    const panel = this.panelService.scrollablePanel;
    if (!panel || this.scrollTrackBound) return;
    panel.addEventListener('scroll', this.onPanelScroll, { passive: true });
    this.scrollTrackBound = true;
  }

  private unbindScrollTracking() {
    const panel = this.panelService.scrollablePanel;
    if (!panel || !this.scrollTrackBound) return;
    panel.removeEventListener('scroll', this.onPanelScroll);
    this.scrollTrackBound = false;
  }

  /** Open / tab change / new message — retry until virtual list paints. */
  private scheduleScrollToBottom(force: boolean = true) {
    this.scrollToBottom(force);
    queueMicrotask(() => this.scrollToBottom(force));
    for (const delay of [50, 150, 300]) {
      const t = setTimeout(() => this.scrollToBottom(force), delay);
      this.openScrollRetryTimers.push(t);
    }
  }

  // @TODO 做法應再斟酌
  scrollToBottom(isForce: boolean = false) {
    if (isForce) this.isAutoScroll = true;
    if (!this.isAutoScroll) return;
    const panel = this.panelService.scrollablePanel;
    if (!panel) return;
    let event = new CustomEvent('scrolltobottom', {});
    panel.dispatchEvent(event);
    if (this.scrollToBottomTimer != null) return;
    this.scrollToBottomTimer = setTimeout(() => {
      if (this.chatTab) this.chatTab.markForRead();
      this.scrollToBottomTimer = null;
      const el = this.panelService.scrollablePanel;
      if (el) {
        el.scrollTop = el.scrollHeight;
        // Second pass after layout (mobile sheet / virtual list height settle).
        requestAnimationFrame(() => {
          if (!this.isAutoScroll || !this.panelService.scrollablePanel) return;
          this.panelService.scrollablePanel.scrollTop = this.panelService.scrollablePanel.scrollHeight;
          this.checkAutoScroll();
        });
      }
      // Stay following while parked at the bottom; scroll-up turns this off via checkAutoScroll.
      this.checkAutoScroll();
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

  /** Jump to the first visible chat tab when the current selection is gone. */
  private selectMainChatTab() {
    const tabs = this.chatTabs;
    const nextId = tabs.length > 0 ? tabs[0].identifier : '';
    if (this._chatTabidentifier === nextId) {
      this.updatePanelTitle();
      return;
    }
    this.chatTabidentifier = nextId;
  }

  onSelectedTab(identifier: string) {
    this.updatePanelTitle();
  }

  showTabSetting() {
    if (this.GuestMode()) return;
    let coordinate = this.pointerDeviceService.pointers[0];
    let option: PanelOption = { left: coordinate.x - 250, top: coordinate.y - 175, width: 520, height: 360 };
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
    color?: string, isInverse?:boolean, isHollow?: boolean, isBlackPaint?: boolean, imageFx?: string, aura?: number, isUseFaceIcon?: boolean, characterIdentifier?: string, standIdentifier?: string, standName?: string, isUseStandImage?: boolean }) {
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
        value.isUseStandImage,
        value.imageFx
      );
    }
  }

  trackByChatTab(index: number, chatTab: ChatTab) {
    return chatTab.identifier;
  }

  privateTabMemberNames(tab: ChatTab): string[] {
    if (!tab?.isPrivate) return [];
    const ids = new Set(tab.memberIds);
    if (tab.creatorUserId) ids.add(tab.creatorUserId);
    const names: string[] = [];
    for (const id of ids) {
      const peer = PeerCursor.findByUserId(id);
      const name = (peer?.name || '').trim();
      names.push(name || id);
    }
    return names;
  }
}
