import { ChangeDetectorRef, Component, OnDestroy, OnInit } from '@angular/core';

import { EventSystem } from '@udonarium/core/system';
import { GameTable } from '@udonarium/game-table';
import {
  clampFloorCropInsets,
  emptyFloorCropInsets,
  FloorCropInsets,
  floorCropClipPath,
  setTableFloorCrop,
} from '@udonarium/table-floor-crop';
import { I18nService } from 'service/i18n.service';
import { PanelService } from 'service/panel.service';

export type TableFloorCropHost = {
  table: GameTable;
  imageUrl: string;
  insets?: FloorCropInsets;
  allowSkip?: boolean;
  /** Push insets to the big map while editing (display-only). */
  livePreview?: (insets: FloorCropInsets) => void;
  settle?: (result: 'apply' | 'skip' | 'cancel') => void;
};

@Component({
  selector: 'table-floor-crop',
  templateUrl: './table-floor-crop.component.html',
  styleUrls: ['../shared/settings-ui.css', './table-floor-crop.component.css'],
  standalone: false,
})
export class TableFloorCropComponent implements OnInit, OnDestroy {
  table: GameTable | null = null;
  imageUrl = '';
  insets: FloorCropInsets = emptyFloorCropInsets();
  /** Insets when the editor opened — restored on cancel. */
  private openedInsets: FloorCropInsets = emptyFloorCropInsets();
  allowSkip = false;
  previewZoom = 1;
  readonly sliderMax = 45;
  applying = false;
  private livePreview: ((insets: FloorCropInsets) => void) | null = null;
  private settle: ((result: 'apply' | 'skip' | 'cancel') => void) | null = null;
  private settled = false;

  constructor(
    private panelService: PanelService,
    private i18n: I18nService,
    private changeDetector: ChangeDetectorRef,
  ) {}

  setup(host: TableFloorCropHost) {
    this.table = host.table;
    this.imageUrl = host.imageUrl || '';
    this.insets = clampFloorCropInsets(host.insets || emptyFloorCropInsets());
    this.openedInsets = { ...this.insets };
    this.allowSkip = !!host.allowSkip;
    this.livePreview = host.livePreview || null;
    this.settle = host.settle || null;
    this.livePreview?.(this.insets);
    this.changeDetector.markForCheck();
  }

  ngOnInit() {
    Promise.resolve().then(() => {
      this.panelService.title = this.i18n.t('tableFloorCrop.title');
    });
    EventSystem.register(this).on('LOCALE_CHANGED', () => {
      this.panelService.title = this.i18n.t('tableFloorCrop.title');
      this.changeDetector.markForCheck();
    });
  }

  ngOnDestroy() {
    EventSystem.unregister(this);
    if (!this.settled) this.finish('cancel');
  }

  get clipPath(): string {
    return floorCropClipPath(this.insets);
  }

  pct(edge: keyof FloorCropInsets): number {
    return this.insets[edge];
  }

  setPct(edge: keyof FloorCropInsets, value: number) {
    this.insets = clampFloorCropInsets({ ...this.insets, [edge]: Number(value) || 0 });
    this.livePreview?.(this.insets);
    this.changeDetector.markForCheck();
  }

  reset() {
    this.insets = emptyFloorCropInsets();
    this.previewZoom = 1;
    this.livePreview?.(this.insets);
    this.changeDetector.markForCheck();
  }

  onWheel(event: WheelEvent) {
    event.preventDefault();
    const delta = event.deltaY > 0 ? -0.1 : 0.1;
    this.previewZoom = Math.max(1, Math.min(4, Math.round((this.previewZoom + delta) * 10) / 10));
    this.changeDetector.markForCheck();
  }

  apply() {
    if (!this.table || this.applying) return;
    this.applying = true;
    try {
      // Persist % only — keep original aerial + model positions.
      setTableFloorCrop(this.table, this.insets);
      this.finish('apply');
      this.panelService.close({ force: true });
    } finally {
      this.applying = false;
      this.changeDetector.markForCheck();
    }
  }

  skip() {
    // Import flow: leave whatever was stored (usually none).
    this.livePreview?.(this.openedInsets);
    this.finish('skip');
    this.panelService.close({ force: true });
  }

  cancel() {
    // Revert live preview to the insets from when the panel opened.
    this.livePreview?.(this.openedInsets);
    this.finish('cancel');
    this.panelService.close({ force: true });
  }

  private finish(result: 'apply' | 'skip' | 'cancel') {
    if (this.settled) return;
    this.settled = true;
    this.settle?.(result);
  }
}
