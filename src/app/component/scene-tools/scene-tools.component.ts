import { Component, OnDestroy, OnInit } from '@angular/core';
import { GuestSession } from '@udonarium/guest-session';
import { PeerCursor } from '@udonarium/peer-cursor';
import { TableDrawing } from '@udonarium/table-fx/table-drawing';
import { TableLight } from '@udonarium/table-fx/table-light';
import { TableWall } from '@udonarium/table-fx/table-wall';
import { SceneCreateKind, SceneModifyKind, SceneToolPermission } from '@udonarium/table-fx/scene-tool-permission';
import { EventSystem } from '@udonarium/core/system';
import { I18nService } from 'service/i18n.service';
import { PanelService } from 'service/panel.service';
import { SceneToolMode, SceneToolService } from 'service/scene-tool.service';
import { TabletopService } from 'service/tabletop.service';

@Component({
  selector: 'scene-tools',
  templateUrl: './scene-tools.component.html',
  styleUrls: ['./scene-tools.component.css'],
  standalone: false
})
export class SceneToolsComponent implements OnInit, OnDestroy {
  constructor(
    public tools: SceneToolService,
    private panelService: PanelService,
    private tabletopService: TabletopService,
    private i18n: I18nService,
  ) {}

  get isGuest(): boolean { return GuestSession.isGuest; }
  get isGM(): boolean { return !!PeerCursor.myCursor?.isGMMode; }
  get perm(): SceneToolPermission { return SceneToolPermission.instance; }
  get canOpen(): boolean { return this.perm.canOpenPanel; }
  get canModify(): boolean { return this.perm.canModify; }

  canCreateKind(kind: SceneCreateKind): boolean { return this.perm.canCreateKind(kind); }
  canModifyKind(kind: SceneModifyKind): boolean { return this.perm.canModifyKind(kind); }

  get walls(): TableWall[] { return this.tabletopService.currentTable?.walls || []; }
  get lights(): TableLight[] { return this.tabletopService.currentTable?.lights || []; }
  get drawings(): TableDrawing[] { return this.tabletopService.currentTable?.drawings || []; }

  get gridSize(): number {
    return this.tabletopService.currentTable?.gridSize || 50;
  }

  ngOnInit() {
    this.tools.isPanelOpen = true;
    EventSystem.trigger('SCENE_TOOLS_PANEL', true);
    Promise.resolve().then(() => {
      this.refreshPanelTitle();
      this.tools.idle();
      if (!this.canOpen) {
        this.panelService.close();
      }
    });
    EventSystem.register(this)
      .on('CHANGE_GM_MODE', () => this.enforceAccess())
      .on(`UPDATE_GAME_OBJECT/identifier/${this.perm.identifier}`, () => this.enforceAccess())
      .on('LOCALE_CHANGED', () => this.refreshPanelTitle());
  }

  ngOnDestroy() {
    EventSystem.unregister(this);
    this.tools.isPanelOpen = false;
    this.tools.idle();
    this.tools.clearSelection();
    EventSystem.trigger('SCENE_TOOLS_PANEL', false);
  }

  private refreshPanelTitle() {
    this.panelService.title = this.i18n.t(this.isGM ? 'scene.titleGm' : 'scene.title');
  }

  private enforceAccess() {
    if (!this.canOpen) {
      this.tools.idle();
      this.tools.clearSelection();
      this.panelService.close();
      return;
    }
    if (this.tools.mode !== 'none' && this.tools.mode !== 'select'
      && !this.perm.canUseCreateMode(this.tools.mode)) {
      this.tools.idle();
    }
    if (this.tools.mode === 'select' && !this.canModify) this.tools.idle();
    if (!this.canModifyKind('light') && this.tools.selectedLights.length) {
      this.tools.selectedLights = [];
      this.tools.selectedLight = null;
    }
    if (!this.canModifyKind('wall') && this.tools.selectedWalls.length) {
      this.tools.selectedWalls = [];
      this.tools.selectedWall = null;
    }
    if (!this.canModifyKind('drawing') && this.tools.selectedDrawings.length) {
      this.tools.selectedDrawings = [];
      this.tools.selectedDrawing = null;
    }
  }

