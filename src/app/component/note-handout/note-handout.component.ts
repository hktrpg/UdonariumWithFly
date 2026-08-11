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
  ViewChild
} from '@angular/core';
import { renderPdfPage } from '@udonarium/core/file-storage/pdf-render';
import { PdfStorage } from '@udonarium/core/file-storage/pdf-storage';
import { VideoStorage } from '@udonarium/core/file-storage/video-storage';
import { EventSystem } from '@udonarium/core/system';
import { TextNote } from '@udonarium/text-note';

export type NoteHandoutPayload = {
  name?: string;
  imageUrl?: string;
  pdfIdentifier?: string;
  pdfPage?: number;
  pdfPageCount?: number;
  videoIdentifier?: string;
  videoUrl?: string;
  text?: string;
  noteIdentifier?: string;
  /** Local Ctrl+hover preview; stays open until Ctrl release. A/D turns PDF pages while open. */
  preview?: boolean;
};

export function buildNoteHandoutPayload(note: TextNote, nameFallback: string): NoteHandoutPayload {
  if (!note) return {};
  // Match tabletop: flipped + back art replaces PDF/video/text with the back image.
  if (note.isFlipped && note.hasBackImage) {
    return {
      name: note.title || nameFallback,
      imageUrl: note.backImage?.url || '',
      noteIdentifier: note.identifier,
    };
  }
  const kind = note.contentKind;
  return {
    name: note.title || nameFallback,
    imageUrl: (kind === 'image' || kind === 'text') ? TextNote.resolveHandoutImageUrl(note) : '',
    pdfIdentifier: kind === 'pdf' ? note.pdfIdentifier : '',
    pdfPage: note.pdfPage || 1,
    pdfPageCount: note.pdfPageCount || 0,
    videoIdentifier: kind === 'video' ? note.videoIdentifier : '',
    videoUrl: kind === 'video' ? note.resolvedVideoUrl : '',
    text: kind === 'text' ? (note.text || '') : '',
    noteIdentifier: note.identifier,
  };
}

