import { ImageStorage } from '@udonarium/core/file-storage/image-storage';
import { ImageTag } from '@udonarium/image-tag';
import { TableSelecter } from '@udonarium/table-selecter';
import { Terrain, TERRAIN_SIZE_MIN } from '@udonarium/terrain';
import { PointerCoordinate } from 'service/pointer-device.service';

import { parseGltfPackage } from './load-gltf';
import { parseObjPackage } from './load-obj';
import { parseStl } from './load-stl';
import {
  MeshIR,
  MODEL_BAKE_SIZE_DEFAULT,
  MODEL_GRID_EDGE_MAX,
  MODEL_IMAGE_TAG,
  MODEL_MAX_FILE_BYTES,
  MODEL_MM_PER_GRID_DEFAULT,
  aabbToGridSize,
} from './mesh-ir';
import { bakeSixOrthoFaces } from './ortho-bake';

export type ImportModelAsTerrainOptions = {
  mmPerGrid?: number;
  bakeSize?: number;
  /** Override display name; default from primary file. */
  name?: string;
};

export type ImportModelAsTerrainResult = {
  terrain: Terrain;
  warnings: string[];
};

/**
 * Single entry: load STL / OBJ(+MTL) / glTF|GLB → bake six faces → Terrain on table.
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

  const mesh = await loadMeshFromFiles(files);
  const blobs = await bakeSixOrthoFaces(mesh, opts.bakeSize ?? MODEL_BAKE_SIZE_DEFAULT);

  const floorBlob = blobs.floor;
  const frontBlob = blobs.wallBottom;
  if (!floorBlob || !frontBlob) throw new Error('MODEL_BAKE_FAILED');

  const floorImg = await ImageStorage.instance.addAsync(floorBlob);
  const wallImg = await ImageStorage.instance.addAsync(frontBlob);
  tagBake(floorImg.identifier);
  tagBake(wallImg.identifier);

  const mm = opts.mmPerGrid ?? MODEL_MM_PER_GRID_DEFAULT;
  let { width, depth, height } = aabbToGridSize(mesh.aabb, mm);
  width = clampGrid(width);
  depth = clampGrid(depth);
  height = clampGrid(Math.max(height, TERRAIN_SIZE_MIN));

  const name = opts.name || primaryBaseName(files) || 'Terrain';
  const terrain = Terrain.create(name, width, depth, height, wallImg.identifier, floorImg.identifier);
  terrain.mutateAppearance(() => {
    terrain.mirrorWallTop = false;
    terrain.mirrorWallLeft = false;
    terrain.isInteract = true;
  });

  const faceOrder = ['underside', 'wallTop', 'wallBottom', 'wallLeft', 'wallRight'] as const;
  for (const face of faceOrder) {
    const blob = blobs[face];
    if (!blob) continue;
    // wallBottom already used as wall fallback; still set explicit face for consistency.
    const img = face === 'wallBottom' ? wallImg : await ImageStorage.instance.addAsync(blob);
    if (face !== 'wallBottom') tagBake(img.identifier);
    terrain.setFaceImage(face, img.identifier);
  }

  terrain.location.x = position.x - (width * 50) / 2;
  terrain.location.y = position.y - (depth * 50) / 2;
  terrain.posZ = position.z;
  viewTable.appendChild(terrain);

  return { terrain, warnings: mesh.warnings || [] };
}

export function isModelDropFile(file: File): boolean {
  const n = (file.name || '').toLowerCase();
  return /\.(stl|obj|mtl|glb|gltf|bin)$/i.test(n)
    || (isImageName(n) && false); // textures only when part of model package
}

export function isPrimaryModelFile(file: File): boolean {
  return /\.(stl|obj|glb|gltf)$/i.test(file.name || '');
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

async function loadMeshFromFiles(files: File[]): Promise<MeshIR> {
  if (files.some(f => /\.stl$/i.test(f.name))) {
    const stl = files.find(f => /\.stl$/i.test(f.name))!;
    return parseStl(await stl.arrayBuffer(), stl.name);
  }
  if (files.some(f => /\.glb$/i.test(f.name) || /\.gltf$/i.test(f.name))) {
    return parseGltfPackage(files);
  }
  if (files.some(f => /\.obj$/i.test(f.name))) {
    return parseObjPackage(files);
  }
  throw new Error('MODEL_UNSUPPORTED');
}

function clampGrid(v: number): number {
  if (!Number.isFinite(v) || v < TERRAIN_SIZE_MIN) return TERRAIN_SIZE_MIN;
  return Math.min(MODEL_GRID_EDGE_MAX, v);
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
    case 'MODEL_NO_OBJ': return 'modelImport.error.noObj';
    case 'MODEL_NO_GLTF': return 'modelImport.error.noGltf';
    case 'MODEL_UNSUPPORTED': return 'modelImport.error.unsupported';
    case 'MODEL_NO_TABLE': return 'modelImport.error.noTable';
    case 'MODEL_BAKE_FAILED': return 'modelImport.error.bakeFailed';
    default: return 'modelImport.error.generic';
  }
}
