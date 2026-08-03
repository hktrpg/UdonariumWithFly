import { Injectable } from '@angular/core';

export type SceneToolMode = 'select' | 'light' | 'wall' | 'draw-rect' | 'draw-ellipse' | 'draw-polygon' | 'draw-freehand' | 'draw-text';

@Injectable({ providedIn: 'root' })
export class SceneToolService {
  mode: SceneToolMode = 'select';
  paletteOpen = true;
  wallDraftPoints: { x: number; y: number }[] = [];
  polygonDraftPoints: { x: number; y: number }[] = [];
  drawStrokeColor = '#e11d48';
  drawFillOpacity = 0.15;

  get isDrawMode(): boolean {
    return this.mode.startsWith('draw-');
  }

  resetDrafts() {
    this.wallDraftPoints = [];
    this.polygonDraftPoints = [];
  }

  setMode(mode: SceneToolMode) {
    this.mode = mode;
    this.resetDrafts();
  }
}
