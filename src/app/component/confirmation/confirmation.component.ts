import { Component, OnDestroy, OnInit } from '@angular/core';
import { ModalService } from 'service/modal.service';
import { PanelService } from 'service/panel.service';
import { EventSystem } from '@udonarium/core/system';
import { I18nService } from 'service/i18n.service';

@Component({
    selector: 'app-confirmation',
    templateUrl: './confirmation.component.html',
    styleUrls: ['../shared/settings-ui.css', './confirmation.component.css'],
    standalone: false
})
export class ConfirmationComponent implements OnInit, OnDestroy {
  title: string = '';
  subTitle: string = '';
  text: string = '';
  help: string = '';
  helpHtml: string = '';
  /** Red warning line (shown above gray help). */
  warn: string = '';
  /**
   * When set with hasInput, show `warn` only while Number(inputValue) exceeds this.
   * Omit to always show `warn` when non-empty.
   */
  warnWhenInputAbove: number | null = null;
  /** Structured help blocks (title / chips / body) for richer confirmations. */
  helpSections: { title?: string; body?: string; chips?: { label: string; tone?: string }[] }[] = [];
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

  /** Optional radio choices; OK resolves `{ choice, remember }` when set. */
  choices: { id: string; label: string }[] = [];
  choiceValue: string = '';
  rememberLabel: string = '';
  rememberValue: boolean = false;
  /** When true, OK stays disabled until a radio choice is selected. */
  requireChoice: boolean = false;

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
    this.warn = modalService.option.warn ? String(modalService.option.warn) : '';
    this.warnWhenInputAbove = modalService.option.warnWhenInputAbove != null
      ? Number(modalService.option.warnWhenInputAbove)
      : null;
    if (this.warnWhenInputAbove != null && !Number.isFinite(this.warnWhenInputAbove)) {
      this.warnWhenInputAbove = null;
    }
    this.helpSections = Array.isArray(modalService.option.helpSections) ? modalService.option.helpSections : [];
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
    this.choices = Array.isArray(modalService.option.choices) ? modalService.option.choices : [];
    this.requireChoice = !!modalService.option.requireChoice;
    if (modalService.option.choiceValue != null) {
      this.choiceValue = String(modalService.option.choiceValue);
    } else if (this.requireChoice) {
      this.choiceValue = '';
    } else {
      this.choiceValue = this.choices[0]?.id || '';
    }
    this.rememberLabel = modalService.option.rememberLabel ? modalService.option.rememberLabel : '';
    this.rememberValue = !!modalService.option.rememberValue;
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

  /** True when warn text should be visible (optionally gated on input count). */
  get showWarn(): boolean {
    if (!this.warn) return false;
    if (this.warnWhenInputAbove == null || !this.hasInput) return true;
    const n = Number(this.inputValue);
    return Number.isFinite(n) && n > this.warnWhenInputAbove;
  }

  ok() {
    if (this.choices.length && this.requireChoice && !this.choiceValue) return;
    if (this.choices.length) {
      this.modalService.resolve({
        choice: this.choiceValue,
        remember: !!this.rememberValue,
      });
    } else if (this.hasInput) {
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
