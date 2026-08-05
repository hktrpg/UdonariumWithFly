import { AfterViewInit, Component, NgZone, OnDestroy, OnInit, ViewChild, ViewContainerRef } from '@angular/core';

import { ChatTabList } from '@udonarium/chat-tab-list';
import { AudioPlayer, VolumeType } from '@udonarium/core/file-storage/audio-player';
import { AudioSharingSystem } from '@udonarium/core/file-storage/audio-sharing-system';
import { AudioStorage } from '@udonarium/core/file-storage/audio-storage';
import { FileArchiver } from '@udonarium/core/file-storage/file-archiver';
import { ImageFile } from '@udonarium/core/file-storage/image-file';
import { ImageSharingSystem } from '@udonarium/core/file-storage/image-sharing-system';
import { ImageStorage } from '@udonarium/core/file-storage/image-storage';
import { ObjectFactory } from '@udonarium/core/synchronize-object/object-factory';
import { ObjectSerializer } from '@udonarium/core/synchronize-object/object-serializer';
import { ObjectStore } from '@udonarium/core/synchronize-object/object-store';
import { ObjectSynchronizer } from '@udonarium/core/synchronize-object/object-synchronizer';
import { EventSystem, Network } from '@udonarium/core/system';
import { DataSummarySetting } from '@udonarium/data-summary-setting';
import { DiceBot } from '@udonarium/dice-bot';
import { Jukebox } from '@udonarium/Jukebox';
import { PeerCursor } from '@udonarium/peer-cursor';
import { PresetSound, SoundEffect } from '@udonarium/sound-effect';
import { TableSelecter } from '@udonarium/table-selecter';
import { FilterType, WeatherType } from '@udonarium/game-table';
import { WEATHER_LABEL_KEY, WEATHER_MENU_ORDER } from 'component/game-table/weather-render';

import { ChatWindowComponent } from 'component/chat-window/chat-window.component';
import { setSkipEmptyDialogQuotes } from '@udonarium/chat-balloon';
import { ContextMenuComponent } from 'component/context-menu/context-menu.component';
import { FileStorageComponent } from 'component/file-storage/file-storage.component';
import { GameCharacterSheetComponent } from 'component/game-character-sheet/game-character-sheet.component';
import { GameObjectInventoryComponent } from 'component/game-object-inventory/game-object-inventory.component';
import { GameTableSettingComponent } from 'component/game-table-setting/game-table-setting.component';
import { JukeboxComponent } from 'component/jukebox/jukebox.component';
import { LobbyComponent } from 'component/lobby/lobby.component';
import { NoteInventoryComponent } from 'component/note-inventory/note-inventory.component';
import { ModalComponent } from 'component/modal/modal.component';
import { PeerMenuComponent } from 'component/peer-menu/peer-menu.component';
import { TextViewComponent } from 'component/text-view/text-view.component';
import { UIPanelComponent } from 'component/ui-panel/ui-panel.component';
import { AppConfig, AppConfigService } from 'service/app-config.service';
import { ChatMessageService } from 'service/chat-message.service';
import { ContextMenuAction, ContextMenuSeparator, ContextMenuService, contextMenuToggleCheck } from 'service/context-menu.service';
import { ModalService } from 'service/modal.service';
import { PanelOption, PanelService } from 'service/panel.service';
import { PointerDeviceService } from 'service/pointer-device.service';
import { SaveDataService } from 'service/save-data.service';
import { StandImageService } from 'service/stand-image.service';
import { I18nService } from 'service/i18n.service';
import { AppLocale } from 'i18n';
import { GameCharacter } from '@udonarium/game-character';
import { DataElement } from '@udonarium/data-element';
import { StandImageComponent } from 'component/stand-image/stand-image.component';
import { DiceRollTable } from '@udonarium/dice-roll-table';
import { DiceRollTableList } from '@udonarium/dice-roll-table-list';
import { DiceRollTableSettingComponent } from 'component/dice-roll-table-setting/dice-roll-table-setting.component';
import { CutInSettingComponent } from 'component/cut-in-setting/cut-in-setting.component';
import { CombatTrackerComponent } from 'component/combat-tracker/combat-tracker.component';
import { SceneToolsComponent } from 'component/scene-tools/scene-tools.component';
import { ScenePresetComponent } from 'component/scene-preset/scene-preset.component';
import { ScenarioTextComponent } from 'component/scenario-text/scenario-text.component';
import { CharacterResourceHudComponent } from 'component/character-resource-hud/character-resource-hud.component';
import { ScenePresetList } from '@udonarium/scene-preset-list';
import { ScenarioTextList } from '@udonarium/scenario-text-list';
import { AuraNameConfig } from '@udonarium/table-fx/aura-name-config';
import { CombatTracker } from '@udonarium/table-fx/combat-tracker';
import { SceneToolPermission } from '@udonarium/table-fx/scene-tool-permission';

import { ImageTag } from '@udonarium/image-tag';
import { CutInService } from 'service/cut-in.service';
import { CutIn } from '@udonarium/cut-in';
import { CutInList } from '@udonarium/cut-in-list';
import { ConfirmationComponent, ConfirmationType } from 'component/confirmation/confirmation.component';
import { RoomSettingComponent } from 'component/room-setting/room-setting.component';
import { SwUpdate } from '@angular/service-worker';

import * as localForage from 'localforage';
import { animate, keyframes, style, transition, trigger } from '@angular/animations';
import { RoomConnectHelper } from '@udonarium/room-connect-helper';
import { RoomInviteService } from 'service/room-invite.service';
import { FolderBackupService } from 'service/folder-backup.service';
import { GuidedTourService } from 'service/guided-tour.service';
import { TeachingTipService } from 'service/teaching-tip.service';
import { MobileLayoutService } from 'service/mobile-layout.service';
import { Subscription } from 'rxjs';

@Component({
    selector: 'app-root',
    templateUrl: './app.component.html',
    styleUrls: ['./app.component.css'],
    animations: [
        trigger('fadeInOut', [
            transition('void => *', [
                animate('100ms ease-out', keyframes([
                    style({ opacity: 0, offset: 0 }),
                    style({ opacity: 1, offset: 1.0 })
                ]))
            ]),
            transition('* => void', [
                animate('100ms ease-in', keyframes([
                    style({ opacity: 1, offset: 0 }),
                    style({ opacity: 0, offset: 1.0 })
                ]))
            ])
        ])
    ],
    standalone: false
})
export class AppComponent implements OnInit, AfterViewInit, OnDestroy {

  @ViewChild('modalLayer', { read: ViewContainerRef, static: true }) modalLayerViewContainerRef: ViewContainerRef;
  private immediateUpdateTimer: NodeJS.Timeout = null;
  private lazyUpdateTimer: NodeJS.Timeout = null;
  private openPanelCount: number = 0;
  isSaveing: boolean = false;
  progresPercent: number = 0;

  isHorizontal = false;
  isLoggedin = false;
  isMobileLayout = false;
  isTabletLandscape = false;
  isMobileEdit = false;
  private inviteHandled = false;
  private lobbyAutoOpened = false;
  private isRefreshPromptOpen = false;
  private mobileSub: Subscription = null;

  static imageUrl = '';
  get imageUrl(): string {
    return AppComponent.imageUrl;
  }
  
  private noticeIntervalTimer: NodeJS.Timer = null;

  get canOpenSceneTools(): boolean { return SceneToolPermission.instance.canOpenPanel; }

  /** Menu item visibility for the local user (GM / guest / player SyncVar). */
  canShowMenu(tourId: string): boolean {
    return SceneToolPermission.instance.canOpenMenu(tourId);
  }

  /** Total unread chat messages (viewable tabs). */
  get chatUnreadCount(): number { return ChatTabList.instance.unreadLength; }
  /** Badge label: cap at 99+ so the bubble stays a tidy pill. */
  get chatUnreadBadgeLabel(): string {
    const n = this.chatUnreadCount;
    return n > 99 ? '99+' : String(n);
  }
  /** Badge on menu chat icon only while no chat panel is open. */
  get showChatUnreadBadge(): boolean {
    return this.chatUnreadCount > 0 && !PanelService.isTourPanelOpen('menu.chat');
  }

  get otherPeers(): PeerCursor[] { return [PeerCursor.myCursor, ...Network.peers.filter(peer => peer.isOpen).map(peer => PeerCursor.findByPeerId(peer.peerId))].filter(peerCursor => peerCursor); /* ObjectStore.instance.getObjects(PeerCursor); */ }
  get isRoom(): boolean { return Network.peer?.isRoom; }
  get isGMMode(): boolean { return !!PeerCursor.myCursor?.isGMMode; }

  private static _noticePlayer: AudioPlayer;
  static get noticePlayer(): AudioPlayer {
    if (!AppComponent._noticePlayer) {
      AppComponent._noticePlayer = new AudioPlayer();
      AppComponent._noticePlayer.volumeType = VolumeType.NOTICE;
    }
    return AppComponent._noticePlayer;
  }
 
  notice(audioIdentifier=PresetSound.puyon) {
    const audio = AudioStorage.instance.get(audioIdentifier);
    if (audio && audio.isReady) {
      EventSystem.unregister(this, 'UPDATE_AUDIO_RESOURE');
      AppComponent.noticePlayer.play(audio);
    } else {
      EventSystem.register(this)
      .on('UPDATE_AUDIO_RESOURE', -100, event => {
        this.notice(audioIdentifier);
      });
    }
  }

