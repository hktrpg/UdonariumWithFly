import { Component, OnDestroy, OnInit } from '@angular/core';

import { ObjectStore } from '@udonarium/core/synchronize-object/object-store';
import { EventSystem, Network } from '@udonarium/core/system';
import { IRoomInfo } from '@udonarium/core/system/network/room-info';
import { GuestSession } from '@udonarium/guest-session';
import { PeerCursor } from '@udonarium/peer-cursor';

import { PasswordCheckComponent } from 'component/password-check/password-check.component';
import { RoomSettingComponent } from 'component/room-setting/room-setting.component';
import { ModalService } from 'service/modal.service';
import { PanelService } from 'service/panel.service';

@Component({
    selector: 'lobby',
    templateUrl: './lobby.component.html',
    styleUrls: ['./lobby.component.css'],
    standalone: false
})
export class LobbyComponent implements OnInit, OnDestroy {
  rooms: IRoomInfo[] = [];

  isReloading: boolean = false;

  help: string = '按「更新列表」以顯示可連線的房間。';

  get currentRoom(): string { return Network.peer.roomId };
  get peerId(): string { return Network.peerId; }
  get isConnected(): boolean { return 0 < Network.peerIds.length; }

  constructor(
    private panelService: PanelService,
    private modalService: ModalService
  ) { }

  ngOnInit() {
    Promise.resolve().then(() => this.changeTitle());
    EventSystem.register(this)
      .on('OPEN_NETWORK', event => {
        this.changeTitle();
      })
      .on('CONNECT_PEER', event => {
        this.changeTitle();
      });
    this.reload();
  }

  private changeTitle() {
    this.modalService.title = this.panelService.title = '大廳';
    if (Network.peer.roomName.length) {
      this.modalService.title = this.panelService.title = '〈' + Network.peer.roomName + '/' + Network.peer.roomId + '〉'
    }
  }

  ngOnDestroy() {
    EventSystem.unregister(this);
  }

  async reload() {
    this.isReloading = true;
    this.help = '搜索中...';
    this.rooms = await Network.listAllRooms();
    this.help = '找不到連線的房間。您可以使用「建立新房間」。';
    this.isReloading = false;
  }

  displayRoomName(room: IRoomInfo): string {
    return GuestSession.displayRoomName(room.name);
  }

  isAllowGuest(room: IRoomInfo): boolean {
    return GuestSession.isAllowGuestRoomName(room.name);
  }

  async connect(room: IRoomInfo, asGuest: boolean = false) {
    let password = '';
    const allowGuest = this.isAllowGuest(room);

    // skyway2023 requires the same password digest as room peers; guests are UI-restricted only.
    if (room.hasPassword) {
      password = await this.modalService.open<string>(PasswordCheckComponent, { peers: room.peers, title: `${this.displayRoomName(room)}/${room.id}` });
      if (password == null) password = '';
    }

    let targetPeers = room.filterByPassword(password);
    if (targetPeers.length < 1) return;

    GuestSession.isGuest = !!(allowGuest && asGuest);
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
      Network.open();
      PeerCursor.myCursor.peerId = Network.peerId;
    }
  }

  private closeIfConnected() {
    if (0 < Network.peers.length) this.modalService.resolve();
  }

  async showRoomSetting() {
    let isCreate = await this.modalService.open(RoomSettingComponent, { width: 700, height: 400, left: 0, top: 400 });
    if (isCreate) this.modalService.resolve();
    this.help = '按「更新列表」以顯示可連線的房間。';
  }
}