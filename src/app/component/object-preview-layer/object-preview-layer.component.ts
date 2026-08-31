import { animate, state, style, transition, trigger } from '@angular/animations';
import {
  AfterViewChecked,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  ElementRef,
  NgZone,
  OnDestroy,
  OnInit,
  QueryList,
  ViewChildren
} from '@angular/core';
import { pdfPageRenderKey, renderPdfPage } from '@udonarium/core/file-storage/pdf-render';
import { PdfStorage } from '@udonarium/core/file-storage/pdf-storage';
import { VideoStorage } from '@udonarium/core/file-storage/video-storage';
import { EventSystem } from '@udonarium/core/system';
import { noteMarkdownToHtml } from '@udonarium/note-markdown';
import { ObjectPreviewPayload, ObjectPreviewService } from 'service/object-preview.service';
import { Subscription } from 'rxjs';

@Component({
  selector: 'object-preview-layer',
  templateUrl: './object-preview-layer.component.html',
  styleUrls: ['./object-preview-layer.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  animations: [
    trigger('fadeInOut', [
      state('in', style({ opacity: 1 })),
      transition('void => *', [
        style({ opacity: 0 }),
        animate('160ms ease-out')
      ]),
      transition('* => void', [
        animate('160ms ease-in', style({ opacity: 0 }))
      ])
    ])
  ],
  standalone: false
})
export class ObjectPreviewLayerComponent implements OnInit, OnDestroy, AfterViewChecked {
  private static readonly PREVIEW_ZOOM_MIN = 0.5;
  private static readonly PREVIEW_ZOOM_MAX = 4;

  @ViewChildren('pdfCanvas') pdfCanvases: QueryList<ElementRef<HTMLCanvasElement>>;

  /** Screen positions for pinned floating windows (id → left/top). */
  floatPos = new Map<string, { left: number; top: number }>();

  private dragContentId: string | null = null;
  private dragLastX = 0;
  private dragLastY = 0;
  private windowDragId: string | null = null;
  private windowDragOffX = 0;
  private windowDragOffY = 0;
  private needsPdfRender = new Set<string>();
  private lastPdfKey = new Map<string, string>();
  private pdfRenderSeq = new Map<string, number>();
  private sub: Subscription | null = null;
  private readonly onWindowWheel = (e: WheelEvent) => this.handlePreviewWheel(e);
  private readonly onWindowKeyDown = (e: KeyboardEvent) => this.handlePageKey(e);

  constructor(
    private objectPreview: ObjectPreviewService,
    private changeDetector: ChangeDetectorRef,
    private ngZone: NgZone,
  ) { }

  get transient(): ObjectPreviewPayload | null {
    return this.objectPreview.transient;
  }

  get pinned(): ObjectPreviewPayload[] {
    return this.objectPreview.pinned;
  }

  ngOnInit() {
    this.sub = this.objectPreview.stateChanged$.subscribe(() => {
      this.syncConsumeFlags();
      this.queuePdfForOpen();
      this.ensureFloatPositions();
      this.changeDetector.markForCheck();
    });
    EventSystem.register(this)
      .on('UPDATE_PDF_RESOURE', () => {
        this.queuePdfForOpen(true);
        this.changeDetector.markForCheck();
      })
      .on('UPDATE_VIDEO_RESOURE', () => this.changeDetector.markForCheck());

    this.ngZone.runOutsideAngular(() => {
      window.addEventListener('wheel', this.onWindowWheel, { capture: true, passive: false });
      window.addEventListener('keydown', this.onWindowKeyDown, true);
    });
    this.syncConsumeFlags();
  }

  ngAfterViewChecked() {
    if (this.needsPdfRender.size === 0 || !this.pdfCanvases?.length) return;
    for (const ref of this.pdfCanvases) {
      const canvas = ref.nativeElement;
      const id = canvas?.dataset?.['previewId'];
      if (!id || !this.needsPdfRender.has(id)) continue;
      this.needsPdfRender.delete(id);
      this.renderPdf(id, canvas);
    }
  }

  ngOnDestroy() {
    ObjectPreviewService.previewConsumesWheel = false;
    ObjectPreviewService.previewConsumesPointer = false;
    this.sub?.unsubscribe();
    window.removeEventListener('wheel', this.onWindowWheel, true);
    window.removeEventListener('keydown', this.onWindowKeyDown, true);
    EventSystem.unregister(this);
  }

