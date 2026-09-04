import { Component, OnDestroy, OnInit } from '@angular/core';
import { EventSystem } from '@udonarium/core/system';
import { I18nService } from 'service/i18n.service';
import { ModalService } from 'service/modal.service';
import { PanelService } from 'service/panel.service';

export type CardSheetImportResult = {
  cols: number;
  rows: number;
  numCards: number;
};

@Component({
  selector: 'app-card-sheet-import',
  templateUrl: './card-sheet-import.component.html',
  styleUrls: ['../shared/settings-ui.css', './card-sheet-import.component.css'],
  standalone: false,
})
export class CardSheetImportComponent implements OnInit, OnDestroy {
  cols = 10;
  rows = 7;
  numCards = 70;
  /** When true, keep numCards synced to cols*rows until the user edits it. */
  private numCardsAuto = true;

  constructor(
    private modalService: ModalService,
    private panelService: PanelService,
    private i18n: I18nService,
  ) {
    const opt = modalService.option || {};
    if (opt.cols != null) this.cols = Number(opt.cols) || this.cols;
    if (opt.rows != null) this.rows = Number(opt.rows) || this.rows;
    if (opt.numCards != null) {
      this.numCards = Number(opt.numCards) || this.numCards;
      this.numCardsAuto = false;
    } else {
      this.numCards = this.maxSlots;
    }
  }

  get maxSlots(): number {
    const c = Math.max(1, Math.floor(Number(this.cols)) || 1);
    const r = Math.max(1, Math.floor(Number(this.rows)) || 1);
    return c * r;
  }

  get canConfirm(): boolean {
    const cols = Math.floor(Number(this.cols));
    const rows = Math.floor(Number(this.rows));
    const n = Math.floor(Number(this.numCards));
    return cols >= 1 && rows >= 1 && n >= 1 && n <= cols * rows;
  }

  ngOnInit() {
    Promise.resolve().then(() => this.refreshTitle());
    EventSystem.register(this).on('LOCALE_CHANGED', () => this.refreshTitle());
  }

  ngOnDestroy() {
    EventSystem.unregister(this);
  }

  onGridChange() {
    if (this.numCardsAuto) {
      this.numCards = this.maxSlots;
    } else if (Math.floor(Number(this.numCards)) > this.maxSlots) {
      this.numCards = this.maxSlots;
    }
  }

  onNumCardsEdit() {
    this.numCardsAuto = false;
  }

  confirm() {
    if (!this.canConfirm) return;
    const result: CardSheetImportResult = {
      cols: Math.floor(Number(this.cols)),
      rows: Math.floor(Number(this.rows)),
      numCards: Math.floor(Number(this.numCards)),
    };
    this.modalService.resolve(result);
  }

  cancel() {
    this.modalService.resolve(false);
  }

  private refreshTitle() {
    this.modalService.title = this.panelService.title = this.i18n.t('cardSheet.title');
  }
}
