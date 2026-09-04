import { ChangeDetectorRef, Component, OnDestroy, OnInit } from '@angular/core';

import { EventSystem } from '@udonarium/core/system';
import { I18nService } from 'service/i18n.service';
import { MobileLayoutService } from 'service/mobile-layout.service';
import { PanelService } from 'service/panel.service';
import { StreetscapeJobService } from 'service/streetscape-job.service';
import { openOrRestoreStreetscapeImportPanel } from 'service/streetscape-panel';

import * as localForage from 'localforage';

@Component({
  selector: 'streetscape-job-hud',
  templateUrl: './streetscape-job-hud.component.html',
  styleUrls: ['./streetscape-job-hud.component.css'],
  standalone: false,
})
export class StreetscapeJobHudComponent implements OnInit, OnDestroy {
  private static readonly POS_KEY = 'udon.streetscape.jobHudPos';

  left = 12;
  top = 120;
  private dragOffsetX = 0;
  private dragOffsetY = 0;
  private dragging = false;
  private unsub: (() => void) | null = null;

  constructor(
    public job: StreetscapeJobService,
    private panelService: PanelService,
    private i18n: I18nService,
    private mobileLayout: MobileLayoutService,
    private changeDetector: ChangeDetectorRef,
  ) {}

  get visible(): boolean {
    return this.job.showHud;
  }

  get statusText(): string {
    return this.job.status || this.i18n.t('streetscape.jobHudWorking');
  }

  get isRunning(): boolean {
    return this.job.busy;
  }

  get isDone(): boolean {
    return !this.job.busy && this.job.phase === 'done';
  }

  get isError(): boolean {
    return !this.job.busy && this.job.phase === 'error';
  }

  ngOnInit() {
    this.loadPosition();
    this.unsub = this.job.subscribe(() => this.changeDetector.markForCheck());
    EventSystem.register(this).on('LOCALE_CHANGED', () => this.changeDetector.markForCheck());
  }

  ngOnDestroy() {
    this.unsub?.();
    EventSystem.unregister(this);
  }

  openPanel(event?: Event) {
    event?.stopPropagation();
    openOrRestoreStreetscapeImportPanel({
      panelService: this.panelService,
      i18n: this.i18n,
      mobileLayout: this.mobileLayout,
      job: this.job,
    });
  }

  cancel(event: Event) {
    event.stopPropagation();
    this.job.cancel();
  }

  dismiss(event: Event) {
    event.stopPropagation();
    if (this.job.busy) {
      this.openPanel();
      return;
    }
    this.job.dismissHud();
  }

  startDrag(event: PointerEvent) {
    if (event.button !== 0) return;
    const el = (event.currentTarget as HTMLElement).closest('.streetscape-job-hud') as HTMLElement;
    if (!el) return;
    this.dragging = true;
    this.dragOffsetX = event.clientX - el.offsetLeft;
    this.dragOffsetY = event.clientY - el.offsetTop;
    el.setPointerCapture(event.pointerId);
    const onMove = (e: PointerEvent) => {
      if (!this.dragging) return;
      this.left = Math.max(0, e.clientX - this.dragOffsetX);
      this.top = Math.max(0, e.clientY - this.dragOffsetY);
      this.changeDetector.markForCheck();
    };
    const onUp = () => {
      this.dragging = false;
      el.releasePointerCapture(event.pointerId);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      this.savePosition();
    };
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
  }

  private async loadPosition() {
    try {
      const pos = await localForage.getItem<{ left: number; top: number }>(StreetscapeJobHudComponent.POS_KEY);
      if (pos && Number.isFinite(pos.left) && Number.isFinite(pos.top)) {
        this.left = pos.left;
        this.top = pos.top;
        this.changeDetector.markForCheck();
      }
    } catch { /* ignore */ }
  }

  private savePosition() {
    localForage.setItem(StreetscapeJobHudComponent.POS_KEY, { left: this.left, top: this.top }).catch(() => {});
  }
}