  trackById(_: number, p: ObjectPreviewPayload) {
    return p.id;
  }

  isPdf(p: ObjectPreviewPayload): boolean { return !!p.pdfIdentifier; }
  isVideo(p: ObjectPreviewPayload): boolean { return !!this.resolvedVideoUrl(p); }
  isText(p: ObjectPreviewPayload): boolean {
    return !this.isPdf(p) && !this.isVideo(p) && !p.imageUrl && !!p.text;
  }
  textHtml(p: ObjectPreviewPayload): string {
    return this.isText(p) ? noteMarkdownToHtml(p.text || '') : '';
  }
  resolvedVideoUrl(p: ObjectPreviewPayload): string {
    if (p.videoIdentifier) {
      const file = VideoStorage.instance.get(p.videoIdentifier);
      if (file?.url) return file.url;
    }
    return (p.videoUrl || '').trim();
  }
  previewTransform(p: ObjectPreviewPayload): string {
    return `translate(${p.panX}px, ${p.panY}px) scale(${p.zoom})`;
  }
  floatStyle(p: ObjectPreviewPayload): { [key: string]: string } {
    const pos = this.floatPos.get(p.id) || { left: 64, top: 12 };
    return {
      left: pos.left + 'px',
      top: pos.top + 'px',
    };
  }

  pinTransient(e?: Event) {
    e?.stopPropagation();
    e?.preventDefault();
    this.objectPreview.pinTransient();
  }

  closeTransient(e?: Event) {
    e?.stopPropagation();
    this.objectPreview.closeTransient();
  }

  closePinned(id: string, e?: Event) {
    e?.stopPropagation();
    this.objectPreview.closePinned(id);
    this.floatPos.delete(id);
  }

  unpin(id: string, e?: Event) {
    e?.stopPropagation();
    this.closePinned(id, e);
  }

  resetView(p: ObjectPreviewPayload, e?: Event) {
    e?.stopPropagation();
    e?.preventDefault();
    this.objectPreview.updateView(p.id, { zoom: 1, panX: 0, panY: 0 });
  }

  prevPage(p: ObjectPreviewPayload, e?: Event) {
    e?.stopPropagation();
    const page = Math.max(1, Math.floor(Number(p.pdfPage)) || 1);
    const max = Math.max(0, Math.floor(Number(p.pdfPageCount)) || 0);
    if (max <= 0) return;
    this.goToPage(p, page <= 1 ? max : page - 1);
  }

  nextPage(p: ObjectPreviewPayload, e?: Event) {
    e?.stopPropagation();
    const page = Math.max(1, Math.floor(Number(p.pdfPage)) || 1);
    const max = Math.max(0, Math.floor(Number(p.pdfPageCount)) || 0);
    if (max <= 0) return;
    this.goToPage(p, page >= max ? 1 : page + 1);
  }

  onContentPointerDown(p: ObjectPreviewPayload, e: PointerEvent) {
    if (e.button !== 0) return;
    const t = e.target as HTMLElement | null;
    if (t?.closest?.('video, button, a, input, textarea, .preview-actions, .preview-bar')) return;
    e.preventDefault();
    e.stopPropagation();
    if (p.pinned) {
      // Pinned: dragging the image moves the whole HUD (no content pan detach).
      const pos = this.floatPos.get(p.id) || { left: 64, top: 12 };
      this.windowDragId = p.id;
      this.windowDragOffX = e.clientX - pos.left;
      this.windowDragOffY = e.clientY - pos.top;
    } else {
      this.dragContentId = p.id;
      this.dragLastX = e.clientX;
      this.dragLastY = e.clientY;
    }
    ObjectPreviewService.previewConsumesPointer = true;
    try {
      (e.currentTarget as HTMLElement)?.setPointerCapture?.(e.pointerId);
    } catch { /* ignore */ }
    this.changeDetector.markForCheck();
  }

  onContentPointerMove(p: ObjectPreviewPayload, e: PointerEvent) {
    if (this.windowDragId === p.id) {
      e.preventDefault();
      e.stopPropagation();
      this.floatPos.set(p.id, {
        left: Math.max(0, e.clientX - this.windowDragOffX),
        top: Math.max(0, e.clientY - this.windowDragOffY),
      });
      this.changeDetector.markForCheck();
      return;
    }
    if (this.dragContentId !== p.id) return;
    e.preventDefault();
    e.stopPropagation();
    const dx = e.clientX - this.dragLastX;
    const dy = e.clientY - this.dragLastY;
    if (dx === 0 && dy === 0) return;
    this.dragLastX = e.clientX;
    this.dragLastY = e.clientY;
    this.objectPreview.updateView(p.id, {
      panX: (p.panX || 0) + dx,
      panY: (p.panY || 0) + dy,
    });
  }

