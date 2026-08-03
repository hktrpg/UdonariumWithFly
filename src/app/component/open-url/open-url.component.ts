import { Component, OnDestroy, OnInit } from '@angular/core';
import { EventSystem } from '@udonarium/core/system';
import { ModalService } from 'service/modal.service';
import { PanelService } from 'service/panel.service';
import { StringUtil } from '@udonarium/core/system/util/string-util';
import { I18nService } from 'service/i18n.service';

@Component({
    selector: 'open-url',
    templateUrl: './open-url.component.html',
    styleUrls: ['./open-url.component.css'],
    standalone: false
})
export class OpenUrlComponent implements OnInit, OnDestroy {
  url: string = '';
  title: string = '';
  subTitle: string = '';
  urlObj: URL;

  constructor(
    private panelService: PanelService,
    private modalService: ModalService,
    public i18n: I18nService
  ) {
    this.url = modalService.option.url ? modalService.option.url : '';
    this.title = modalService.option.title ? modalService.option.title : '';
    this.subTitle = modalService.option.subTitle ? modalService.option.subTitle : '';
    this.urlObj = (this.isValid ? new URL(this.url) : null);
  }

  get isValid(): boolean {
    return StringUtil.validUrl(this.url.trim());
  }

  get isOuter(): boolean {
    if (!this.isValid) return false;
    return window.location.origin != this.urlObj.origin;
  }

  ngOnInit() {
    Promise.resolve().then(() => this.updateTitle());
    EventSystem.register(this).on('LOCALE_CHANGED', -1000, () => this.updateTitle());
  }

  private updateTitle() {
    let titleBar = this.i18n.t('url.title');
    if (this.title) {
      titleBar += ('〈' + this.title + (this.subTitle ? `：${this.subTitle}` : '') + '〉');
    } else if (this.subTitle) {
      titleBar += `〈${this.subTitle}〉`;
    }
    this.modalService.title = this.panelService.title = titleBar;
  }

  ngOnDestroy() {
    EventSystem.unregister(this);
  }

  openUrl() {
    window.open(this.url.trim(), '_blank', 'noreferrer');
    this.modalService.resolve(true);
  }

  cancel() {
    this.modalService.resolve(false);
  }
}
