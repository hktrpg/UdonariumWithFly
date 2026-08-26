import { Injectable, NgZone } from '@angular/core';
import * as localForage from 'localforage';

import { EventSystem, Network } from '@udonarium/core/system';
import { GuestSession } from '@udonarium/guest-session';
import { PeerCursor } from '@udonarium/peer-cursor';
import { TableTimer, TableTimerCountMode, TableTimerDisplayMode, TableTimerList, TableTimerState, TIMER_OPERATION_LOG_TAB } from '@udonarium/table-fx/table-timer';
import { translate } from 'i18n';

import { TimerZeroRunnerService } from './timer-zero-runner.service';

/** Personal canvas view (not synced). Synced displayMode only gates room show/hide. */
export type TimerLocalViewMode = 'full' | 'compact' | 'hidden';

@Injectable({ providedIn: 'root' })
export class TimerService {
  private static readonly LOCAL_VIEW_KEY = 'udon.timer.localViewModes';
  private static readonly PERSONAL_CANVAS_KEY = 'udon.timer.personalCanvas';
  private tickTimer: ReturnType<typeof setInterval> | null = null;
  private readonly handledFinishAt = new Map<string, number>();
  private readonly localViewModes = new Map<string, TimerLocalViewMode>();
  private readonly personalCanvasIds = new Set<string>();
  private localViewReady = false;

  constructor(
    private ngZone: NgZone,
    private zeroRunner: TimerZeroRunnerService,
  ) {
    TableTimerList.instance;
    this.loadLocalViewModes();
    EventSystem.register(this)
      .on(`UPDATE_GAME_OBJECT/identifier/${TableTimerList.instance.identifier}`, () => {
        this.ngZone.run(() => this.pruneHandledFinishes());
      })
      .on('UPDATE_GAME_OBJECT', event => {
        const timer = this.timers.find(t => t.identifier === event.data?.identifier);
        if (timer?.state === 'finished' && timer.finishedAt > 0) {
          this.maybeRunOnZero(timer);
        }
      });
    this.startTick();
  }

  get list(): TableTimerList { return TableTimerList.instance; }

  get timers(): TableTimer[] { return this.list.timers; }

  /** Timers that should appear on this user's canvas (any view mode). */
  get canvasTimers(): TableTimer[] {
    return this.timers.filter(t => this.isOnCanvas(t));
  }

  /** Full-mode widgets (one per timer). */
  get fullCanvasTimers(): TableTimer[] {
    return this.canvasTimers.filter(t => this.getLocalViewMode(t.identifier) === 'full');
  }

  /** Compact-mode timers merged into a single HUD. */
  get compactCanvasTimers(): TableTimer[] {
    return this.canvasTimers.filter(t => this.getLocalViewMode(t.identifier) === 'compact');
  }

  /** @deprecated Use fullCanvasTimers / compactCanvasTimers. */
  get overlayTimers(): TableTimer[] {
    return this.canvasTimers;
  }

  get isGuest(): boolean { return GuestSession.isGuest || Network.GuestMode(); }

  isRoomVisible(timer: TableTimer | null | undefined): boolean {
    return !!timer && timer.displayMode !== 'hidden';
  }

  setRoomVisible(identifier: string, visible: boolean) {
    if (this.isGuest || !identifier) return;
    const timer = this.timers.find(t => t.identifier === identifier);
    if (!timer || !this.canManageTimer(timer)) return;
    timer.displayMode = visible ? 'full' : 'hidden';
    if (visible) {
      this.personalCanvasIds.delete(identifier);
      this.persistPersonalCanvas();
    }
    this.touch(timer);
    EventSystem.trigger('TABLE_TIMER_TICK', null);
  }

  /** Broadcast timer on every participant's canvas (synced). Does not change local layout or position. */
  showOnRoomCanvas(identifier: string) {
    if (this.isGuest || !identifier) return;
    const timer = this.timers.find(t => t.identifier === identifier);
    if (!timer || !this.canManageTimer(timer)) return;
    const wasRoomHidden = timer.displayMode === 'hidden';
    if (wasRoomHidden) {
      timer.displayMode = 'full';
    }
    this.personalCanvasIds.delete(identifier);
    this.persistPersonalCanvas();
    const local = this.getLocalViewMode(identifier);
    if (local === 'hidden') {
      this.setLocalViewMode(identifier, 'full');
    } else if (wasRoomHidden) {
      EventSystem.trigger('TABLE_TIMER_TICK', null);
    }
    this.touch(timer);
  }