@Component({
  selector: 'note-handout',
  templateUrl: './note-handout.component.html',
  styleUrls: ['./note-handout.component.css'],
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
export class NoteHandoutComponent implements OnInit, OnDestroy, AfterViewChecked {
  @ViewChild('pdfCanvas') pdfCanvas: ElementRef<HTMLCanvasElement>;

  title = '';
  imageUrl = '';
  text = '';
  pdfIdentifier = '';
  pdfPage = 1;
  pdfPageCount = 0;
  videoIdentifier = '';
  videoUrl = '';
  isPreview = false;
  private needsPdfRender = false;
  private previewNoteId = '';
  private pdfRenderSeq = 0;
  private readonly onWindowKeyDown = (e: KeyboardEvent) => this.handlePageKey(e);

  get isOpen(): boolean {
    return !!(this.imageUrl || this.pdfIdentifier || this.resolvedVideoUrl || this.text);
  }
  get isPdf(): boolean { return !!this.pdfIdentifier; }
  get isVideo(): boolean { return !!this.resolvedVideoUrl; }
  get isText(): boolean { return !this.isPdf && !this.isVideo && !this.imageUrl && !!this.text; }
  get resolvedVideoUrl(): string {
    if (this.videoIdentifier) {
      const file = VideoStorage.instance.get(this.videoIdentifier);
      if (file?.url) return file.url;
    }
    return (this.videoUrl || '').trim();
  }

  constructor(
    private changeDetector: ChangeDetectorRef,
    private ngZone: NgZone
  ) { }

  ngOnInit() {
    EventSystem.register(this)
      .on('SHOW_NOTE_HANDOUT', event => {
        const data: NoteHandoutPayload = event.data || {};
        this.title = data.name || '';
        this.imageUrl = data.imageUrl || '';
        this.text = data.text || '';
        this.pdfIdentifier = data.pdfIdentifier || '';
        this.pdfPage = Math.max(1, Math.floor(Number(data.pdfPage)) || 1);
        this.pdfPageCount = Math.max(0, Math.floor(Number(data.pdfPageCount)) || 0);
        if (this.pdfPageCount > 0 && this.pdfPage > this.pdfPageCount) this.pdfPage = this.pdfPageCount;
        this.videoIdentifier = data.videoIdentifier || '';
        this.videoUrl = data.videoUrl || '';
        this.isPreview = !!data.preview;
        this.previewNoteId = data.noteIdentifier || '';
        this.pdfRenderSeq++;
        this.needsPdfRender = !!this.pdfIdentifier;
        this.changeDetector.markForCheck();
      })
      .on('HIDE_NOTE_HANDOUT', event => {
        const data = event.data || {};
        if (!this.isOpen) return;
        if (this.isPreview) {
          if (data?.noteIdentifier && this.previewNoteId && data.noteIdentifier !== this.previewNoteId) return;
          this.close();
          return;
        }
        if (data?.force) this.close();
      })
      .on('UPDATE_PDF_RESOURE', () => {
        if (this.pdfIdentifier) {
          this.needsPdfRender = true;
          this.changeDetector.markForCheck();
        }
      })
      .on('UPDATE_VIDEO_RESOURE', () => {
        if (this.videoIdentifier) this.changeDetector.markForCheck();
      });

    // Capture phase so A/D work even while Ctrl is held (Ctrl+A is otherwise stolen by the browser).
    this.ngZone.runOutsideAngular(() => {
      window.addEventListener('keydown', this.onWindowKeyDown, true);
    });
  }

  ngAfterViewChecked() {
    if (this.needsPdfRender && this.pdfCanvas?.nativeElement) {
      this.needsPdfRender = false;
      this.renderPdf();
    }
  }

  ngOnDestroy() {
    window.removeEventListener('keydown', this.onWindowKeyDown, true);
    EventSystem.unregister(this);
  }

  private handlePageKey(e: KeyboardEvent) {
    if (!this.isOpen || !this.isPdf || e.repeat) return;
    if (this.isTypingTarget(e.target)) return;
    const code = e.code;
    if (code !== 'KeyA' && code !== 'KeyD') return;
    e.preventDefault();
    e.stopPropagation();
    this.ngZone.run(() => {
      if (code === 'KeyA') this.prevPage();
      else this.nextPage();
    });
  }

  private isTypingTarget(target: EventTarget | null): boolean {
    const el = target as HTMLElement | null;
    if (!el) return false;
    const tag = (el.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
    return !!el.isContentEditable;
  }

  onBackdropClick() {
    if (!this.isPreview) this.close();
  }

  close() {
    this.pdfRenderSeq++;
    this.imageUrl = '';
    this.text = '';
    this.pdfIdentifier = '';
    this.videoIdentifier = '';
    this.videoUrl = '';
    this.title = '';
    this.pdfPage = 1;
    this.pdfPageCount = 0;
    this.isPreview = false;
    this.previewNoteId = '';
    this.changeDetector.markForCheck();
  }

  prevPage(e?: Event) {
    e?.stopPropagation();
    const page = Math.max(1, Math.floor(Number(this.pdfPage)) || 1);
    const max = Math.max(0, Math.floor(Number(this.pdfPageCount)) || 0);
    if (max <= 0) return;
    // Wrap: first → last
    this.goToPage(page <= 1 ? max : page - 1);
  }

  nextPage(e?: Event) {
    e?.stopPropagation();
    const page = Math.max(1, Math.floor(Number(this.pdfPage)) || 1);
    const max = Math.max(0, Math.floor(Number(this.pdfPageCount)) || 0);
    if (max <= 0) return;
    // Wrap: last → first
    this.goToPage(page >= max ? 1 : page + 1);
  }

  private goToPage(page: number) {
    const max = Math.max(0, Math.floor(Number(this.pdfPageCount)) || 0);
    let next = Math.max(1, Math.floor(Number(page)) || 1);
    if (max > 0) next = Math.min(next, max);
    if (next === this.pdfPage) return;
    this.pdfPage = next;
    this.needsPdfRender = true;
    this.changeDetector.markForCheck();
  }

  private async renderPdf() {
    const pdf = PdfStorage.instance.get(this.pdfIdentifier);
    const canvas = this.pdfCanvas?.nativeElement;
    if (!pdf?.url || !canvas) return;
    const seq = ++this.pdfRenderSeq;
    const wantPage = Math.max(1, Math.floor(Number(this.pdfPage)) || 1);
    const id = this.pdfIdentifier;
    try {
      const result = await renderPdfPage(canvas, pdf.url, wantPage, id, 1100);
      // Ignore stale renders so an older page cannot overwrite the current one.
      if (seq !== this.pdfRenderSeq || this.pdfIdentifier !== id) return;
      this.pdfPageCount = result.pageCount;
      // Keep clamped page; if we asked past the end, stay on last (result.page === pageCount).
      this.pdfPage = result.page;
      this.changeDetector.markForCheck();
    } catch (err) {
      if (seq === this.pdfRenderSeq) console.warn('note handout PDF render failed', err);
    }
  }
}
