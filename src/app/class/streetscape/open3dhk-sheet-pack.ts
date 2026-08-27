import { attachPackagePath, packagePathOf } from '@udonarium/terrain-model/model-package-files';

import { BUILTIN_STREETSCAPE_CAPS } from './caps';
import { STREETSCAPE_ERRORS } from './errors';
import { composeStreetscapeFloor } from './floor-composer';
import { filterOutOpen3dhkBuildingIds, matchOpen3dhkBuildingsByIds } from './open3dhk-building-id';
import {
  chooseBuildingsForSheet,
  filterBuildingsOnTerrain,
  Open3dhkTerrainBox,
} from './open3dhk-map-select';
import { createPackLoad } from './pack-file-source';
import { StreetscapeFeatureV1, StreetscapePackV1, parseStreetscapePackV1 } from './pack-schema';
import { streetscapeScaleFromPack } from './placement';
import { StreetscapePackLoad } from './source';

export type Open3dhkBuildingMember = {
  id: string;
  gltfPath: string;
  binPath: string;
  binBytes: number;
  worldX: number;
  worldZ: number;
  sizeMeters?: { w: number; d: number; h: number };
};

export type Open3dhkTerrainFloor = {
  imagePath: string;
  imageFile: File;
  /** World-space XZ AABB covered by the aerial (meters, HK1980). */
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
};

/** Normalized package paths are lowercase (`building/<id>/<id>.gltf`). */
const BUILDING_GLTF_RE = /^building\/([^/]+)\/\1\.gltf$/;
const TERRAIN_GLTF_RE = /^terrain\(tb\)\/([^/]+)\/\1\.gltf$/;
const IMAGE_URI_RE = /\.(png|jpe?g|webp|gif|bmp)$/i;

/**
 * Official Open3Dhk Individualised sheet ZIP → Streetscape PackLoad.
 * Prefers TERRAIN aerial as floor; picks largest buildings inside that footprint.
 */
export type Open3dhkZipFormat = 'GLTF' | 'GLTF0';