  /** Show on this client only (works even when room display is hidden). Preserves compact/full when already visible. */
  showOnMyCanvas(identifier: string, mode: TimerLocalViewMode = 'full') {
    if (!identifier || mode === 'hidden') return;
    const timer = this.timers.find(t => t.identifier === identifier);
    if (!timer) return;
    let changed = false;
    if (!this.isRoomVisible(timer)) {
      if (!this.personalCanvasIds.has(identifier)) {
        this.personalCanvasIds.add(identifier);
        this.persistPersonalCanvas();
        changed = true;
      }
    }
    if (this.getLocalViewMode(identifier) === 'hidden') {
      this.setLocalViewMode(identifier, mode);
    } else if (changed) {
      EventSystem.trigger('TABLE_TIMER_TICK', null);
    }
  }

  isOnCanvas(timer: TableTimer | null | undefined): boolean {
    if (!timer) return false;
    const local = this.getLocalViewMode(timer.identifier);
    if (local === 'hidden') return false;
    if (this.isRoomVisible(timer)) return true;
    return this.personalCanvasIds.has(timer.identifier);
  }

  getLocalViewMode(identifier: string): TimerLocalViewMode {
    const stored = this.localViewModes.get(identifier);
    if (stored) return stored;
    return 'full';
  }

  setLocalViewMode(identifier: string, mode: TimerLocalViewMode) {
    if (!identifier) return;
    this.localViewModes.set(identifier, mode);
    this.persistLocalViewModes();
    EventSystem.trigger('TABLE_TIMER_TICK', null);
  }

  createTimer(label?: string, totalMs = 5 * 60 * 1000): TableTimer | null {
    if (this.isGuest) return null;
    const timer = this.list.addTimer(label?.trim() || '', totalMs);
    timer.createdBy = PeerCursor.myCursor?.name || '';
    timer.createdByUserId = Network.peer?.userId || '';
    timer.displayMode = 'full';
    this.setLocalViewMode(timer.identifier, 'full');
    this.personalCanvasIds.delete(timer.identifier);
    this.persistPersonalCanvas();
    this.touch(timer);
    timer.onZeroActions = [
      { type: 'sound', preset: 'surprise' },
      { type: 'chat', message: '', tabIdentifier: TIMER_OPERATION_LOG_TAB },
    ];
    const n = Math.max(1, timer.sequenceNumber);
    timer.posY = Math.min(88, 12 + (n - 1) * 7);
    timer.posX = Math.min(92, Math.max(8, 50 + ((n - 1) % 3 - 1) * 8));
    return timer;
  }

  canManageTimer(timer: TableTimer | null | undefined): boolean {
    if (this.isGuest || !timer) return false;
    if (PeerCursor.myCursor?.isGMMode) return true;
    const userId = Network.peer?.userId;
    if (!userId) return false;
    if (timer.createdByUserId) return timer.createdByUserId === userId;
    return timer.createdBy === (PeerCursor.myCursor?.name || '');
  }

  deleteTimer(identifier: string) {
    if (this.isGuest || !identifier) return;
    const timer = this.timers.find(t => t.identifier === identifier);
    if (!this.canManageTimer(timer)) return;
    this.handledFinishAt.delete(identifier);
    this.localViewModes.delete(identifier);
    this.personalCanvasIds.delete(identifier);
    this.persistLocalViewModes();
    this.persistPersonalCanvas();
    this.list.removeTimer(identifier);
  }

  updateTimer(identifier: string, patch: Partial<{
    label: string;
    totalMs: number;
    countMode: TableTimerCountMode;
    displayMode: TableTimerDisplayMode;
    posX: number;
    posY: number;
    flashSeconds: number;
    onZeroActionsJson: string;
  }>) {
    if (this.isGuest || !identifier) return;
    const timer = this.timers.find(t => t.identifier === identifier);
    if (!timer || !this.canManageTimer(timer)) return;
    if (patch.label != null) timer.label = patch.label;
    if (patch.countMode != null && patch.countMode !== timer.countMode) {
      timer.countMode = patch.countMode;
      if (timer.state === 'stopped' || timer.state === 'finished') {
        timer.remainingMs = patch.countMode === 'countup' ? 0 : timer.totalMs;
      }
    }
    if (patch.displayMode != null) timer.displayMode = patch.displayMode;
    if (patch.posX != null) timer.posX = this.clampPercent(patch.posX);
    if (patch.posY != null) timer.posY = this.clampPercent(patch.posY);
    if (patch.flashSeconds != null) timer.flashSeconds = Math.max(0, patch.flashSeconds);
    if (patch.onZeroActionsJson != null) timer.onZeroActionsJson = patch.onZeroActionsJson;
    if (patch.totalMs != null && patch.totalMs > 0) {
      timer.totalMs = patch.totalMs;
      if (timer.state === 'stopped' || timer.state === 'finished') {
        timer.remainingMs = patch.totalMs;
      }
    }
    this.touch(timer);
  }

