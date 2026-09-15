import { Injectable } from '@angular/core';
import { GameCharacter } from '@udonarium/game-character';

import { OverviewDisplayConfigComponent } from 'component/overview-display-config/overview-display-config.component';
import { I18nService } from 'service/i18n.service';
import { PanelOption, PanelService } from 'service/panel.service';
import { PointerDeviceService } from 'service/pointer-device.service';

export type OverviewDisplayConfigMode = 'character' | 'inventory';

export interface OverviewDisplayConfigOpenOptions {
  mode: OverviewDisplayConfigMode;
  character?: GameCharacter | null;
}

@Injectable({
  providedIn: 'root'
})
export class OverviewDisplayConfigService {
  isOpen = false;
  mode: OverviewDisplayConfigMode = 'inventory';
  character: GameCharacter | null = null;

  private activeTourId: string | null = null;
  private listeners = new Set<() => void>();

  constructor(
    private panelService: PanelService,
    private pointerDeviceService: PointerDeviceService,
    private i18n: I18nService
  ) { }

  static tourId(options: OverviewDisplayConfigOpenOptions): string {
    if (options.mode === 'character' && options.character) {
      return `overview.config.${options.character.identifier}`;
    }
    return 'overview.config.inventory';
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  open(options: OverviewDisplayConfigOpenOptions) {
    const tourId = OverviewDisplayConfigService.tourId(options);
    const title = this.i18n.t('overviewConfig.title');
    if (PanelService.bringTourPanelToFront(tourId, { title })) {
      this.applyOpenState(options, tourId);
      return;
    }

    const coordinate = this.pointerDeviceService.pointers[0] || { x: 200, y: 160 };
    const option: PanelOption = {
      title,
      left: coordinate.x - 190,
      top: coordinate.y - 200,
      width: 380,
      height: 520,
      tourPanelId: tourId,
      geometryKey: 'overview.display-config',
    };
    const component = this.panelService.open<OverviewDisplayConfigComponent>(OverviewDisplayConfigComponent, option);
    component.mode = options.mode;
    component.character = options.character ?? null;
    this.applyOpenState(options, tourId);
  }

  close() {
    const tourId = this.activeTourId;
    if (!tourId) return;
    this.clearOpenState();
    PanelService.closePanelsByTourId(tourId);
  }

  handlePanelClosed(tourId: string) {
    if (!this.isOpen || this.activeTourId !== tourId) return;
    this.clearOpenState();
  }

  private applyOpenState(options: OverviewDisplayConfigOpenOptions, tourId: string) {
    this.isOpen = true;
    this.mode = options.mode;
    this.character = options.character ?? null;
    this.activeTourId = tourId;
    this.notify();
  }

  private clearOpenState() {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.activeTourId = null;
    this.notify();
  }

  private notify() {
    for (const listener of this.listeners) listener();
  }
}
