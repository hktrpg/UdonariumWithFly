import { ImageStorage } from '@udonarium/core/file-storage/image-storage';
import { ImageTag } from '@udonarium/image-tag';
import { TableSelecter } from '@udonarium/table-selecter';
import { Terrain, TerrainFaceName, TERRAIN_SIZE_MIN } from '@udonarium/terrain';
import { PointerCoordinate } from 'service/pointer-device.service';

import {
  PerFaceInsets,
  TerrainBakeCropState,
  applyBakeCropToTerrain,
  autoPerFaceInsets,
  cropAllFaceBlobs,
  serializeBakeCropState,
} from './bake-crop';
import { newBakeGroupId, assembleBakeGroupAt, placeTerrainAt } from './bake-group';
import { footprintBoxSummary, footprintDebug } from './footprint-debug';
import { splitFootprintFromPositions } from './footprint-split';
import { parseObjPackage } from './load-obj';
import { parseStl } from './load-stl';
import {
  MeshAabb,
  MeshIR,
  MODEL_BAKE_SIZE_DEFAULT,
  MODEL_IMAGE_TAG,
  MODEL_MAX_FILE_BYTES,
  MODEL_MM_PER_GRID_DEFAULT,
  MODEL_PHOTO_BAKE_SIZE,
  aabbToGridSize,
  uniformFitScale,
} from './mesh-ir';
import { isPrimaryModelFile, packagePathOf } from './model-package-files';
import { BakedFaceBlobs, bakeSixOrthoFaces } from './ortho-bake';
import { photoGltfFaces } from './photo-gltf-faces';

export { isPrimaryModelFile };

export type BakeBoxPreviewResult =
  | { action: 'confirm'; faces: PerFaceInsets }
  | { action: 'skip' }
  | { action: 'abort' };

export type ImportModelAsTerrainOptions = {
  mmPerGrid?: number;
  bakeSize?: number;
  /** Override display name; default from primary file. */
  name?: string;
  /**
   * Called once per box when the caller wants a crop preview.
   * Skip keeps auto insets; abort stops remaining boxes.
   */
  previewBox?: (ctx: BakeBoxPreviewContext) => Promise<BakeBoxPreviewResult>;
};

export type BakeBoxPreviewContext = {
  blobs: BakedFaceBlobs;
  faces: PerFaceInsets;
  index: number;
  total: number;
  name: string;
  terrain: Terrain;
};

export type ImportModelAsTerrainResult = {
  terrain: Terrain;
  terrains: Terrain[];
  warnings: string[];
};

export type BakedBox = {
  blobs: BakedFaceBlobs;
  aabb: MeshAabb;
};

export type BakedModelBoxes = {
  boxes: BakedBox[];
  fullAabb: MeshAabb;
  warnings: string[];
};

/**
 * Single entry: load STL / OBJ(+MTL) / glTF|GLB → bake six faces → Terrain(s) on table.
 * L-shaped glTF/STL footprints may become several independent boxes (max 8).
 */
export async function importModelAsTerrain(
  files: File[],
  position: PointerCoordinate,
  opts: ImportModelAsTerrainOptions = {},
): Promise<ImportModelAsTerrainResult> {
  const viewTable = TableSelecter.instance.viewTable;
  if (!viewTable) throw new Error('MODEL_NO_TABLE');
  if (!files?.length) throw new Error('MODEL_EMPTY');

  for (const f of files) {
    if (isPrimaryModelFile(f) && f.size > MODEL_MAX_FILE_BYTES) {
      throw new Error('MODEL_FILE_TOO_LARGE');
    }
  }

  const baked = await bakeModelBoxes(files, opts.bakeSize);
  const mm = opts.mmPerGrid ?? MODEL_MM_PER_GRID_DEFAULT;
  const raw = aabbToGridSize(baked.fullAabb, mm);
  const scale = uniformFitScale(raw.width, raw.depth, raw.height);
  const gridPerWorld = scale / mm;
  const fullSx = Math.max(1e-9, baked.fullAabb.max[0] - baked.fullAabb.min[0]);
  const fullSz = Math.max(1e-9, baked.fullAabb.max[2] - baked.fullAabb.min[2]);
  const modelW = fullSx * gridPerWorld;
  const modelD = fullSz * gridPerWorld;
  const baseName = opts.name || primaryBaseName(files) || 'Terrain';
  const terrains = await placeBakedModelBoxes(baked, position, {
    name: baseName,
    gridPerWorld,
    layoutAabb: baked.fullAabb,
    layoutWidth: modelW,
    layoutDepth: modelD,
    previewBox: opts.previewBox,
    assemble: true,
  });
  footprintDebug('importModelAsTerrain done', {
    n: terrains.length,
    parts: terrains.map(t => {
      const pose = t.getPoseForView();
      return {
        name: t.name,
        id: t.identifier,
        bakeGroupId: t.bakeGroupId,
        width: t.width,
        depth: t.depth,
        location: { ...t.location },
        pose,
        yDiffPose: +(pose.y - (t.location?.y ?? 0)).toFixed(2),
      };
    }),
    locationYSpan: (() => {
      const ys = terrains.map(t => t.location?.y ?? 0);
      return ys.length ? +(Math.max(...ys) - Math.min(...ys)).toFixed(2) : 0;
    })(),
    poseYSpan: (() => {
      const ys = terrains.map(t => t.getPoseForView().y);
      return ys.length ? +(Math.max(...ys) - Math.min(...ys)).toFixed(2) : 0;
    })(),
  });
  return { terrain: terrains[0], terrains, warnings: baked.warnings };
}