  /** @deprecated Prefer setLocalViewMode — kept for older callers. */
  cycleDisplayMode(identifier: string) {
    if (!identifier) return;
    const order: TimerLocalViewMode[] = ['full', 'compact'];
    const cur = this.getLocalViewMode(identifier);
    const idx = order.indexOf(cur as TimerLocalViewMode);
    this.setLocalViewMode(identifier, order[(idx < 0 ? 0 : idx + 1) % order.length]);
  }

  /** @deprecated Prefer setLocalViewMode. */
  setDisplayMode(identifier: string, mode: TableTimerDisplayMode) {
    if (mode === 'hidden') {
      this.setLocalViewMode(identifier, 'hidden');
      return;
    }
    this.setLocalViewMode(identifier, mode === 'minimal' ? 'compact' : mode);
  }

  start(identifier: string) {
    if (this.isGuest || !identifier) return;
    const timer = this.timers.find(t => t.identifier === identifier);
    if (!timer) return;
    const now = Date.now();
    if (timer.countMode === 'countup') {
      if (timer.state === 'paused') {
        timer.startedAt = now;
        timer.state = 'running';
      } else {
        timer.remainingMs = 0;
        timer.startedAt = now;
        timer.state = 'running';
        timer.finishedAt = 0;
        timer.finishedByPeerId = '';
        this.handledFinishAt.delete(identifier);
      }
    } else if (timer.state === 'paused' && timer.remainingMs > 0) {
      timer.startedAt = now;
      timer.state = 'running';
    } else {
      timer.remainingMs = timer.totalMs;
      timer.startedAt = now;
      timer.state = 'running';
      timer.finishedAt = 0;
      timer.finishedByPeerId = '';
      this.handledFinishAt.delete(identifier);
    }
    this.touch(timer);
  }

  pause(identifier: string) {
    if (this.isGuest || !identifier) return;
    const timer = this.timers.find(t => t.identifier === identifier);
    if (!timer || timer.state !== 'running') return;
    if (timer.countMode === 'countup') {
      timer.remainingMs = this.computeElapsed(timer);
    } else {
      timer.remainingMs = this.computeRemaining(timer);
    }
    timer.startedAt = 0;
    timer.state = 'paused';
    this.touch(timer);
  }

  stop(identifier: string) {
    if (this.isGuest || !identifier) return;
    const timer = this.timers.find(t => t.identifier === identifier);
    if (!timer) return;
    timer.remainingMs = timer.countMode === 'countup' ? 0 : timer.totalMs;
    timer.startedAt = 0;
    timer.state = 'stopped';
    timer.finishedAt = 0;
    timer.finishedByPeerId = '';
    this.handledFinishAt.delete(identifier);
    this.touch(timer);
  }

  reset(identifier: string) {
    this.stop(identifier);
  }

  setPosition(identifier: string, posX: number, posY: number) {
    if (this.isGuest || !identifier) return;
    const timer = this.timers.find(t => t.identifier === identifier);
    if (!timer) return;
    timer.posX = this.clampPercent(posX);
    timer.posY = this.clampPercent(posY);
    this.touch(timer);
  }

  formatRemaining(timer: TableTimer): string {
    const ms = this.getDisplayMs(timer);
    const totalSec = Math.ceil(ms / 1000);
    const min = Math.floor(totalSec / 60);
    const sec = totalSec % 60;
    return `${min}:${sec.toString().padStart(2, '0')}`;
  }

  /** 0–1 progress for full-mode ring (remaining for countdown, elapsed for count-up). */
  progressRatio(timer: TableTimer): number {
    if (!timer || timer.totalMs <= 0) return 0;
    const ms = this.getDisplayMs(timer);
    return Math.min(1, Math.max(0, ms / timer.totalMs));
  }

  timerDisplayLabel(timer: TableTimer): string {
    const label = (timer.label || '').trim();
    if (label) return label;
    const n = timer.sequenceNumber > 0 ? timer.sequenceNumber : this.timers.indexOf(timer) + 1;
    return translate('timer.defaultLabel', { n: Math.max(1, n) });
  }

  isFlashing(timer: TableTimer): boolean {
    if (timer.state !== 'finished' || !(timer.finishedAt > 0)) return false;
    const duration = Math.max(0, timer.flashSeconds) * 1000;
    return Date.now() - timer.finishedAt < duration;
  }

  private startTick() {
    if (this.tickTimer != null) return;
    this.tickTimer = setInterval(() => this.tick(), 200);
  }

