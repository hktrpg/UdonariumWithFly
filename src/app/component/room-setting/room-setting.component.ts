import { Component, OnDestroy, OnInit } from '@angular/core';

import { EventSystem, Network } from '@udonarium/core/system';
import { PeerContext } from '@udonarium/core/system/network/peer-context';
import { PeerCursor } from '@udonarium/peer-cursor';
import { RoomAuth } from '@udonarium/room-auth';
import { RoomConnectHelper } from '@udonarium/room-connect-helper';

import { ModalService } from 'service/modal.service';
import { I18nService } from 'service/i18n.service';
import { PanelService } from 'service/panel.service';
import { RoomInviteService } from 'service/room-invite.service';

@Component({
    selector: 'room-setting',
    templateUrl: './room-setting.component.html',
    styleUrls: ['../shared/settings-ui.css', './room-setting.component.css'],
    standalone: false
})
export class RoomSettingComponent implements OnInit, OnDestroy {
  /** When true, edit passwords of the current role-auth room (GM only). */
  editMode = false;
  roomName: string;
  gmPassword: string = '';
  userPassword: string = '';
  guestPassword: string = '';
  isSaving = false;
  help: string = '';

  get peerId(): string { return Network.peerId; }
  get isConnected(): boolean { return 0 < Network.peerIds.length; }
  validateLength: boolean = false;

  constructor(
    private panelService: PanelService,
    private modalService: ModalService,
    private i18n: I18nService,
    private roomInvite: RoomInviteService,
  ) {
    this.editMode = !!modalService.option?.editMode;
  }

  ngOnInit() {
    if (this.editMode && Network.peer?.isRoom) {
      this.roomName = RoomAuth.displayRoomName(Network.peer.roomName || '');
      this.gmPassword = this.roomInvite.getRolePassword('gm');
      this.userPassword = this.roomInvite.getRolePassword('user');
      this.guestPassword = this.roomInvite.getRolePassword('guest');
    } else {
      this.roomName = this.i18n.t('room.defaultName');
    }
    Promise.resolve().then(() => this.refreshPanelTitle());
    EventSystem.register(this)
      .on('LOCALE_CHANGED', () => this.refreshPanelTitle());
    this.recalcPeerId();
  }

  ngOnDestroy() {
    EventSystem.unregister(this);
  }

  private refreshPanelTitle() {
    this.modalService.title = this.panelService.title = this.i18n.t(
      this.editMode ? 'room.editTitle' : 'room.title'
    );
  }

  recalcPeerId() {
    const roomId = this.editMode && Network.peer?.isRoom ? Network.peer.roomId : '***';
    const encoded = RoomAuth.encode(this.roomName, roomId, {
      gm: this.gmPassword,
      user: this.userPassword,
      guest: this.guestPassword,
    });
    const userId = Network.peer.userId;
    const peer = PeerContext.create(
      userId,
      this.editMode && Network.peer?.isRoom ? roomId : PeerContext.generateId('***'),
      encoded,
      ''
    );
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
    // Host joins as GM. Pass roomId explicitly — Network.open is async so peer.roomId may lag.
    RoomAuth.applyIdentity('gm', roomId);
    // Keep plaintext role passwords in-session for invite-link generation.
    this.roomInvite.setRolePasswords({
      gm: this.gmPassword,
      user: this.userPassword,
      guest: this.guestPassword,
    });

    const afterCreate = this.modalService.option?.afterCreate;
    this.modalService.resolve(true);
    if (typeof afterCreate === 'function') afterCreate();
  }

  async saveRoomPasswords() {
    if (!this.editMode || !Network.peer?.isRoom || this.isSaving) return;
    if (!this.validateLength) return;

    this.isSaving = true;
    this.help = '';
    const roomId = Network.peer.roomId;
    const encodedName = RoomAuth.encode(this.roomName, roomId, {
      gm: this.gmPassword,
      user: this.userPassword,
      guest: this.guestPassword,
    });

    this.roomInvite.setRolePasswords({
      gm: this.gmPassword,
      user: this.userPassword,
      guest: this.guestPassword,
    });

    try {
      // Notify others before we leave the old SkyWay channel.
      if (Network.peers.length > 0) {
        EventSystem.call('ROOM_REKEY', { roomId, roomName: encodedName });
        await new Promise(r => setTimeout(r, 150));
      }
      await RoomConnectHelper.rekeyRoom(roomId, encodedName);
      RoomAuth.applyIdentity('gm', roomId);
      RoomAuth.noteAttained('gm', roomId);
      this.modalService.resolve(true);
    } catch (e) {
      console.warn('saveRoomPasswords failed', e);
      this.help = this.i18n.t('room.editError');
      this.isSaving = false;
    }
  }

  cancel() {
    this.modalService.resolve(null);
  }
}
