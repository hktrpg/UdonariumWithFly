import { Component, OnDestroy, OnInit } from '@angular/core';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { detectSheetCropMarks } from '@udonarium/card-sheet-slice';
import { CropMarkGrid } from '@udonarium/card-sheet-trim';
import { EventSystem } from '@udonarium/core/system';
import { parsePageRange, PageRangeError } from '@udonarium/page-range';
import { peekPdfPageCount, renderPdfPagePreviewPng } from '@udonarium/pdf-card-sheet';
import { I18nService } from 'service/i18n.service';
import { ModalService } from 'service/modal.service';
import { PanelService } from 'service/panel.service';

export type CardSheetImportResult = {
  cols: number;
  rows: number;
  numCards: number;
  /** 1-based pages when importing a PDF; omitted for image sheets. */
  pages?: number[];
  /** Slice on detected crop / trim marks when possible. */
  autoTrim: boolean;
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
  /** Print-style page list for PDF imports. */
  pageRange = '';
  pageCount = 0;
  autoTrim = true;
  isPdf = false;
  previewLoading = false;
  detectStatus: 'idle' | 'ok' | 'fail' = 'idle';
  /** Object URL of the face sheet for the live grid preview (revoked on destroy). */
  previewUrl = '';
  previewSafeUrl: SafeResourceUrl | null = null;
  /** Percent positions (0–100) for crop-mark overlay lines. */
  markXs: number[] = [];
  markYs: number[] = [];
  /** When true, keep numCards synced to cols*rows until the user edits it. */
  private numCardsAuto = true;
  private previewFile: Blob | null = null;
  private previewImageW = 0;
  private previewImageH = 0;

  constructor(
    private modalService: ModalService,
    private panelService: PanelService,
    private i18n: I18nService,
    private sanitizer: DomSanitizer,
  ) {
    const opt = modalService.option || {};
    this.isPdf = !!opt.isPdf;
    if (opt.cols != null) this.cols = Number(opt.cols) || this.cols;
    if (opt.rows != null) this.rows = Number(opt.rows) || this.rows;
    if (opt.autoTrim != null) this.autoTrim = !!opt.autoTrim;
    if (this.isPdf) {
      // PnP letter sheets are commonly 4×2 poker cards.
      this.cols = opt.cols != null ? this.cols : 4;
      this.rows = opt.rows != null ? this.rows : 2;
      this.autoTrim = opt.autoTrim != null ? this.autoTrim : true;
    }
    if (opt.previewFile instanceof Blob) {
      this.previewFile = opt.previewFile;
    } else if (typeof opt.previewUrl === 'string' && opt.previewUrl) {
      this.previewSafeUrl = this.sanitizer.bypassSecurityTrustResourceUrl(opt.previewUrl);
    }
    if (opt.numCards != null) {
      this.numCards = Number(opt.numCards) || this.numCards;
      this.numCardsAuto = false;
    } else {
      this.numCards = this.maxSlots;
    }
    if (typeof opt.pageRange === 'string') this.pageRange = opt.pageRange;
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

  /** Indices 0..cols*rows-1 for the equal-grid overlay cells. */
  get slotIndexes(): number[] {
    const n = this.safeCols * this.safeRows;
    return Array.from({ length: n }, (_, i) => i);
  }

  get useMarkOverlay(): boolean {
    return this.autoTrim && this.markXs.length >= 2 && this.markYs.length >= 2;
  }

  get pageRangeError(): string {
    if (!this.isPdf) return '';
    try {
      parsePageRange(this.pageRange, Math.max(1, this.pageCount || 1));
      return '';
    } catch (err) {
      if (err instanceof PageRangeError) {
        return this.i18n.t(`cardSheet.error.page_${err.code}`);
      }
      return this.i18n.t('cardSheet.error.page_invalid');
    }
  }

  get canConfirm(): boolean {
    const cols = Math.floor(Number(this.cols));
    const rows = Math.floor(Number(this.rows));
    const n = Math.floor(Number(this.numCards));
    if (!(cols >= 1 && rows >= 1 && n >= 1 && n <= cols * rows)) return false;
    if (this.isPdf) {
      if (this.previewLoading) return false;
      if (!this.pageCount) return false;
      return !this.pageRangeError;
    }
    return true;
  }

  ngOnInit() {
    Promise.resolve().then(() => this.refreshTitle());
    EventSystem.register(this).on('LOCALE_CHANGED', () => this.refreshTitle());
    void this.bootstrapPreview();
  }

  ngOnDestroy() {
    EventSystem.unregister(this);
    this.revokePreviewUrl();
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

  onAutoTrimChange() {
    if (this.autoTrim && this.detectStatus === 'idle') {
      void this.redetectFromPreviewImg();
    }
  }

  onPreviewImgLoad(ev: Event) {
    const img = ev.target as HTMLImageElement | null;
    if (!img) return;
    this.previewImageW = img.naturalWidth || img.width;
    this.previewImageH = img.naturalHeight || img.height;
    if (this.autoTrim) this.applyDetectedGrid(detectSheetCropMarks(img));
  }

  confirm() {
    if (!this.canConfirm) return;
    const result: CardSheetImportResult = {
      cols: Math.floor(Number(this.cols)),
      rows: Math.floor(Number(this.rows)),
      numCards: Math.floor(Number(this.numCards)),
      autoTrim: !!this.autoTrim,
    };
    if (this.isPdf) {
      result.pages = parsePageRange(this.pageRange, this.pageCount);
    }
    this.modalService.resolve(result);
  }

  cancel() {
    this.modalService.resolve(false);
  }

  private async bootstrapPreview() {
    if (!this.previewFile) return;
    this.previewLoading = true;
    try {
      if (this.isPdf) {
        const preview = await renderPdfPagePreviewPng(this.previewFile, 1, 720);
        this.pageCount = preview.pageCount;
        if (!this.pageRange.trim()) {
          this.pageRange = this.pageCount > 1 ? `1-${this.pageCount}` : '1';
        }
        this.setPreviewBlob(preview.blob);
      } else {
        this.setPreviewBlob(this.previewFile);
      }
    } catch (err) {
      console.warn('card-sheet preview failed', err);
      this.detectStatus = 'fail';
    } finally {
      this.previewLoading = false;
    }
  }

  private setPreviewBlob(blob: Blob) {
    this.revokePreviewUrl();
    this.previewUrl = URL.createObjectURL(blob);
    this.previewSafeUrl = this.sanitizer.bypassSecurityTrustResourceUrl(this.previewUrl);
  }

  private revokePreviewUrl() {
    if (this.previewUrl) {
      URL.revokeObjectURL(this.previewUrl);
      this.previewUrl = '';
    }
  }

  private redetectFromPreviewImg() {
    // Triggered when toggling autoTrim after image already loaded — use a temp Image.
    if (!this.previewUrl) return;
    const img = new Image();
    img.onload = () => this.applyDetectedGrid(detectSheetCropMarks(img));
    img.src = this.previewUrl;
  }

  private applyDetectedGrid(grid: CropMarkGrid | null) {
    if (!grid || grid.xs.length < 2 || grid.ys.length < 2) {
      this.detectStatus = 'fail';
      this.markXs = [];
      this.markYs = [];
      return;
    }
    this.detectStatus = 'ok';
    const w = this.previewImageW || grid.xs[grid.xs.length - 1] || 1;
    const h = this.previewImageH || grid.ys[grid.ys.length - 1] || 1;
    this.markXs = grid.xs.map(x => (x / w) * 100);
    this.markYs = grid.ys.map(y => (y / h) * 100);
    const dCols = grid.xs.length - 1;
    const dRows = grid.ys.length - 1;
    if (dCols >= 1 && dRows >= 1) {
      this.cols = dCols;
      this.rows = dRows;
      if (this.numCardsAuto) this.numCards = dCols * dRows;
      else if (this.numCards > dCols * dRows) this.numCards = dCols * dRows;
    }
  }

  private refreshTitle() {
    const key = this.isPdf ? 'cardSheet.titlePdf' : 'cardSheet.title';
    this.modalService.title = this.panelService.title = this.i18n.t(key);
  }
}
