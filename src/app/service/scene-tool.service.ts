import { Injectable } from '@angular/core';
import { TableDrawing } from '@udonarium/table-fx/table-drawing';
import { TableLight } from '@udonarium/table-fx/table-light';
import { TableWall } from '@udonarium/table-fx/table-wall';

/** `none` = idle (no tool lit). `select` = scene-object pick only. */
export type SceneToolMode = 'none' | 'select' | 'light' | 'wall' | 'draw-rect' | 'draw-ellipse' | 'draw-polygon' | 'draw-freehand' | 'draw-text';

@Injectable({ providedIn: 'root' })
export class SceneToolService {
  mode: SceneToolMode = 'none';
  /** True while the scene-tools panel is open (GM edit overlays). */
  isPanelOpen = false;
  wallDraftPoints: { x: number; y: number }[] = [];
  polygonDraftPoints: { x: number; y: number }[] = [];
  drawStrokeColor = '#e11d48';
  drawFillOpacity = 0.15;
  /** Stroke width in px for freehand / shapes. */
  drawStrokeWidth = 4;
  drawStrokeOpacity = 1;
  /** Text content for next place / edit. */
  draftText = '註記';
  draftFontSize = 18;

  /** Defaults for next placed light (radii in grid squares). */
  lightColor = '#ffd080';
  lightIntensity = 0.75;
  lightBrightGrid = 2;
  lightDimGrid = 4;
  lightName = '燈光';

  selectedDrawing: TableDrawing = null;
  selectedLight: TableLight = null;
  selectedWall: TableWall = null;

  /** Show wall lines / light dots only while the GM panel is open. */
  get showEditOverlay(): boolean {
    return this.isPanelOpen;
  }

  get isDrawMode(): boolean {
    return this.mode.startsWith('draw-');
  }

  get isSceneSelectMode(): boolean {
    return this.mode === 'select';
  }

  /** When true, normal tabletop pick / character select yields to scene tools. */
  get isBlockingPick(): boolean {
    return this.mode !== 'none';
  }

  resetDrafts() {
    this.wallDraftPoints = [];
    this.polygonDraftPoints = [];
  }

  setMode(mode: SceneToolMode) {
    // Toolbar: clicking Select again turns it off (do not stay lit).
    if (mode === 'select' && this.mode === 'select') {
      this.idle();
      return;
    }
    this.mode = mode;
    this.resetDrafts();
    if (mode !== 'select' && mode !== 'none') {
      this.clearSelection();
    }
  }

  /** Enter select without toggle (e.g. picking from the scene object list). */
  enterSelect() {
    this.mode = 'select';
    this.resetDrafts();
  }

  /** Leave any active tool without keeping select lit. */
  idle() {
    this.mode = 'none';
    this.resetDrafts();
  }

  clearSelection() {
    this.selectedDrawing = null;
    this.selectedLight = null;
    this.selectedWall = null;
  }

  selectDrawing(d: TableDrawing) {
    this.clearSelection();
    this.selectedDrawing = d;
    if (!d) return;
    this.drawStrokeColor = d.strokeColor || this.drawStrokeColor;
    this.drawStrokeWidth = d.strokeWidth || this.drawStrokeWidth;
    this.drawStrokeOpacity = d.strokeOpacity ?? this.drawStrokeOpacity;
    if (d.type !== 'freehand' && d.type !== 'text') {
      this.drawFillOpacity = d.fillOpacity ?? this.drawFillOpacity;
    }
    if (d.type === 'text') {
      this.draftText = d.text || '';
      this.draftFontSize = d.fontSize || 18;
    }
  }

  applyTextToSelected() {
    if (!this.selectedDrawing || this.selectedDrawing.type !== 'text') return;
    this.selectedDrawing.text = this.draftText || '';
    this.selectedDrawing.fontSize = this.draftFontSize || 18;
    this.selectedDrawing.strokeColor = this.drawStrokeColor;
  }
}
