import { Component, OnDestroy, OnInit } from '@angular/core';

import { IRoomInfo } from '@udonarium/core/system/network/room-info';
import { RoomAuth, RoomJoinResult, RoomRole } from '@udonarium/room-auth';

import { ModalService } from 'service/modal.service';
import { PanelService } from 'service/panel.service';

@Component({
  selector: 'room-join',
  templateUrl: './room-join.component.html',
  styleUrls: ['./room-join.component.css'],
  standalone: false
})
export class RoomJoinComponent implements OnInit, OnDestroy {
  room: IRoomInfo;
  role: RoomRole = 'user';
  password: string = '';
  help: string = '';
  /** When true, used from peer-menu「轉換身份」instead of lobby join. */
  switchMode = false;
  currentRole: RoomRole = null;

  readonly roles: { id: RoomRole; label: string; hint: string }[] = [
    { id: 'gm', label: 'GM', hint: '遊戲主持人' },
    { id: 'user', label: '玩家', hint: '一般參加者' },
    { id: 'guest', label: '訪客', hint: '功能受限' },
  ];

  constructor(
    private panelService: PanelService,
    private modalService: ModalService,
  ) {
    this.room = modalService.option.room;
    this.switchMode = !!modalService.option.switchMode;
    this.currentRole = modalService.option.currentRole || null;
  }

  get title(): string {
    if (!this.room) return '';
    return `${RoomAuth.displayRoomName(this.room.name)}/${this.room.id}`;
  }

  get submitLabel(): string {
    return this.switchMode ? '確認轉換' : '進入房間';
  }

  ngOnInit() {
    Promise.resolve().then(() => {
      const head = this.switchMode ? '轉換身份' : '選擇身份';
      this.modalService.title = this.panelService.title = this.room
        ? `${head}〈${this.title}〉`
        : head;
    });
    if (this.currentRole && this.isRoleAvailable(this.currentRole)) {
      this.role = this.currentRole;
      return;
    }
    const order: RoomRole[] = ['user', 'gm', 'guest'];
    const first = order.find(r => this.isRoleAvailable(r));
    if (first) this.role = first;
  }

  ngOnDestroy() { }

  isRoleAvailable(role: RoomRole): boolean {
    if (!this.room) {
      return role === 'gm' || role === 'user';
    }
    return RoomAuth.isRoleAvailable(this.room.name, role);
  }

  needsPassword(): boolean {
    return this.needsPasswordFor(this.role);
  }

  needsPasswordFor(role: RoomRole): boolean {
    if (!this.room) return false;
    // Legacy / non-role-auth: no per-role password gate.
    if (!RoomAuth.isRoleAuthRoom(this.room.name)) return false;
    return RoomAuth.roleNeedsPassword(this.room.name, role);
  }

  onRoleChange() {
    this.password = '';
    this.help = '';
  }

  submit() {
    if (!this.isRoleAvailable(this.role)) {
      this.help = '此身份不可用';
      return;
    }
    if (this.switchMode && this.currentRole && this.role === this.currentRole) {
      this.help = '已是此身份';
      return;
    }
    if (this.room && RoomAuth.isRoleAuthRoom(this.room.name)) {
      if (this.needsPassword()) {
        if (!RoomAuth.verify(this.room.id, this.room.name, this.role, this.password)) {
          this.help = '密碼錯誤';
          return;
        }
      } else if (!RoomAuth.verify(this.room.id, this.room.name, this.role, '')) {
        this.help = '無法切換為此身份';
        return;
      }
    }
    const result: RoomJoinResult = { role: this.role, password: this.password || '' };
    this.modalService.resolve(result);
  }

  cancel() {
    this.modalService.resolve(null);
  }
}
