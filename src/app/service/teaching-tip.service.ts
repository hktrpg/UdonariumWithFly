import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

const HOVER_TIPS_KEY = 'udonarium.ui.hoverTips';

export interface TeachingTipState {
  visible: boolean;
  tipKey: string;
  titleKey: string;
  bodyKey: string;
  left: number;
  top: number;
  anchorEl: HTMLElement | null;
}

@Injectable({ providedIn: 'root' })
export class TeachingTipService {
  private readonly stateSubject = new BehaviorSubject<TeachingTipState>({
    visible: false,
    tipKey: '',
    titleKey: '',
    bodyKey: '',
    left: 0,
    top: 0,
    anchorEl: null,
  });

  readonly state$ = this.stateSubject.asObservable();

  /** When true, hover tips are suppressed (e.g. during guided tour). */
  paused = false;

  private enabled = true;

  constructor() {
    try {
      const stored = localStorage.getItem(HOVER_TIPS_KEY);
      if (stored === '0') this.enabled = false;
    } catch { /* ignore */ }
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  setEnabled(enabled: boolean) {
    this.enabled = !!enabled;
    try {
      localStorage.setItem(HOVER_TIPS_KEY, this.enabled ? '1' : '0');
    } catch { /* ignore */ }
    if (!this.enabled) this.hide();
  }

  show(tipKey: string, anchorEl: HTMLElement) {
    if (!this.enabled || this.paused || !tipKey || !anchorEl) return;
    const rect = anchorEl.getBoundingClientRect();
    const boxW = 280;
    const boxH = 120;
    let left = rect.right + 8;
    let top = rect.top;
    if (left + boxW > window.innerWidth - 8) left = Math.max(8, rect.left - boxW - 8);
    if (top + boxH > window.innerHeight - 8) top = Math.max(8, window.innerHeight - boxH - 8);
    if (top < 8) top = 8;

    this.stateSubject.next({
      visible: true,
      tipKey,
      titleKey: `${tipKey}.title`,
      bodyKey: `${tipKey}.body`,
      left,
      top,
      anchorEl,
    });
  }

  hide(anchorEl?: HTMLElement) {
    const cur = this.stateSubject.value;
    if (anchorEl && cur.anchorEl && cur.anchorEl !== anchorEl) return;
    if (!cur.visible) return;
    this.stateSubject.next({ ...cur, visible: false, anchorEl: null, tipKey: '' });
  }

  hideAll() {
    this.hide();
  }
}