  onContentPointerUp(p: ObjectPreviewPayload, e: PointerEvent) {
    if (this.windowDragId === p.id) {
      e.stopPropagation();
      this.windowDragId = null;
      ObjectPreviewService.previewConsumesPointer = false;
      try {
        (e.currentTarget as HTMLElement)?.releasePointerCapture?.(e.pointerId);
      } catch { /* ignore */ }
      this.changeDetector.markForCheck();
      return;
    }
    if (this.dragContentId !== p.id) return;
    e.stopPropagation();
    this.dragContentId = null;
    ObjectPreviewService.previewConsumesPointer = false;
    try {
      (e.currentTarget as HTMLElement)?.releasePointerCapture?.(e.pointerId);
    } catch { /* ignore */ }
    this.changeDetector.markForCheck();
  }

  onContentDblClick(p: ObjectPreviewPayload, e: Event) {
    e.preventDefault();
    e.stopPropagation();
    this.resetView(p, e);
  }

  isContentDragging(p: ObjectPreviewPayload): boolean {
    return this.dragContentId === p.id || this.windowDragId === p.id;
  }

  onWindowPointerDown(p: ObjectPreviewPayload, e: PointerEvent) {
    if (e.button !== 0) return;
    const t = e.target as HTMLElement | null;
    if (t?.closest?.('button, .preview-content-stage, video, a, input, textarea')) return;
    e.preventDefault();
    e.stopPropagation();
    const pos = this.floatPos.get(p.id) || { left: 64, top: 12 };
    this.windowDragId = p.id;
    this.windowDragOffX = e.clientX - pos.left;
    this.windowDragOffY = e.clientY - pos.top;
    ObjectPreviewService.previewConsumesPointer = true;
    try {
      (e.currentTarget as HTMLElement)?.setPointerCapture?.(e.pointerId);
    } catch { /* ignore */ }
  }

  onWindowPointerMove(p: ObjectPreviewPayload, e: PointerEvent) {
    if (this.windowDragId !== p.id) return;
    e.preventDefault();
    e.stopPropagation();
    this.floatPos.set(p.id, {
      left: Math.max(0, e.clientX - this.windowDragOffX),
      top: Math.max(0, e.clientY - this.windowDragOffY),
    });
    this.changeDetector.markForCheck();
  }

  onWindowPointerUp(p: ObjectPreviewPayload, e: PointerEvent) {
    if (this.windowDragId !== p.id) return;
    e.stopPropagation();
    this.windowDragId = null;
    if (!this.dragContentId) ObjectPreviewService.previewConsumesPointer = false;
    try {
      (e.currentTarget as HTMLElement)?.releasePointerCapture?.(e.pointerId);
    } catch { /* ignore */ }
  }

  private goToPage(p: ObjectPreviewPayload, page: number) {
    const max = Math.max(0, Math.floor(Number(p.pdfPageCount)) || 0);
    let next = Math.max(1, Math.floor(Number(page)) || 1);
    if (max > 0) next = Math.min(next, max);
    if (next === p.pdfPage) return;
    this.objectPreview.updateView(p.id, { pdfPage: next });
    this.needsPdfRender.add(p.id);
  }

  /** Ctrl-preview: wheel zooms content when over a preview surface (or fullscreen transient). */
  private handlePreviewWheel(e: WheelEvent) {
    // Fullscreen transient: zoom anywhere (backdrop is PE-none so target is often the table).
    let target = this.transient || this.wheelTargetPayload(e);
    if (!target) return;
    // Pinned floats: only consume when the pointer is over that float (or fullscreen).
    if (!this.transient && !this.pinned.some(p => p.id === target!.id)) return;
    e.preventDefault();
    e.stopPropagation();
    const raw = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    if (raw === 0) return;
    const factor = raw > 0 ? (1 / 1.12) : 1.12;
    const next = Math.min(
      ObjectPreviewLayerComponent.PREVIEW_ZOOM_MAX,
      Math.max(ObjectPreviewLayerComponent.PREVIEW_ZOOM_MIN, (target.zoom || 1) * factor),
    );
    if (Math.abs(next - (target.zoom || 1)) < 0.001) return;
    this.ngZone.run(() => {
      this.objectPreview.updateView(target!.id, { zoom: next });
    });
  }

