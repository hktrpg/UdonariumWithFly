import { ChangeDetectorRef, Component, HostListener, OnDestroy, OnInit } from '@angular/core';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { detectSheetCropMarks, detectSheetSoftMargins } from '@udonarium/card-sheet-slice';
import { contentRectFromInsets, CropMarkGrid, insetsFromCropMarkGrid } from '@udonarium/card-sheet-trim';
import { EventSystem } from '@udonarium/core/system';
import { parsePageRange, PageRangeError } from '@udonarium/page-range';
import { renderPdfPagePreviewPng } from '@udonarium/pdf-card-sheet';
import {
  clampFloorCropInsets,
  emptyFloorCropInsets,
  FloorCropInsets,
  floorCropInsetsAlmostZero,
} from '@udonarium/table-floor-crop';
import { I18nService } from 'service/i18n.service';
import { ModalService } from 'service/modal.service';
import { PanelService } from 'service/panel.service';

export type CardSheetImportResult = {
  cols: number;
  rows: number;
  numCards: number;
  /** 1-based pages when importing a multi-page sheet (PDF or image pages). */
  pages?: number[];
  /** Slice on detected crop / trim marks / gutters when possible. */
  autoTrim: boolean;
  /** Outer edge trim percentages (map-style). */
  insets: FloorCropInsets;
};

type TrimEdge = keyof FloorCropInsets;
type PreviewDragMode = 'pan' | 'trim';

