import { Injectable, NgZone } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { EventSystem } from '@udonarium/core/system';
import { buildGuidedTourSteps, GuidedTourStep, shouldSkipStep, TourRequire } from '@udonarium/guided-tour-steps';
import { PanelService } from 'service/panel.service';
import { TabletopSelectionService } from 'service/tabletop-selection.service';
import { TeachingTipService } from 'service/teaching-tip.service';
import { TokenPathMoveService } from 'service/token-path-move.service';

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
  private eventBound = false;

  private readonly stateSubject = new BehaviorSubject<GuidedTourUiState>(this.snapshot());
  readonly state$ = this.stateSubject.asObservable();

  private readonly onPointerMove = (e: PointerEvent) => this.handlePan(e);
  private readonly onWheel = (e: WheelEvent) => this.handleWheel(e);
  private readonly onContextMenu = () => this.handleContextMenu();
  private readonly onClickCapture = (e: Event) => this.handleClickCapture(e);
  private readonly onKeyDown = (e: KeyboardEvent) => this.handleKeyMove(e);
  private readonly onPointerUp = () => this.handlePathDraft();
  private readonly onResize = () => this.refreshHole();

  private panLast: { x: number; y: number } | null = null;
  /** Bumped to cancel pending panel-open auto-advance timers. */
  private autoAdvanceToken = 0;

  constructor(
    private tips: TeachingTipService,
    private ngZone: NgZone,
    private tokenPath: TokenPathMoveService,
    private selection: TabletopSelectionService,
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
    this.cancelAutoAdvance();
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
    this.prepareStep({ allowAutoAdvance: false });
  }

  next() {
    if (this.phase === 'welcome') {
      this.start();
      return;
    }
    if (this.phase !== 'running') return;
    if (!this.actionDone && this.currentRequire() !== 'ack') return;
    this.cancelAutoAdvance();
    this.stepIndex++;
    while (this.stepIndex < this.steps.length && shouldSkipStep(this.steps[this.stepIndex])) {
      this.stepIndex++;
    }
    if (this.stepIndex >= this.steps.length) {
      this.complete();
      return;
    }
    this.prepareStep({ allowAutoAdvance: true });
  }

  prev() {
    if (this.phase !== 'running' || this.stepIndex <= 0) return;
    this.cancelAutoAdvance();
    this.stepIndex--;
    while (this.stepIndex > 0 && shouldSkipStep(this.steps[this.stepIndex])) {
      this.stepIndex--;
    }
    // Never auto-skip when walking backward — otherwise「上一步」bounces forward again.
    this.prepareStep({ allowAutoAdvance: false });
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
      if (require === 'panel-open') {
        this.scheduleHoleRefresh();
        if (step.autoAdvance) this.scheduleAutoAdvance(320);
      }
    });
  }

  private prepareStep(opts?: { allowAutoAdvance?: boolean }) {
    const allowAutoAdvance = opts?.allowAutoAdvance !== false;
    const step = this.steps[this.stepIndex];
    this.actionDone = !step || step.require === 'ack';
    this.panLast = null;
    if (step?.id === 'tableChapter') {
      PanelService.closeAllPanels();
    }
    if (step?.require !== 'path-draft' && this.tokenPath.hasDraft) {
      this.tokenPath.cancelDraft();
    }
    if (step?.require === 'select-object') {
      // Force a fresh select so this step is practiced, not skipped from prior selection.
      this.selection.clear();
      this.actionDone = false;
    }
    // Panel already open: enable Next; auto-advance only when moving forward (e.g. Connection).
    if (step?.require === 'panel-open' && step.tourId && PanelService.getTourPanelElement(step.tourId)) {
      this.actionDone = true;
      this.refreshHole();
      this.emit();
      if (allowAutoAdvance && step.autoAdvance) this.scheduleAutoAdvance(0);
      else this.scheduleHoleRefresh();
      return;
    }
    this.refreshHole();
    this.emit();
    if (step?.require === 'panel-open' && this.actionDone) {
      this.scheduleHoleRefresh();
    }
  }

  private scheduleHoleRefresh() {
    const delays = [0, 50, 120, 220];
    for (const ms of delays) {
      setTimeout(() => {
        if (this.phase !== 'running') return;
        this.ngZone.run(() => this.refreshHole());
      }, ms);
    }
  }

  private cancelAutoAdvance() {
    this.autoAdvanceToken++;
  }

  /** After panel-open succeeds, move on without requiring「下一步」. */
  private scheduleAutoAdvance(delayMs: number) {
    if (!this.steps[this.stepIndex]?.autoAdvance) return;
    const token = ++this.autoAdvanceToken;
    const stepIndex = this.stepIndex;
    const stepId = this.steps[this.stepIndex]?.id;
    setTimeout(() => {
      if (token !== this.autoAdvanceToken) return;
      if (this.phase !== 'running') return;
      if (this.stepIndex !== stepIndex) return;
      if (this.steps[this.stepIndex]?.id !== stepId) return;
      if (!this.steps[this.stepIndex]?.autoAdvance) return;
      if (this.currentRequire() !== 'panel-open' || !this.actionDone) return;
      this.ngZone.run(() => this.next());
    }, delayMs);
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
    this.cancelAutoAdvance();
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
      window.addEventListener('pointerup', this.onPointerUp, true);
      window.addEventListener('resize', this.onResize);
    });
    if (!this.eventBound) {
      this.eventBound = true;
      EventSystem.register(this)
        .on('TABLE_PING_SPAWNED', () => this.handleTablePing())
        .on('UPDATE_SELECTION', () => this.handleSelectObject());
    }
  }

  private unbindListeners() {
    if (!this.listenersBound) return;
    this.listenersBound = false;
    window.removeEventListener('pointermove', this.onPointerMove, true);
    window.removeEventListener('wheel', this.onWheel, true);
    window.removeEventListener('contextmenu', this.onContextMenu, true);
    window.removeEventListener('click', this.onClickCapture, true);
    window.removeEventListener('keydown', this.onKeyDown, true);
    window.removeEventListener('pointerup', this.onPointerUp, true);
    window.removeEventListener('resize', this.onResize);
    if (this.eventBound) {
      this.eventBound = false;
      EventSystem.unregister(this);
    }
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

  private handleWheel(e: WheelEvent) {
    const req = this.currentRequire();
    if (req !== 'gesture-wheel-pan' && req !== 'gesture-zoom') return;
    if (Math.abs(e.deltaY) < 1 && Math.abs(e.deltaX) < 1) return;

    if (req === 'gesture-wheel-pan') {
      if (!(e.shiftKey || e.ctrlKey || e.metaKey) || e.altKey) return;
      // Ctrl+Shift+wheel is object rotate, not view pan
      if ((e.ctrlKey || e.metaKey) && e.shiftKey) return;
    } else {
      // Plain wheel zoom — ignore modifier pans / rotates
      if (e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) return;
    }

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

  private handlePathDraft() {
    if (this.currentRequire() !== 'path-draft' || this.actionDone) return;
    // Defer so game-table finishPathClick can add the waypoint first.
    setTimeout(() => {
      if (this.currentRequire() !== 'path-draft' || this.actionDone) return;
      if (!this.tokenPath.hasDraft) return;
      this.ngZone.run(() => {
        this.actionDone = true;
        this.emit();
      });
    }, 0);
  }

  private handleTablePing() {
    if (this.phase !== 'running' || this.currentRequire() !== 'table-ping' || this.actionDone) return;
    this.ngZone.run(() => {
      this.actionDone = true;
      this.emit();
    });
  }

  private handleSelectObject() {
    if (this.phase !== 'running' || this.currentRequire() !== 'select-object' || this.actionDone) return;
    if (this.selection.size < 1) return;
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
    const el = this.resolveHighlightElement(step);
    if (el) {
      const r = el.getBoundingClientRect();
      if (r.width >= 1 && r.height >= 1) {
        const pad = 4;
        hole = {
          left: Math.round(r.left) - pad,
          top: Math.round(r.top) - pad,
          width: Math.round(r.width) + pad * 2,
          height: Math.round(r.height) + pad * 2,
        };
        bubbleLeft = Math.min(window.innerWidth - 340, Math.max(8, r.right + 12));
        bubbleTop = Math.min(window.innerHeight - 200, Math.max(8, r.top));
        if (bubbleLeft + 320 > window.innerWidth) {
          bubbleLeft = Math.max(8, r.left - 332);
        }
        // Large panels: keep bubble near the panel's right edge
        if (r.width > window.innerWidth * 0.45) {
          bubbleLeft = Math.min(window.innerWidth - 340, Math.max(8, r.right + 8));
          if (bubbleLeft + 320 > window.innerWidth) {
            bubbleLeft = Math.max(8, r.left - 332);
          }
          bubbleTop = Math.min(window.innerHeight - 220, Math.max(8, r.top + 8));
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

  /** Nav button until panel opens; then the opened panel chrome. */
  private resolveHighlightElement(step: GuidedTourStep | null): HTMLElement | null {
    if (!step) return null;
    if (step.require === 'panel-open' && step.tourId) {
      if (this.actionDone) {
        const panel = PanelService.getTourPanelElement(step.tourId);
        if (panel) return panel;
      }
      return step.target ? document.querySelector(step.target) as HTMLElement | null : null;
    }
    if (step.tourId && (step.focusTarget || step.target?.includes('data-tour-panel'))) {
      const panel = PanelService.getTourPanelElement(step.tourId);
      if (panel) return panel;
    }
    if (step.focusTarget) {
      const focused = document.querySelector(step.focusTarget) as HTMLElement | null;
      if (focused) return focused;
    }
    return step.target ? document.querySelector(step.target) as HTMLElement | null : null;
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