export async function packLoadFromOpen3dhkSheetFiles(
  files: File[],
  opts: {
    sheet: string;
    title?: string;
    maxFeatures?: number;
    format?: Open3dhkZipFormat;
    /** Terrain aerial only — no buildings (defer facades). */
    floorOnly?: boolean;
    /** Reuse map-only world AABB so deferred facades align. */
    reuseWorldExtent?: { minX: number; maxX: number; minZ: number; maxZ: number };
    /** Prefer these Open3Dhk building folder ids when present in `files`. */
    preferredBuildingIds?: string[];
    /** Skip already-placed buildings when ranking. */
    excludeBuildingIds?: string[];
  },
): Promise<StreetscapePackLoad> {
  const format: Open3dhkZipFormat = opts.format === 'GLTF' ? 'GLTF' : 'GLTF0';
  const terrain = await findOpen3dhkTerrainFloor(files);

  if (opts.floorOnly) {
    if (!terrain) throw new Error(STREETSCAPE_ERRORS.NO_FLOOR);
    const minX = terrain.minX;
    const maxX = terrain.maxX;
    const minZ = terrain.minZ;
    const maxZ = terrain.maxZ;
    const attribution = format === 'GLTF'
      ? `Lands Department / Open3Dhk Individualised — sheet ${opts.sheet} (floor only; facades deferred)`
      : `Lands Department / Open3Dhk Individualised — sheet ${opts.sheet} (floor only)`;
    const packRaw: StreetscapePackV1 = {
      version: 1,
      id: `open3dhk-${opts.sheet}`,
      title: opts.title || `Open3Dhk ${opts.sheet}`,
      attribution,
      metersPerUnit: 1,
      axis: 'y-up',
      origin: { x: 0, z: 0 },
      extentMeters: {
        width: Math.max(20, maxX - minX),
        depth: Math.max(20, maxZ - minZ),
      },
      floor: { path: 'floor.png' },
      features: [],
      quality: { bakeMaxEdgePx: 512, fitGrid: false, featureSort: 'distanceToOrigin' },
    };
    const pack = parseStreetscapePackV1(packRaw);
    const cropped = await cropTerrainAerialToExtent(terrain, minX, maxX, minZ, maxZ);
    const bag = new Map<string, File>();
    bag.set('floor.png', attachPackagePath(cropped, 'floor.png'));
    return {
      ...createPackLoad(pack, Array.from(bag.values())),
      worldExtent: { minX, maxX, minZ, maxZ },
    };
  }

  const members = await listOpen3dhkBuildings(files);
  if (!members.length) throw new Error(STREETSCAPE_ERRORS.NOT_A_PACK);

  const terrainBox: Open3dhkTerrainBox | null = terrain
    ? { minX: terrain.minX, maxX: terrain.maxX, minZ: terrain.minZ, maxZ: terrain.maxZ }
    : opts.reuseWorldExtent
      ? {
        minX: opts.reuseWorldExtent.minX,
        maxX: opts.reuseWorldExtent.maxX,
        minZ: opts.reuseWorldExtent.minZ,
        maxZ: opts.reuseWorldExtent.maxZ,
      }
      : null;
  const maxN = typeof opts.maxFeatures === 'number' && Number.isFinite(opts.maxFeatures) && opts.maxFeatures > 0
    ? Math.max(1, Math.floor(opts.maxFeatures))
    : Math.max(1, members.length);
  const preferred = (opts.preferredBuildingIds || []).map(id => String(id || '').trim()).filter(Boolean);
  const pool = filterOutOpen3dhkBuildingIds(members, opts.excludeBuildingIds);
  let selected: Open3dhkBuildingMember[];
  if (preferred.length) {
    selected = matchOpen3dhkBuildingsByIds(members, preferred, maxN);
    if (!selected.length) selected = chooseBuildingsForSheet(pool, maxN, terrainBox);
  } else {
    selected = chooseBuildingsForSheet(pool, maxN, terrainBox);
  }

  let minX: number;
  let maxX: number;
  let minZ: number;
  let maxZ: number;
  if (opts.reuseWorldExtent) {
    minX = opts.reuseWorldExtent.minX;
    maxX = opts.reuseWorldExtent.maxX;
    minZ = opts.reuseWorldExtent.minZ;
    maxZ = opts.reuseWorldExtent.maxZ;
  } else if (terrain && filterBuildingsOnTerrain(members, terrainBox).length) {
    minX = terrain.minX;
    maxX = terrain.maxX;
    minZ = terrain.minZ;
    maxZ = terrain.maxZ;
  } else {
    const xs = selected.map(m => m.worldX);
    const zs = selected.map(m => m.worldZ);
    const pad = 40;
    minX = Math.min(...xs) - pad;
    maxX = Math.max(...xs) + pad;
    minZ = Math.min(...zs) - pad;
    maxZ = Math.max(...zs) + pad;
  }

  const features: StreetscapeFeatureV1[] = selected.map(m => {
    const w = m.sizeMeters?.w ?? 0;
    const d = m.sizeMeters?.d ?? 0;
    const cx = m.worldX - minX;
    const cz = m.worldZ - minZ;
    return {
      id: m.id,
      kind: 'building',
      path: m.gltfPath,
      // Pack contract: positionMeters is min-corner when sizeMeters is set.
      positionMeters: m.sizeMeters
        ? { x: cx - w / 2, z: cz - d / 2 }
        : { x: cx, z: cz },
      ...(m.sizeMeters ? { sizeMeters: m.sizeMeters } : {}),
    };
  });

  const attribution = format === 'GLTF'
    ? `Lands Department / Open3Dhk Individualised — sheet ${opts.sheet} (GLTF textured)`
    : `Lands Department / Open3Dhk Individualised — sheet ${opts.sheet} (GLTF0; facade tint from aerial)`;

  const packRaw: StreetscapePackV1 = {
    version: 1,
    id: `open3dhk-${opts.sheet}`,
    title: opts.title || `Open3Dhk ${opts.sheet}`,
    attribution,
    metersPerUnit: 1,
    axis: 'y-up',
    origin: { x: 0, z: 0 },
    extentMeters: {
      width: Math.max(20, maxX - minX),
      depth: Math.max(20, maxZ - minZ),
    },
    floor: { path: 'floor.png' },
    features,
    quality: { bakeMaxEdgePx: 512, fitGrid: false, featureSort: 'distanceToOrigin' },
  };
  const pack = parseStreetscapePackV1(packRaw);

  const bag = new Map<string, File>();
  for (const m of selected) {
    const prefix = `building/${m.id}/`;
    const folder = files.filter(f => packagePathOf(f).startsWith(prefix));
    const gltfFile = folder.find(f => packagePathOf(f) === m.gltfPath);
    const binFile = folder.find(f => packagePathOf(f) === m.binPath);
    if (!gltfFile || !binFile) throw new Error(STREETSCAPE_ERRORS.NO_FEATURE);
    const localizedText = localizeOpen3dhkGltf(await gltfFile.text()).json;
    bag.set(
      m.gltfPath,
      attachPackagePath(
        new File([localizedText], gltfFile.name, { type: 'model/gltf+json' }),
        m.gltfPath,
      ),
    );
    for (const file of folder) {
      const path = packagePathOf(file);
      if (path === m.gltfPath) continue;
      bag.set(path, file);
    }
  }

  if (terrain) {
    const cropped = await cropTerrainAerialToExtent(terrain, minX, maxX, minZ, maxZ);
    bag.set('floor.png', attachPackagePath(cropped, 'floor.png'));
  } else if (opts.reuseWorldExtent) {
    // Deferred facades: keep a tiny placeholder floor; table already has the aerial.
    const placeholder = tinyPngPlaceholder();
    bag.set('floor.png', attachPackagePath(placeholder, 'floor.png'));
  } else {
    const scale = streetscapeScaleFromPack(pack, BUILTIN_STREETSCAPE_CAPS, 50);
    const floorBlob = composeStreetscapeFloor(pack, scale, features, {
      pavementCssColor: '#c4b8a4',
    });
    bag.set(
      'floor.png',
      attachPackagePath(new File([floorBlob], 'floor.png', { type: 'image/png' }), 'floor.png'),
    );
  }

  return {
    ...createPackLoad(pack, Array.from(bag.values())),
    worldExtent: { minX, maxX, minZ, maxZ },
  };
}

