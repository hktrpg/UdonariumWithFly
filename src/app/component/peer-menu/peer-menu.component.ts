import { Component, NgZone, OnDestroy, OnInit } from '@angular/core';

import { ObjectStore } from '@udonarium/core/synchronize-object/object-store';
import { EventSystem, Network } from '@udonarium/core/system';
import { PeerContext } from '@udonarium/core/system/network/peer-context';
import { PeerSessionGrade } from '@udonarium/core/system/network/peer-session-state';
import { GuestSession } from '@udonarium/guest-session';
import { SceneToolPermission } from '@udonarium/table-fx/scene-tool-permission';
import { PeerCursor } from '@udonarium/peer-cursor';
import { RoomAuth } from '@udonarium/room-auth';

import { FileSelecterComponent } from 'component/file-selecter/file-selecter.component';
import { LobbyComponent } from 'component/lobby/lobby.component';
import { RoomJoinComponent } from 'component/room-join/room-join.component';
import { AppConfig, AppConfigService } from 'service/app-config.service';
import { ModalService } from 'service/modal.service';
import { PanelService } from 'service/panel.service';
import { animate, style, transition, trigger } from '@angular/animations';
import { ChatMessageService } from 'service/chat-message.service';
import { ConfirmationComponent, ConfirmationType } from 'component/confirmation/confirmation.component';
import { GameCharacter } from '@udonarium/game-character';
import { ImageFile, ImageState } from '@udonarium/core/file-storage/image-file';
import { ImageStorage } from '@udonarium/core/file-storage/image-storage';
import { RoomInfo } from '@udonarium/core/system/network/room-info';
import { RoomJoinResult, RoomRole } from '@udonarium/room-auth';

import * as localForage from 'localforage';

@Component({
    selector: 'peer-menu',
    templateUrl: './peer-menu.component.html',
    styleUrls: ['./peer-menu.component.css'],
    animations: [
        trigger('fadeInOut', [
            transition('false => true', [
                animate('50ms ease-in-out', style({ opacity: 1.0 })),
                animate('900ms ease-in-out', style({ opacity: 0 }))
            ])
        ])
    ],
    standalone: false
})
export class PeerMenuComponent implements OnInit, OnDestroy {
  targetUserId: string = '';
  networkService = Network
  gameRoomService = ObjectStore.instance;

  isCopied = false;
  isRoomNameCopied = false;
  isPasswordCopied = false;
  isPasswordOpen = false;
  isRoomInfoCopied = false

  help: string = '';

  private _timeOutId: NodeJS.Timeout;
  private _timeOutId2: NodeJS.Timeout;
  private _timeOutId3: NodeJS.Timeout;
  private _timeOutId4: NodeJS.Timeout;

  private interval: NodeJS.Timeout;
  get myPeer(): PeerCursor { return PeerCursor.myCursor; }

  get myPeerName(): string {
    if (!PeerCursor.myCursor) return null;
    return PeerCursor.myCursor.name;
  }
  set myPeerName(name: string) {
    if (PeerCursor.myCursor) {
      PeerCursor.myCursor.name = name;
      if (PeerCursor.myCursor.name === PeerCursor.CHAT_DEFAULT_NAME) {
        localForage.removeItem(PeerCursor.CHAT_MY_NAME_LOCAL_STORAGE_KEY).catch(e => console.log(e));
      } else {
        localForage.setItem(PeerCursor.CHAT_MY_NAME_LOCAL_STORAGE_KEY, PeerCursor.myCursor.name).catch(e => console.log(e));
      }
    }
  }

