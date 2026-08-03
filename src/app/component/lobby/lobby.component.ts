import { Component, OnDestroy, OnInit } from '@angular/core';

import { ObjectStore } from '@udonarium/core/synchronize-object/object-store';
import { EventSystem, Network } from '@udonarium/core/system';
import { IRoomInfo } from '@udonarium/core/system/network/room-info';
import { GuestSession } from '@udonarium/guest-session';
import { PeerCursor } from '@udonarium/peer-cursor';
import { RoomAuth, RoomJoinResult } from '@udonarium/room-auth';

import { PasswordCheckComponent } from 'component/password-check/password-check.component';
import { RoomJoinComponent } from 'component/room-join/room-join.component';
import { RoomSettingComponent } from 'component/room-setting/room-setting.component';
import { ModalService } from 'service/modal.service';
import { I18nService } from 'service/i18n.service';
import { PanelService } from 'service/panel.service';

@Component({
    selector: 'lobby',
    templateUrl: './lobby.component.html',
    styleUrls: ['../shared/settings-ui.css', './lobby.component.css'],
    standalone: false
})
export class LobbyComponent implements OnInit, OnDestroy {
  rooms: IRoomInfo[] = [];

  isReloading: boolean = false;

  help: string;

  get currentRoom(): string { return Network.peer.roomId };
  get peerId(): string { return Network.peerId; }
  get isConnected(): boolean { return 0 < Network.peerIds.length; }

  constructor(
    private panelService: PanelService,
    private modalService: ModalService,
    private i18n: I18nService,
  ) { }

  ngOnInit() {
    Promise.resolve().then(() => this.changeTitle());
    EventSystem.register(this)
      .on('OPEN_NETWORK', event => {
        this.changeTitle();
      })
      .on('CONNECT_PEER', event => {
        this.changeTitle();
      })
      .on('LOCALE_CHANGED', () => {
        this.changeTitle();
        this.refreshHelp();
      });
    this.help = this.i18n.t('lobby.helpInitial');
    this.reload();
  }

  private changeTitle() {
    this.modalService.title = this.panelService.title = this.i18n.t('lobby.title');
    if (Network.peer.roomName.length) {
      const name = RoomAuth.displayRoomName(Network.peer.roomName);
      this.modalService.title = this.panelService.title = this.i18n.t('lobby.titleRoom', { name, id: Network.peer.roomId });
    }
  }

  ngOnDestroy() {
    EventSystem.unregister(this);
  }

  async reload() {
    this.isReloading = true;
    this.help = this.i18n.t('lobby.helpSearching');
    this.rooms = await Network.listAllRooms();
    this.help = this.i18n.t('lobby.helpEmpty');
    this.isReloading = false;
  }

  displayRoomName(room: IRoomInfo): string {
    return RoomAuth.displayRoomName(room.name);
  }

  isRoleAuthRoom(room: IRoomInfo): boolean {
    return RoomAuth.isRoleAuthRoom(room.name);
  }

  roomHasLock(room: IRoomInfo): boolean {
    if (RoomAuth.isRoleAuthRoom(room.name)) return RoomAuth.hasAnyRolePassword(room.name);
    return room.hasPassword;
  }

  isAllowGuest(room: IRoomInfo): boolean {
    if (RoomAuth.isRoleAuthRoom(room.name)) {
      return RoomAuth.isRoleAvailable(room.name, 'guest');
    }
    return GuestSession.isAllowGuestRoomName(room.name);
  }

  async connect(room: IRoomInfo, asGuest: boolean = false) {
    if (RoomAuth.isRoleAuthRoom(room.name)) {
      await this.connectWithRole(room);
      return;
    }
    await this.connectLegacy(room, asGuest);
  }

  private async connectWithRole(room: IRoomInfo) {
    const result = await this.modalService.open<RoomJoinResult>(RoomJoinComponent, {
      room,
      width: 420,
      height: 360,
    });
    if (!result) return;

    // Role-auth rooms always use empty skyway password.
    const targetPeers = room.filterByPassword('');
    if (targetPeers.length < 1) return;

    RoomAuth.applyIdentity(result.role);
    this.openAndConnect(room, '', targetPeers);
  }

  private async connectLegacy(room: IRoomInfo, asGuest: boolean) {
    let password = '';
    const allowGuest = this.isAllowGuest(room);

    if (room.hasPassword) {
      password = await this.modalService.open<string>(PasswordCheckComponent, { peers: room.peers, title: `${this.displayRoomName(room)}/${room.id}` });
      if (password == null) password = '';
    }

    let targetPeers = room.filterByPassword(password);
    if (targetPeers.length < 1) return;

    GuestSession.isGuest = !!(allowGuest && asGuest);
    if (PeerCursor.myCursor) {
      PeerCursor.isGMHold = false;
      PeerCursor.myCursor.isGMMode = false;
    }
    this.openAndConnect(room, password, targetPeers);
  }

  private openAndConnect(room: IRoomInfo, password: string, targetPeers: any[]) {
    let userId = Network.peer.userId;
    Network.open(userId, room.id, room.name, password);
    PeerCursor.myCursor.peerId = Network.peerId;

    let triedPeer: string[] = [];

    let onTried = () => {
      if (triedPeer.length < targetPeers.length) return false;
      this.resetNetwork();
      EventSystem.unregister(triedPeer);
      this.closeIfConnected();
      return true;
    }
    let onConnect = (peerId) => {
      console.log('連線成功！', peerId);
      triedPeer.push(peerId);
      console.log('連線成功 ' + triedPeer.length + '/' + targetPeers.length);
      return onTried();
    }
    let onDisconnect = (peerId) => {
      console.warn('連線失敗', peerId);
      triedPeer.push(peerId);
      console.warn('連線失敗 ' + triedPeer.length + '/' + targetPeers.length);
      return onTried();
    }

    EventSystem.register(triedPeer)
      .on('OPEN_NETWORK', event => {
        console.log('LobbyComponent OPEN_PEER', event.data.peerId);
        EventSystem.unregister(triedPeer);
        ObjectStore.instance.clearDeleteHistory();
        for (let peer of targetPeers) {
          if (!Network.connect(peer) && onDisconnect(peer.peerId)) return;
        }
        EventSystem.register(triedPeer)
          .on('CONNECT_PEER', event => onConnect(event.data.peerId))
          .on('DISCONNECT_PEER', event => onDisconnect(event.data.peerId));
      });
  }

  private resetNetwork() {
    if (Network.peers.length < 1) {
      GuestSession.isGuest = false;
      if (PeerCursor.myCursor) {
        PeerCursor.isGMHold = false;
        PeerCursor.myCursor.isGMMode = false;
      }
      Network.open();
      PeerCursor.myCursor.peerId = Network.peerId;
    }
  }

  private closeIfConnected() {
    if (0 < Network.peers.length) this.modalService.resolve();
  }

  async showRoomSetting() {
    let isCreate = await this.modalService.open(RoomSettingComponent, { width: 700, height: 420, left: 0, top: 400 });
    if (isCreate) this.modalService.resolve();
    this.help = this.i18n.t('lobby.helpInitial');
  }

  private refreshHelp() {
    if (this.isReloading) {
      this.help = this.i18n.t('lobby.helpSearching');
    } else if (this.rooms.length < 1) {
      this.help = this.i18n.t('lobby.helpEmpty');
    } else {
      this.help = this.i18n.t('lobby.helpInitial');
    }
  }
}