export async function listOpen3dhkBuildings(files: File[]): Promise<Open3dhkBuildingMember[]> {
  const out: Open3dhkBuildingMember[] = [];
  for (const file of files) {
    const path = packagePathOf(file);
    const m = BUILDING_GLTF_RE.exec(path);
    if (!m) continue;
    const id = m[1];
    const binPath = `building/${id}/${id}.bin`;
    const binFile = files.find(f => packagePathOf(f) === binPath);
    if (!binFile) continue;
    const parsed = localizeOpen3dhkGltf(await file.text());
    out.push({
      id,
      gltfPath: path,
      binPath,
      binBytes: binFile.size,
      worldX: parsed.worldX,
      worldZ: parsed.worldZ,
      sizeMeters: parsed.sizeMeters,
    });
  }
  return out;
}

export async function findOpen3dhkTerrainFloor(files: File[]): Promise<Open3dhkTerrainFloor | null> {
  for (const file of files) {
    const path = packagePathOf(file);
    const m = TERRAIN_GLTF_RE.exec(path);
    if (!m) continue;
    const id = m[1];
    const dir = `terrain(tb)/${id}`;
    const parsed = localizeOpen3dhkGltf(await file.text());
    const doc = JSON.parse(parsed.json) as Record<string, unknown>;
    const imageUri = firstGltfImageUri(doc);
    if (!imageUri || !IMAGE_URI_RE.test(imageUri)) continue;
    const imagePath = `${dir}/${normalizeUri(imageUri)}`;
    const imageFile = files.find(f => packagePathOf(f) === imagePath)
      || files.find(f => packagePathOf(f).endsWith(`/${normalizeUri(imageUri)}`));
    if (!imageFile) continue;

    const local = localXzExtentFromGltf(doc);
    // LandsD axis matrix: (x,y,z)_local → (x, z, -y)_world offsets.
    const minX = parsed.worldX + local.minX;
    const maxX = parsed.worldX + local.maxX;
    const minZ = parsed.worldZ - local.maxY;
    const maxZ = parsed.worldZ - local.minY;
    return {
      imagePath: packagePathOf(imageFile),
      imageFile,
      minX: Math.min(minX, maxX),
      maxX: Math.max(minX, maxX),
      minZ: Math.min(minZ, maxZ),
      maxZ: Math.max(minZ, maxZ),
    };
  }
  return null;
}

