import { Injectable } from '@angular/core';

import { ImageStorage } from '@udonarium/core/file-storage/image-storage';
import { EventSystem } from '@udonarium/core/system';
import { GameTable } from '@udonarium/game-table';
import {
  FloorCropInsets,
  clampFloorCropInsets,
  emptyFloorCropInsets,
  readTableFloorCrop,
  setTableFloorCrop,
} from '@udonarium/table-floor-crop';
import { TableFloorCropComponent } from 'component/table-floor-crop/table-floor-crop.component';
import { I18nService } from 'service/i18n.service';
import { PanelOption, PanelService } from 'service/panel.service';
import { PointerDeviceService } from 'service/pointer-device.service';

export const TABLE_FLOOR_CROP_PREVIEW = 'TABLE_FLOOR_CROP_PREVIEW';

@Injectable({ providedIn: 'root' })
export class TableFloorCropService {
  private live = new Map<string, FloorCropInsets>();

  constructor(
    private panelService: PanelService,
    private pointerDeviceService: PointerDeviceService,
    private i18n: I18nService,
  ) {}

  livePreviewFor(tableId: string | null | undefined): FloorCropInsets | null {
    if (!tableId) return null;
    return this.live.get(tableId) || null;
  }

  setLivePreview(tableId: string, insets: FloorCropInsets) {
    this.live.set(tableId, clampFloorCropInsets(insets));
    EventSystem.trigger(TABLE_FLOOR_CROP_PREVIEW, { identifier: tableId });
  }

  clearLivePreview(tableId: string) {
    this.live.delete(tableId);
    EventSystem.trigger(TABLE_FLOOR_CROP_PREVIEW, { identifier: tableId });
  }

  /** Open crop editor. Insets are stored as % on the table (reversible, re-editable). */
  open(table: GameTable, opts?: { allowSkip?: boolean }): Promise<'apply' | 'skip' | 'cancel'> {
    if (!table) return Promise.resolve('cancel');
    const image = ImageStorage.instance.get(table.imageIdentifier);
    if (!image?.url || image.isEmpty) return Promise.resolve('cancel');

    const tourId = `panel.table-floor-crop.${table.identifier}`;
    if (PanelService.bringTourPanelToFront(tourId)) {
      return Promise.resolve('cancel');
    }

    const id = table.identifier;
    const stored = readTableFloorCrop(table);
    this.setLivePreview(id, stored);

    const ptr = this.pointerDeviceService.pointers[0] || { x: 120, y: 80 };
    const option: PanelOption = {
      title: this.i18n.t('tableFloorCrop.title'),
      left: Math.max(8, (ptr.x || 120) - 180),
      top: Math.max(8, (ptr.y || 80) - 40),
      width: 420,
      height: 520,
      tourPanelId: tourId,
      geometryKey: 'panel.table-floor-crop',
    };

    return new Promise(resolve => {
      const component = this.panelService.open(TableFloorCropComponent, option);
      let done = false;
      const settle = (result: 'apply' | 'skip' | 'cancel') => {
        if (done) return;
        done = true;
        this.clearLivePreview(id);
        resolve(result);
      };
      component.setup({
        table,
        imageUrl: image.url,
        insets: stored,
        allowSkip: !!opts?.allowSkip,
        livePreview: (insets) => this.setLivePreview(id, insets),
        settle,
      });
    });
  }

  /** Persist % without rewriting the floor bitmap. */
  commit(table: GameTable, insets: FloorCropInsets): void {
    setTableFloorCrop(table, insets);
  }

  clear(table: GameTable): void {
    setTableFloorCrop(table, emptyFloorCropInsets());
  }
}