  private wheelTargetPayload(e: WheelEvent): ObjectPreviewPayload | null {
    const el = e.target as HTMLElement | null;
    const host = el?.closest?.('[data-preview-root]') as HTMLElement | null;
    const id = host?.dataset?.['previewRoot'];
    if (!id) return null;
    if (this.transient?.id === id) return this.transient;
    return this.pinned.find(p => p.id === id) || null;
  }

  private handlePageKey(e: KeyboardEvent) {
    if (e.repeat) return;
    const code = e.code;
    if (code !== 'KeyA' && code !== 'KeyD') return;
    const p = this.transient || this.pinned.find(x => this.isPdf(x));
    if (!p || !this.isPdf(p)) return;
    if (this.isTypingTarget(e.target)) return;
    e.preventDefault();
    e.stopPropagation();
    this.ngZone.run(() => {
      if (code === 'KeyA') this.prevPage(p);
      else this.nextPage(p);
    });
  }

  private isTypingTarget(target: EventTarget | null): boolean {
    const el = target as HTMLElement | null;
    if (!el) return false;
    const tag = (el.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
    return !!el.isContentEditable;
  }

  private syncConsumeFlags() {
    // Fullscreen transient owns the wheel globally; pinned floats only consume when
    // the pointer is over them (handled in handlePreviewWheel).
    ObjectPreviewService.previewConsumesWheel = !!this.transient;
    if (!this.transient && !this.pinned.length) {
      ObjectPreviewService.previewConsumesPointer = false;
      this.dragContentId = null;
      this.windowDragId = null;
    }
  }

  private queuePdfForOpen(force = false) {
    const all = [
      ...(this.transient ? [this.transient] : []),
      ...this.pinned,
    ];
    for (const p of all) {
      if (!p.pdfIdentifier) continue;
      if (force) {
        this.needsPdfRender.add(p.id);
        continue;
      }
      const key = pdfPageRenderKey(p.pdfIdentifier, p.pdfPage || 1);
      if (this.lastPdfKey.get(p.id) !== key) this.needsPdfRender.add(p.id);
    }
  }

  private ensureFloatPositions() {
    // Clear of vertical desktop icon rail (~52px) so pinned windows aren't under menu icons.
    const baseLeft = 64;
    const baseTop = 12;
    let i = 0;
    for (const p of this.pinned) {
      if (!this.floatPos.has(p.id)) {
        this.floatPos.set(p.id, { left: baseLeft + i * 32, top: baseTop + i * 32 });
      }
      i++;
    }
    for (const id of [...this.floatPos.keys()]) {
      if (!this.pinned.some(p => p.id === id)) this.floatPos.delete(id);
    }
  }

  private async renderPdf(id: string, canvas: HTMLCanvasElement) {
    const p = this.findById(id);
    if (!p?.pdfIdentifier || !canvas) return;
    const pdf = PdfStorage.instance.get(p.pdfIdentifier);
    if (!pdf?.url) return;
    const seq = (this.pdfRenderSeq.get(id) || 0) + 1;
    this.pdfRenderSeq.set(id, seq);
    const wantPage = Math.max(1, Math.floor(Number(p.pdfPage)) || 1);
    const pdfId = p.pdfIdentifier;
    const attemptKey = pdfPageRenderKey(pdfId, wantPage);
    try {
      const result = await renderPdfPage(canvas, pdf.url, wantPage, pdfId, 1600);
      if (!result || seq !== this.pdfRenderSeq.get(id)) return;
      const live = this.findById(id);
      if (!live || live.pdfIdentifier !== pdfId) return;
      this.lastPdfKey.set(id, pdfPageRenderKey(pdfId, result.page));
      this.objectPreview.updateView(id, { pdfPage: result.page, pdfPageCount: result.pageCount });
    } catch (err) {
      if (seq !== this.pdfRenderSeq.get(id)) return;
      this.lastPdfKey.set(id, attemptKey);
      console.warn('object preview PDF render failed', err);
    }
  }

  private findById(id: string): ObjectPreviewPayload | null {
    if (this.transient?.id === id) return this.transient;
    return this.pinned.find(p => p.id === id) || null;
  }
}