  private tick() {
    let changed = false;
    for (const timer of this.timers) {
      if (timer.state !== 'running') continue;
      if (timer.countMode === 'countup') {
        const elapsed = this.computeElapsed(timer);
        if (timer.totalMs > 0 && elapsed >= timer.totalMs) {
          timer.remainingMs = timer.totalMs;
          timer.startedAt = 0;
          timer.state = 'finished';
          changed = true;
          this.tryFinish(timer);
        } else {
          changed = true;
        }
        continue;
      }
      const remaining = this.computeRemaining(timer);
      if (remaining > 0) {
        changed = true;
        continue;
      }
      timer.remainingMs = 0;
      timer.startedAt = 0;
      timer.state = 'finished';
      changed = true;
      this.tryFinish(timer);
    }
    if (changed) {
      this.ngZone.run(() => EventSystem.trigger('TABLE_TIMER_TICK', null));
    }
  }

  private tryFinish(timer: TableTimer) {
    if (timer.finishedAt > 0) {
      this.maybeRunOnZero(timer);
      return;
    }
    const now = Date.now();
    timer.finishedAt = now;
    timer.finishedByPeerId = this.peerId();
    this.touch(timer);
    this.maybeRunOnZero(timer);
  }

  private maybeRunOnZero(timer: TableTimer) {
    if (!(timer.finishedAt > 0)) return;
    const prev = this.handledFinishAt.get(timer.identifier);
    if (prev === timer.finishedAt) return;
    if (timer.finishedByPeerId && timer.finishedByPeerId !== this.peerId()) {
      this.handledFinishAt.set(timer.identifier, timer.finishedAt);
      return;
    }
    this.handledFinishAt.set(timer.identifier, timer.finishedAt);
    this.ngZone.run(() => this.zeroRunner.run(timer));
  }

  private pruneHandledFinishes() {
    const live = new Set(this.timers.map(t => t.identifier));
    for (const id of Array.from(this.handledFinishAt.keys())) {
      if (!live.has(id)) this.handledFinishAt.delete(id);
    }
  }

  private computeRemaining(timer: TableTimer): number {
    if (timer.state !== 'running' || !(timer.startedAt > 0)) {
      return Math.max(0, timer.remainingMs);
    }
    return Math.max(0, timer.remainingMs - (Date.now() - timer.startedAt));
  }

  private computeElapsed(timer: TableTimer): number {
    if (timer.state !== 'running' || !(timer.startedAt > 0)) {
      return Math.max(0, timer.remainingMs);
    }
    return Math.max(0, timer.remainingMs + (Date.now() - timer.startedAt));
  }

  private getDisplayMs(timer: TableTimer): number {
    if (timer.countMode === 'countup') {
      return timer.state === 'running' ? this.computeElapsed(timer) : Math.max(0, timer.remainingMs);
    }
    return timer.state === 'running' ? this.computeRemaining(timer) : Math.max(0, timer.remainingMs);
  }

  private clampPercent(value: number): number {
    if (!Number.isFinite(value)) return 50;
    return Math.min(100, Math.max(0, value));
  }

  private peerId(): string {
    return Network.peer?.peerId || '';
  }

  private touch(timer: TableTimer) {
    timer.lastTouchedBy = PeerCursor.myCursor?.name || '';
    timer.lastTouchedAt = Date.now();
  }

  private loadLocalViewModes() {
    Promise.all([
      localForage.getItem<Record<string, TimerLocalViewMode>>(TimerService.LOCAL_VIEW_KEY),
      localForage.getItem<string[]>(TimerService.PERSONAL_CANVAS_KEY),
    ]).then(([map, personalIds]) => {
      if (map && typeof map === 'object') {
        for (const [id, mode] of Object.entries(map)) {
          if (mode === 'full' || mode === 'compact' || mode === 'hidden') {
            this.localViewModes.set(id, mode);
          } else if (mode === 'minimal') {
            this.localViewModes.set(id, 'compact');
          }
        }
      }
      if (Array.isArray(personalIds)) {
        for (const id of personalIds) {
          if (typeof id === 'string' && id) this.personalCanvasIds.add(id);
        }
      }
      this.localViewReady = true;
      this.ngZone.run(() => EventSystem.trigger('TABLE_TIMER_TICK', null));
    }).catch(() => {
      this.localViewReady = true;
    });
  }

  private persistLocalViewModes() {
    const payload: Record<string, TimerLocalViewMode> = {};
    for (const [id, mode] of this.localViewModes) {
      payload[id] = mode;
    }
    localForage.setItem(TimerService.LOCAL_VIEW_KEY, payload).catch(() => {});
  }

  private persistPersonalCanvas() {
    localForage.setItem(TimerService.PERSONAL_CANVAS_KEY, Array.from(this.personalCanvasIds)).catch(() => {});
  }
}