export function selectOpen3dhkBuildings(
  members: Open3dhkBuildingMember[],
  maxN: number,
): Open3dhkBuildingMember[] {
  if (members.length <= maxN) return members.slice();
  const cx = members.reduce((s, m) => s + m.worldX, 0) / members.length;
  const cz = members.reduce((s, m) => s + m.worldZ, 0) / members.length;
  return members
    .slice()
    .sort((a, b) => {
      const score = (m: Open3dhkBuildingMember) => {
        const d = Math.hypot(m.worldX - cx, m.worldZ - cz);
        // log size: avoid always picking the absolute largest towers (often 20–60 JPEG facades).
        return Math.log1p(m.binBytes) / (1 + d);
      };
      return score(b) - score(a);
    })
    .slice(0, maxN);
}

/**
 * Zero HK1980 translation on the root node so bake AABB is local.
 * Keeps the LandsD Y↔Z axis matrix.
 */
export function localizeOpen3dhkGltf(text: string): {
  json: string;
  worldX: number;
  worldZ: number;
  sizeMeters?: { w: number; d: number; h: number };
} {
  let doc: Record<string, unknown>;
  try {
    doc = JSON.parse(text);
  } catch {
    throw new Error(STREETSCAPE_ERRORS.NOT_A_PACK);
  }
  let worldX = 0;
  let worldZ = 0;
  const nodes = Array.isArray(doc.nodes) ? doc.nodes as Record<string, unknown>[] : [];
  for (const node of nodes) {
    const matrix = node.matrix;
    if (!Array.isArray(matrix) || matrix.length < 15) continue;
    const tx = Number(matrix[12]);
    const tz = Number(matrix[14]);
    if (!Number.isFinite(tx) || !Number.isFinite(tz)) continue;
    if (Math.hypot(tx, tz) < 1) continue;
    worldX = tx;
    worldZ = tz;
    matrix[12] = 0;
    matrix[13] = 0;
    matrix[14] = 0;
    break;
  }
  return {
    json: JSON.stringify(doc),
    worldX,
    worldZ,
    sizeMeters: sizeFromGltfAccessors(doc),
  };
}

/** Crop aerial to the pack extent; downscale long edge for storage. */
export async function cropTerrainAerialToExtent(
  terrain: Open3dhkTerrainFloor,
  minX: number,
  maxX: number,
  minZ: number,
  maxZ: number,
  maxEdgePx = 2048,
): Promise<File> {
  const tw = Math.max(1e-6, terrain.maxX - terrain.minX);
  const td = Math.max(1e-6, terrain.maxZ - terrain.minZ);
  // JPG U: west→east (X). V: often north→south; LandsD terrain Y local maps to -Z.
  const u0 = clamp01((minX - terrain.minX) / tw);
  const u1 = clamp01((maxX - terrain.minX) / tw);
  const v0 = clamp01((terrain.maxZ - maxZ) / td);
  const v1 = clamp01((terrain.maxZ - minZ) / td);

  const url = URL.createObjectURL(terrain.imageFile);
  try {
    const img = await loadHtmlImage(url);
    const sw = Math.max(1, img.naturalWidth || img.width);
    const sh = Math.max(1, img.naturalHeight || img.height);
    const sx = Math.floor(Math.min(u0, u1) * sw);
    const sy = Math.floor(Math.min(v0, v1) * sh);
    const sWidth = Math.max(1, Math.ceil(Math.abs(u1 - u0) * sw));
    const sHeight = Math.max(1, Math.ceil(Math.abs(v1 - v0) * sh));

    let dw = sWidth;
    let dh = sHeight;
    const scale = Math.min(1, maxEdgePx / Math.max(dw, dh));
    dw = Math.max(64, Math.round(dw * scale));
    dh = Math.max(64, Math.round(dh * scale));

    const canvas = document.createElement('canvas');
    canvas.width = dw;
    canvas.height = dh;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error(STREETSCAPE_ERRORS.NO_FLOOR);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(img, sx, sy, sWidth, sHeight, 0, 0, dw, dh);
    const blob = await canvasToPngBlob(canvas);
    return new File([blob], 'floor.png', { type: 'image/png' });
  } finally {
    URL.revokeObjectURL(url);
  }
}

