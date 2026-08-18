import { MeshAabb, emptyAabb, expandAabb } from './mesh-ir';
import {
  dirOfPackagePath,
  isPrimaryModelFile,
  lastModelExpandFlags,
  normalizePackagePath,
  packagePathOf,
} from './model-package-files';

/** Cap so a 1:1000 sheet cannot explode ImageStorage / CSS boxes. */
export const CITY_PACK_MAX_BUILDINGS = 24;
export const CITY_PACK_TABLE_MAX_GRIDS = 100;
export const CITY_PACK_MAP_MAX_PX = 2048;
export const CITY_PACK_SKYLINE_W = 2048;
export const CITY_PACK_SKYLINE_H = 640;
/** Street fill under stamped roof photos. */
export const CITY_PACK_STREET_FILL = '#6b7468';

export type CityPackBuilding = {
  name: string;
  files: File[];
  primary: File;
};

export type CityPackTableLayout = {
  gridPerWorld: number;
  usedW: number;
  usedD: number;
  originX: number;
  originY: number;
  centerX: number;
  centerY: number;
};

const MAP_NAME_RE = /(?:^|\/)(?:map|ortho|orthophoto)s?\.(png|jpe?g|webp)$/i;
const BG_NAME_RE = /(?:^|\/)(?:background|bg|skyline|oblique)s?\.(png|jpe?g|webp)$/i;
const CITY_HINT_RE = /open3dhk|3d-?vis|3dmap|3d.?digital|csdi|landsd|\d{1,2}-[ns][ew]-\d/i;

function pathOf(file: File): string {
  return packagePathOf(file) || (file.name || '');
}

