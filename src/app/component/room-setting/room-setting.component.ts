import { Component, OnDestroy, OnInit } from '@angular/core';

import { EventSystem, Network } from '@udonarium/core/system';
import { PeerContext } from '@udonarium/core/system/network/peer-context';
import { GuestSession } from '@udonarium/guest-session';
import { PeerCursor } from '@udonarium/peer-cursor';

import { ModalService } from 'service/modal.service';
import { PanelService } from 'service/panel.service';

@Component({
    selector: 'room-setting',
    templateUrl: './room-setting.component.html',
    styleUrls: ['./room-setting.component.css'],
    standalone: false
})
export class RoomSettingComponent implements OnInit, OnDestroy {
  peers: PeerContext[] = [];
  isReloading: boolean = false;

  roomName: string = '普通房間';
  password: string = '';
  isPrivate: boolean = false;
  allowGuest: boolean = false;

  get peerId(): string { return Network.peerId; }
  get isConnected(): boolean { return 0 < Network.peerIds.length; }
  validateLength: boolean = false;

  constructor(
    private panelService: PanelService,
    private modalService: ModalService
  ) { }

  ngOnInit() {
    Promise.resolve().then(() => this.modalService.title = this.panelService.title = '新增房間');
    EventSystem.register(this);
    this.calcPeerId(this.roomName, this.password);
  }

  ngOnDestroy() {
    EventSystem.unregister(this);
  }

  calcPeerId(roomName: string, password: string) {
    let userId = Network.peer.userId;
    let peer = PeerContext.create(userId, PeerContext.generateId('***'), roomName, password);
    this.validateLength = peer.peerId.length < 64 ? true : false;
  }

  createRoom() {
    let userId = Network.peer.userId;
    GuestSession.isGuest = false;
    const roomName = this.allowGuest ? GuestSession.markAllowGuest(this.roomName) : this.roomName;
    Network.open(userId, PeerContext.generateId('***'), roomName, this.password);
    PeerCursor.myCursor.peerId = Network.peerId;

    this.modalService.resolve(true);
  }
}