  /** Light dim radius in grid squares (selected or next-place default). */
  get lightDimGrid(): number {
    const l = this.tools.selectedLight;
    if (l) return Math.round((l.dimRadius / this.gridSize) * 10) / 10;
    return this.tools.lightDimGrid;
  }
  set lightDimGrid(v: number) {
    if (this.tools.selectedLight && !this.canModifyKind('light')) return;
    const n = Math.max(0.5, Number(v) || 0.5);
    if (this.tools.selectedLight) {
      this.tools.selectedLight.dimRadius = n * this.gridSize;
      if (this.tools.selectedLight.brightRadius > this.tools.selectedLight.dimRadius) {
        this.tools.selectedLight.brightRadius = this.tools.selectedLight.dimRadius;
      }
    } else {
      this.tools.lightDimGrid = n;
      if (this.tools.lightBrightGrid > n) this.tools.lightBrightGrid = n;
    }
  }

  get lightBrightGrid(): number {
    const l = this.tools.selectedLight;
    if (l) return Math.round((l.brightRadius / this.gridSize) * 10) / 10;
    return this.tools.lightBrightGrid;
  }
  set lightBrightGrid(v: number) {
    if (this.tools.selectedLight && !this.canModifyKind('light')) return;
    const n = Math.max(0, Number(v) || 0);
    if (this.tools.selectedLight) {
      this.tools.selectedLight.brightRadius = n * this.gridSize;
      if (this.tools.selectedLight.dimRadius < this.tools.selectedLight.brightRadius) {
        this.tools.selectedLight.dimRadius = this.tools.selectedLight.brightRadius;
      }
    } else {
      this.tools.lightBrightGrid = n;
      if (this.tools.lightDimGrid < n) this.tools.lightDimGrid = n;
    }
  }

  applyLightField() {
    if (!this.canModifyKind('light')) return;
    EventSystem.trigger('UPDATE_GAME_OBJECT', this.tabletopService.currentTable?.toContext());
  }

  setMode(mode: SceneToolMode) {
    if (!this.canOpen) return;
    if (mode === 'select' && !this.canModify) return;
    if (mode !== 'none' && mode !== 'select' && !this.perm.canUseCreateMode(mode)) return;
    this.tools.setMode(mode);
  }

  finishWall() {
    if (!this.canCreateKind('wall')) return;
    if (this.tools.wallDraftPoints.length < 2) return;
    const wall = TableWall.create(this.tools.wallDraftPoints.slice());
    this.tabletopService.currentTable?.appendChild(wall);
    this.tools.resetDrafts();
    EventSystem.trigger('UPDATE_GAME_OBJECT', this.tabletopService.currentTable.toContext());
  }

  undoWallPoint() {
    if (!this.canCreateKind('wall')) return;
    this.tools.wallDraftPoints.pop();
  }

  finishPolygon() {
    if (!this.canCreateKind('draw-polygon')) return;
    if (this.tools.polygonDraftPoints.length < 3) return;
    EventSystem.trigger('SCENE_TOOL_COMMIT_POLYGON', null);
  }

  deleteSelected() {
    this.tools.deleteSelection();
  }

  selectWall(w: TableWall) {
    if (!this.canModifyKind('wall')) return;
    this.tools.enterSelect();
    this.tools.selectWall(w);
  }

  selectLight(l: TableLight) {
    if (!this.canModifyKind('light')) return;
    this.tools.enterSelect();
    this.tools.selectLight(l);
  }

  selectDrawing(d: TableDrawing) {
    if (!this.canModifyKind('drawing')) return;
    this.tools.enterSelect();
    this.tools.selectDrawing(d);
  }

  applyTextEdit() {
    if (!this.canModifyKind('drawing')) return;
    this.tools.applyTextToSelected();
  }

  applyStyleToSelected() {
    if (!this.canModifyKind('drawing')) return;
    const d = this.tools.selectedDrawing;
    if (!d) return;
    d.strokeColor = this.tools.drawStrokeColor;
    d.strokeWidth = this.tools.drawStrokeWidth;
    d.strokeOpacity = this.tools.drawStrokeOpacity;
    if (d.type !== 'freehand' && d.type !== 'text') {
      d.fillColor = this.tools.drawStrokeColor;
      d.fillOpacity = this.tools.drawFillOpacity;
    }
    if (d.type === 'text') d.fontSize = this.tools.draftFontSize || 18;
  }
}