function baseNameOf(file: File): string {
  const n = pathOf(file);
  const base = n.replace(/^.*\//, '');
  return base.replace(/\.[^.]+$/, '').trim();
}

function primaryRank(file: File): number {
  const p = pathOf(file);
  if (/\.glb$/i.test(p)) return 0;
  if (/\.gltf$/i.test(p)) return 1;
  if (/\.fbx$/i.test(p)) return 2;
  if (/\.obj$/i.test(p)) return 3;
  if (/\.stl$/i.test(p)) return 4;
  return 9;
}

function isOverlayImage(file: File): boolean {
  return isCityPackMapImage(file) || isCityPackBackgroundImage(file);
}

export function isCityPackMapImage(file: File): boolean {
  return MAP_NAME_RE.test(normalizePackagePath(pathOf(file)))
    || MAP_NAME_RE.test(file.name || '');
}

export function isCityPackBackgroundImage(file: File): boolean {
  return BG_NAME_RE.test(normalizePackagePath(pathOf(file)))
    || BG_NAME_RE.test(file.name || '');
}

export function findCityPackMapImage(files: File[]): File | undefined {
  return (files || []).find(isCityPackMapImage);
}

export function findCityPackBackgroundImage(files: File[]): File | undefined {
  return (files || []).find(isCityPackBackgroundImage);
}

export function dropHas3dTilesMarker(files?: File[]): boolean {
  if (lastModelExpandFlags().saw3dTiles) return true;
  return (files || []).some(f => {
    const p = normalizePackagePath(pathOf(f));
    return /(^|\/)tileset\.json$/.test(p) || /\.(b3dm|i3dm|pnts|cmpt|osgb|3tz)$/i.test(p);
  });
}

/** Multiple buildings, or one building plus a map/background overlay, or Open3Dhk-ish names. */
export function dropLooksLikeCityPack(files: File[]): boolean {
  const list = files || [];
  const primaries = list.filter(isPrimaryModelFile);
  if (primaries.length >= 2) return true;
  if (primaries.length >= 1 && (findCityPackMapImage(list) || findCityPackBackgroundImage(list))) {
    return true;
  }
  if (primaries.length >= 1 && list.some(f => CITY_HINT_RE.test(pathOf(f)) || CITY_HINT_RE.test(f.name || ''))) {
    return true;
  }
  return false;
}

/**
 * One group per building. Same-folder glTF+GLB (or FBX) collapses to the preferred format.
 * Sidecars (textures / bin / mtl) are shared across groups so package-relative URIs resolve.
 */
export function groupCityPackBuildings(files: File[]): CityPackBuilding[] {
  const list = files || [];
  const primaries = list.filter(isPrimaryModelFile);
  const sidecars = list.filter(f => !isPrimaryModelFile(f) && !isOverlayImage(f));

  const byDir = new Map<string, File[]>();
  for (const primary of primaries) {
    const dir = dirOfPackagePath(pathOf(primary));
    const bucket = byDir.get(dir) || [];
    bucket.push(primary);
    byDir.set(dir, bucket);
  }

  const chosen: File[] = [];
  for (const bucket of byDir.values()) {
    const byBase = new Map<string, File[]>();
    for (const f of bucket) {
      const key = baseNameOf(f).toLowerCase() || pathOf(f);
      const arr = byBase.get(key) || [];
      arr.push(f);
      byBase.set(key, arr);
    }
    for (const alts of byBase.values()) {
      alts.sort((a, b) => primaryRank(a) - primaryRank(b));
      chosen.push(alts[0]);
    }
  }

  chosen.sort((a, b) => pathOf(a).localeCompare(pathOf(b)));
  return chosen.map(primary => ({
    name: baseNameOf(primary) || 'Building',
    primary,
    files: [primary, ...sidecars],
  }));
}

export function mergeAabbs(aabbs: MeshAabb[]): MeshAabb {
  const out = emptyAabb();
  for (const box of aabbs || []) {
    expandAabb(out, box.min[0], box.min[1], box.min[2]);
    expandAabb(out, box.max[0], box.max[1], box.max[2]);
  }
  if (!Number.isFinite(out.min[0])) return { min: [0, 0, 0], max: [0, 0, 0] };
  return out;
}

export function aabbSize(aabb: MeshAabb): { sx: number; sy: number; sz: number } {
  return {
    sx: Math.max(0, aabb.max[0] - aabb.min[0]),
    sy: Math.max(0, aabb.max[1] - aabb.min[1]),
    sz: Math.max(0, aabb.max[2] - aabb.min[2]),
  };
}

export function aabbCenterXZ(aabb: MeshAabb): { x: number; z: number } {
  return {
    x: (aabb.min[0] + aabb.max[0]) * 0.5,
    z: (aabb.min[2] + aabb.max[2]) * 0.5,
  };
}

/**
 * True when footprints are spread out (world / sheet coordinates).
 * False when every building sits on the same local origin (stacked).
 */
export function buildingsHaveWorldSpread(aabbs: MeshAabb[]): boolean {
  if (!aabbs || aabbs.length < 2) return true;
  const centers = aabbs.map(aabbCenterXZ);
  let maxDist = 0;
  for (let i = 0; i < centers.length; i++) {
    for (let j = i + 1; j < centers.length; j++) {
      const d = Math.hypot(centers[i].x - centers[j].x, centers[i].z - centers[j].z);
      if (d > maxDist) maxDist = d;
    }
  }
  let typical = 0;
  for (const box of aabbs) {
    const { sx, sz } = aabbSize(box);
    typical += Math.max(sx, sz);
  }
  typical /= aabbs.length;
  return maxDist > Math.max(typical * 0.5, 1e-3);
}

/**
 * Fit the union footprint into the table, preserving aspect (letterbox).
 * Table units are grids; origin/center are table pixels (50 px / grid).
 */
export function cityPackTableLayout(
  union: MeshAabb,
  tableWidth: number,
  tableHeight: number,
  gridPx = 50,
): CityPackTableLayout {
  const { sx, sz } = aabbSize(union);
  const tw = Math.max(1, tableWidth || 1);
  const th = Math.max(1, tableHeight || 1);
  const gridPerWorld = Math.min(
    tw / Math.max(sx, 1e-9),
    th / Math.max(sz, 1e-9),
  );
  const usedW = sx * gridPerWorld;
  const usedD = sz * gridPerWorld;
  const originX = ((tw - usedW) / 2) * gridPx;
  const originY = ((th - usedD) / 2) * gridPx;
  return {
    gridPerWorld,
    usedW,
    usedD,
    originX,
    originY,
    centerX: originX + (usedW * gridPx) / 2,
    centerY: originY + (usedD * gridPx) / 2,
  };
}

export function buildingTableCenter(
  buildingAabb: MeshAabb,
  union: MeshAabb,
  layout: CityPackTableLayout,
  gridPx = 50,
): { x: number; y: number } {
  const c = aabbCenterXZ(buildingAabb);
  return {
    x: layout.originX + (c.x - union.min[0]) * layout.gridPerWorld * gridPx,
    y: layout.originY + (c.z - union.min[2]) * layout.gridPerWorld * gridPx,
  };
}

/** Flat signs / road slabs should not catch walk / slope. */
export function cityPackShouldInteract(width: number, depth: number, height: number): boolean {
  const h = Math.max(0, height);
  const footprint = Math.min(Math.max(0, width), Math.max(0, depth));
  if (h < 0.35) return false;
  if (footprint > 0 && h < footprint * 0.15) return false;
  return true;
}

export function cityPackErrorI18nKey(err: unknown): string {
  const code = err instanceof Error ? err.message : String(err || '');
  switch (code) {
    case 'CITY_PACK_3D_TILES':
    case 'MODEL_3D_TILES':
      return 'modelImport.error.cityPackTiles';
    case 'CITY_PACK_TOO_MANY':
      return 'modelImport.error.cityPackTooMany';
    case 'CITY_PACK_PHOTOGRAMMETRY':
      return 'modelImport.error.cityPackPhotogrammetry';
    case 'CITY_PACK_NO_BUILDING':
      return 'modelImport.error.cityPackNoBuilding';
    default:
      return '';
  }
}