export type PlaceBakedModelOptions = {
  name: string;
  gridPerWorld: number;
  layoutAabb: MeshAabb;
  layoutWidth: number;
  layoutDepth: number;
  previewBox?: ImportModelAsTerrainOptions['previewBox'];
  /** Re-center L/U parts on `position` (single-model import). City packs skip this. */
  assemble?: boolean;
  isInteract?: boolean;
};

/**
 * Place already-baked boxes using a shared grid scale. Used by single-model import
 * and Open3Dhk city packs (one call per building, world-relative center).
 */
export async function placeBakedModelBoxes(
  baked: BakedModelBoxes,
  position: PointerCoordinate,
  opts: PlaceBakedModelOptions,
): Promise<Terrain[]> {
  const viewTable = TableSelecter.instance.viewTable;
  if (!viewTable) throw new Error('MODEL_NO_TABLE');
  if (!baked.boxes.length) throw new Error('MODEL_BAKE_FAILED');

  const fullSy = Math.max(0, baked.fullAabb.max[1] - baked.fullAabb.min[1]);
  const height = Math.max(TERRAIN_SIZE_MIN, fullSy * opts.gridPerWorld);
  const terrains: Terrain[] = [];
  const bakeGroupId = baked.boxes.length > 1 ? newBakeGroupId() : '';
  const interact = opts.isInteract !== false;

  footprintDebug('placeBakedModelBoxes layout', {
    drop: position,
    boxCount: baked.boxes.length,
    bakeGroupId: bakeGroupId || '(single)',
    gridPerWorld: +opts.gridPerWorld.toFixed(6),
    modelW: +opts.layoutWidth.toFixed(3),
    modelD: +opts.layoutDepth.toFixed(3),
    height: +height.toFixed(3),
    fullAabb: footprintBoxSummary(opts.layoutAabb),
    boxes: baked.boxes.map((b, i) => ({ i, ...footprintBoxSummary(b.aabb, opts.layoutAabb) })),
  });

  for (let i = 0; i < baked.boxes.length; i++) {
    const box = baked.boxes[i];
    const autoFaces = await autoPerFaceInsets(box.blobs);
    const terrain = await createTerrainBox(box, autoFaces, {
      baseName: opts.name,
      index: i,
      total: baked.boxes.length,
      height,
      gridPerWorld: opts.gridPerWorld,
      fullAabb: opts.layoutAabb,
      center: position,
      modelW: opts.layoutWidth,
      modelD: opts.layoutDepth,
      cropNow: false,
      bakeGroupId,
      isInteract: interact,
    });
    viewTable.appendChild(terrain);
    terrains.push(terrain);

    if (opts.previewBox) {
      const result = await opts.previewBox({
        blobs: box.blobs,
        faces: autoFaces,
        index: i,
        total: baked.boxes.length,
        name: baked.boxes.length > 1 ? `${opts.name} ${i + 1}` : opts.name,
        terrain,
      });
      if (result.action === 'abort') {
        terrain.destroy();
        terrains.pop();
        break;
      }
      const faces = result.action === 'confirm' ? result.faces : autoFaces;
      await applyBakeCropToTerrain(terrain, faces);
    }
  }

  if (!terrains.length) throw new Error('MODEL_IMPORT_CANCELLED');
  if (opts.assemble !== false && terrains.length > 1 && bakeGroupId) {
    assembleBakeGroupAt(terrains, position);
  }
  return terrains;
}

