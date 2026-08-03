import { Component, OnDestroy, OnInit } from '@angular/core';

import { EventSystem, Network } from '@udonarium/core/system';
import { PeerContext } from '@udonarium/core/system/network/peer-context';
import { PeerCursor } from '@udonarium/peer-cursor';
import { RoomAuth } from '@udonarium/room-auth';

import { ModalService } from 'service/modal.service';
import { PanelService } from 'service/panel.service';

@Component({
    selector: 'room-setting',
    templateUrl: './room-setting.component.html',
    styleUrls: ['./room-setting.component.css'],
    standalone: false
})
export class RoomSettingComponent implements OnInit, OnDestroy {
  roomName: string = '普通房間';
  gmPassword: string = '';
  userPassword: string = '';
  guestPassword: string = '';

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
    this.recalcPeerId();
  }

  ngOnDestroy() {
    EventSystem.unregister(this);
  }

  recalcPeerId() {
    const roomId = '***';
    const encoded = RoomAuth.encode(this.roomName, roomId, {
      gm: this.gmPassword,
      user: this.userPassword,
      guest: this.guestPassword,
    });
    const userId = Network.peer.userId;
    const peer = PeerContext.create(userId, PeerContext.generateId('***'), encoded, '');
    this.validateLength = peer.peerId.length < 64;
  }

  createRoom() {
    const userId = Network.peer.userId;
    const roomId = PeerContext.generateId('***');
    const encodedName = RoomAuth.encode(this.roomName, roomId, {
      gm: this.gmPassword,
      user: this.userPassword,
      guest: this.guestPassword,
    });
    // Role-auth rooms use empty skyway password; roles are gated by RoomAuth digests.
    Network.open(userId, roomId, encodedName, '');
    PeerCursor.myCursor.peerId = Network.peerId;
    // Host joins as GM.
    RoomAuth.applyIdentity('gm');

    this.modalService.resolve(true);
  }
}
