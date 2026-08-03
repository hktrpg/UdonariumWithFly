import { Injectable, NgZone } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { buildGuidedTourSteps, GuidedTourStep, shouldSkipStep, TourRequire } from '@udonarium/guided-tour-steps';
import { TeachingTipService } from 'service/teaching-tip.service';

const TOUR_DONE_KEY = 'udonarium.ui.tourDone';

export type GuidedTourPhase = 'idle' | 'welcome' | 'running' | 'done';

export interface GuidedTourUiState {
  phase: GuidedTourPhase;
  stepIndex: number;
  steps: GuidedTourStep[];
  current: GuidedTourStep | null;
  actionDone: boolean;
  hole: { left: number; top: number; width: number; height: number } | null;
  bubbleLeft: number;
  bubbleTop: number;
}

@Injectable({ providedIn: 'root' })
export class GuidedTourService {
  private steps: GuidedTourStep[] = [];
  private stepIndex = -1;
  private phase: GuidedTourPhase = 'idle';
  private actionDone = false;
  private listenersBound = false;

  private readonly stateSubject = new BehaviorSubject<GuidedTourUiState>(this.snapshot());
  readonly state$ = this.stateSubject.asObservable();

  private readonly onPointerMove = (e: PointerEvent) => this.handlePan(e);
  private readonly onWheel = (e: WheelEvent) => this.handleZoom(e);
  private readonly onContextMenu = () => this.handleContextMenu();
  private readonly onClickCapture = (e: Event) => this.handleClickCapture(e);
  private readonly onKeyDown = (e: KeyboardEvent) => this.handleKeyMove(e);
  private readonly onResize = () => this.refreshHole();

  private panLast: { x: number; y: number } | null = null;

  constructor(
    private tips: TeachingTipService,
    private ngZone: NgZone,
  ) { }

  get isActive(): boolean {
    return this.phase === 'welcome' || this.phase === 'running';
  }

  get isTourDone(): boolean {
    try {
      return localStorage.getItem(TOUR_DONE_KEY) === '1';
    } catch {
      return false;
    }
  }

  /** Call after UI is ready (ngAfterViewInit). */
  tryOfferFirstRun() {
    if (this.isTourDone || this.isActive) return;
    this.phase = 'welcome';
    this.tips.paused = true;
    this.tips.hideAll();
    this.emit();
  }

  start() {
    this.steps = buildGuidedTourSteps().filter(s => !shouldSkipStep(s));
    this.stepIndex = 0;
    this.phase = 'running';
    this.actionDone = this.steps[0]?.require === 'ack';
    this.tips.paused = true;
    this.tips.hideAll();
    this.bindListeners();
    this.refreshHole();
    this.emit();
  }

  skipAll() {
    this.markDone();
    this.teardown();
  }

  skipChapter() {
    if (this.phase !== 'running' || this.stepIndex < 0) return;
    const chapter = this.steps[this.stepIndex]?.chapter;
    if (!chapter) {
      this.next();
      return;
    }
    let i = this.stepIndex + 1;
    while (i < this.steps.length && this.steps[i].chapter === chapter) i++;
    this.stepIndex = i;
    if (this.stepIndex >= this.steps.length) {
      this.complete();
      return;
    }
    this.prepareStep();
  }

  next() {
    if (this.phase === 'welcome') {
      this.start();
      return;
    }
    if (this.phase !== 'running') return;
    if (!this.actionDone && this.currentRequire() !== 'ack') return;
    this.stepIndex++;
    while (this.stepIndex < this.steps.length && shouldSkipStep(this.steps[this.stepIndex])) {
      this.stepIndex++;
    }
    if (this.stepIndex >= this.steps.length) {
      this.complete();
      return;
    }
    this.prepareStep();
  }

  prev() {
    if (this.phase !== 'running' || this.stepIndex <= 0) return;
    this.stepIndex--;
    while (this.stepIndex > 0 && shouldSkipStep(this.steps[this.stepIndex])) {
      this.stepIndex--;
    }
    this.prepareStep();
  }

  replay() {
    try {
      localStorage.removeItem(TOUR_DONE_KEY);
    } catch { /* ignore */ }
    this.start();
  }

  notifyPanelOpened(tourId: string) {
    this.completeIfMatch('panel-open', tourId);
  }

  notifyMenuClick(tourId: string) {
    const req = this.currentRequire();
    if (req === 'panel-open' || req === 'click') {
      this.completeIfMatch(req, tourId);
    }
  }

  private completeIfMatch(require: TourRequire, tourId: string) {
    const step = this.steps[this.stepIndex];
    if (this.phase !== 'running' || !step) return;
    if (step.require !== require) return;
    if (step.tourId && step.tourId !== tourId) return;
    this.ngZone.run(() => {
      this.actionDone = true;
      this.emit();
    });
  }

  private prepareStep() {
    const step = this.steps[this.stepIndex];
    this.actionDone = !step || step.require === 'ack';
    this.panLast = null;
    this.refreshHole();
    this.emit();
  }

  private complete() {
    this.markDone();
    this.teardown();
  }

  private markDone() {
    try {
      localStorage.setItem(TOUR_DONE_KEY, '1');
    } catch { /* ignore */ }
  }

  private teardown() {
    this.unbindListeners();
    this.phase = 'idle';
    this.stepIndex = -1;
    this.steps = [];
    this.actionDone = false;
    this.tips.paused = false;
    this.emit();
  }

