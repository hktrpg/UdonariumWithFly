import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

export type CardCaptionOverlayState = {
  name: string;
  textHtml: string;
  showName: boolean;
  showText: boolean;
  /** Viewport coordinates — caption sits beside the card (mid-height). */
  x: number;
  y: number;
  /** When true, caption extends left from (x,y); otherwise right. */
  flipX?: boolean;
};

/**
 * Screen-space card hover caption (not under table 3D transforms).
 * `position: fixed` inside a transformed table host sticks to the canvas — this overlay lives at app root.
 */
@Injectable({
  providedIn: 'root'
})
export class CardCaptionOverlayService {
  private readonly stateSubject = new BehaviorSubject<CardCaptionOverlayState | null>(null);
  readonly state$ = this.stateSubject.asObservable();

  get snapshot(): CardCaptionOverlayState | null {
    return this.stateSubject.value;
  }

  show(state: CardCaptionOverlayState) {
    this.stateSubject.next({ ...state });
  }

  update(partial: Partial<CardCaptionOverlayState>) {
    const cur = this.stateSubject.value;
    if (!cur) return;
    this.stateSubject.next({ ...cur, ...partial });
  }

  clear() {
    if (!this.stateSubject.value) return;
    this.stateSubject.next(null);
  }
}