function pointInAabb(
  x: number,
  z: number,
  box: { minX: number; maxX: number; minZ: number; maxZ: number },
): boolean {
  return x >= box.minX && x <= box.maxX && z >= box.minZ && z <= box.maxZ;
}

function firstGltfImageUri(doc: Record<string, unknown>): string {
  const images = Array.isArray(doc.images) ? doc.images as Record<string, unknown>[] : [];
  for (const img of images) {
    if (typeof img.uri === 'string' && img.uri.trim()) return img.uri.trim();
  }
  return '';
}

function normalizeUri(uri: string): string {
  return uri.replace(/\\/g, '/').split('/').pop()?.toLowerCase() || uri.toLowerCase();
}

function localXzExtentFromGltf(doc: Record<string, unknown>): {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
} {
  const accessors = Array.isArray(doc.accessors) ? doc.accessors as Record<string, unknown>[] : [];
  for (const acc of accessors) {
    if (acc.type !== 'VEC3' || !Array.isArray(acc.min) || !Array.isArray(acc.max)) continue;
    const min = acc.min.map(Number);
    const max = acc.max.map(Number);
    if (min.length < 3 || max.length < 3) continue;
    if (![...min, ...max].every(Number.isFinite)) continue;
    // Prefer the largest horizontal footprint accessor.
    const dx = Math.abs(max[0] - min[0]);
    const dy = Math.abs(max[1] - min[1]);
    if (dx + dy < 10) continue;
    return {
      minX: Math.min(min[0], max[0]),
      maxX: Math.max(min[0], max[0]),
      minY: Math.min(min[1], max[1]),
      maxY: Math.max(min[1], max[1]),
    };
  }
  return { minX: -100, maxX: 100, minY: -100, maxY: 100 };
}

function sizeFromGltfAccessors(doc: Record<string, unknown>): { w: number; d: number; h: number } | undefined {
  const accessors = Array.isArray(doc.accessors) ? doc.accessors as Record<string, unknown>[] : [];
  for (const acc of accessors) {
    if (acc.type !== 'VEC3' || !Array.isArray(acc.min) || !Array.isArray(acc.max)) continue;
    const min = acc.min.map(Number);
    const max = acc.max.map(Number);
    if (min.length < 3 || max.length < 3) continue;
    if (![...min, ...max].every(Number.isFinite)) continue;
    const dx = Math.abs(max[0] - min[0]);
    const dy = Math.abs(max[1] - min[1]);
    const dz = Math.abs(max[2] - min[2]);
    if (dx + dy + dz < 1e-3) continue;
    // After LandsD axis: footprint ≈ (dx, dy), height ≈ dz.
    return { w: Math.max(1, dx), d: Math.max(1, dy), h: Math.max(1, dz) };
  }
  return undefined;
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function tinyPngPlaceholder(): File {
  const b64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new File([bytes], 'floor.png', { type: 'image/png' });
}

function loadHtmlImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(STREETSCAPE_ERRORS.NO_FLOOR));
    img.src = url;
  });
}

function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      blob => (blob ? resolve(blob) : reject(new Error(STREETSCAPE_ERRORS.NO_FLOOR))),
      'image/png',
    );
  });
}
