import { Subscription } from 'rxjs';
import { CardCaptionOverlayService } from 'service/card-caption-overlay.service';
import { anchorBesideCard } from 'service/card-caption-text';
import { ObjectPreviewService } from 'service/object-preview.service';

export {
  canRevealCardCaption,
  cardCaptionName,
  cardCaptionRubiedText,
} from 'service/card-caption-text';

/** Delay before the card name appears on map hover. */
export const CARD_HOVER_CAPTION_NAME_MS = 200;
/** Delay before card.text appears (from hover start). */
export const CARD_HOVER_CAPTION_TEXT_MS = 500;

/**
 * Desktop-only staged caption: name at 0.2s, full text at 0.5s.
 * Call clear() on leave / drag / Object Image Preview open.
 */
export class CardHoverCaptionController {
  showName = false;
  showText = false;
  private nameTimer: ReturnType<typeof setTimeout> | null = null;
  private textTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly onChange: () => void;

  constructor(onChange: () => void) {
    this.onChange = onChange;
  }

  start() {
    this.clearTimer();
    this.showName = false;
    this.showText = false;
    this.onChange();
    this.nameTimer = setTimeout(() => {
      this.nameTimer = null;
      this.showName = true;
      this.onChange();
    }, CARD_HOVER_CAPTION_NAME_MS);
    this.textTimer = setTimeout(() => {
      this.textTimer = null;
      this.showText = true;
      this.onChange();
    }, CARD_HOVER_CAPTION_TEXT_MS);
  }

  /** Start only on fine-pointer desktop (skip sticky mobile hover). */
  startIfDesktop(isMobile: boolean) {
    if (isMobile) return;
    this.start();
  }

  clear() {
    this.clearTimer();
    // Always reset flags so a pending 0.2s/0.5s start cannot fire after leave.
    if (!this.showName && !this.showText) return;
    this.showName = false;
    this.showText = false;
    this.onChange();
  }

  get isVisible(): boolean {
    return this.showName || this.showText;
  }

  private clearTimer() {
    if (this.nameTimer) {
      clearTimeout(this.nameTimer);
      this.nameTimer = null;
    }
    if (this.textTimer) {
      clearTimeout(this.textTimer);
      this.textTimer = null;
    }
  }
}

/** Push staged caption to the app-root screen-space overlay (beside the card on the canvas). */
export function publishCardCaptionOverlay(
  overlay: CardCaptionOverlayService,
  caption: CardHoverCaptionController,
  el: Element | null | undefined,
  name: string,
  textHtml: string,
) {
  if (!caption.isVisible) {
    overlay.clear();
    return;
  }
  const anchor = anchorBesideCard(el ?? null);
  overlay.show({
    name,
    textHtml,
    showName: caption.showName,
    showText: caption.showText,
    x: anchor.x,
    y: anchor.y,
    flipX: anchor.flipX,
  });
}

/**
 * Dismiss caption whenever any Object Image Preview opens (not only same-id).
 */
export function wireCardHoverCaptionDismiss(
  preview: ObjectPreviewService,
  caption: CardHoverCaptionController,
  onDismiss?: () => void,
): Subscription {
  return preview.previewOpened$.subscribe(() => {
    caption.clear();
    onDismiss?.();
  });
}
