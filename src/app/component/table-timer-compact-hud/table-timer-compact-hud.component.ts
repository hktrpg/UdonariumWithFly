import { ChangeDetectorRef, Component, Input, OnDestroy, OnInit } from '@angular/core';
import { EventSystem } from '@udonarium/core/system';
import { GuestSession } from '@udonarium/guest-session';
import { TableTimer } from '@udonarium/table-fx/table-timer';
import { TimerService } from 'service/timer.service';

import * as localForage from 'localforage';

@Component({
  selector: 'table-timer-compact-hud',
  templateUrl: './table-timer-compact-hud.component.html',
  styleUrls: ['./table-timer-compact-hud.component.css'],
  standalone: false,
})
export class TableTimerCompactHudComponent implements OnInit, OnDestroy {
  private static readonly POS_KEY = 'udon.timer.compactHudPos';

  @Input() timers: TableTimer[] = [];

  left = 0;
  top = 72;
  private dragOffsetX = 0;
  private dragOffsetY = 0;
  private dragging = false;
  private positionedDefault = false;

  constructor(
    public timerService: TimerService,
    private changeDetector: ChangeDetectorRef,
  ) {}

  get isGuest(): boolean { return GuestSession.isGuest; }

  ngOnInit() {
    this.loadPosition();
    EventSystem.register(this)
      .on('TABLE_TIMER_TICK', () => this.changeDetector.markForCheck())
      .on('UPDATE_GAME_OBJECT', () => this.changeDetector.markForCheck());
  }

  ngOnDestroy() {
    EventSystem.unregister(this);
  }

  displayLabel(timer: TableTimer): string {
    return this.timerService.timerDisplayLabel(timer);
  }

  displayTime(timer: TableTimer): string {
    return this.timerService.formatRemaining(timer);
  }

  isRunning(timer: TableTimer): boolean {
    return timer?.state === 'running';
  }

  isFinished(timer: TableTimer): boolean {
    return timer?.state === 'finished';
  }

  isFlashing(timer: TableTimer): boolean {
    return this.timerService.isFlashing(timer);
  }

  expandTimer(timer: TableTimer, event: Event) {
    event.stopPropagation();
    if (!timer) return;
    this.timerService.setLocalViewMode(timer.identifier, 'full');
    this.changeDetector.markForCheck();
  }

  hideAll(event: Event) {
    event.stopPropagation();
    for (const timer of this.timers) {
      this.timerService.setLocalViewMode(timer.identifier, 'hidden');
    }
    this.changeDetector.markForCheck();
  }

  toggleRun(timer: TableTimer, event: Event) {
    event.stopPropagation();
    if (this.isGuest || !timer) return;
    if (timer.state === 'running') {
      this.timerService.pause(timer.identifier);
    } else {
      this.timerService.start(timer.identifier);
    }
  }

  stopTimer(timer: TableTimer, event: Event) {
    event.stopPropagation();
    if (this.isGuest || !timer) return;
    this.timerService.stop(timer.identifier);
  }

  startDrag(event: PointerEvent) {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const el = (event.currentTarget as HTMLElement).closest('.timer-compact-hud') as HTMLElement;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    this.dragOffsetX = event.clientX - rect.left;
    this.dragOffsetY = event.clientY - rect.top;
    this.dragging = true;
    const onMove = (e: PointerEvent) => this.onDragMove(e);
    const onUp = () => {
      this.dragging = false;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      this.persistPosition();
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }

  private onDragMove(event: PointerEvent) {
    if (!this.dragging) return;
    const vw = window.innerWidth || 1;
    const vh = window.innerHeight || 1;
    const el = document.querySelector('.timer-compact-hud') as HTMLElement;
    const w = el?.offsetWidth || 220;
    const h = el?.offsetHeight || 80;
    this.left = Math.min(vw - w - 8, Math.max(8, event.clientX - this.dragOffsetX));
    this.top = Math.min(vh - h - 8, Math.max(8, event.clientY - this.dragOffsetY));
    this.changeDetector.markForCheck();
  }

  private loadPosition() {
    localForage.getItem<{ left: number; top: number }>(TableTimerCompactHudComponent.POS_KEY).then(pos => {
      if (pos && Number.isFinite(pos.left) && Number.isFinite(pos.top)) {
        this.left = pos.left;
        this.top = pos.top;
        this.positionedDefault = true;
      } else {
        this.placeDefaultTopRight();
      }
      this.changeDetector.markForCheck();
    }).catch(() => this.placeDefaultTopRight());
  }

  private placeDefaultTopRight() {
    if (this.positionedDefault) return;
    this.positionedDefault = true;
    const vw = window.innerWidth || 800;
    this.left = Math.max(8, vw - 240);
    this.top = 72;
  }

  private persistPosition() {
    localForage.setItem(TableTimerCompactHudComponent.POS_KEY, { left: this.left, top: this.top }).catch(() => {});
  }
}