  constructor(
    private swUpdate: SwUpdate,
    private modalService: ModalService,
    private panelService: PanelService,
    private pointerDeviceService: PointerDeviceService,
    private chatMessageService: ChatMessageService,
    private appConfigService: AppConfigService,
    private saveDataService: SaveDataService,
    private ngZone: NgZone,
    private contextMenuService: ContextMenuService,
    private standImageService: StandImageService,
    private cutInService: CutInService,
    private i18n: I18nService,
    private roomInvite: RoomInviteService,
    private folderBackup: FolderBackupService,
    private guidedTour: GuidedTourService,
    private teachingTips: TeachingTipService,
    private mobileLayout: MobileLayoutService,
  ) {

    this.ngZone.runOutsideAngular(() => {
      EventSystem;
      Network;
      FileArchiver.instance.initialize();
      void this.folderBackup.initialize();
      ImageSharingSystem.instance.initialize();
      ImageStorage.instance;
      AudioSharingSystem.instance.initialize();
      AudioStorage.instance;
      ObjectFactory.instance;
      ObjectSerializer.instance;
      ObjectStore.instance;
      ObjectSynchronizer.instance.initialize();
    });
    this.appConfigService.initialize();
    this.pointerDeviceService.initialize();

    TableSelecter.instance.initialize();
    ChatTabList.instance.initialize();
    DataSummarySetting.instance.initialize();

    let diceBot: DiceBot = new DiceBot('DiceBot', this.chatMessageService);
    diceBot.initialize();
    DiceBot.getHelpMessage('').then(() => this.lazyNgZoneUpdate(true));

    let jukebox: Jukebox = new Jukebox('Jukebox');
    jukebox.initialize();

    let soundEffect: SoundEffect = new SoundEffect('SoundEffect');
    soundEffect.initialize();

    ChatTabList.instance.addChatTab(this.i18n.t('sample.mainTab'), 'MainTab');
    let subTab = ChatTabList.instance.addChatTab(this.i18n.t('sample.subTab'), 'SubTab');
    subTab.recieveOperationLogLevel = 1;

    CutInList.instance.initialize();
    ScenePresetList.instance.initialize();
    ScenarioTextList.instance.initialize();
    const sampleScenario = ScenarioTextList.instance.addItem(this.i18n.t('sample.scenarioText'));
    sampleScenario.body = this.i18n.t('sample.scenarioTextBody');
    AuraNameConfig.instance;
    CombatTracker.instance;
    SceneToolPermission.instance;

    let sampleDiceRollTable = new DiceRollTable('SampleDiceRollTable');
    sampleDiceRollTable.initialize();
    sampleDiceRollTable.name = this.i18n.t('sample.diceTable')
    sampleDiceRollTable.command = 'SAMPLE'
    sampleDiceRollTable.dice = '1d6';
    sampleDiceRollTable.value = this.i18n.t('sample.diceTableValue');
    DiceRollTableList.instance.addDiceRollTable(sampleDiceRollTable);

    let fileContext = ImageFile.createEmpty('none_icon').toContext();
    fileContext.url = './assets/images/ic_account_circle_black_24dp_2x.png';
    let noneIconImage = ImageStorage.instance.add(fileContext);
    ImageTag.create(noneIconImage.identifier).tag = this.i18n.t('sample.tagIcon');

    fileContext = ImageFile.createEmpty('stand_no_image').toContext();
    fileContext.url = './assets/images/nc96424.png';
    let standNoIconImage = ImageStorage.instance.add(fileContext);
    ImageTag.create(standNoIconImage.identifier).tag = this.i18n.t('sample.tagStand');

    try {
      localForage.getItem(AudioPlayer.MAIN_VOLUME_LOCAL_STORAGE_KEY).then(volume => { 
        if (typeof volume === 'number' && 0 <= volume && volume <= 1) AudioPlayer.volume = volume;
      });
      localForage.getItem(AudioPlayer.AUDITION_VOLUME_LOCAL_STORAGE_KEY).then(volume => {
        if (typeof volume === 'number' && 0 <= volume && volume <= 1) AudioPlayer.auditionVolume = volume;
      });
      localForage.getItem(AudioPlayer.SOUND_EFFECT_VOLUME_LOCAL_STORAGE_KEY).then(volume => {
        if (typeof volume === 'number' && 0 <= volume && volume <= 1) AudioPlayer.soundEffectVolume = volume;
      });
      localForage.getItem(AudioPlayer.NOTICE_VOLUME_LOCAL_STORAGE_KEY).then(volume => {
        if (typeof volume === 'number' && 0 <= volume && volume <= 1) AudioPlayer.noticeVolume = volume;
      });
      localForage.getItem(AudioPlayer.AMBIENT_VOLUME_LOCAL_STORAGE_KEY).then(volume => {
        if (typeof volume === 'number' && 0 <= volume && volume <= 1) AudioPlayer.ambientVolume = volume;
      });
      localForage.getItem(AudioPlayer.MAIN_IS_MUTE_LOCAL_STORAGE_KEY).then(isMute => AudioPlayer.isMute = !!isMute);
      localForage.getItem(AudioPlayer.AUDITION_IS_MUTE_LOCAL_STORAGE_KEY).then(isMute => AudioPlayer.isAuditionMute = !!isMute);
      localForage.getItem(AudioPlayer.SOUND_EFFECT_IS_MUTE_LOCAL_STORAGE_KEY).then(isMute => AudioPlayer.isSoundEffectMute = !!isMute);
      localForage.getItem(AudioPlayer.NOTICE_IS_MUTE_LOCAL_STORAGE_KEY).then(isMute => AudioPlayer.isNoticeMute = !!isMute);
      localForage.getItem(AudioPlayer.AMBIENT_IS_MUTE_LOCAL_STORAGE_KEY).then(isMute => AudioPlayer.isAmbientMute = !!isMute);
      localForage.getItem(ChatWindowComponent.CHAT_IS_NOTICE_ON_LOCAL_STORAGE_KEY).then(isNoticeOn => {
        // Default ON when unset; honor explicit boolean from storage.
        ChatWindowComponent.isNoticeOn = isNoticeOn == null ? true : !!isNoticeOn;
      });
      localForage.getItem(ChatWindowComponent.CHAT_IS_LEFT_ONLY_LOCAL_STORAGE_KEY).then(isLeftOnly => {
        // Default ON (always left) when unset; honor explicit boolean from storage.
        ChatWindowComponent.isLeftOnly = isLeftOnly == null ? true : !!isLeftOnly;
      });
      localForage.getItem(ChatWindowComponent.CHAT_AUTO_POPUP_LOCAL_STORAGE_KEY).then(isAutoPopup => ChatWindowComponent.isAutoPopup = !!isAutoPopup);
      localForage.getItem(ChatWindowComponent.CHAT_SKIP_EMPTY_QUOTES_LOCAL_STORAGE_KEY).then(skip => {
        const on = skip == null ? true : !!skip;
        ChatWindowComponent.skipEmptyDialogQuotes = on;
        setSkipEmptyDialogQuotes(on);
      });
      PanelService.loadGeometryFromStorage();
      ChatWindowComponent.loadGeometryFromStorage();
    } catch(e) {
      console.log(e);
    }

    AudioPlayer.resumeAudioContext();
    PresetSound.dicePick = AudioStorage.instance.add('./assets/sounds/soundeffect-lab/shoulder-touch1.mp3').identifier;
    PresetSound.dicePut = AudioStorage.instance.add('./assets/sounds/soundeffect-lab/book-stack1.mp3').identifier;
    PresetSound.diceRoll1 = AudioStorage.instance.add('./assets/sounds/on-jin/spo_ge_saikoro_teburu01.mp3').identifier;
    PresetSound.diceRoll2 = AudioStorage.instance.add('./assets/sounds/on-jin/spo_ge_saikoro_teburu02.mp3').identifier;
    PresetSound.cardDraw = AudioStorage.instance.add('./assets/sounds/soundeffect-lab/card-turn-over1.mp3').identifier;
    PresetSound.cardPick = AudioStorage.instance.add('./assets/sounds/soundeffect-lab/shoulder-touch1.mp3').identifier;
    PresetSound.cardPut = AudioStorage.instance.add('./assets/sounds/soundeffect-lab/book-stack1.mp3').identifier;
    PresetSound.cardShuffle = AudioStorage.instance.add('./assets/sounds/soundeffect-lab/card-open1.mp3').identifier;
    PresetSound.piecePick = AudioStorage.instance.add('./assets/sounds/soundeffect-lab/shoulder-touch1.mp3').identifier;
    PresetSound.piecePut = AudioStorage.instance.add('./assets/sounds/soundeffect-lab/book-stack1.mp3').identifier;
    PresetSound.blockPick = AudioStorage.instance.add('./assets/sounds/tm2/tm2_pon002.wav').identifier;
    PresetSound.blockPut = AudioStorage.instance.add('./assets/sounds/tm2/tm2_pon002.wav').identifier;
    PresetSound.lock = AudioStorage.instance.add('./assets/sounds/tm2/tm2_switch001.wav').identifier;
    PresetSound.unlock = AudioStorage.instance.add('./assets/sounds/tm2/tm2_switch001.wav').identifier;
    PresetSound.sweep = AudioStorage.instance.add('./assets/sounds/tm2/tm2_swing003.wav').identifier;
    PresetSound.puyon = AudioStorage.instance.add('./assets/sounds/soundeffect-lab/puyon1.mp3').identifier;
    PresetSound.surprise = AudioStorage.instance.add('./assets/sounds/otologic/Onmtp-Surprise02-1.mp3').identifier;
    PresetSound.coinToss = AudioStorage.instance.add('./assets/sounds/niconicomons/nc146227.mp3').identifier;
    PresetSound.selectionStart = AudioStorage.instance.add('./assets/sounds/soundeffect-lab/decision50.mp3').identifier;
    PresetSound.ping = AudioStorage.instance.add('./assets/sounds/otologic/Onmtp-Surprise02-1.mp3').identifier;

    AudioStorage.instance.get(PresetSound.dicePick).isHidden = true;
    AudioStorage.instance.get(PresetSound.dicePut).isHidden = true;
    AudioStorage.instance.get(PresetSound.diceRoll1).isHidden = true;
    AudioStorage.instance.get(PresetSound.diceRoll2).isHidden = true;
    AudioStorage.instance.get(PresetSound.cardDraw).isHidden = true;
    AudioStorage.instance.get(PresetSound.cardPick).isHidden = true;
    AudioStorage.instance.get(PresetSound.cardPut).isHidden = true;
    AudioStorage.instance.get(PresetSound.cardShuffle).isHidden = true;
    AudioStorage.instance.get(PresetSound.piecePick).isHidden = true;
    AudioStorage.instance.get(PresetSound.piecePut).isHidden = true;
    AudioStorage.instance.get(PresetSound.blockPick).isHidden = true;
    AudioStorage.instance.get(PresetSound.blockPut).isHidden = true;
    AudioStorage.instance.get(PresetSound.lock).isHidden = true;
    AudioStorage.instance.get(PresetSound.unlock).isHidden = true;
    AudioStorage.instance.get(PresetSound.sweep).isHidden = true
    AudioStorage.instance.get(PresetSound.puyon).isHidden = true;
    AudioStorage.instance.get(PresetSound.surprise).isHidden = true;
    AudioStorage.instance.get(PresetSound.coinToss).isHidden = true;
    AudioStorage.instance.get(PresetSound.sweep).isHidden = true;
    AudioStorage.instance.get(PresetSound.selectionStart).isHidden = true;
    AudioStorage.instance.get(PresetSound.ping).isHidden = true;

    PeerCursor.createMyCursor().then(() => {
      if (!PeerCursor.myCursor.imageIdentifier) PeerCursor.myCursor.imageIdentifier = noneIconImage.identifier;
    });

    EventSystem.register(this)
      .on('UPDATE_GAME_OBJECT', event => { this.lazyNgZoneUpdate(event.isSendFromSelf); })
      .on('DELETE_GAME_OBJECT', event => { this.lazyNgZoneUpdate(event.isSendFromSelf); })
      .on('UPDATE_SELECTION', event => { this.lazyNgZoneUpdate(event.isSendFromSelf); })
      .on('SYNCHRONIZE_AUDIO_LIST', event => { if (event.isSendFromSelf) this.lazyNgZoneUpdate(false); })
      .on('SYNCHRONIZE_FILE_LIST', event => { if (event.isSendFromSelf) this.lazyNgZoneUpdate(false); })
      .on<AppConfig>('LOAD_CONFIG', event => {
        console.log('LOAD_CONFIG !!!', event.data);
        if (event.data.dice && event.data.dice.url) {
          const API_VERSION = event.data.dice.api;
          const langSortOrder = ['A', 'English', 'ChineseTraditional', 'SimplifiedChinese', 'Korean', 'Other'];
          //console.log(api)
          // TODO: 還沒想到合適的 BCDice-API 管理者資訊顯示 UI，暫緩
          //fetch(event.data.dice.url + '/v1/admin', {mode: 'cors'})
          //  .then(response => { return response.json() })
          //  .then(infos => { DiceBot.adminUrl = infos.url });
          fetch(event.data.dice.url + (API_VERSION == 1 ? '/v1/names' : '/v2/game_system'), {mode: 'cors'})
            .then(response => { return response.json() })
            .then(infos => {
              let apiUrl = event.data.dice.url;
              DiceBot.apiUrl = apiUrl.endsWith('/') ? apiUrl.substring(0, apiUrl.length - 1) : apiUrl;
              DiceBot.apiVersion = API_VERSION;
              DiceBot.diceBotInfos = [];
              let tempInfos = (API_VERSION == 1 ? infos.names : infos.game_system)
                .filter(info => (API_VERSION == 1 ? info.system : info.id) != 'DiceBot')
                .map(info => {
                  let normalize = (info.sort_key && info.sort_key.indexOf('国際化') < 0) ? info.sort_key : info.name.normalize('NFKD');
                  for (let replaceData of DiceBot.replaceData) {
                    if (replaceData[2] && info.name === replaceData[0]) {
                      normalize = replaceData[1];
                      info.name = replaceData[2];
                    }
                    normalize = normalize.split(replaceData[0].normalize('NFKD')).join(replaceData[1].normalize('NFKD'));
                  }
                  info.normalize = normalize.replace(/[\u3041-\u3096]/g, m => String.fromCharCode(m.charCodeAt(0) + 0x60))
                    .replace(/第(.+?)版/g, 'タイ$1ハン')
                    .replace(/[・!?！？\s　:：=＝\/／（）\(\)]+/g, '')
                    .replace(/([アカサタナハマヤラワ])ー+/g, '$1ア')
                    .replace(/([イキシチニヒミリ])ー+/g, '$1イ')
                    .replace(/([ウクスツヌフムユル])ー+/g, '$1ウ')
                    .replace(/([エケセテネヘメレ])ー+/g, '$1エ')
                    .replace(/([オコソトノホモヨロ])ー+/g, '$1オ')
                    .replace(/ン+ー+/g, 'ン')
                    .replace(/ン+/g, 'ン');
                  return info;
                })
                .map(info => {
                  const lang = /.+\:(.+)/.exec((API_VERSION == 1 ? info.system : info.id));
                  info.lang = lang ? lang[1] : 'A';
                  return info;
                })
                .sort((a, b) => {
                  return langSortOrder.indexOf(a.lang) < langSortOrder.indexOf(b.lang) ? -1 
                    : langSortOrder.indexOf(a.lang) > langSortOrder.indexOf(b.lang) ? 1
                    : a.normalize == b.normalize ? 0 
                    : a.normalize < b.normalize ? -1 : 1;
                });
              DiceBot.diceBotInfos = [];
              DiceBot.diceBotInfosIndexed = [];
              DiceBot.diceBotInfos.push(...tempInfos.map(info => { return { id: (API_VERSION == 1 ? info.system : info.id), game: info.name } }));
              if (tempInfos.length > 0) {
                let sentinel = tempInfos[0].normalize.substring(0, 1);
                let group = { index: tempInfos[0].normalize.substring(0, 1), infos: [] };
                for (let info of tempInfos) {
                  let index = info.lang == 'Other' ? this.i18n.t('lang.other')
                    : info.lang == 'ChineseTraditional' ? this.i18n.t('lang.zhTW')
                    : info.lang == 'Korean' ? this.i18n.t('lang.ko')
                    : info.lang == 'English' ? this.i18n.t('lang.en')
                    : info.lang == 'SimplifiedChinese' ? this.i18n.t('lang.zhCN')
                    : info.normalize.substring(0, 1);
                  if (index !== sentinel) {
                    sentinel = index;
                    DiceBot.diceBotInfosIndexed.push(group);
                    group = { index: index, infos: [] };
                  }
                  group.infos.push({ id: (API_VERSION == 1 ? info.system : info.id), game: info.name });
                }
                DiceBot.diceBotInfosIndexed.push(group);
                //DiceBot.diceBotInfosIndexed.sort((a, b) => a.index == b.index ? 0 : a.index < b.index ? -1 : 1);
              }
            });
        }
        console.log('LOAD_CONFIG !!!');
        Network.configure(event.data);
        Network.open();
      })
      .on<File>('FILE_LOADED', event => {
        this.lazyNgZoneUpdate(false);
      })
      .on('OPEN_NETWORK', event => {
        console.log('OPEN_NETWORK', event.data.peerId);
        PeerCursor.myCursor.peerId = Network.peer.peerId;
        PeerCursor.myCursor.userId = Network.peer.userId;
        this.isLoggedin = false;
        if (!this.inviteHandled && !Network.peer.isRoom) {
          this.inviteHandled = true;
          this.ngZone.run(async () => {
            await this.tryConsumeInvite();
            if (!Network.peer?.isRoom) this.openLobbyIfNeeded();
          });
        } else if (!Network.peer.isRoom) {
          this.ngZone.run(() => this.openLobbyIfNeeded());
        }
      })
      .on('ROOM_REKEY', event => {
        // GM changed room auth; reopen into the new encoded roomName.
        if (event.isSendFromSelf) return;
        const roomId = event.data?.roomId;
        const roomName = event.data?.roomName;
        if (!roomId || !roomName) return;
        if (!Network.peer?.isRoom || Network.peer.roomId !== roomId) return;
        if (Network.peer.roomName === roomName) return;
        this.ngZone.run(() => {
          RoomConnectHelper.rekeyRoom(roomId, roomName).catch(e => console.warn('ROOM_REKEY failed', e));
        });
      })
      .on('KICK_PEER', event => {
        if (event.isSendFromSelf) return;
        const byName = String(event.data?.byName || '').trim();
        this.ngZone.run(() => {
          void this.handleKicked(byName);
        });
      })
      .on('NETWORK_ERROR', event => {
        console.log('NETWORK_ERROR', event.data.peerId);
        let errorType: string = event.data.errorType;
        let errorMessage: string = event.data.errorMessage;

        this.ngZone.run(async () => {
          // SkyWay error handling
          let quietErrorTypes = ['peer-unavailable'];
          // Only auto-retry transient network drops. Backend/auth failures need config fixes.
          let reconnectErrorTypes = ['disconnected', 'socket-error', 'unavailable-id'];
          let configErrorTypes = ['server-error', 'authentication', 'token-expired'];

          if (quietErrorTypes.includes(errorType)) return;
          await this.modalService.open(TextViewComponent, { title: this.i18n.t('net.errorTitle'), text: errorMessage });

          if (configErrorTypes.includes(errorType)) {
            await this.modalService.open(TextViewComponent, {
              title: this.i18n.t('net.errorTitle'),
              text: this.i18n.t('net.backendHelp')
            });
            this.isLoggedin = false;
            return;
          }

          if (!reconnectErrorTypes.includes(errorType)) return;
          await this.modalService.open(TextViewComponent, { title: this.i18n.t('net.errorTitle'), text: this.i18n.t('net.reconnectHint') });
          Network.open();
          this.isLoggedin = false;
        });
      })
      .on('CONNECT_PEER', event => {
        if (event.isSendFromSelf) { 
          this.chatMessageService.calibrateTimeOffset();
          if (!this.isLoggedin) {
            this.isLoggedin = true;
            chatMessageService.sendOperationLog(this.isRoom ? this.i18n.t('net.connectedRoom', { name: Network.peer.roomName }) : this.i18n.t('net.connectedPeer'));
          }
        }
        this.lazyNgZoneUpdate(event.isSendFromSelf);
      })
      .on('DISCONNECT_PEER', event => {
        this.lazyNgZoneUpdate(event.isSendFromSelf);
        if (event.isSendFromSelf) this.isLoggedin = false;
      })
      .on('MESSAGE_NORTIFICATION', event => {
        //console.log(event)
        /* 暫緩
        try {
          Notification.requestPermission().then((permission) => {
            if (permission === 'granted') {
              const tab = <ChatTab>ObjectStore.instance.get(event.data.tabIdentifier);
              const message = <ChatMessage>ObjectStore.instance.get(event.data.messageIdentifier);
              if (tab && message) {
                const option: { body: string, icon?: string, tag?: string } = { body: message.plainText(), tag: 'chat-message' };
                const image = message.image;
                if (image) option.icon = message.image.url;
                const notification = new Notification(tab.name + ' - ' + message.name + (message.toColor ? (' ➡ ' + message.toName + ' ' + this.i18n.t('net.whisper')) : ''), option);
                document.addEventListener('visibilitychange', () => {
                  if (document.visibilityState === 'visible') notification.close();
                });
              }
            }
          });
        } catch(e) {
          console.log(e);
        }
        */
        this.lazyNgZoneUpdate(true);
        if (ChatWindowComponent.isAutoPopup && !PanelService.isTourPanelOpen('menu.chat')) {
          this.ngZone.run(() => this.open('ChatWindowComponent'));
        }
        // 設定是否應交給 UI 元件持有？
        if (ChatWindowComponent.isNoticeOn) {
          if (event.data?.isDirect || !this.noticeIntervalTimer) {
            clearTimeout(this.noticeIntervalTimer);
            this.noticeIntervalTimer = setTimeout(() => {
              clearTimeout(this.noticeIntervalTimer);
              this.noticeIntervalTimer = null;
            }, 100);
            this.notice();
          }
        } else if (this.noticeIntervalTimer) {
          clearTimeout(this.noticeIntervalTimer);
          this.noticeIntervalTimer = null;
        }
      })
      .on('MESSAGE_ADDED', () => {
        this.lazyNgZoneUpdate(true);
      })
      .on('CHAT_PANEL_CHANGED', () => {
        this.lazyNgZoneUpdate(true);
      })
      .on('PLAY_CUT_IN', -1000, event => {
        let cutIn = ObjectStore.instance.get<CutIn>(event.data.identifier);
        this.cutInService.play(cutIn, event.data.secret ? event.data.secret : false, event.data.test ? event.data.test : false, event.data.sender);
      })
      .on('STOP_CUT_IN', -1000, event => {
        this.cutInService.stop(event.data.identifier);
      })
      .on('POPUP_STAND_IMAGE', -1000, event => {
        let standElement = ObjectStore.instance.get<DataElement>(event.data.standIdentifier);
        let gameCharacter = ObjectStore.instance.get<GameCharacter>(event.data.characterIdentifier);
        this.standImageService.show(gameCharacter, standElement, event.data.color ? event.data.color : null, event.data.secret);
      })
      .on('FAREWELL_STAND_IMAGE', -1000, event => {
        this.standImageService.farewell(event.data.characterIdentifier);
      })
      .on('DELETE_STAND_IMAGE', -1000, event => {
        this.standImageService.destroy(event.data.characterIdentifier, event.data.identifier);
      })
      .on('DESTORY_STAND_IMAGE_ALL', -1000, event => {
        this.standImageService.destroyAll();
      })
      .on('OPEN_COMBAT_TRACKER', -1000, () => {
        this.ngZone.run(() => {
          if (!CombatTrackerComponent.isOpen) this.open('CombatTrackerComponent');
        });
      })
      .on('OPEN_TOOLBOX', -1000, event => {
        this.ngZone.run(() => {
          // Table right-click uses OPEN_TOOLBOX + extraActions; do not gate on menu.toolbox.
          const data = event.data || {};
          this.openToolboxAt(
            { x: data.x ?? 0, y: data.y ?? 0 },
            Array.isArray(data.extraActions) ? data.extraActions : [],
            { compact: true }
          );
        });
      })
      .on('OPEN_CHAT', -1000, () => {
        this.ngZone.run(() => this.openOrToggle('ChatWindowComponent'));
      })
      .on('SHOW_CHAT', -1000, event => {
        this.ngZone.run(() => {
          const tabIdentifier = event.data?.tabIdentifier as string | undefined;
          this.showChatWindow(tabIdentifier);
        });
      });

    workaroundForMobileSafari();
  }
  
