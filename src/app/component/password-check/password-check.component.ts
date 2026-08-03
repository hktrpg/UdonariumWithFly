import { AfterViewInit, Component, ElementRef, OnDestroy, OnInit, ViewChild } from '@angular/core';

import { EventSystem, Network } from '@udonarium/core/system';
import { PeerContext } from '@udonarium/core/system/network/peer-context';

import { ModalService } from 'service/modal.service';
import { PanelService } from 'service/panel.service';
import { I18nService } from 'service/i18n.service';

@Component({
    selector: 'password-check',
    templateUrl: './password-check.component.html',
    styleUrls: ['./password-check.component.css'],
    standalone: false
})
export class PasswordCheckComponent implements OnInit, AfterViewInit, OnDestroy {
  @ViewChild('passwordInput', { static: true }) passwordInputElementRef: ElementRef<HTMLInputElement>;

  password: string = '';
  help: string = '';

  private targetPeers: PeerContext[] = [];
  title: string = '';

  get peerId(): string { return Network.peerId; }
  get isConnected(): boolean { return 0 < Network.peerIds.length; }

  constructor(
    private panelService: PanelService,
    private modalService: ModalService,
    public i18n: I18nService
  ) {
    this.targetPeers = modalService.option.peers ?? [];
    this.title = modalService.option.title ? modalService.option.title : '';
  }

  ngOnInit() {
    Promise.resolve().then(() => this.updateTitle());
    EventSystem.register(this).on('LOCALE_CHANGED', -1000, () => this.updateTitle());
  }

  ngAfterViewInit() {
    this.passwordInputElementRef.nativeElement.focus();
  }

  private updateTitle() {
    this.modalService.title = this.panelService.title = this.i18n.t('pass.title', { title: this.title });
  }

  ngOnDestroy() {
    EventSystem.unregister(this);
  }

  onInputChange(value: string) {
    this.help = '';
  }

  submit() {
    if (this.targetPeers.find(peer => peer.verifyPassword(this.password))) this.modalService.resolve(this.password);
    this.help = this.i18n.t('pass.invalid');
  }
}