const PREVIEW_ZOOM_MIN = 1;
const PREVIEW_ZOOM_MAX = 5;
/** Magnetic snap distance for trim handles (% of sheet). */
const TRIM_SNAP_PCT = 1.25;

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
  /** Print-style page list for multi-page imports. */
  pageRange = '';
  pageCount = 0;
  previewPage = 1;
  autoTrim = true;
  isPdf = false;
  previewLoading = false;
  detectStatus: 'idle' | 'ok' | 'fail' = 'idle';
  insets: FloorCropInsets = emptyFloorCropInsets();
  readonly sliderMax = 45;
  /** Preview zoom / pan for precise trim inspection. */
  previewZoom = 1;
  panX = 0;
  panY = 0;
  /** Object URL of the face sheet for the live grid preview (revoked on destroy). */
  previewUrl = '';
  previewSafeUrl: SafeResourceUrl | null = null;
  /** Percent positions (0–100) for crop-mark overlay lines (relative to full preview). */
  markXs: number[] = [];
  markYs: number[] = [];
  /** Magnetic snap targets for trim handles (sheet %). */
  snapX: number[] = [];
  snapY: number[] = [];
  /** When true, keep numCards synced to cols*rows until the user edits it. */
  private numCardsAuto = true;
  private previewFile: Blob | null = null;
  /** Extra sheet pages for multi-image imports (index 0 = first page). */
  private sheetPages: Blob[] = [];
  private previewImageW = 0;
  private previewImageH = 0;
  private softMarginsSeeded = false;
  private loadToken = 0;
  private dragMode: PreviewDragMode | null = null;
  private trimEdge: TrimEdge | null = null;
  private dragPointerId = -1;
  private dragLastX = 0;
  private dragLastY = 0;
  private stageEl: HTMLElement | null = null;
  /** Soft-margin snapshot used as magnetic targets after the user edits. */
  private softSnap: FloorCropInsets = emptyFloorCropInsets();

  constructor(
    private modalService: ModalService,
    private panelService: PanelService,
    private i18n: I18nService,
    private sanitizer: DomSanitizer,
    private changeDetector: ChangeDetectorRef,
  ) {
    const opt = modalService.option || {};
    this.isPdf = !!opt.isPdf;
    if (opt.cols != null) this.cols = Number(opt.cols) || this.cols;
    if (opt.rows != null) this.rows = Number(opt.rows) || this.rows;
    if (opt.autoTrim != null) this.autoTrim = !!opt.autoTrim;
    if (opt.insets) this.insets = clampFloorCropInsets(opt.insets);

    if (Array.isArray(opt.sheetPages) && opt.sheetPages.length) {
      this.sheetPages = opt.sheetPages.filter((b: unknown) => b instanceof Blob);
    }

    if (this.isPdf || this.sheetPages.length > 1) {
      // PnP letter sheets are commonly 4×2 poker cards.
      this.cols = opt.cols != null ? this.cols : 4;
      this.rows = opt.rows != null ? this.rows : 2;
      this.autoTrim = opt.autoTrim != null ? this.autoTrim : true;
    }

    if (opt.previewFile instanceof Blob) {
      this.previewFile = opt.previewFile;
    } else if (this.sheetPages[0]) {
      this.previewFile = this.sheetPages[0];
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

  get showPageControls(): boolean {
    return this.pageCount > 1;
  }

  /** Keep a fixed preview shell so page turns do not collapse the modal. */
  get showPreviewShell(): boolean {
    return !!(this.previewSafeUrl || this.previewLoading || this.pageCount > 0 || this.previewFile || this.sheetPages.length);
  }

  get showPageRange(): boolean {
    return this.isPdf || this.sheetPages.length > 1;
  }

  get clipPath(): string {
    // Kept for compatibility; preview uses dim-outside window instead of clipping.
    return 'none';
  }

  get previewTransform(): string {
    return `translate(${this.panX}px, ${this.panY}px) scale(${this.previewZoom})`;
  }

  get isPanning(): boolean {
    return this.dragMode === 'pan';
  }

  get isTrimDragging(): boolean {
    return this.dragMode === 'trim';
  }

  get viewAltered(): boolean {
    return this.previewZoom > 1 || this.panX !== 0 || this.panY !== 0;
  }

  get trimWindowStyle(): Record<string, string> {
    const i = this.insets;
    return {
      top: `${i.top}%`,
      right: `${i.right}%`,
      bottom: `${i.bottom}%`,
      left: `${i.left}%`,
    };
  }

  get gridInsetStyle(): Record<string, string> {
    return this.trimWindowStyle;
  }

  /** Line position from the left/top of the sheet (0–100). */
  trimLinePos(edge: TrimEdge): number {
    if (edge === 'left') return this.insets.left;
    if (edge === 'right') return 100 - this.insets.right;
    if (edge === 'top') return this.insets.top;
    return 100 - this.insets.bottom;
  }

  get pageRangeError(): string {
    if (!this.showPageRange) return '';
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
    if (this.previewLoading) return false;
    if (this.showPageRange) {
      if (!this.pageCount) return false;
      return !this.pageRangeError;
    }
    return true;
  }

  get canPrevPage(): boolean {
    return this.previewPage > 1 && !this.previewLoading;
  }

  get canNextPage(): boolean {
    return this.previewPage < this.pageCount && !this.previewLoading;
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
    // Auto-trim must not own Width×Height — refresh overlay against the user's grid.
    if (this.autoTrim) {
      this.markXs = [];
      this.markYs = [];
      this.detectStatus = 'idle';
      void this.redetectGuttersOnly();
    }
    this.changeDetector.markForCheck();
  }

  onNumCardsEdit() {
    this.numCardsAuto = false;
  }

  onAutoTrimChange() {
    if (this.autoTrim) {
      this.softMarginsSeeded = false;
      void this.redetectFromPreviewImg();
    } else {
      this.markXs = [];
      this.markYs = [];
      this.detectStatus = 'idle';
      this.changeDetector.markForCheck();
    }
  }

  pct(edge: keyof FloorCropInsets): number {
    return this.insets[edge];
  }

  setPct(edge: keyof FloorCropInsets, value: number) {
    this.insets = clampFloorCropInsets({ ...this.insets, [edge]: Number(value) || 0 });
    // Manual inset edits: re-probe gutters inside the trimmed area only.
    if (this.autoTrim) void this.redetectGuttersOnly();
    this.changeDetector.markForCheck();
  }

  resetInsets() {
    this.insets = emptyFloorCropInsets();
    this.softMarginsSeeded = false;
    this.resetPreviewView();
    if (this.autoTrim) void this.redetectFromPreviewImg();
    else this.changeDetector.markForCheck();
  }

  resetPreviewView() {
    this.previewZoom = 1;
    this.panX = 0;
    this.panY = 0;
    this.changeDetector.markForCheck();
  }

  onPreviewWheel(event: WheelEvent) {
    event.preventDefault();
    const delta = event.deltaY > 0 ? -0.15 : 0.15;
    const next = Math.max(
      PREVIEW_ZOOM_MIN,
      Math.min(PREVIEW_ZOOM_MAX, Math.round((this.previewZoom + delta) * 100) / 100),
    );
    if (next === this.previewZoom) return;
    this.previewZoom = next;
    if (this.previewZoom <= 1) {
      this.panX = 0;
      this.panY = 0;
    }
    this.changeDetector.markForCheck();
  }

  onTrimHandleDown(event: PointerEvent, edge: TrimEdge) {
    event.preventDefault();
    event.stopPropagation();
    const stage = (event.currentTarget as HTMLElement | null)?.closest('.sheet-preview-stage') as HTMLElement | null;
    this.beginDrag('trim', event, stage, edge);
  }

  onPreviewPanDown(event: PointerEvent) {
    if (event.button !== 0) return;
    if ((event.target as HTMLElement | null)?.closest?.('.trim-handle')) return;
    const frame = event.currentTarget as HTMLElement;
    const stage = frame.querySelector('.sheet-preview-stage') as HTMLElement | null;
    this.beginDrag('pan', event, stage, null);
  }

  @HostListener('document:pointermove', ['$event'])
  onDocumentPointerMove(event: PointerEvent) {
    if (!this.dragMode || event.pointerId !== this.dragPointerId) return;
    if (this.dragMode === 'pan') {
      this.panX += event.clientX - this.dragLastX;
      this.panY += event.clientY - this.dragLastY;
      this.dragLastX = event.clientX;
      this.dragLastY = event.clientY;
      this.changeDetector.markForCheck();
      return;
    }
    if (this.dragMode === 'trim' && this.trimEdge && this.stageEl) {
      this.applyTrimDrag(event.clientX, event.clientY);
    }
  }

  @HostListener('document:pointerup', ['$event'])
  @HostListener('document:pointercancel', ['$event'])
  onDocumentPointerUp(event: PointerEvent) {
    if (event.pointerId !== this.dragPointerId) return;
    const wasTrim = this.dragMode === 'trim';
    this.dragMode = null;
    this.trimEdge = null;
    this.dragPointerId = -1;
    this.stageEl = null;
    if (wasTrim && this.autoTrim) void this.redetectGuttersOnly();
    this.changeDetector.markForCheck();
  }

  private beginDrag(
    mode: PreviewDragMode,
    event: PointerEvent,
    stage: HTMLElement | null,
    edge: TrimEdge | null,
  ) {
    this.dragMode = mode;
    this.trimEdge = edge;
    this.dragPointerId = event.pointerId;
    this.dragLastX = event.clientX;
    this.dragLastY = event.clientY;
    this.stageEl = stage;
    const cap = (event.currentTarget as HTMLElement | null) || (event.target as HTMLElement | null);
    try {
      cap?.setPointerCapture?.(event.pointerId);
    } catch { /* ignore */ }
  }

  private applyTrimDrag(clientX: number, clientY: number) {
    if (!this.stageEl || !this.trimEdge) return;
    const rect = this.stageEl.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return;
    const xPct = ((clientX - rect.left) / rect.width) * 100;
    const yPct = ((clientY - rect.top) / rect.height) * 100;
    const edge = this.trimEdge;
    let next = { ...this.insets };
    if (edge === 'left') {
      next.left = this.snapValue(xPct, this.snapX);
    } else if (edge === 'right') {
      next.right = this.snapValue(100 - xPct, this.rightSnapTargets());
    } else if (edge === 'top') {
      next.top = this.snapValue(yPct, this.snapY);
    } else {
      next.bottom = this.snapValue(100 - yPct, this.bottomSnapTargets());
    }
    this.insets = clampFloorCropInsets(next);
    this.changeDetector.markForCheck();
  }

  private rightSnapTargets(): number[] {
    const out = [0, this.softSnap.right];
    for (const x of this.snapX) out.push(100 - x);
    return out;
  }

  private bottomSnapTargets(): number[] {
    const out = [0, this.softSnap.bottom];
    for (const y of this.snapY) out.push(100 - y);
    return out;
  }

  private snapValue(raw: number, targets: number[]): number {
    let v = Math.max(0, Math.min(this.sliderMax, raw));
    let best = v;
    let bestDist = TRIM_SNAP_PCT;
    for (const t of targets) {
      if (!Number.isFinite(t)) continue;
      const d = Math.abs(v - t);
      if (d < bestDist) {
        bestDist = d;
        best = t;
      }
    }
    // Half-percent soft grid when not magnetized harder.
    const half = Math.round(v * 2) / 2;
    if (Math.abs(v - half) < Math.min(0.35, bestDist)) best = half;
    return Math.max(0, Math.min(this.sliderMax, Math.round(best * 10) / 10));
  }

  private rebuildSnapTargets() {
    const xs = new Set<number>([0, this.softSnap.left, 100 - this.softSnap.right]);
    const ys = new Set<number>([0, this.softSnap.top, 100 - this.softSnap.bottom]);
    for (const x of this.markXs) xs.add(x);
    for (const y of this.markYs) ys.add(y);
    this.snapX = [...xs].filter(n => Number.isFinite(n)).sort((a, b) => a - b);
    this.snapY = [...ys].filter(n => Number.isFinite(n)).sort((a, b) => a - b);
  }

  prevPage() {
    if (!this.canPrevPage) return;
    void this.loadPreviewPage(this.previewPage - 1);
  }

  nextPage() {
    if (!this.canNextPage) return;
    void this.loadPreviewPage(this.previewPage + 1);
  }

  onPreviewImgLoad(ev: Event) {
    const img = ev.target as HTMLImageElement | null;
    if (!img) return;
    this.previewImageW = img.naturalWidth || img.width;
    this.previewImageH = img.naturalHeight || img.height;
    if (this.autoTrim) {
      // First page: seed shared insets. Later pages: keep size/% stable, only refresh overlay.
      if (!this.softMarginsSeeded) this.runAutoDetect(img);
      else this.refreshOverlayOnly(img);
    } else if (!this.softMarginsSeeded && floorCropInsetsAlmostZero(this.insets)) {
      this.seedSoftMargins(img);
      this.changeDetector.markForCheck();
    }
  }

  confirm() {
    if (!this.canConfirm) return;
    const result: CardSheetImportResult = {
      cols: Math.floor(Number(this.cols)),
      rows: Math.floor(Number(this.rows)),
      numCards: Math.floor(Number(this.numCards)),
      autoTrim: !!this.autoTrim,
      insets: clampFloorCropInsets(this.insets),
    };
    if (this.showPageRange) {
      result.pages = parsePageRange(this.pageRange, this.pageCount);
    }
    this.modalService.resolve(result);
  }

  cancel() {
    this.modalService.resolve(false);
  }

  private async bootstrapPreview() {
    if (this.isPdf && this.previewFile) {
      this.previewLoading = true;
      try {
        const preview = await renderPdfPagePreviewPng(this.previewFile, 1, 720);
        this.pageCount = preview.pageCount;
        this.previewPage = 1;
        if (!this.pageRange.trim()) {
          this.pageRange = this.pageCount > 1 ? `1-${this.pageCount}` : '1';
        }
        this.setPreviewBlob(preview.blob);
      } catch (err) {
        console.warn('card-sheet preview failed', err);
        this.detectStatus = 'fail';
      } finally {
        this.previewLoading = false;
      }
      return;
    }

    if (this.sheetPages.length) {
      this.pageCount = this.sheetPages.length;
      this.previewPage = 1;
      if (!this.pageRange.trim()) {
        this.pageRange = this.pageCount > 1 ? `1-${this.pageCount}` : '1';
      }
      this.setPreviewBlob(this.sheetPages[0]);
      return;
    }

    if (this.previewFile) {
      this.pageCount = 1;
      this.previewPage = 1;
      this.setPreviewBlob(this.previewFile);
    }
  }

  private async loadPreviewPage(page: number) {
    const want = Math.max(1, Math.min(this.pageCount, Math.floor(page) || 1));
    if (want === this.previewPage && this.previewSafeUrl && !this.previewLoading) return;
    const token = ++this.loadToken;
    // Busy overlay only — keep previous image mounted to avoid modal resize.
    this.previewLoading = true;
    this.changeDetector.markForCheck();
    try {
      if (this.isPdf && this.previewFile) {
        const preview = await renderPdfPagePreviewPng(this.previewFile, want, 720);
        if (token !== this.loadToken) return;
        this.pageCount = preview.pageCount;
        this.previewPage = preview.page;
        this.setPreviewBlob(preview.blob);
      } else if (this.sheetPages.length) {
        const blob = this.sheetPages[want - 1];
        if (!blob) return;
        this.previewPage = want;
        this.setPreviewBlob(blob);
      }
    } catch (err) {
      console.warn('card-sheet preview page failed', err);
      this.detectStatus = 'fail';
    } finally {
      if (token === this.loadToken) {
        this.previewLoading = false;
        this.changeDetector.markForCheck();
      }
    }
  }

  private setPreviewBlob(blob: Blob) {
    const prev = this.previewUrl;
    this.previewUrl = URL.createObjectURL(blob);
    this.previewSafeUrl = this.sanitizer.bypassSecurityTrustResourceUrl(this.previewUrl);
    // Revoke after swap so the still-visible previous frame does not flash blank.
    if (prev) {
      queueMicrotask(() => URL.revokeObjectURL(prev));
    }
  }

  private revokePreviewUrl() {
    if (this.previewUrl) {
      URL.revokeObjectURL(this.previewUrl);
      this.previewUrl = '';
    }
  }

  private redetectFromPreviewImg() {
    if (!this.previewUrl) return;
    const img = new Image();
    img.onload = () => {
      this.previewImageW = img.naturalWidth || img.width;
      this.previewImageH = img.naturalHeight || img.height;
      this.runAutoDetect(img);
    };
    img.src = this.previewUrl;
  }

  private redetectGuttersOnly() {
    if (!this.previewUrl) return;
    const img = new Image();
    img.onload = () => {
      this.previewImageW = img.naturalWidth || img.width;
      this.previewImageH = img.naturalHeight || img.height;
      const content = contentRectFromInsets(this.previewImageW, this.previewImageH, this.insets);
      this.applyDetectedGrid(
        detectSheetCropMarks(img, content, this.safeCols, this.safeRows),
      );
      this.changeDetector.markForCheck();
    };
    img.src = this.previewUrl;
  }

  /**
   * Marks-first auto trim:
   * 1) Crop marks matching Width×Height → fill % insets from outer bleed + overlay
   * 2) Else soft paper margins (incl. L/R beyond hairline borders) + gutters inside
   */
  private runAutoDetect(img: HTMLImageElement) {
    const w = this.previewImageW || img.naturalWidth || img.width;
    const h = this.previewImageH || img.naturalHeight || img.height;

    // Full-page crop marks (ticks live in bleed — do not soft-crop first).
    // Only seed insets from marks when the grid matches the user's cols×rows.
    const marks = detectSheetCropMarks(img);
    const markCols = marks ? marks.xs.length - 1 : 0;
    const markRows = marks ? marks.ys.length - 1 : 0;
    if (marks && markCols === this.safeCols && markRows === this.safeRows) {
      this.insets = insetsFromCropMarkGrid(marks, w, h);
      this.softSnap = detectSheetSoftMargins(img);
      this.softMarginsSeeded = true;
      this.applyDetectedGrid(marks);
      this.changeDetector.markForCheck();
      return;
    }

    // No matching mark grid — soft margins drive 去邊 (fixes L/R); never change W×H.
    this.insets = detectSheetSoftMargins(img);
    this.softSnap = this.insets;
    this.softMarginsSeeded = true;
    this.rebuildSnapTargets();
    this.refreshOverlayOnly(img);
  }

  /** Recompute mark/gutter overlay for the current page without changing shared insets. */
  private refreshOverlayOnly(img: HTMLImageElement) {
    const w = this.previewImageW || img.naturalWidth || img.width;
    const h = this.previewImageH || img.naturalHeight || img.height;
    const content = contentRectFromInsets(w, h, this.insets);
    const full = detectSheetCropMarks(img);
    const markCols = full ? full.xs.length - 1 : 0;
    const markRows = full ? full.ys.length - 1 : 0;
    if (full && markCols === this.safeCols && markRows === this.safeRows) {
      this.applyDetectedGrid(full);
    } else {
      this.applyDetectedGrid(
        detectSheetCropMarks(img, content, this.safeCols, this.safeRows),
      );
    }
    this.changeDetector.markForCheck();
  }

  private seedSoftMargins(img: HTMLImageElement) {
    const soft = detectSheetSoftMargins(img);
    this.softSnap = soft;
    if (!floorCropInsetsAlmostZero(soft)) {
      this.insets = soft;
    }
    this.softMarginsSeeded = true;
    this.rebuildSnapTargets();
  }

  private applyDetectedGrid(grid: CropMarkGrid | null) {
    if (!grid || grid.xs.length < 2 || grid.ys.length < 2) {
      this.detectStatus = 'fail';
      this.markXs = [];
      this.markYs = [];
      this.rebuildSnapTargets();
      return;
    }
    const dCols = grid.xs.length - 1;
    const dRows = grid.ys.length - 1;
    // Auto-trim never changes Width×Height — only draw marks when they match the user's grid.
    if (dCols !== this.safeCols || dRows !== this.safeRows) {
      this.detectStatus = 'fail';
      this.markXs = [];
      this.markYs = [];
      this.rebuildSnapTargets();
      return;
    }
    this.detectStatus = 'ok';
    const w = this.previewImageW || grid.xs[grid.xs.length - 1] || 1;
    const h = this.previewImageH || grid.ys[grid.ys.length - 1] || 1;
    this.markXs = grid.xs.map(x => (x / w) * 100);
    this.markYs = grid.ys.map(y => (y / h) * 100);
    this.rebuildSnapTargets();
  }

  private refreshTitle() {
    this.modalService.title = this.panelService.title = this.i18n.t('cardSheet.title');
  }
}
