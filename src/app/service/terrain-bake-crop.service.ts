import { Injectable } from '@angular/core';

import { EventSystem } from '@udonarium/core/system';
import { ImageStorage } from '@udonarium/core/file-storage/image-storage';
import { Terrain, TerrainFaceName } from '@udonarium/terrain';
import {
  BAKE_CROP_FACES,
  PerFaceInsets,
  applyBakeCropToTerrain,
  clonePerFaceInsets,
  hasBakeCropSources,
  parseBakeCropState,
} from '@udonarium/terrain-model/bake-crop';
import { BakeBoxPreviewContext, BakeBoxPreviewResult } from '@udonarium/terrain-model/model-terrain-import';
import { BakedFaceBlobs } from '@udonarium/terrain-model/ortho-bake';
import {
  TerrainBakeCropComponent,
  TerrainBakeCropResolve,
  TerrainBakeCropThumb,
} from 'component/terrain-bake-crop/terrain-bake-crop.component';
import { ModalService } from 'service/modal.service';

export const TERRAIN_BAKE_CROP_PREVIEW = 'TERRAIN_BAKE_CROP_PREVIEW';

@Injectable({ providedIn: 'root' })
export class TerrainBakeCropService {
  private live = new Map<string, PerFaceInsets>();

  constructor(
    private modalService: ModalService,
  ) { }

  hasSources(terrain: Terrain | null | undefined): boolean {
    return hasBakeCropSources(terrain);
  }

  livePreviewFor(identifier: string | null | undefined): PerFaceInsets | null {
    if (!identifier) return null;
    return this.live.get(identifier) || null;
  }

  setLivePreview(identifier: string, faces: PerFaceInsets) {
    this.live.set(identifier, clonePerFaceInsets(faces));
    EventSystem.trigger(TERRAIN_BAKE_CROP_PREVIEW, { identifier });
  }

  clearLivePreview(identifier: string) {
    this.live.delete(identifier);
    EventSystem.trigger(TERRAIN_BAKE_CROP_PREVIEW, { identifier });
  }

  async previewImportBox(ctx: BakeBoxPreviewContext): Promise<BakeBoxPreviewResult> {
    const id = ctx.terrain.identifier;
    const urls = blobUrls(ctx.blobs);
    this.setLivePreview(id, ctx.faces || {});
    try {
      const result = await this.modalService.open<TerrainBakeCropResolve | false>(TerrainBakeCropComponent, {
        mode: 'import',
        thumbs: thumbsFromUrls(urls),
        faces: ctx.faces || {},
        selectedFace: 'wallBottom',
        index: ctx.index,
        total: ctx.total,
        boxName: ctx.name,
        panelWidth: '520px',
        livePreview: (faces: PerFaceInsets) => this.setLivePreview(id, faces),
      });
      if (!result || result.action === 'abort') return { action: 'abort' };
      if (result.action === 'skip') return { action: 'skip' };
      return { action: 'confirm', faces: clonePerFaceInsets(result.faces) };
    } finally {
      this.clearLivePreview(id);
      revokeUrls(urls);
    }
  }

  async openEdit(terrain: Terrain): Promise<void> {
    const state = parseBakeCropState(terrain.bakeCropJson);
    if (!state) return;
    const id = terrain.identifier;
    const urls = sourceUrls(state.sources);
    const faces = clonePerFaceInsets(state.faces);
    this.setLivePreview(id, faces);
    try {
      const result = await this.modalService.open<TerrainBakeCropResolve | false>(TerrainBakeCropComponent, {
        mode: 'edit',
        thumbs: thumbsFromUrls(urls),
        faces,
        selectedFace: 'wallBottom',
        index: 0,
        total: 1,
        boxName: terrain.name,
        panelWidth: '520px',
        livePreview: (next: PerFaceInsets) => this.setLivePreview(id, next),
      });
      if (!result || result.action !== 'confirm') return;
      await applyBakeCropToTerrain(terrain, result.faces);
    } finally {
      this.clearLivePreview(id);
    }
  }
}

function blobUrls(blobs: BakedFaceBlobs): Partial<Record<TerrainFaceName, string>> {
  const urls: Partial<Record<TerrainFaceName, string>> = {};
  for (const face of BAKE_CROP_FACES) {
    const blob = blobs[face];
    if (blob) urls[face] = URL.createObjectURL(blob);
  }
  return urls;
}

function sourceUrls(sources: Partial<Record<TerrainFaceName, string>>): Partial<Record<TerrainFaceName, string>> {
  const urls: Partial<Record<TerrainFaceName, string>> = {};
  for (const face of BAKE_CROP_FACES) {
    const id = sources[face];
    if (!id) continue;
    const file = ImageStorage.instance.get(id);
    if (file?.url) urls[face] = file.url;
  }
  return urls;
}

function thumbsFromUrls(urls: Partial<Record<TerrainFaceName, string>>): TerrainBakeCropThumb[] {
  const labels: Partial<Record<TerrainFaceName, string>> = {
    floor: 'sheet.changeFloorImage',
    underside: 'terrain.settings.faceUnderside',
    wallTop: 'terrain.settings.faceWallTop',
    wallBottom: 'terrain.settings.faceWallBottom',
    wallLeft: 'terrain.settings.faceWallLeft',
    wallRight: 'terrain.settings.faceWallRight',
  };
  return BAKE_CROP_FACES
    .filter(face => urls[face])
    .map(face => ({ face, url: urls[face]!, labelKey: labels[face] || 'sheet.changeFloorImage' }));
}

function revokeUrls(urls: Partial<Record<TerrainFaceName, string>>): void {
  for (const url of Object.values(urls)) {
    if (url && url.startsWith('blob:')) URL.revokeObjectURL(url);
  }
}