  get myPeerColor(): string {
    if (!PeerCursor.myCursor) return PeerCursor.CHAT_DEFAULT_COLOR;
    return PeerCursor.myCursor.color;
  }
  set myPeerColor(color: string) {
    if (color && PeerCursor.myCursor) {
      color = color.trim().toLowerCase();
      if (!/^\#[0-9a-f]{6}$/.test(color)) return; 
      PeerCursor.myCursor.color = (color == PeerCursor.CHAT_TRANSPARENT_COLOR) ? PeerCursor.CHAT_DEFAULT_COLOR : color;
      if (PeerCursor.myCursor.color === PeerCursor.CHAT_DEFAULT_COLOR) {
        localForage.removeItem(PeerCursor.CHAT_MY_COLOR_LOCAL_STORAGE_KEY).catch(e => console.log(e));
      } else {
        localForage.setItem(PeerCursor.CHAT_MY_COLOR_LOCAL_STORAGE_KEY, PeerCursor.myCursor.color).catch(e => console.log(e));
      }
    }
  }

  get isGMMode(): boolean{ return PeerCursor.myCursor ? PeerCursor.myCursor.isGMMode : false; }
  set isGMMode(isGMMode: boolean) { if (PeerCursor.myCursor) PeerCursor.myCursor.isGMMode = isGMMode; }

  get scenePerm() { return SceneToolPermission.instance; }

  get sceneCanCreateLight(): boolean { return this.scenePerm.playerCanCreateLight; }
  set sceneCanCreateLight(v: boolean) { this.scenePerm.playerCanCreateLight = !!v; }
  get sceneCanCreateWall(): boolean { return this.scenePerm.playerCanCreateWall; }
  set sceneCanCreateWall(v: boolean) { this.scenePerm.playerCanCreateWall = !!v; }
  get sceneCanCreateRect(): boolean { return this.scenePerm.playerCanCreateRect; }
  set sceneCanCreateRect(v: boolean) { this.scenePerm.playerCanCreateRect = !!v; }
  get sceneCanCreateEllipse(): boolean { return this.scenePerm.playerCanCreateEllipse; }
  set sceneCanCreateEllipse(v: boolean) { this.scenePerm.playerCanCreateEllipse = !!v; }
  get sceneCanCreatePolygon(): boolean { return this.scenePerm.playerCanCreatePolygon; }
  set sceneCanCreatePolygon(v: boolean) { this.scenePerm.playerCanCreatePolygon = !!v; }
  get sceneCanCreateFreehand(): boolean { return this.scenePerm.playerCanCreateFreehand; }
  set sceneCanCreateFreehand(v: boolean) { this.scenePerm.playerCanCreateFreehand = !!v; }
  get sceneCanCreateText(): boolean { return this.scenePerm.playerCanCreateText; }
  set sceneCanCreateText(v: boolean) { this.scenePerm.playerCanCreateText = !!v; }

  get sceneCanModifyLight(): boolean { return this.scenePerm.playerCanModifyLight; }
  set sceneCanModifyLight(v: boolean) { this.scenePerm.playerCanModifyLight = !!v; }
  get sceneCanModifyWall(): boolean { return this.scenePerm.playerCanModifyWall; }
  set sceneCanModifyWall(v: boolean) { this.scenePerm.playerCanModifyWall = !!v; }
  get sceneCanModifyDrawing(): boolean { return this.scenePerm.playerCanModifyDrawing; }
  set sceneCanModifyDrawing(v: boolean) { this.scenePerm.playerCanModifyDrawing = !!v; }

  get sceneAllCreate(): boolean {
    const p = this.scenePerm;
    return p.playerCanCreateLight && p.playerCanCreateWall
      && p.playerCanCreateRect && p.playerCanCreateEllipse
      && p.playerCanCreatePolygon && p.playerCanCreateFreehand
      && p.playerCanCreateText;
  }
  get sceneAllModify(): boolean {
    const p = this.scenePerm;
    return p.playerCanModifyLight && p.playerCanModifyWall && p.playerCanModifyDrawing;
  }
  setAllSceneCreate(v: boolean) { this.scenePerm.setAllCreate(v); }
  setAllSceneModify(v: boolean) { this.scenePerm.setAllModify(v); }

  get isGMHold(): boolean { return PeerCursor.isGMHold; }
  get isDisableConnect(): boolean { return this.isGMHold || this.isGMMode; }

  get displayRoomName(): string {
    return RoomAuth.displayRoomName(this.networkService.peer.roomName || '');
  }
  get displayRoomLabel(): string {
    return this.displayRoomName + '/' + this.networkService.peer.roomId;
  }
  get isRoleAuthRoom(): boolean {
    return RoomAuth.isRoleAuthRoom(this.networkService.peer.roomName || '');
  }
  get isGuest(): boolean { return GuestSession.isGuest; }

  get currentRole(): RoomRole {
    if (this.isGuest) return 'guest';
    if (this.isGMMode || this.isGMHold) return 'gm';
    return 'user';
  }

  get currentRoleLabel(): string {
    switch (this.currentRole) {
      case 'gm': return 'GM';
      case 'guest': return '訪客';
      default: return '玩家';
    }
  }

  get maskedPassword(): string { return '●●●●●●●●' }
  get config(): AppConfig { return AppConfigService.appConfig; }
  get canUsePrivateSession(): boolean { return this.config.backend.mode == 'skyway'; }

  constructor(
    private ngZone: NgZone,
    private modalService: ModalService,
    private panelService: PanelService,
    private chatMessageService: ChatMessageService,
    public appConfigService: AppConfigService
  ) { }

  GuestMode() {
    return Network.GuestMode();
  }


  ngOnInit() {
    Promise.resolve().then(() => { this.panelService.title = '連線資訊'; this.panelService.isAbleFullScreenButton = false });
  }

  ngAfterViewInit() {
    EventSystem.register(this)
      .on('OPEN_NETWORK', event => {
        this.ngZone.run(() => { });
      });
    this.interval = setInterval(() => { }, 1000);
  }

  ngOnDestroy() {
    clearTimeout(this._timeOutId);
    clearTimeout(this._timeOutId2);
    clearTimeout(this._timeOutId3);
    clearTimeout(this._timeOutId4);
    EventSystem.unregister(this);
    clearInterval(this.interval);
  }

  changeIcon() {
    let currentImageIdentifires: string[] = [];
    if (this.myPeer && this.myPeer.imageIdentifier) currentImageIdentifires = [this.myPeer.imageIdentifier];
    this.modalService.open<string>(FileSelecterComponent, { currentImageIdentifires: currentImageIdentifires }).then(value => {
      if (!this.myPeer || !value) return;
      this.myPeer.imageIdentifier = value;
      let file: ImageFile = ImageStorage.instance.get(value);
      if (file) {
        if (file.state === ImageState.COMPLETE) {
          localForage.setItem(PeerCursor.CHAT_MY_ICON_LOCAL_STORAGE_KEY, file.blob).catch(e => console.log(e));
        } else if (value === 'none_icon') {
          localForage.removeItem(PeerCursor.CHAT_MY_ICON_LOCAL_STORAGE_KEY).catch(e => console.log(e));
        } else {
          localForage.setItem(PeerCursor.CHAT_MY_ICON_LOCAL_STORAGE_KEY, value).catch(e => console.log(e));
        }
      }
    });
  }

  connectPeer() {
    let targetUserId = this.targetUserId;
    this.targetUserId = '';
    if (targetUserId.length < 1) return;
    this.help = '';
    let peer = PeerContext.create(targetUserId);
    if (peer.isRoom) return;
    ObjectStore.instance.clearDeleteHistory();
    Network.connect(peer);
    if (PeerCursor.isGMHold || this.isGMMode) {
      PeerCursor.isGMHold = false;
      this.isGMMode = false;
      if (this.isGMMode) {
        this.chatMessageService.sendOperationLog('解除 GM 模式');
        EventSystem.trigger('CHANGE_GM_MODE', null);
      }
    }
  }

  showLobby() {
    if (PeerCursor.isGMHold || this.isGMMode) {
      PeerCursor.isGMHold = false;
      this.isGMMode = false;
      if (this.isGMMode) {
        this.chatMessageService.sendOperationLog('解除 GM 模式');
        EventSystem.trigger('CHANGE_GM_MODE', null);
      }
    }
    this.modalService.open(LobbyComponent, { width: 700, height: 400, left: 0, top: 400 });
  }

  stringFromSessionGrade(grade: PeerSessionGrade): string {
    return PeerSessionGrade[grade] ?? PeerSessionGrade[PeerSessionGrade.UNSPECIFIED];
  }

  findUserId(peerId: string) {
    const peerCursor = PeerCursor.findByPeerId(peerId);
    return peerCursor ? peerCursor.userId : '';
  }

  findPeerName(peerId: string) {
    const peerCursor = PeerCursor.findByPeerId(peerId);
    return peerCursor ? peerCursor.name : '';
  }

  findPeerColor(peerId: string) {
    const peerCursor = PeerCursor.findByPeerId(peerId);
    return peerCursor ? peerCursor.color : '';
  }

  findPeerImageUrl(peerId: string) {
    const peerCursor = PeerCursor.findByPeerId(peerId);
    return peerCursor ? peerCursor.image.url : '';
  }

  findPeerIsGMMode(peerId: string): boolean {
    const peerCursor = PeerCursor.findByPeerId(peerId);
    return peerCursor ? peerCursor.isGMMode : false;
  }

  copyPeerId() {
    if (navigator.clipboard && this.canUsePrivateSession) {
      navigator.clipboard.writeText(this.networkService.peer.userId);
      this.isCopied = true;
      clearTimeout(this._timeOutId);
      this._timeOutId = setTimeout(() => {
        this.isCopied = false;
      }, 1000);
    }
  }

  copyRoomName() {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(this.displayRoomLabel);
      this.isRoomNameCopied = true;
      clearTimeout(this._timeOutId2);
      this._timeOutId2 = setTimeout(() => {
        this.isRoomNameCopied = false;
      }, 1000);
    }
  }