  private currentRequire(): TourRequire | null {
    return this.steps[this.stepIndex]?.require ?? null;
  }

  private bindListeners() {
    if (this.listenersBound) return;
    this.listenersBound = true;
    this.ngZone.runOutsideAngular(() => {
      window.addEventListener('pointermove', this.onPointerMove, true);
      window.addEventListener('wheel', this.onWheel, { capture: true, passive: true });
      window.addEventListener('contextmenu', this.onContextMenu, true);
      window.addEventListener('click', this.onClickCapture, true);
      window.addEventListener('keydown', this.onKeyDown, true);
      window.addEventListener('resize', this.onResize);
    });
  }

  private unbindListeners() {
    if (!this.listenersBound) return;
    this.listenersBound = false;
    window.removeEventListener('pointermove', this.onPointerMove, true);
    window.removeEventListener('wheel', this.onWheel, true);
    window.removeEventListener('contextmenu', this.onContextMenu, true);
    window.removeEventListener('click', this.onClickCapture, true);
    window.removeEventListener('keydown', this.onKeyDown, true);
    window.removeEventListener('resize', this.onResize);
  }

  private handlePan(e: PointerEvent) {
    if (this.currentRequire() !== 'gesture-pan') return;
    if (e.buttons === 0) {
      this.panLast = null;
      return;
    }
    // Ctrl+left drag = pan in this app
    if (!(e.buttons & 1) || !e.ctrlKey) return;
    if (!this.panLast) {
      this.panLast = { x: e.clientX, y: e.clientY };
      return;
    }
    const dx = e.clientX - this.panLast.x;
    const dy = e.clientY - this.panLast.y;
    if (dx * dx + dy * dy > 36) {
      this.ngZone.run(() => {
        this.actionDone = true;
        this.emit();
      });
    }
  }

  private handleZoom(e: WheelEvent) {
    if (this.currentRequire() !== 'gesture-zoom') return;
    if (Math.abs(e.deltaY) < 1) return;
    this.ngZone.run(() => {
      this.actionDone = true;
      this.emit();
    });
  }

  private handleKeyMove(e: KeyboardEvent) {
    if (this.currentRequire() !== 'key-move' || this.actionDone) return;
    const t = e.target as HTMLElement | null;
    if (t) {
      const tag = (t.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select' || t.isContentEditable) return;
    }
    const key = e.key;
    const code = e.code;
    const isMove =
      key === 'ArrowUp' || key === 'ArrowDown' || key === 'ArrowLeft' || key === 'ArrowRight' ||
      code === 'KeyW' || code === 'KeyA' || code === 'KeyS' || code === 'KeyD' ||
      key === 'w' || key === 'a' || key === 's' || key === 'd' ||
      key === 'W' || key === 'A' || key === 'S' || key === 'D';
    if (!isMove) return;
    this.ngZone.run(() => {
      this.actionDone = true;
      this.emit();
    });
  }

  private handleContextMenu() {
    if (this.currentRequire() !== 'context-menu') return;
    // Defer slightly so menu can open
    setTimeout(() => {
      this.ngZone.run(() => {
        this.actionDone = true;
        this.emit();
      });
    }, 50);
  }

  private handleClickCapture(e: Event) {
    const step = this.steps[this.stepIndex];
    if (this.phase !== 'running' || !step?.tourId) return;
    const el = (e.target as HTMLElement)?.closest?.(`[data-tour-id="${step.tourId}"]`);
    if (!el) return;
    if (step.require === 'click' || step.require === 'panel-open') {
      this.ngZone.run(() => {
        this.actionDone = true;
        this.emit();
      });
    }
  }

  refreshHole() {
    const step = this.steps[this.stepIndex];
    let hole: GuidedTourUiState['hole'] = null;
    let bubbleLeft = Math.max(16, window.innerWidth / 2 - 160);
    let bubbleTop = Math.max(16, window.innerHeight / 2 - 80);
    if (step?.target) {
      const el = document.querySelector(step.target) as HTMLElement | null;
      if (el) {
        const r = el.getBoundingClientRect();
        const pad = 6;
        hole = {
          left: r.left - pad,
          top: r.top - pad,
          width: r.width + pad * 2,
          height: r.height + pad * 2,
        };
        bubbleLeft = Math.min(window.innerWidth - 340, Math.max(8, r.right + 12));
        bubbleTop = Math.min(window.innerHeight - 200, Math.max(8, r.top));
        if (bubbleLeft + 320 > window.innerWidth) {
          bubbleLeft = Math.max(8, r.left - 332);
        }
      }
    }
    const cur = this.stateSubject.value;
    this.stateSubject.next({
      ...cur,
      hole,
      bubbleLeft,
      bubbleTop,
      actionDone: this.actionDone,
      stepIndex: this.stepIndex,
      current: step ?? null,
      phase: this.phase,
      steps: this.steps,
    });
  }

  private snapshot(): GuidedTourUiState {
    return {
      phase: this.phase,
      stepIndex: this.stepIndex,
      steps: this.steps,
      current: this.steps[this.stepIndex] ?? null,
      actionDone: this.actionDone,
      hole: null,
      bubbleLeft: 24,
      bubbleTop: 24,
    };
  }

  private emit() {
    this.refreshHole();
  }
}
