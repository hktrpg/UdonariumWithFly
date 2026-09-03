import { Component, OnDestroy, OnInit } from '@angular/core';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
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
  /** Object URL of the face sheet for the live grid preview (revoked on destroy). */
  previewUrl = '';
  previewSafeUrl: SafeResourceUrl | null = null;
  /** When true, keep numCards synced to cols*rows until the user edits it. */
  private numCardsAuto = true;

  constructor(
    private modalService: ModalService,
    private panelService: PanelService,
    private i18n: I18nService,
    private sanitizer: DomSanitizer,
  ) {
    const opt = modalService.option || {};
    if (opt.cols != null) this.cols = Number(opt.cols) || this.cols;
    if (opt.rows != null) this.rows = Number(opt.rows) || this.rows;
    if (opt.previewFile instanceof Blob) {
      this.previewUrl = URL.createObjectURL(opt.previewFile);
      this.previewSafeUrl = this.sanitizer.bypassSecurityTrustResourceUrl(this.previewUrl);
    } else if (typeof opt.previewUrl === 'string' && opt.previewUrl) {
      this.previewUrl = '';
      this.previewSafeUrl = this.sanitizer.bypassSecurityTrustResourceUrl(opt.previewUrl);
    }
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

  get safeCols(): number {
    return Math.max(1, Math.min(40, Math.floor(Number(this.cols)) || 1));
  }

  get safeRows(): number {
    return Math.max(1, Math.min(40, Math.floor(Number(this.rows)) || 1));
  }

  get safeNumCards(): number {
    const max = this.safeCols * this.safeRows;
    return Math.max(1, Math.min(max, Math.floor(Number(this.numCards)) || 1));
  }

  /** Indices 0..cols*rows-1 for the grid overlay cells. */
  get slotIndexes(): number[] {
    const n = this.safeCols * this.safeRows;
    return Array.from({ length: n }, (_, i) => i);
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
    if (this.previewUrl) {
      URL.revokeObjectURL(this.previewUrl);
      this.previewUrl = '';
    }
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
