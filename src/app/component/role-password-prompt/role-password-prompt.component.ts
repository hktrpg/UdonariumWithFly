import { AfterViewInit, Component, ElementRef, OnDestroy, OnInit, ViewChild } from '@angular/core';

import { EventSystem } from '@udonarium/core/system';
import { RoomAuth, RoomRole } from '@udonarium/room-auth';

import { ModalService } from 'service/modal.service';
import { PanelService } from 'service/panel.service';
import { I18nService } from 'service/i18n.service';

@Component({
  selector: 'role-password-prompt',
  templateUrl: './role-password-prompt.component.html',
  styleUrls: ['../shared/settings-ui.css'],
  standalone: false
})
export class RolePasswordPromptComponent implements OnInit, AfterViewInit, OnDestroy {
  @ViewChild('passwordInput', { static: true }) passwordInputElementRef: ElementRef<HTMLInputElement>;

  roomId: string = '';
  roomName: string = '';
  role: RoomRole = 'user';
  password: string = '';
  help: string = '';

  constructor(
    private panelService: PanelService,
    private modalService: ModalService,
    private i18n: I18nService,
  ) {
    this.roomId = modalService.option.roomId || '';
    this.roomName = modalService.option.roomName || '';
    this.role = modalService.option.role || 'user';
  }

  ngOnInit() {
    Promise.resolve().then(() => this.refreshTitle());
    EventSystem.register(this).on('LOCALE_CHANGED', () => this.refreshTitle());
  }

  ngAfterViewInit() {
    this.passwordInputElementRef.nativeElement.focus();
  }

  ngOnDestroy() {
    EventSystem.unregister(this);
  }

  private refreshTitle() {
    const roleLabel = this.i18n.t(`roomJoin.role.${this.role}.label`);
    this.modalService.title = this.panelService.title = this.i18n.t('invite.passwordPromptTitle', { role: roleLabel });
  }

  onInputChange() {
    this.help = '';
  }

  submit() {
    if (!RoomAuth.verify(this.roomId, this.roomName, this.role, this.password || '')) {
      this.help = this.i18n.t('roomJoin.errorWrongPassword');
      return;
    }
    this.modalService.resolve(this.password || '');
  }

  cancel() {
    this.modalService.resolve(null);
  }
}
