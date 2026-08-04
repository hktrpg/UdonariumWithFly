import { Component, OnDestroy, OnInit } from '@angular/core';
import { ModalService } from 'service/modal.service';
import { PanelService } from 'service/panel.service';
import { EventSystem } from '@udonarium/core/system';
import { I18nService } from 'service/i18n.service';

@Component({
    selector: 'app-confirmation',
    templateUrl: './confirmation.component.html',
    styleUrls: ['./confirmation.component.css'],
    standalone: false
})
export class ConfirmationComponent implements OnInit, OnDestroy {
  title: string = '';
  subTitle: string = '';
  text: string = '';
  help: string = '';
  helpHtml: string = '';
  materialIcon: string = '';
  okLabel: string = '';
  cancelLabel: string = '';
  extraLabel: string = '';
  type: ConfirmationType = ConfirmationType.OK;
  action: Function = null;
  cancelAction: Function = null;
  extraAction: Function = null;
  /** When true, extra button closes the modal after running extraAction. Default false. */
  extraCloses: boolean = false;

  /** Optional single-line prompt; OK resolves with the string (cancel still resolves false). */
  hasInput: boolean = false;
  inputLabel: string = '';
  inputValue: string = '';
  inputPlaceholder: string = '';

  constructor(
    private panelService: PanelService,
    private modalService: ModalService,
    private i18n: I18nService
  ) { 
    this.title = modalService.option.title ? modalService.option.title : '';
    this.subTitle = modalService.option.subTitle ? modalService.option.subTitle : '';
    this.text = modalService.option.text ? modalService.option.text : '';
    this.help = modalService.option.help ? modalService.option.help : '';
    this.helpHtml = modalService.option.helpHtml ? modalService.option.helpHtml : '';
    this.materialIcon = modalService.option.materialIcon ? modalService.option.materialIcon : '';
    this.okLabel = modalService.option.okLabel ? modalService.option.okLabel : '';
    this.cancelLabel = modalService.option.cancelLabel ? modalService.option.cancelLabel : '';
    this.extraLabel = modalService.option.extraLabel ? modalService.option.extraLabel : '';
    this.type = modalService.option.type ? modalService.option.type : ConfirmationType.OK;
    this.action = modalService.option.action ? modalService.option.action : null;
    this.cancelAction = modalService.option.cancelAction ? modalService.option.cancelAction : null;
    this.extraAction = modalService.option.extraAction ? modalService.option.extraAction : null;
    this.extraCloses = !!modalService.option.extraCloses;
    this.hasInput = !!modalService.option.inputLabel || modalService.option.inputValue != null || !!modalService.option.hasInput;
    this.inputLabel = modalService.option.inputLabel ? modalService.option.inputLabel : '';
    this.inputValue = modalService.option.inputValue != null ? String(modalService.option.inputValue) : '';
    this.inputPlaceholder = modalService.option.inputPlaceholder ? modalService.option.inputPlaceholder : '';
  }

  ngOnInit() {
    Promise.resolve().then(() => {
      let titleBar = this.i18n.t('confirm.title');
      if (this.title) {
        titleBar += ('〈' + this.title + (this.subTitle ? `：${this.subTitle}` : '') + '〉');
      } else if (this.subTitle) {
        titleBar += `〈${this.subTitle}〉`;
      }
      this.modalService.title = this.panelService.title = titleBar;
    });
    EventSystem.register(this)
      .on('LOCALE_CHANGED', () => this.refreshTitle());
  }

  ngOnDestroy() {
    EventSystem.unregister(this);
  }

  private refreshTitle() {
    let titleBar = this.i18n.t('confirm.title');
    if (this.title) {
      titleBar += ('〈' + this.title + (this.subTitle ? `：${this.subTitle}` : '') + '〉');
    } else if (this.subTitle) {
      titleBar += `〈${this.subTitle}〉`;
    }
    this.modalService.title = this.panelService.title = titleBar;
  }

  ok() {
    if (this.hasInput) {
      this.modalService.resolve(this.inputValue);
    } else {
      this.modalService.resolve(true);
    }
    if (this.action) this.action();
  }

  cancel() {
    this.modalService.resolve(false);
    if (this.cancelAction) this.cancelAction();
  }

  extra() {
    if (this.extraAction) this.extraAction();
    if (this.extraCloses) this.modalService.resolve('extra');
  }
}

export enum ConfirmationType {
  OK = 1,
  OK_CANCEL = 2
}
