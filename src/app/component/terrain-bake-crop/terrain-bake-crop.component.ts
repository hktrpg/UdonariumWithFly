import { Component, OnDestroy, OnInit } from '@angular/core';
import { TerrainFaceName } from '@udonarium/terrain';
import {
  FaceEdgeInsets,
  PerFaceInsets,
  clipPathForFace,
  clonePerFaceInsets,
  clampInsets,
  emptyInsets,
} from '@udonarium/terrain-model/bake-crop';
import { EventSystem } from '@udonarium/core/system';
import { I18nService } from 'service/i18n.service';
import { ModalService } from 'service/modal.service';
import { PanelService } from 'service/panel.service';

export type TerrainBakeCropMode = 'import' | 'edit';

export type TerrainBakeCropThumb = {
  face: TerrainFaceName;
  url: string;
  labelKey: string;
};

export type TerrainBakeCropResolve =
  | { action: 'confirm'; faces: PerFaceInsets }
  | { action: 'skip' }
  | { action: 'abort' };

@Component({
  selector: 'app-terrain-bake-crop',
  templateUrl: './terrain-bake-crop.component.html',
  styleUrls: ['../shared/settings-ui.css', './terrain-bake-crop.component.css'],
  standalone: false,
})
export class TerrainBakeCropComponent implements OnInit, OnDestroy {
  mode: TerrainBakeCropMode = 'edit';
  thumbs: TerrainBakeCropThumb[] = [];
  faces: PerFaceInsets = {};
  selectedFace: TerrainFaceName = 'wallBottom';
  index = 0;
  total = 1;
  boxName = '';
  private livePreview: ((faces: PerFaceInsets) => void) | null = null;

  readonly sliderMax = 40;

  constructor(
    private modalService: ModalService,
    private panelService: PanelService,
    private i18n: I18nService,
  ) {
    const opt = modalService.option || {};
    this.mode = opt.mode === 'import' ? 'import' : 'edit';
    this.thumbs = Array.isArray(opt.thumbs) ? opt.thumbs : [];
    this.faces = clonePerFaceInsets(opt.faces || {});
    this.index = Math.max(0, +opt.index || 0);
    this.total = Math.max(1, +opt.total || 1);
    this.boxName = opt.boxName || '';
    this.livePreview = typeof opt.livePreview === 'function' ? opt.livePreview : null;
    const initial = opt.selectedFace as TerrainFaceName;
    this.selectedFace = this.thumbs.some(t => t.face === initial)
      ? initial
      : (this.thumbs.find(t => t.face === 'wallBottom')?.face || this.thumbs[0]?.face || 'wallBottom');
    if (!this.faces[this.selectedFace]) this.faces[this.selectedFace] = emptyInsets();
  }

  ngOnInit() {
    this.refreshTitle();
    this.emitPreview();
    EventSystem.register(this).on('LOCALE_CHANGED', () => this.refreshTitle());
  }

  ngOnDestroy() {
    EventSystem.unregister(this);
  }

  selectFace(face: TerrainFaceName) {
    this.selectedFace = face;
    if (!this.faces[face]) this.faces[face] = emptyInsets();
  }

  clipFor(face: TerrainFaceName): string {
    return clipPathForFace(face, this.faces[face] || emptyInsets());
  }

  pct(side: keyof FaceEdgeInsets): number {
    const insets = this.faces[this.selectedFace] || emptyInsets();
    return Math.round((insets[side] || 0) * 1000) / 10;
  }

  setPct(side: keyof FaceEdgeInsets, value: number) {
    const cur = this.faces[this.selectedFace] || emptyInsets();
    this.faces = {
      ...this.faces,
      [this.selectedFace]: clampInsets({ ...cur, [side]: Math.max(0, (+value || 0) / 100) }),
    };
    this.emitPreview();
  }

  confirm() {
    this.modalService.resolve({ action: 'confirm', faces: clonePerFaceInsets(this.faces) } as TerrainBakeCropResolve);
  }

  skip() {
    this.modalService.resolve({ action: 'skip' } as TerrainBakeCropResolve);
  }

  abort() {
    this.modalService.resolve({ action: 'abort' } as TerrainBakeCropResolve);
  }

  cancel() {
    this.modalService.resolve(this.mode === 'import'
      ? ({ action: 'abort' } as TerrainBakeCropResolve)
      : false);
  }

  private emitPreview() {
    this.livePreview?.(clonePerFaceInsets(this.faces));
  }

  private refreshTitle() {
    const base = this.i18n.t('terrainBakeCrop.title');
    const extra = this.total > 1
      ? this.i18n.t('terrainBakeCrop.boxOf', { current: this.index + 1, total: this.total })
      : (this.boxName || '');
    this.modalService.title = this.panelService.title = extra ? `${base}〈${extra}〉` : base;
  }
}