async function createTerrainBox(
  box: BakedBox,
  faces: PerFaceInsets,
  layout: {
    baseName: string;
    index: number;
    total: number;
    height: number;
    gridPerWorld: number;
    fullAabb: MeshAabb;
    center: PointerCoordinate;
    modelW: number;
    modelD: number;
    cropNow: boolean;
    bakeGroupId: string;
    isInteract?: boolean;
  },
): Promise<Terrain> {
  const sourceIds = await addFaceImages(box.blobs);
  const displayIds = layout.cropNow
    ? await addFaceImages(await cropAllFaceBlobs(box.blobs, faces))
    : sourceIds;

  const floorId = displayIds.floor;
  const wallId = displayIds.wallBottom || displayIds.wall;
  if (!floorId || !wallId) throw new Error('MODEL_BAKE_FAILED');

  const boxW = Math.max(TERRAIN_SIZE_MIN, (box.aabb.max[0] - box.aabb.min[0]) * layout.gridPerWorld);
  const boxD = Math.max(TERRAIN_SIZE_MIN, (box.aabb.max[2] - box.aabb.min[2]) * layout.gridPerWorld);
  const name = layout.total > 1 ? `${layout.baseName} ${layout.index + 1}` : layout.baseName;

  const terrain = Terrain.create(name, boxW, boxD, layout.height, wallId, floorId);
  terrain.mutateAppearance(() => {
    terrain.mirrorWallTop = false;
    terrain.mirrorWallLeft = false;
    terrain.isInteract = layout.isInteract !== false;
  });

  const faceOrder: TerrainFaceName[] = ['underside', 'wallTop', 'wallBottom', 'wallLeft', 'wallRight'];
  for (const face of faceOrder) {
    const id = displayIds[face];
    if (!id) continue;
    terrain.setFaceImage(face, id);
  }

  const groupLocalX = (box.aabb.min[0] - layout.fullAabb.min[0]) * layout.gridPerWorld * 50;
  const groupLocalY = (box.aabb.min[2] - layout.fullAabb.min[2]) * layout.gridPerWorld * 50;
  const anchorX = layout.center.x - (layout.modelW * 50) / 2 + groupLocalX;
  const anchorY = layout.center.y - (layout.modelD * 50) / 2 + groupLocalY;

  footprintDebug('createTerrainBox', {
    index: layout.index,
    name,
    boxW: +boxW.toFixed(3),
    boxD: +boxD.toFixed(3),
    aabb: footprintBoxSummary(box.aabb, layout.fullAabb),
    groupLocalX: +groupLocalX.toFixed(2),
    groupLocalY: +groupLocalY.toFixed(2),
    anchorX: +anchorX.toFixed(2),
    anchorY: +anchorY.toFixed(2),
  });

  const state: TerrainBakeCropState = {
    sources: sourceIds,
    faces,
    fullWidth: boxW,
    fullDepth: boxD,
    fullHeight: layout.height,
    anchorX,
    anchorY,
    groupLocalX,
    groupLocalY,
    ...(layout.bakeGroupId && layout.total > 1 ? { groupSize: layout.total } : {}),
  };
  terrain.bakeCropJson = serializeBakeCropState(state);
  if (layout.bakeGroupId) terrain.bakeGroupId = layout.bakeGroupId;
  // Pose before appendChild so movable mounts at the modeled footprint offset.
  placeTerrainAt(terrain, anchorX, anchorY, layout.center.z);
  return terrain;
}

async function addFaceImages(blobs: BakedFaceBlobs): Promise<Partial<Record<TerrainFaceName, string>>> {
  const ids: Partial<Record<TerrainFaceName, string>> = {};
  const faces: TerrainFaceName[] = ['floor', 'underside', 'wallTop', 'wallBottom', 'wallLeft', 'wallRight'];
  let wallBottomId = '';
  for (const face of faces) {
    const blob = blobs[face];
    if (!blob) continue;
    if (face === 'wallBottom' && wallBottomId) {
      ids[face] = wallBottomId;
      continue;
    }
    const img = await ImageStorage.instance.addAsync(blob);
    tagBake(img.identifier);
    ids[face] = img.identifier;
    if (face === 'wallBottom') wallBottomId = img.identifier;
  }
  if (ids.wallBottom) ids.wall = ids.wallBottom;
  return ids;
}

export function isModelDropFile(file: File): boolean {
  const n = (file.name || '').toLowerCase();
  return /\.(stl|obj|mtl|glb|gltf|fbx|bin)$/i.test(n)
    || (isImageName(n) && false); // textures only when part of model package
}

export function isModelPackageTexture(file: File): boolean {
  return isImageName((file.name || '').toLowerCase());
}

function isImageName(n: string): boolean {
  return /\.(png|jpe?g|webp|gif|bmp)$/i.test(n);
}