  copyPassword() {
    if (navigator.clipboard) {
      this.modalService.open(ConfirmationComponent, {
        title: '複製密碼', 
        text: '要將密碼複製到剪貼簿嗎？',
        helpHtml: '分享密碼時，請勿公開張貼到社群或任何人都能看見的地方。',
        type: ConfirmationType.OK_CANCEL,
        materialIcon: 'content_copy',
        action: () => {
          navigator.clipboard.writeText(this.networkService.peer.password);
          this.isPasswordCopied = true;
          clearTimeout(this._timeOutId3);
          this._timeOutId3 = setTimeout(() => {
            this.isPasswordCopied = false;
          }, 1000);
        }
      });
      this.isPasswordOpen = false;
    }
  }

  copyRoomInfo() {
    if (navigator.clipboard) {
      this.modalService.open(ConfirmationComponent, {
        title: '複製房間資訊', 
        text: '要將房間資訊（房間名稱/房間 ID、密碼）複製到剪貼簿嗎？',
        helpHtml: '分享密碼時，請勿公開張貼到社群或任何人都能看見的地方。',
        type: ConfirmationType.OK_CANCEL,
        materialIcon: 'content_copy',
        action: () => {
          navigator.clipboard.writeText('房間名稱：' + this.networkService.peer.roomName + '/' + this.networkService.peer.roomId + '  密碼：' + this.networkService.peer.password);
          this.isRoomInfoCopied = true;
          clearTimeout(this._timeOutId4);
          this._timeOutId4 = setTimeout(() => {
            this.isRoomInfoCopied = false;
          }, 1000);
        }
      });
      this.isPasswordOpen = false;
    }
  }

