import { Component, OnDestroy, OnInit } from '@angular/core';

import { EventSystem, Network } from '@udonarium/core/system';
import { PeerContext } from '@udonarium/core/system/network/peer-context';
import { PeerCursor } from '@udonarium/peer-cursor';
import { RoleAuthInput, RoomAuth } from '@udonarium/room-auth';
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
  /** When true, edit data of the current role-auth room (GM only). */
  editMode = false;
  /** When set, reopen this roomId instead of minting a new one (folder backup resume). */
  preferredRoomId = '';
  /** Auth restore state for resume hints. */
  preferredAuthStatus: 'ready' | 'legacy' | 'missing' | 'undecryptable' | '' = '';
  roomName: string;
  gmPassword: string = '';
  userPassword: string = '';
  guestPassword: string = '';
  /** Allow player (user) role to join. */
  allowUser = true;
  /** Allow guest role to join. */
  allowGuest = true;
  isSaving = false;
  help: string = '';

  get peerId(): string { return Network.peerId; }
  get isConnected(): boolean { return 0 < Network.peerIds.length; }
  get isResume(): boolean { return !this.editMode && !!this.preferredRoomId; }

  get resumeAuthHintKey(): string {
    switch (this.preferredAuthStatus) {
      case 'ready': return 'room.resumeAuth.ready';
      case 'legacy': return 'room.resumeAuth.legacy';
      case 'undecryptable': return 'room.resumeAuth.undecryptable';
      case 'missing': return 'room.resumeAuth.missing';
      default: return '';
    }
  }
  validateLength: boolean = false;

  constructor(
    private panelService: PanelService,
    private modalService: ModalService,
    private i18n: I18nService,
    private roomInvite: RoomInviteService,
  ) {
    this.editMode = !!modalService.option?.editMode;
    const preferred = String(modalService.option?.preferredRoomId || '').trim();
    if (/^[A-Za-z0-9_-]{1,32}$/.test(preferred)) {
      this.preferredRoomId = preferred;
    }
    const status = String(modalService.option?.preferredAuthStatus || '');
    if (status === 'ready' || status === 'legacy' || status === 'missing' || status === 'undecryptable') {
      this.preferredAuthStatus = status;
    }
  }

  ngOnInit() {
    if (this.editMode && Network.peer?.isRoom) {
      this.roomName = RoomAuth.displayRoomName(Network.peer.roomName || '');
      const info = RoomAuth.parse(Network.peer.roomName || '');
      this.allowUser = info.user.mode !== 'disabled';
      this.allowGuest = info.guest.mode !== 'disabled';
      this.gmPassword = this.roomInvite.getRolePassword('gm');
      this.userPassword = this.allowUser ? this.roomInvite.getRolePassword('user') : '';
      this.guestPassword = this.allowGuest ? this.roomInvite.getRolePassword('guest') : '';
    } else {
      const preferredName = String(this.modalService.option?.preferredRoomName || '').trim();
      this.roomName = preferredName || this.i18n.t('room.defaultName');
      this.allowUser = true;
      this.allowGuest = true;
      this.applyPreferredAuth(this.modalService.option?.preferredAuth);
    }
    Promise.resolve().then(() => this.refreshPanelTitle());
    EventSystem.register(this)
      .on('LOCALE_CHANGED', () => this.refreshPanelTitle());
    this.recalcPeerId();
  }

  private applyPreferredAuth(auth: any) {
    if (!auth || typeof auth !== 'object') return;
    if (typeof auth.allowUser === 'boolean') this.allowUser = auth.allowUser;
    if (typeof auth.allowGuest === 'boolean') this.allowGuest = auth.allowGuest;
    if (typeof auth.gmPassword === 'string') this.gmPassword = auth.gmPassword.slice(0, 12);
    if (typeof auth.userPassword === 'string') {
      this.userPassword = this.allowUser ? auth.userPassword.slice(0, 12) : '';
    }
    if (typeof auth.guestPassword === 'string') {
      this.guestPassword = this.allowGuest ? auth.guestPassword.slice(0, 12) : '';
    }
  }

  ngOnDestroy() {
    EventSystem.unregister(this);
  }

  private refreshPanelTitle() {
    this.modalService.title = this.panelService.title = this.i18n.t(
      this.editMode ? 'room.editTitle' : (this.isResume ? 'room.resumeTitle' : 'room.title')
    );
  }

  get canSubmit(): boolean {
    if (!this.roomName?.trim() || this.roomName.trim().length > 16) return false;
    if (!this.validateLength) return false;
    if ((this.gmPassword?.length ?? 0) > 12) return false;
    if (this.allowUser && (this.userPassword?.length ?? 0) > 12) return false;
    if (this.allowGuest && (this.guestPassword?.length ?? 0) > 12) return false;
    return true;
  }

  onAllowUserChange() {
    if (!this.allowUser) this.userPassword = '';
    this.recalcPeerId();
  }

  onAllowGuestChange() {
    if (!this.allowGuest) this.guestPassword = '';
    this.recalcPeerId();
  }

  private buildRoleAuthInputs(): { gm: RoleAuthInput; user: RoleAuthInput; guest: RoleAuthInput } {
    return {
      gm: this.gmPassword,
      user: this.allowUser
        ? this.userPassword
        : { mode: 'disabled' },
      guest: this.allowGuest
        ? this.guestPassword
        : { mode: 'disabled' },
    };
  }

  private resolveCreateRoomId(): string {
    if (this.editMode && Network.peer?.isRoom) return Network.peer.roomId;
    if (this.preferredRoomId) return this.preferredRoomId;
    return PeerContext.generateId('***');
  }

  recalcPeerId() {
    const roomId = this.resolveCreateRoomId();
    const encoded = RoomAuth.encode(this.roomName, roomId, this.buildRoleAuthInputs());
    const userId = Network.peer.userId;
    const peer = PeerContext.create(userId, roomId, encoded, '');
    this.validateLength = peer.peerId.length < 64;
  }

  createRoom() {
    const userId = Network.peer.userId;
    const roomId = this.resolveCreateRoomId();
    const roles = this.buildRoleAuthInputs();
    const encodedName = RoomAuth.encode(this.roomName, roomId, roles);
    // Role-auth rooms use empty skyway password; roles are gated by RoomAuth digests.
    Network.open(userId, roomId, encodedName, '');
    PeerCursor.myCursor.peerId = Network.peerId;
    // Host joins as GM. Pass roomId explicitly — Network.open is async so peer.roomId may lag.
    RoomAuth.applyIdentity('gm', roomId);
    // Keep plaintext role passwords in-session for invite-link generation.
    this.roomInvite.setRolePasswords({
      gm: this.gmPassword,
      user: this.allowUser ? this.userPassword : '',
      guest: this.allowGuest ? this.guestPassword : '',
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
    const roles = this.buildRoleAuthInputs();
    const encodedName = RoomAuth.encode(this.roomName, roomId, roles);

    this.roomInvite.setRolePasswords({
      gm: this.gmPassword,
      user: this.allowUser ? this.userPassword : '',
      guest: this.allowGuest ? this.guestPassword : '',
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