/** True when the drop set should be treated as a 3D model package (not pure images). */
export function dropLooksLikeModelPackage(files: File[]): boolean {
  return files.some(isPrimaryModelFile);
}

function isExt(file: File, re: RegExp): boolean {
  return re.test(packagePathOf(file)) || re.test(file.name || '');
}

export async function bakeModelBoxes(
  files: File[],
  bakeSize?: number,
): Promise<BakedModelBoxes> {
  if (files.some(f => isExt(f, /\.glb$/i) || isExt(f, /\.gltf$/i) || isExt(f, /\.fbx$/i))) {
    const photo = await photoGltfFaces(files, bakeSize ?? MODEL_PHOTO_BAKE_SIZE);
    return {
      boxes: photo.boxes?.length ? photo.boxes : [{ blobs: photo.blobs, aabb: photo.aabb }],
      fullAabb: photo.fullAabb || photo.aabb,
      warnings: photo.warnings,
    };
  }
  const mesh = await loadSoupMeshFromFiles(files);
  const aabbs = splitFootprintFromPositions(mesh.positions, mesh.aabb);
  const boxes: BakedBox[] = [];
  for (const aabb of aabbs) {
    boxes.push({
      blobs: await bakeSixOrthoFaces(mesh, bakeSize ?? MODEL_BAKE_SIZE_DEFAULT, aabb),
      aabb,
    });
  }
  return { boxes, fullAabb: mesh.aabb, warnings: mesh.warnings || [] };
}

async function loadSoupMeshFromFiles(files: File[]): Promise<MeshIR> {
  if (files.some(f => isExt(f, /\.stl$/i))) {
    const stl = files.find(f => isExt(f, /\.stl$/i))!;
    return parseStl(await stl.arrayBuffer(), stl.name);
  }
  if (files.some(f => isExt(f, /\.obj$/i))) {
    return parseObjPackage(files);
  }
  throw new Error('MODEL_UNSUPPORTED');
}

function primaryBaseName(files: File[]): string {
  const primary = files.find(isPrimaryModelFile) || files[0];
  return (primary?.name || '').replace(/\.[^.]+$/, '').trim();
}

function tagBake(imageIdentifier: string): void {
  try {
    let tag = ImageTag.get(imageIdentifier);
    if (!tag) tag = ImageTag.create(imageIdentifier);
    tag.addWords(MODEL_IMAGE_TAG);
  } catch {
    // Non-fatal: tagging is best-effort.
  }
}

/** Map known error codes to i18n keys (caller translates). */
export function modelImportErrorI18nKey(err: unknown): string {
  const code = err instanceof Error ? err.message : String(err || '');
  switch (code) {
    case 'MODEL_EMPTY': return 'modelImport.error.empty';
    case 'MODEL_TOO_MANY_TRIANGLES': return 'modelImport.error.tooManyTriangles';
    case 'MODEL_FILE_TOO_LARGE': return 'modelImport.error.fileTooLarge';
    case 'MODEL_NO_WEBGL': return 'modelImport.error.noWebgl';
    case 'MODEL_INVALID_STL': return 'modelImport.error.invalidStl';
    case 'MODEL_INVALID_OBJ': return 'modelImport.error.invalidObj';
    case 'MODEL_INVALID_GLTF': return 'modelImport.error.invalidGltf';
    case 'MODEL_INVALID_FBX': return 'modelImport.error.invalidFbx';
    case 'MODEL_NO_OBJ': return 'modelImport.error.noObj';
    case 'MODEL_NO_GLTF': return 'modelImport.error.noGltf';
    case 'MODEL_NO_FBX': return 'modelImport.error.noFbx';
    case 'MODEL_NO_MODEL_IN_ZIP': return 'modelImport.error.noModelInZip';
    case 'MODEL_BLEND_ONLY': return 'modelImport.error.blendOnly';
    case 'MODEL_INVALID_ZIP': return 'modelImport.error.invalidZip';
    case 'MODEL_UNSUPPORTED': return 'modelImport.error.unsupported';
    case 'MODEL_NO_TABLE': return 'modelImport.error.noTable';
    case 'MODEL_BAKE_FAILED': return 'modelImport.error.bakeFailed';
    case 'MODEL_3D_TILES':
    case 'CITY_PACK_3D_TILES': return 'modelImport.error.cityPackTiles';
    case 'CITY_PACK_TOO_MANY': return 'modelImport.error.cityPackTooMany';
    case 'CITY_PACK_PHOTOGRAMMETRY': return 'modelImport.error.cityPackPhotogrammetry';
    case 'CITY_PACK_NO_BUILDING': return 'modelImport.error.cityPackNoBuilding';
    default: return 'modelImport.error.generic';
  }
}