  isAbleClipboardCopy(): boolean {
    return navigator.clipboard ? true : false;
  }

  onPasswordOpen($event: Event) {
    if (this.isPasswordOpen) {
      this.isPasswordOpen = false;
    } else {
      $event.preventDefault();
      this.modalService.open(ConfirmationComponent, {
        title: '顯示密碼', 
        text: '要顯示密碼嗎？',
        helpHtml: '直播時請注意不要讓密碼出現在畫面上。<br>分享密碼時，請勿公開張貼到社群或任何人都能看見的地方。',
        type: ConfirmationType.OK_CANCEL,
        materialIcon: 'visibility',
        action: () => {
          this.isPasswordOpen = true;
          (<HTMLInputElement>$event.target).checked = true;
          //this.changeDetector.markForCheck();
        }
      });
    }
  }

  async switchIdentity() {
    const peer = this.networkService.peer;
    const room = peer.isRoom
      ? new RoomInfo(peer.roomId, peer.roomName, [peer as any])
      : new RoomInfo('local', RoomAuth.encode('本機', 'local', { gm: '', user: '', guest: '' }), []);

    const result = await this.modalService.open<RoomJoinResult>(RoomJoinComponent, {
      room,
      switchMode: true,
      currentRole: this.currentRole,
      width: 420,
      height: 380,
    });
    if (!result) return;

    const label = result.role === 'gm' ? 'GM' : (result.role === 'guest' ? '訪客' : '玩家');
    this.modalService.open(ConfirmationComponent, {
      title: '轉換身份',
      text: `確定將身份轉換為「${label}」嗎？`,
      helpHtml: result.role === 'gm'
        ? 'GM 可查看密語、卡片背面、未公開骰子與角色／游標位置；且無法由自己發起房間／私人連線。'
        : (result.role === 'guest' ? '訪客模式功能受限（例如無法存檔）。' : '以一般玩家身份參加。'),
      type: ConfirmationType.OK_CANCEL,
      materialIcon: 'swap_horiz',
      action: () => {
        const prev = this.currentRole;
        RoomAuth.applyIdentity(result.role);
        // Clear legacy hold state.
        PeerCursor.isGMHold = false;
        this.chatMessageService.sendOperationLog(`身份轉換：${this.roleLabel(prev)} → ${label}`);
        EventSystem.trigger('CHANGE_GM_MODE', null);
        if (prev === 'gm' && result.role !== 'gm' && GameCharacter.isStealthMode) {
          this.modalService.open(ConfirmationComponent, {
            title: '隱身模式',
            text: '已開啟隱身：其他人看不到你的游標位置。',
            help: '只要桌面上有「僅自己可見」的角色，其他人就看不到你的游標位置。',
            type: ConfirmationType.OK,
            materialIcon: 'disabled_visible'
          });
        }
      }
    });
  }

  private roleLabel(role: RoomRole): string {
    switch (role) {
      case 'gm': return 'GM';
      case 'guest': return '訪客';
      default: return '玩家';
    }
  }

  healthIcon(helth) {
    if (helth >= 0.99) return 'sentiment_very_satisfied';
    if (helth > 0.97) return 'sentiment_dissatisfied';
    if (helth > 0.95) return 'mood_bad';
    return 'sentiment_very_dissatisfied';
  }

  healthClass(helth) {
    if (helth >= 0.99) return 'health-blue';
    if (helth > 0.97) return 'health-green';
    if (helth > 0.95) return 'health-yellow';
    return 'health-red';
  }
}