  private static readonly beforeUnloadProc = (event) => {
    event.stopImmediatePropagation();
    event.preventDefault();
    event.returnValue = '';
  };

  private readonly onWindowKeydown = (event: KeyboardEvent) => {
    const isReload =
      event.key === 'F5' ||
      ((event.ctrlKey || event.metaKey) && (event.key === 'r' || event.key === 'R'));
    if (!isReload) return;
    if (this.GuestMode()) return;
    if (this.isRefreshPromptOpen || this.isSaveing) {
      event.preventDefault();
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    this.ngZone.run(() => this.promptRefreshDownload());
  };

  private promptRefreshDownload() {
    if (this.isRefreshPromptOpen || this.GuestMode()) return;
    this.isRefreshPromptOpen = true;
    const folderReady = this.folderBackup.isReady;
    this.modalService.open(ConfirmationComponent, {
      title: this.i18n.t('menu.confirm.refresh.title'),
      text: this.i18n.t('menu.confirm.refresh.text'),
      help: this.i18n.t(folderReady ? 'menu.confirm.refresh.helpFolder' : 'menu.confirm.refresh.help'),
      type: ConfirmationType.OK_CANCEL,
      materialIcon: 'sd_storage',
      okLabel: this.i18n.t('menu.downloadZip'),
      cancelLabel: this.i18n.t('menu.confirm.refresh.reload'),
      action: () => {
        void this.saveThenReload();
      },
      cancelAction: () => {
        void this.flushFolderThenReload();
      },
    }).finally(() => {
      this.isRefreshPromptOpen = false;
    });
  }

  private async saveThenReload() {
    await this.save();
    const ok = await this.folderBackup.flush({ timeoutMs: 15000 });
    if (!ok && this.folderBackup.hasFolder) {
      const proceed = await this.confirmFlushFailedReload();
      if (!proceed) return;
    }
    this.reloadWithoutPrompt();
  }

  private async flushFolderThenReload() {
    const ok = await this.folderBackup.flush({ timeoutMs: 15000 });
    if (!ok && this.folderBackup.hasFolder && this.isRoom && !this.GuestMode()) {
      const proceed = await this.confirmFlushFailedReload();
      if (!proceed) return;
    }
    this.reloadWithoutPrompt();
  }

  private async confirmFlushFailedReload(): Promise<boolean> {
    const choice = await this.modalService.open(ConfirmationComponent, {
      title: this.i18n.t('menu.folderBackup.flushFailed.title'),
      text: this.i18n.t('menu.folderBackup.flushFailed.text'),
      help: this.folderBackup.lastError
        ? this.i18n.t('menu.folderBackup.flushFailed.helpError', { error: this.folderBackup.lastError })
        : this.i18n.t('menu.folderBackup.flushFailed.help'),
      type: ConfirmationType.OK_CANCEL,
      materialIcon: 'warning',
      okLabel: this.i18n.t('menu.folderBackup.flushFailed.reload'),
      cancelLabel: this.i18n.t('confirm.cancel'),
    });
    return choice === true;
  }

  private reloadWithoutPrompt() {
    window.removeEventListener('beforeunload', AppComponent.beforeUnloadProc);
    document.location.reload();
  }

  private async tryConsumeInvite() {
    const payload = this.roomInvite.parseInviteFromLocation();
    if (!payload) return;
    this.roomInvite.clearInviteFromLocation();

    // Modal host is wired in ngAfterViewInit; wait briefly if network opens first.
    for (let i = 0; i < 40 && !ModalService.defaultParentViewContainerRef; i++) {
      await new Promise(resolve => setTimeout(resolve, 50));
    }

    const result = await this.roomInvite.joinFromInvite(payload);
    if (result === 'ok') return;

    const errorKey = `invite.error.${result}`;
    await this.modalService.open(ConfirmationComponent, {
      title: this.i18n.t('invite.errorTitle'),
      text: this.i18n.t(errorKey),
      type: ConfirmationType.OK,
      materialIcon: 'link_off',
    });
  }

  ngOnInit() {
    window.addEventListener('beforeunload', AppComponent.beforeUnloadProc);
    window.addEventListener('keydown', this.onWindowKeydown, true);
    this.isMobileLayout = this.mobileLayout.isMobile;
    this.isTabletLandscape = this.mobileLayout.isTabletLandscape;
    this.isMobileEdit = this.mobileLayout.isMobile && this.mobileLayout.isEdit;
    // Guest cannot use Edit mode.
    if (this.GuestMode() && this.mobileLayout.isEdit) {
      this.mobileLayout.setUiMode('play');
      this.isMobileEdit = false;
    }
    this.mobileSub = this.mobileLayout.isMobile$.subscribe(v => {
      this.isMobileLayout = v;
      this.isTabletLandscape = this.mobileLayout.isTabletLandscape;
      this.isMobileEdit = v && this.mobileLayout.isEdit;
    });
    this.mobileSub.add(this.mobileLayout.chromeMode$.subscribe(() => {
      this.isTabletLandscape = this.mobileLayout.isTabletLandscape;
      this.isMobileLayout = this.mobileLayout.isMobile;
      this.isMobileEdit = this.mobileLayout.isMobile && this.mobileLayout.isEdit;
    }));
    this.mobileSub.add(this.mobileLayout.uiMode$.subscribe(() => {
      this.isMobileEdit = this.mobileLayout.isMobile && this.mobileLayout.isEdit;
    }));
  }

  ngAfterViewInit() {
    PanelService.defaultParentViewContainerRef = ModalService.defaultParentViewContainerRef = ContextMenuService.defaultParentViewContainerRef = StandImageService.defaultParentViewContainerRef = CutInService.defaultParentViewContainerRef = this.modalLayerViewContainerRef;
    queueMicrotask(() => {
      this.guidedTour.tryOfferFirstRun();
      if (!this.guidedTour.isActive) {
        this.openDefaultPanels();
      }
    });
    let tourWasActive = false;
    this.guidedTour.state$.subscribe(s => {
      const active = s.phase === 'welcome' || s.phase === 'running';
      if (active && !tourWasActive) {
        // Keep the tour unobstructed: no cold-start lobby over welcome / steps.
        this.ngZone.run(() => PanelService.closePanelsByTourId('menu.lobby'));
      }
      if (tourWasActive && !active) {
        this.ngZone.run(() => this.openDefaultPanels());
      }
      tourWasActive = active;
    });
    
    // PWA: download quietly, activate when ready; apply on next F5 / reopen (no confirm).
    let notification: Notification;
    this.swUpdate.versionUpdates.subscribe(event => {
      switch (event.type) {
        case 'VERSION_DETECTED':
          console.log(`Downloading new app version: ${event.version.hash}`);
          Notification.requestPermission().then((permission) => {
            if (permission === 'granted') {
              notification = new Notification('Udonarium with Fly', { 
                body: this.i18n.t('update.downloading'),
                icon: 'card.png'
              });
              notification.addEventListener('click', function(e) {
                e.preventDefault();
                e.stopPropagation();
                if (notification) {
                  notification.close();
                  notification = null;
                }
                return false;
              });
            }
          });
          break;
        case 'VERSION_READY':
          console.log(`Current app version: ${event.currentVersion.hash}`);
          console.log(`New app version ready for use: ${event.latestVersion.hash}`);
          void this.swUpdate.activateUpdate().then(() => {
            if (notification) {
              notification.close();
              notification = null;
            }
            console.log('New app version activated; will apply on next reload.');
          });
          break;
        case 'VERSION_INSTALLATION_FAILED':
          console.log(`Failed to install app version '${event.version.hash}': ${event.error}`);
          break;
      }
    });
  }

  ngOnDestroy() {
    EventSystem.unregister(this);
    if (this.noticeIntervalTimer) clearTimeout(this.noticeIntervalTimer);
    window.removeEventListener('keydown', this.onWindowKeydown, true);
    this.mobileSub?.unsubscribe();
  }

  open(componentName: string) {
    this.enforceGuestPlayMode();
    const menuTourId = this.tourIdForComponent(componentName);
    if (menuTourId && !this.canShowMenu(menuTourId)) return;
    let component: { new(...args: any[]): any } = null;
    let option: PanelOption = { width: 450, height: 600, left: 100 }
    switch (componentName) {
      case 'PeerMenuComponent':
        option.width = 520;
        option.title = this.i18n.t('peer.title');
        component = PeerMenuComponent;
        // Keep map visible — connection is a half sheet, not full-screen.
        if (this.mobileLayout.isMobile) option.mobileSheet = 'half';
        break;
      case 'ChatWindowComponent':
        component = ChatWindowComponent;
        ChatWindowComponent.applySavedGeometry(option);
        option.title = this.i18n.t('chat.title');
        if (this.mobileLayout.isMobile) option.mobileSheet = 'half';
        break;
      case 'GameTableSettingComponent':
        component = GameTableSettingComponent;
        option = { width: 620, height: 520, left: 100, title: this.i18n.t('table.title') };
        break;
      case 'FileStorageComponent':
        component = FileStorageComponent;
        option.width = 700;
        option.title = this.i18n.t('file.title');
        break;
      case 'GameCharacterSheetComponent':
        component = GameCharacterSheetComponent;
        break;
      case 'JukeboxComponent':
        component = JukeboxComponent;
        option.height = 540;
        option.title = this.i18n.t('jukebox.title');
        break;
      case 'GameObjectInventoryComponent':
        component = GameObjectInventoryComponent;
        option.title = this.i18n.t('inv.title');
        break;
      case 'NoteInventoryComponent':
        component = NoteInventoryComponent;
        option.title = this.i18n.t('note.title');
        break;
      case 'DiceRollTableSettingComponent':
        component = DiceRollTableSettingComponent;
        option = { width: 645, height: 475, title: this.i18n.t('diceTable.title') };
        break;
      case 'CutInSettingComponent':
        component = CutInSettingComponent;
        option = { width: 700, height: 600, title: this.i18n.t('cutin.title') };
        break;
      case 'CombatTrackerComponent':
        component = CombatTrackerComponent;
        option = { width: 520, height: 640, left: 100, title: this.i18n.t('combat.title') };
        if (this.mobileLayout.isMobile && this.mobileLayout.isPlay) option.mobileSheet = 'half';
        break;
      case 'SceneToolsComponent':
        if (!SceneToolPermission.instance.canOpenPanel) return;
        component = SceneToolsComponent;
        option = {
          width: 380,
          height: 560,
          left: 100,
          title: this.i18n.t(PeerCursor.myCursor?.isGMMode ? 'scene.titleGm' : 'scene.title'),
        };
        break;
      case 'ScenePresetComponent':
        component = ScenePresetComponent;
        option = { width: 520, height: 560, left: 100, title: this.i18n.t('scenePreset.title') };
        break;
      case 'ScenarioTextComponent':
        component = ScenarioTextComponent;
        option = { width: 520, height: 560, left: 100, title: this.i18n.t('scenarioText.title') };
        break;
    }
    if (component) {
      const tourId = this.tourIdForComponent(componentName);
      // Chat windows may open multiple copies (different tabs / positions).
      const allowMultiple = componentName === 'ChatWindowComponent' && !this.mobileLayout.isMobile;
      if (tourId) {
        if (!allowMultiple) PanelService.closePanelsByTourId(tourId);
        option.tourPanelId = tourId;
      }
      if (!this.mobileLayout.isMobile) {
        if (componentName === 'ChatWindowComponent') {
          // Keep remembered chat geometry; nudge duplicates so they don't fully stack.
          const chatOpenCount = PanelService.openPanelsByTourId('menu.chat');
          if (chatOpenCount > 0) {
            option.left = (option.left ?? ChatWindowComponent.DEFAULT_LEFT) + chatOpenCount * 24;
            option.top = (option.top ?? ChatWindowComponent.DEFAULT_TOP) + chatOpenCount * 24;
          }
        } else {
          const geoKey = PanelService.resolveGeometryKey(option);
          const saved = geoKey ? PanelService.getGeometry(geoKey) : null;
          const hasSavedPos = !!(saved
            && typeof saved.left === 'number' && Number.isFinite(saved.left)
            && typeof saved.top === 'number' && Number.isFinite(saved.top));
          if (!hasSavedPos) {
            option.top = (this.openPanelCount % 10 + 1) * 20;
            option.left = 100 + (this.openPanelCount % 20 + 1) * 5;
            this.openPanelCount = this.openPanelCount + 1;
          }
        }
      } else {
        // Bottom-nav open: replace any existing sheet so the nav stays usable.
        option.mobileReplace = true;
        // Inventory / notes / table / etc. all open as half sheet (map stays visible).
        if (!option.mobileSheet) option.mobileSheet = 'half';
      }
      option = this.mobileLayout.adaptPanelOption(option);
      this.panelService.open(component, option);
      if (tourId) this.guidedTour.notifyPanelOpened(tourId);
      if (componentName === 'ChatWindowComponent') {
        EventSystem.trigger('CHAT_PANEL_CHANGED', null);
      }
    }
  }

  private async openDefaultPanels() {
    await PanelService.geometryReady;
    await ChatWindowComponent.geometryReady;
    this.panelService.open(PeerMenuComponent, this.mobileLayout.adaptPanelOption({
      width: 520, height: 450, left: 100,
      tourPanelId: 'menu.connection',
      title: this.i18n.t('peer.title'),
      mobileReplace: true,
      mobileSheet: 'half',
    }));
    // On mobile, only open connection by default — chat opens on demand to keep the map usable.
    if (!this.mobileLayout.isMobile) {
      this.panelService.open(ChatWindowComponent, ChatWindowComponent.applySavedGeometry({
        tourPanelId: 'menu.chat',
        title: this.i18n.t('chat.title'),
      }));
    }
    if (Network.isOpen && !Network.peer?.isRoom) {
      this.openLobbyIfNeeded();
    }
  }

  /** Show lobby once on cold start when not already in a room / invite join. */
  private openLobbyIfNeeded() {
    if (this.lobbyAutoOpened) return;
    if (this.guidedTour.isActive) return;
    if (!PanelService.defaultParentViewContainerRef) return;
    if (!Network.isOpen || Network.peer?.isRoom) return;
    if (this.roomInvite.parseInviteFromLocation()) return;
    this.lobbyAutoOpened = true;
    // Normal UI panel (not modal): no overlay / focus trap; map stays usable.
    PanelService.closePanelsByTourId('menu.lobby');
    this.panelService.open(LobbyComponent, LobbyComponent.centeredPanelOption({
      title: this.i18n.t('lobby.title'),
    }));
  }

  private tourIdForComponent(componentName: string): string | null {
    switch (componentName) {
      case 'PeerMenuComponent': return 'menu.connection';
      case 'ChatWindowComponent': return 'menu.chat';
      case 'GameTableSettingComponent': return 'menu.table';
      case 'FileStorageComponent': return 'menu.images';
      case 'JukeboxComponent': return 'menu.music';
      case 'CombatTrackerComponent': return 'menu.combat';
      case 'SceneToolsComponent': return 'menu.sceneTools';
      case 'ScenePresetComponent': return 'menu.scenePreset';
      case 'ScenarioTextComponent': return 'menu.scenarioText';
      case 'GameObjectInventoryComponent': return 'menu.inventory';
      case 'NoteInventoryComponent': return 'menu.notes';
      default: return null;
    }
  }

  isNavActive(tourId: string): boolean {
    if (!this.isMobileLayout) return false;
    if (tourId === 'menu.more') return this.contextMenuService.isShow;
    return PanelService.isTourPanelOpen(tourId);
  }

  /**
   * Menu icon: open if closed; if open and already frontmost, close;
   * if open but behind another panel, bring to front (chat on desktop always opens).
   */
  openOrToggle(componentName: string) {
    this.enforceGuestPlayMode();
    const isChat = componentName === 'ChatWindowComponent';
    // Desktop chat can open multiple windows — never toggle-close from the menu.
    if (!this.mobileLayout.isMobile && isChat) {
      this.open(componentName);
      return;
    }
    const tourId = this.tourIdForComponent(componentName);
    if (tourId && PanelService.isTourPanelOpen(tourId)) {
      if (PanelService.isTourPanelTopmost(tourId)) {
        PanelService.closePanelsByTourId(tourId);
        // Dismiss More / toolbox sheets so a re-tap does not feel like a re-open.
        this.contextMenuService.close();
      } else {
        PanelService.bringTourPanelToFront(tourId);
      }
      return;
    }
    this.open(componentName);
  }

  /** Open chat if needed, bring to front (never close), optionally select a tab. */
  showChatWindow(tabIdentifier?: string) {
    this.enforceGuestPlayMode();
    if (!this.canShowMenu('menu.chat')) return;
    if (tabIdentifier) {
      ChatWindowComponent.pendingTabIdentifier = tabIdentifier;
    }
    if (PanelService.isTourPanelOpen('menu.chat')) {
      PanelService.bringTourPanelToFront('menu.chat');
    } else {
      this.open('ChatWindowComponent');
    }
    if (tabIdentifier) {
      queueMicrotask(() => EventSystem.trigger('SELECT_CHAT_TAB', { tabIdentifier }));
    }
  }

  setMobileUiMode(mode: 'play' | 'edit') {
    if (!this.mobileLayout.isMobile) return;
    if (mode === 'edit' && this.GuestMode()) return;
    PanelService.closeAllPanels();
    this.contextMenuService.close();
    this.mobileLayout.setUiMode(mode);
    this.isMobileEdit = mode === 'edit';
  }

  /** If identity becomes Guest while Edit is sticky, force Play + close sheets. */
  private enforceGuestPlayMode() {
    if (!this.mobileLayout.isMobile || !this.GuestMode() || !this.mobileLayout.isEdit) return;
    PanelService.closeAllPanels();
    this.mobileLayout.setUiMode('play');
    this.isMobileEdit = false;
  }

  GuestMode() {
    return Network.GuestMode();
  }

  async save() {
    if (this.isSaveing || this.GuestMode()) return;
    this.isSaveing = true;
    this.progresPercent = 0;
    let roomName = 0 < Network.peer.roomName.length
      ? Network.peer.roomName
      : 'HKTRPG';
    await this.saveDataService.saveRoomAsync(roomName, percent => {
      this.progresPercent = percent;
    });

    setTimeout(() => {
      this.isSaveing = false;
      this.progresPercent = 0;
    }, 500);
  }

  handleFileSelect(event: Event) {
    let input = <HTMLInputElement>event.target;
    let files = input.files;
    if (files.length) FileArchiver.instance.load(files);
    input.value = '';
  }

  private lazyNgZoneUpdate(isImmediate: boolean) {
    if (isImmediate) {
      if (this.immediateUpdateTimer !== null) return;
      this.immediateUpdateTimer = setTimeout(() => {
        this.immediateUpdateTimer = null;
        if (this.lazyUpdateTimer != null) {
          clearTimeout(this.lazyUpdateTimer);
          this.lazyUpdateTimer = null;
        }
        this.ngZone.run(() => { });
      }, 0);
    } else {
      if (this.lazyUpdateTimer !== null) return;
      this.lazyUpdateTimer = setTimeout(() => {
        this.lazyUpdateTimer = null;
        if (this.immediateUpdateTimer != null) {
          clearTimeout(this.immediateUpdateTimer);
          this.immediateUpdateTimer = null;
        }
        this.ngZone.run(() => { });
      }, 100);
    }
  }

  toolBox(event: Event) {
    this.guidedTour.notifyMenuClick('menu.toolbox');
    if (!this.canShowMenu('menu.toolbox')) return;
    if (this.contextMenuService.isShow) {
      this.contextMenuService.close();
      return;
    }
    const button = <HTMLElement>event.target;
    const clientRect = button.getBoundingClientRect();
    const position = this.isMobileLayout
      ? {
          x: window.pageXOffset + clientRect.left,
          y: Math.max(8, window.pageYOffset + clientRect.top - this.mobileLayout.bottomChromePx),
        }
      : {
          x: window.pageXOffset + clientRect.left + (this.isHorizontal ? 0 : button.clientWidth * 0.9),
          y: window.pageYOffset + clientRect.top + (this.isHorizontal ? button.clientHeight * 0.9 : 0)
        };
    this.openToolboxAt(position);
  }

  /** Mobile primary-nav "More" — mode-aware secondary actions; tap again to collapse. */
  openMoreMenu(event: Event) {
    this.enforceGuestPlayMode();
    this.guidedTour.notifyMenuClick('menu.more');
    // Second tap on More closes the action sheet (outside-click ignores this button).
    if (this.contextMenuService.isShow) {
      this.contextMenuService.close();
      return;
    }
    const button = <HTMLElement>event.target;
    const clientRect = button.getBoundingClientRect();
    const position = {
      x: window.pageXOffset + clientRect.left,
      y: Math.max(8, window.pageYOffset + clientRect.top - this.mobileLayout.bottomChromePx),
    };
    const menu: ContextMenuAction[] = [];
    if (this.isMobileEdit) {
      menu.push({
        name: this.i18n.t('menu.mode.exitEdit'),
        materialIcon: 'sports_esports',
        action: () => this.setMobileUiMode('play'),
      });
      menu.push(ContextMenuSeparator);
      if (this.canShowMenu('menu.toolbox')) {
        menu.push({ name: this.i18n.t('menu.toolbox'), materialIcon: 'build', action: () => this.openToolboxAt(position) });
      }
      if (this.canShowMenu('menu.sceneTools')) {
        menu.push({ name: this.i18n.t('menu.sceneTools'), materialIcon: 'architecture', action: () => this.openOrToggle('SceneToolsComponent') });
      }
      if (this.canShowMenu('menu.scenePreset')) {
        menu.push({ name: this.i18n.t('menu.scenePreset'), materialIcon: 'theaters', action: () => this.openOrToggle('ScenePresetComponent') });
      }
      if (this.canShowMenu('menu.scenarioText')) {
        menu.push({ name: this.i18n.t('menu.scenarioText'), materialIcon: 'menu_book', action: () => this.openOrToggle('ScenarioTextComponent') });
      }
    } else {
      if (!this.GuestMode()) {
        menu.push({
          name: this.i18n.t('menu.mode.enterEdit'),
          materialIcon: 'edit',
          action: () => this.setMobileUiMode('edit'),
        });
        menu.push(ContextMenuSeparator);
        if (this.canShowMenu('menu.toolbox')) {
          menu.push({ name: this.i18n.t('menu.toolbox'), materialIcon: 'build', action: () => this.openToolboxAt(position) });
        }
        if (this.canShowMenu('menu.notes')) {
          menu.push({ name: this.i18n.t('menu.notes'), materialIcon: 'note', action: () => this.openOrToggle('NoteInventoryComponent') });
        }
      }
      if (this.canShowMenu('menu.sceneTools')) {
        menu.push({ name: this.i18n.t('menu.sceneTools'), materialIcon: 'architecture', action: () => this.openOrToggle('SceneToolsComponent') });
      }
    }
    menu.push(ContextMenuSeparator);
    Array.prototype.push.apply(menu, this.buildAlwaysAvailableViewActions());
    menu.push(ContextMenuSeparator);
    // Force-open: standSetteings() would toggle-close while More is still showing.
    menu.push({ name: this.i18n.t('menu.settings'), materialIcon: 'how_to_reg', action: () => this.openSettingsAt(position) });
    menu.push({ name: this.i18n.t('menu.disconnect'), materialIcon: 'logout', action: () => this.logout() });
    this.contextMenuService.open(position, menu, this.i18n.t('menu.more'));
  }

  private openToolboxAt(
    position: { x: number, y: number },
    extraActions: ContextMenuAction[] = [],
    options?: { compact?: boolean }
  ) {
    // Full toolbox needs menu.toolbox. View reset / close panels are always available.
    const includeToolbox = this.canShowMenu('menu.toolbox');
    const menu: ContextMenuAction[] = includeToolbox
      ? this.buildToolboxMenuActions(!!options?.compact)
      : this.buildAlwaysAvailableViewActions();
    if (extraActions.length) {
      if (menu.length) menu.push(ContextMenuSeparator);
      Array.prototype.push.apply(menu, extraActions);
    }
    if (menu.length < 1) return;
    this.contextMenuService.open(
      position,
      menu,
      includeToolbox ? this.i18n.t('menu.toolbox') : this.i18n.t('menu.title'),
    );
  }

  /** Local view helpers — never gated by toolbox menu permission. */
  private buildAlwaysAvailableViewActions(): ContextMenuAction[] {
    const menu: ContextMenuAction[] = [{
      name: this.i18n.t('menu.viewReset'),
      materialIcon: 'remove_red_eye',
      selfOnly: true,
      subActions: [
        { name: this.i18n.t('menu.viewReset.default'), action: () => EventSystem.trigger('RESET_POINT_OF_VIEW', null) },
        { name: this.i18n.t('menu.viewReset.top'), action: () => EventSystem.trigger('RESET_POINT_OF_VIEW', 'top') }
      ]
    }];
    // Desktop only — mobile sheets replace each other via bottom nav.
    if (!this.mobileLayout.isMobile) {
      menu.push({
        name: this.i18n.t('toolbox.closeAllPanels'),
        materialIcon: 'close_fullscreen',
        selfOnly: true,
        action: () => PanelService.closeAllPanels()
      });
    }
    return menu;
  }

  private buildToolboxMenuActions(compact: boolean = false): ContextMenuAction[] {
    const menu: ContextMenuAction[] = [];
    if (!compact) {
      const cunIns = CutInList.instance.cutIns;
      menu.push({ name: this.i18n.t('toolbox.playCutIn'), materialIcon: 'play_arrow',
        action: null, subActions: cunIns.length === 0 ? [
          {
            name: this.i18n.t('toolbox.noCutIn'),
            disabled: true,
            center: true
          }
        ] : cunIns.map(cutIn => {
          return {
            name: `${cutIn.isValidAudio ? '' : '⚠️'}${cutIn.name == '' ? this.i18n.t('toolbox.unnamedCutIn') : cutIn.name}`,
            subActions: [{
                name: this.i18n.t('cutin.all'),
                action: () => {
                  EventSystem.call('PLAY_CUT_IN', {
                    identifier: cutIn.identifier,
                    secret: false,
                    sender: PeerCursor.myCursor.peerId
                  });
                  this.chatMessageService.sendOperationLog(this.i18n.t('toolbox.played', { name: cutIn.name == '' ? this.i18n.t('toolbox.unnamedCutIn') : cutIn.name }));
                }
              }, ContextMenuSeparator, ...this.otherPeers.map(peer => {
              return {
                name: peer.name + (peer === PeerCursor.myCursor ? ' ' + this.i18n.t('cutin.you') : ''),
                color: peer.color,
                default: true,
                action: () => {
                  if (peer !== PeerCursor.myCursor) {
                    EventSystem.call('PLAY_CUT_IN', {
                      identifier: cutIn.identifier,
                      secret: true,
                      sender: PeerCursor.myCursor.peerId
                    }, peer.peerId);
                  }
                  EventSystem.call('PLAY_CUT_IN', {
                    identifier: cutIn.identifier,
                    secret: true,
                    sender: PeerCursor.myCursor.peerId
                  }, PeerCursor.myCursor.peerId);
                }
              }
            })]
          };
        })
      });
      menu.push(ContextMenuSeparator);
    }
    menu.push(this.makeWeatherToolboxMenu());
    menu.push(this.makeDayNightToolboxMenu());
    if (!compact) {
      menu.push(ContextMenuSeparator);
      menu.push({ name: this.i18n.t('toolbox.cutInSettings'), materialIcon: 'movie_creation', action: () => this.open('CutInSettingComponent') });
      menu.push({ name: this.i18n.t('toolbox.diceTableSettings'), materialIcon: 'table_rows', action: () => this.open('DiceRollTableSettingComponent') });
    }
    menu.push(ContextMenuSeparator);
    Array.prototype.push.apply(menu, this.buildAlwaysAvailableViewActions());
    menu.push({ name: this.i18n.t('menu.diceOpen'), materialIcon: 'all_out', action: () => this.diceAllOpne() });
    if (!compact) {
      menu.push(ContextMenuSeparator);
      menu.push({
        name: SceneToolPermission.instance.canLoadZip()
          ? this.i18n.t('menu.loadZip')
          : `${this.i18n.t('menu.loadZip')}（${this.i18n.t('peer.loadData.gmOnly')}）`,
        materialIcon: 'open_in_browser',
        disabled: !SceneToolPermission.instance.canLoadZip(),
        action: () => this.openZipFileSelect()
      });
      menu.push({
        name: this.isSaveing ? `${this.progresPercent}%` : this.i18n.t('menu.downloadZip'),
        materialIcon: 'sd_storage',
        disabled: this.isSaveing,
        action: () => this.save()
      });
      menu.push(this.makeFolderBackupToolboxMenu());
    }
    return menu;
  }

  private makeFolderBackupToolboxMenu(): ContextMenuAction {
    const status = this.folderBackup.status;
    const statusName = status === 'writing'
      ? this.i18n.t('menu.folderBackup.status.writing')
      : status === 'ready'
        ? this.i18n.t('menu.folderBackup.status.ready', { name: this.folderBackup.folderName || '-' })
        : this.i18n.t(`menu.folderBackup.status.${status}`);
    const unsupported = status === 'unsupported';
    const subActions: ContextMenuAction[] = [
      {
        name: statusName,
        disabled: true,
      },
      ContextMenuSeparator,
      {
        name: this.i18n.t('menu.folderBackup.bind'),
        disabled: unsupported,
        action: () => { void this.folderBackup.bindFolder(); }
      },
      {
        name: this.i18n.t('menu.folderBackup.reauth'),
        disabled: unsupported || status === 'unbound',
        action: () => { void this.folderBackup.requestAccess(); }
      },
    ];
    if (this.folderBackup.canLoadFromFolder) {
      const canLoad = SceneToolPermission.instance.canLoadRoom();
      subActions.push({
        name: canLoad
          ? this.i18n.t('menu.folderBackup.load')
          : `${this.i18n.t('menu.folderBackup.load')}（${this.i18n.t('peer.loadData.gmOnly')}）`,
        disabled: !canLoad,
        action: () => { void this.openFolderBackupLoad(); }
      });
    }
    subActions.push({
      name: this.i18n.t('menu.folderBackup.unbind'),
      disabled: unsupported || status === 'unbound',
      action: () => { void this.folderBackup.unbindFolder(); }
    });
    return {
      name: this.i18n.t('menu.folderBackup'),
      materialIcon: 'folder',
      disabled: unsupported,
      subActions,
    };
  }

  private makeWeatherToolboxMenu() {
    const markType = (type: WeatherType) => {
      const cur = TableSelecter.instance.viewTable?.weatherType || 'none';
      return `${cur === type ? '◉' : '○'}`;
    };
    const setType = (type: WeatherType) => {
      const table = TableSelecter.instance.viewTable;
      if (!table) return;
      table.weatherType = type;
      if (type !== 'none' && !(table.weatherIntensity > 0)) table.weatherIntensity = 0.5;
    };
    const markIntensity = (value: number) => {
      const cur = TableSelecter.instance.viewTable?.weatherIntensity ?? 0.5;
      const on = Math.abs(cur - value) < 0.06;
      return `${on ? '◉' : '○'}`;
    };
    const setIntensity = (value: number) => {
      const table = TableSelecter.instance.viewTable;
      if (!table) return;
      table.weatherIntensity = value;
      if (table.weatherType === 'none') table.weatherType = 'rain';
    };
    const typeItem = (type: WeatherType, labelKey: string) => {
      const label = this.i18n.t(labelKey);
      return {
        name: `${markType(type)} ${label}`,
        nameUpdate: () => `${markType(type)} ${label}`,
        action: () => setType(type),
        checkBox: 'radio' as const,
      };
    };
    const intensityItem = (value: number, labelKey: string) => {
      const label = this.i18n.t(labelKey);
      return {
        name: `${markIntensity(value)} ${label}`,
        nameUpdate: () => `${markIntensity(value)} ${label}`,
        action: () => setIntensity(value),
        checkBox: 'radio' as const,
      };
    };
    return {
      name: this.i18n.t('table.weather'),
      materialIcon: 'wb_cloudy',
      subActions: [
        ...WEATHER_MENU_ORDER.map(type => typeItem(type, WEATHER_LABEL_KEY[type])),
        ContextMenuSeparator,
        {
          name: this.i18n.t('table.intensity'),
          subActions: [
            intensityItem(0.25, 'table.intensityLow'),
            intensityItem(0.5, 'table.intensityMid'),
            intensityItem(0.75, 'table.intensityHigh'),
            intensityItem(1, 'table.intensityMax'),
          ],
        },
      ],
    };
  }

  private makeDayNightToolboxMenu() {
    const DAY_TARGET = 0;
    const NIGHT_TARGET = 0.85;
    const animateDarkness = (target: number) => {
      const table = TableSelecter.instance.viewTable;
      if (!table) return;
      table.backgroundFilterType = target >= 0.5 ? FilterType.BLACK : FilterType.NONE;
      const start = table.darkness ?? 0;
      const t0 = performance.now();
      const dur = 800;
      const step = (now: number) => {
        const p = Math.min(1, (now - t0) / dur);
        table.darkness = p < 1 ? start + (target - start) * p : target;
        if (p < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    };
    // Mutually exclusive — match backgroundFilterType threshold (no 0.35–0.55 gap).
    const isNight = () => (TableSelecter.instance.viewTable?.darkness ?? 0) >= 0.5;
    const isDay = () => !isNight();
    return {
      name: this.i18n.t('table.dayNight'),
      materialIcon: 'brightness_6',
      subActions: [
        {
          name: `${isDay() ? '◉' : '○'} ${this.i18n.t('table.day')}`,
          nameUpdate: () => `${isDay() ? '◉' : '○'} ${this.i18n.t('table.day')}`,
          action: () => animateDarkness(DAY_TARGET),
          checkBox: 'radio' as const,
        },
        {
          name: `${isNight() ? '◉' : '○'} ${this.i18n.t('table.night')}`,
          nameUpdate: () => `${isNight() ? '◉' : '○'} ${this.i18n.t('table.night')}`,
          action: () => animateDarkness(NIGHT_TARGET),
          checkBox: 'radio' as const,
        },
      ],
    };
  }

  async openZipFileSelect() {
    if (!SceneToolPermission.instance.canLoadZip()) return;
    if (!this.isRoom) {
      let loadDirectOpened = false;
      const choice = await this.modalService.open(ConfirmationComponent, {
        title: this.i18n.t('menu.confirm.loadZip.title'),
        text: this.i18n.t('menu.confirm.loadZip.text'),
        help: this.i18n.t('menu.confirm.loadZip.help'),
        type: ConfirmationType.OK_CANCEL,
        materialIcon: 'meeting_room',
        okLabel: this.i18n.t('menu.confirm.loadZip.createRoom'),
        cancelLabel: this.i18n.t('menu.confirm.loadZip.loadDirect'),
        // Open file picker in the click handler so browsers allow it.
        cancelAction: () => {
          loadDirectOpened = true;
          this.pickZipFiles();
        },
      });
      if (choice === true) {
        await this.modalService.open(RoomSettingComponent, {
          width: 720,
          height: 720,
          left: 0,
          top: 80,
          // Keep file picker in the create-button click stack.
          afterCreate: () => this.pickZipFiles(),
        });
        return;
      }
      if (loadDirectOpened || choice === false) return;
      return;
    }

    this.pickZipFiles();
  }

  openFolderBackupLoad() {
    if (this.GuestMode() || !this.folderBackup.canLoadFromFolder) return;
    if (!SceneToolPermission.instance.canLoadRoom()) return;
    void this.folderBackup.openLoadUi();
  }

  private pickZipFiles() {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.accept = 'application/xml,text/xml,application/zip';
    input.onchange = (event: Event) => this.handleFileSelect(event);
    input.click();
  }

  standSetteings(event: Event) {
    this.guidedTour.notifyMenuClick('menu.settings');
    // Nav toggle: second tap closes. Nested opens (More → Settings) use openSettingsAt.
    if (this.contextMenuService.isShow) {
      this.contextMenuService.close();
      return;
    }
    const button = <HTMLElement>event.target;
    const clientRect = button.getBoundingClientRect();
    const position = this.isMobileLayout
      ? {
          x: window.pageXOffset + clientRect.left,
          y: Math.max(8, window.pageYOffset + clientRect.top - this.mobileLayout.bottomChromePx),
        }
      : {
          x: window.pageXOffset + clientRect.left + (this.isHorizontal ? 0 : button.clientWidth * 0.9),
          y: window.pageYOffset + clientRect.top + (this.isHorizontal ? button.clientHeight * 0.9 : 0)
        };
    this.openSettingsAt(position);
  }

  /** Open settings sheet/menu (replaces any current context menu). */
  private openSettingsAt(position: { x: number; y: number }) {
    this.guidedTour.notifyMenuClick('menu.settings');
    this.contextMenuService.open(position, [
      ...this.buildAlwaysAvailableViewActions(),
      ContextMenuSeparator,
      contextMenuToggleCheck({
        get: () => TableSelecter.instance.gridShow,
        set: (v) => {
          TableSelecter.instance.gridShow = v;
          EventSystem.trigger('UPDATE_GAME_OBJECT', TableSelecter.instance.toContext());
        },
        on: `☑${this.i18n.t('menu.settings.showGrid')}`,
        off: `☐${this.i18n.t('menu.settings.showGrid')}`,
      }),
      contextMenuToggleCheck({
        get: () => TableSelecter.instance.gridSnap,
        set: (v) => { TableSelecter.instance.gridSnap = v; },
        on: `☑${this.i18n.t('menu.settings.gridSnap')}`,
        off: `☐${this.i18n.t('menu.settings.gridSnap')}`,
      }),
      ContextMenuSeparator,
      contextMenuToggleCheck({
        get: () => ChatWindowComponent.isNoticeOn,
        set: (v) => { ChatWindowComponent.setChatNotice(v); },
        on: `☑${this.i18n.t('menu.settings.noticeSound')}`,
        off: `☐${this.i18n.t('menu.settings.noticeSound')}`,
      }),
      contextMenuToggleCheck({
        get: () => ChatWindowComponent.isLeftOnly,
        set: (v) => { ChatWindowComponent.setChatLeftOnly(v); },
        on: `☑${this.i18n.t('menu.settings.leftOnly')}`,
        off: `☐${this.i18n.t('menu.settings.leftOnly')}`,
      }),
      contextMenuToggleCheck({
        get: () => ChatWindowComponent.isAutoPopup,
        set: (v) => { ChatWindowComponent.setChatAutoPopup(v); },
        on: `☑${this.i18n.t('menu.settings.autoPopupChat')}`,
        off: `☐${this.i18n.t('menu.settings.autoPopupChat')}`,
      }),
      contextMenuToggleCheck({
        get: () => ChatWindowComponent.skipEmptyDialogQuotes,
        set: (v) => { ChatWindowComponent.setSkipEmptyDialogQuotes(v); },
        on: `☑${this.i18n.t('menu.settings.skipEmptyQuotes')}`,
        off: `☐${this.i18n.t('menu.settings.skipEmptyQuotes')}`,
      }),
      contextMenuToggleCheck({
        get: () => CharacterResourceHudComponent.isVisible,
        set: (v) => CharacterResourceHudComponent.setVisible(v),
        on: `☑${this.i18n.t('menu.settings.resourceHud')}`,
        off: `☐${this.i18n.t('menu.settings.resourceHud')}`,
      }),
      ContextMenuSeparator,
      contextMenuToggleCheck({
        get: () => StandImageComponent.isShowStand,
        set: (v) => { StandImageComponent.isShowStand = v; },
        on: `☑${this.i18n.t('menu.settings.showStand')}`,
        off: `☐${this.i18n.t('menu.settings.showStand')}`,
      }),
      contextMenuToggleCheck({
        get: () => StandImageComponent.isShowNameTag,
        set: (v) => { StandImageComponent.isShowNameTag = v; },
        on: `☑${this.i18n.t('menu.settings.showNameTag')}`,
        off: `☐${this.i18n.t('menu.settings.showNameTag')}`,
        level: 1,
        disabled: !StandImageComponent.isShowStand,
      }),
      contextMenuToggleCheck({
        get: () => StandImageComponent.isCanBeGone,
        set: (v) => { StandImageComponent.isCanBeGone = v; },
        on: `☑${this.i18n.t('menu.settings.standAutoExit')}`,
        off: `☐${this.i18n.t('menu.settings.standAutoExit')}`,
        level: 1,
        disabled: !StandImageComponent.isShowStand,
      }),
      ContextMenuSeparator,
      {
        name: this.i18n.t('lang.label'),
        materialIcon: 'language',
        subActions: this.i18n.locales.map(locale => ({
          name: `${this.i18n.locale === locale.id ? '☑' : '☐'} ${locale.nativeLabel}`,
          checkBox: 'check',
          keepOpen: true,
          action: () => this.i18n.setLocale(locale.id as AppLocale),
          nameUpdate: () => `${this.i18n.locale === locale.id ? '☑' : '☐'} ${locale.nativeLabel}`,
        })),
      },
      ContextMenuSeparator,
      // Hover tips stick after taps on touch UIs — desktop-only setting.
      ...(this.teachingTips.isAvailable ? [contextMenuToggleCheck({
        get: () => this.teachingTips.isEnabled,
        set: (v) => this.teachingTips.setEnabled(v),
        on: `☑${this.i18n.t('tour.hoverTips')}`,
        off: `☐${this.i18n.t('tour.hoverTips')}`,
      })] : []),
      {
        name: this.i18n.t('tour.replay'),
        materialIcon: 'school',
        action: () => this.guidedTour.replay(),
      },
      {
        name: this.i18n.t('tour.helpControls'),
        materialIcon: 'help_outline',
        action: () => this.openControlsHelp(),
      },
      ContextMenuSeparator,
      { name: this.i18n.t('menu.settings.clearStands'), action: () => EventSystem.trigger('DESTORY_STAND_IMAGE_ALL', null) }
    ], this.i18n.t('menu.settings'));
  }

  private openControlsHelp() {
    const text = [
      this.i18n.t('tutorial.welcome'),
      this.i18n.t('tutorial.view'),
      this.i18n.t('tutorial.keyboard'),
      this.i18n.t('tutorial.chat'),
      this.i18n.t('tutorial.scene'),
    ].join('\n\n');
    this.modalService.open(TextViewComponent, {
      title: this.i18n.t('tour.helpControls'),
      text,
    });
  }
/*
  farewellStandAll() {
    EventSystem.trigger('DESTORY_STAND_IMAGE_ALL', null);
  }
*/
  diceAllOpne() {
    this.modalService.open(ConfirmationComponent, {
      title: this.i18n.t('menu.confirm.diceOpen.title'),
      text: this.i18n.t('menu.confirm.diceOpen.text'),
      help: this.i18n.t('menu.confirm.diceOpen.help'),
      type: ConfirmationType.OK_CANCEL,
      materialIcon: 'all_out',
      action: () => {
        EventSystem.trigger('DICE_ALL_OPEN', null);
      }
    });
  }

  logout() {
    const folderReady = this.folderBackup.isReady;
    const option: any = {
      title: this.i18n.t('menu.confirm.logout.title'),
      text: this.i18n.t(this.isRoom ? 'menu.confirm.logout.textRoom' : 'menu.confirm.logout.text'),
      help: this.i18n.t(
        this.GuestMode()
          ? 'menu.confirm.logout.helpGuest'
          : (folderReady ? 'menu.confirm.logout.helpFolder' : 'menu.confirm.logout.help')
      ),
      type: ConfirmationType.OK_CANCEL,
      materialIcon: 'logout',
      action: () => {
        void this.flushFolderThenReload();
      },
    };
    if (!this.GuestMode()) {
      option.extraLabel = this.i18n.t('menu.downloadZip');
      option.extraAction = () => { void this.save(); };
    }
    this.modalService.open(ConfirmationComponent, option);
  }

  private async handleKicked(byName: string) {
    try {
      await this.modalService.open(ConfirmationComponent, {
        title: this.i18n.t('peer.kick.notifyTitle'),
        text: this.i18n.t(
          byName ? 'peer.kick.notifyTextNamed' : 'peer.kick.notifyText',
          byName ? { name: byName } : undefined
        ),
        type: ConfirmationType.OK,
        materialIcon: 'person_remove',
      });
    } catch {
      /* ignore */
    }
    await this.flushFolderThenReload();
  }

  deleteGameObject(gameObject: any) {
    throw new Error('Method not implemented.');
  }

  rotateChange(isHorizontal) {
    this.isHorizontal = isHorizontal;
  }

  closeImagePreview() {
    URL.revokeObjectURL(AppComponent.imageUrl);
    AppComponent.imageUrl = '';
  }
}

PanelService.UIPanelComponentClass = UIPanelComponent;
//ContextMenuService.UIPanelComponentClass = ContextMenuComponent;
ContextMenuService.ContextMenuComponentClass = ContextMenuComponent;
ModalService.ModalComponentClass = ModalComponent;

function workaroundForMobileSafari() {
  // Workaround for issue confirmed on Mobile Safari (iOS 16.4).
  // chrome-smooth-image-trick interferes with CSS animation (keyframes), so override with fix CSS.
  let ua = window.navigator.userAgent.toLowerCase();
  let isiOS = ua.indexOf('iphone') > -1 || ua.indexOf('ipad') > -1 || ua.indexOf('macintosh') > -1 && 'ontouchend' in document;
  if (isiOS) {
    let style = document.createElement('style');
    style.innerHTML = `
      .chrome-smooth-image-trick {
        transform-style: flat;
      }
      `;
    document.body.appendChild(style);
  }
}
