import { ChangeDetectorRef, Component, Input, OnDestroy, OnInit } from '@angular/core';
import { EventSystem } from '@udonarium/core/system';
import { GuestSession } from '@udonarium/guest-session';
import { TableTimer } from '@udonarium/table-fx/table-timer';
import { TimerLocalViewMode, TimerService } from 'service/timer.service';

@Component({
  selector: 'table-timer',
  templateUrl: './table-timer.component.html',
  styleUrls: ['./table-timer.component.css'],
  standalone: false,
})
export class TableTimerComponent implements OnInit, OnDestroy {
  @Input() timer: TableTimer;

  private dragOffsetX = 0;
  private dragOffsetY = 0;
  private dragging = false;
  private flashTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    public timerService: TimerService,
    private changeDetector: ChangeDetectorRef,
  ) {}

  get isGuest(): boolean { return GuestSession.isGuest; }
  get viewMode(): TimerLocalViewMode {
    return this.timer ? this.timerService.getLocalViewMode(this.timer.identifier) : 'full';
  }
  get isFull(): boolean { return this.viewMode === 'full'; }
  get isCompact(): boolean { return this.viewMode === 'compact'; }
  get showLabel(): boolean { return this.isFull; }
  get displayTime(): string { return this.timer ? this.timerService.formatRemaining(this.timer) : ''; }
  get isFlashing(): boolean { return this.timer ? this.timerService.isFlashing(this.timer) : false; }
  get isRunning(): boolean { return this.timer?.state === 'running'; }
  get isFinished(): boolean { return this.timer?.state === 'finished'; }

  get displayLabel(): string {
    if (!this.timer) return '';
    return this.timerService.timerDisplayLabel(this.timer);
  }

  readonly ringRadius = 15.915;
  get ringCircumference(): number { return 2 * Math.PI * this.ringRadius; }
  get ringDashOffset(): number {
    return this.ringCircumference * (1 - this.timerService.progressRatio(this.timer));
  }

  ngOnInit() {
    EventSystem.register(this)
      .on('TABLE_TIMER_TICK', () => this.changeDetector.markForCheck())
      .on(`UPDATE_GAME_OBJECT/identifier/${this.timer?.identifier}`, () => this.changeDetector.markForCheck());
    this.flashTimer = setInterval(() => {
      if (this.timerService.isFlashing(this.timer)) {
        this.changeDetector.markForCheck();
      }
    }, 250);
  }

  ngOnDestroy() {
    EventSystem.unregister(this);
    if (this.flashTimer) clearInterval(this.flashTimer);
  }

  startDrag(event: PointerEvent) {
    if (this.isGuest || !this.timer || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const el = (event.currentTarget as HTMLElement).closest('.table-timer-root') as HTMLElement;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    this.dragOffsetX = event.clientX - rect.left;
    this.dragOffsetY = event.clientY - rect.top;
    this.dragging = true;
    const onMove = (e: PointerEvent) => this.onDragMove(e);
    const onUp = (e: PointerEvent) => {
      this.dragging = false;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      this.onDragEnd(e);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }

  private onDragMove(event: PointerEvent) {
    if (!this.dragging || !this.timer) return;
    const vw = window.innerWidth || 1;
    const vh = window.innerHeight || 1;
    const el = document.querySelector(`[data-timer-id="${this.timer.identifier}"]`) as HTMLElement;
    const w = el?.offsetWidth || 120;
    const h = el?.offsetHeight || 48;
    const left = event.clientX - this.dragOffsetX;
    const top = event.clientY - this.dragOffsetY;
    const posX = ((left + w / 2) / vw) * 100;
    const posY = ((top + h / 2) / vh) * 100;
    this.timerService.setPosition(this.timer.identifier, posX, posY);
    this.changeDetector.markForCheck();
  }

  private onDragEnd(_event: PointerEvent) {
    this.changeDetector.markForCheck();
  }

  toggleRun(event: Event) {
    event.stopPropagation();
    if (this.isGuest || !this.timer) return;
    if (this.timer.state === 'running') {
      this.timerService.pause(this.timer.identifier);
    } else {
      this.timerService.start(this.timer.identifier);
    }
  }

  stopTimer(event: Event) {
    event.stopPropagation();
    if (this.isGuest || !this.timer) return;
    this.timerService.stop(this.timer.identifier);
  }

  setViewMode(mode: TimerLocalViewMode, event: Event) {
    event.stopPropagation();
    if (!this.timer) return;
    this.timerService.setLocalViewMode(this.timer.identifier, mode);
    this.changeDetector.markForCheck();
  }

  onShellClick(_event: MouseEvent) {
    // Full mode only on this widget; compact timers live in the merged HUD.
  }
}
