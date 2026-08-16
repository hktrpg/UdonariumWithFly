import { ImageStorage } from '@udonarium/core/file-storage/image-storage';
import { Terrain, TerrainFaceName, TERRAIN_SIZE_MIN } from '@udonarium/terrain';

import { MeshAabb } from './mesh-ir';
import { BakedFaceBlobs } from './ortho-bake';

/** 0.8% of the face long edge, clamped 1–16 px (texel pad at 1024). */
export const BAKE_CROP_PAD_FRACTION = 0.008;
export const BAKE_CROP_PAD_MIN_PX = 1;
export const BAKE_CROP_PAD_MAX_PX = 16;
export const BAKE_CROP_ALPHA_MIN = 12;
const INSET_SUM_MAX = 0.9;

export type FaceEdgeInsets = {
  west: number;
  east: number;
  south: number;
  north: number;
};

/** @deprecated Use FaceEdgeInsets — same shape; NESW are that photo's edges (north = top). */
export type FootprintInsets = FaceEdgeInsets;

export type PerFaceInsets = Partial<Record<TerrainFaceName, FaceEdgeInsets>>;

export const BAKE_CROP_FACES: TerrainFaceName[] = [
  'floor', 'underside', 'wallTop', 'wallBottom', 'wallLeft', 'wallRight',
];

export type TerrainBakeCropState = {
  sources: Partial<Record<TerrainFaceName, string>>;
  /** Per-face photo edges. north = top of that image (south wall top = 北). */
  faces: PerFaceInsets;
  /** Legacy single footprint crop; migrated into `faces` on parse. */
  insets?: FaceEdgeInsets;
  fullWidth: number;
  fullDepth: number;
  fullHeight: number;
  anchorX: number;
  anchorY: number;
  /** Offset from the multi-box model origin (table px); used to reassemble groups. */
  groupLocalX?: number;
  groupLocalY?: number;
};

export type PixelRect = { x: number; y: number; w: number; h: number };

export function emptyInsets(): FootprintInsets {
  return { west: 0, east: 0, south: 0, north: 0 };
}

export function padPxForLongEdge(longEdgePx: number): number {
  const raw = Math.round(Math.max(0, longEdgePx) * BAKE_CROP_PAD_FRACTION);
  return Math.min(BAKE_CROP_PAD_MAX_PX, Math.max(BAKE_CROP_PAD_MIN_PX, raw));
}

export function clampInsets(insets: FootprintInsets): FootprintInsets {
  let west = clamp01(insets.west);
  let east = clamp01(insets.east);
  let south = clamp01(insets.south);
  let north = clamp01(insets.north);
  const we = west + east;
  if (we > INSET_SUM_MAX && we > 0) {
    const s = INSET_SUM_MAX / we;
    west *= s;
    east *= s;
  }
  const ns = north + south;
  if (ns > INSET_SUM_MAX && ns > 0) {
    const s = INSET_SUM_MAX / ns;
    north *= s;
    south *= s;
  }
  return { west, east, south, north };
}

/**
 * Opaque bbox of a photo → NESW fractions of THAT image.
 * north = top, south = bottom, west = left, east = right.
 *
 * This only trims empty photo margins. It must NOT be used to invent large
 * "sibling bleed" crops (e.g. west-wall east 50%): those came from rendering
 * neighboring F/U wings into the same ortho shot. Fix that with AABB clipping
 * at bake time; opaque-bbox crop would keep the bleed because it is opaque.
 */
export function insetsFromOpaqueRgba(
  data: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
  alphaMin: number = BAKE_CROP_ALPHA_MIN,
): FootprintInsets {
  if (width < 1 || height < 1) return emptyInsets();
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] < alphaMin) continue;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < minX || maxY < minY) return emptyInsets();
  const pad = padPxForLongEdge(Math.max(width, height));
  const left = Math.max(0, minX - pad);
  const top = Math.max(0, minY - pad);
  const right = Math.min(width - 1, maxX + pad);
  const bottom = Math.min(height - 1, maxY + pad);
  return clampInsets({
    west: left / width,
    east: (width - 1 - right) / width,
    north: top / height,
    south: (height - 1 - bottom) / height,
  });
}

/**
 * Crop a face photo. NESW are that image's edges (north = top), so a south
 * wall can crop its upper sign band with north.
 */
export function cropRectForFace(
  _face: TerrainFaceName,
  width: number,
  height: number,
  insets: FaceEdgeInsets,
): PixelRect {
  const i = clampInsets(insets);
  if (width < 1 || height < 1) return { x: 0, y: 0, w: width, h: height };
  const x = Math.round(i.west * width);
  const y = Math.round(i.north * height);
  const w = Math.max(1, Math.round(width * (1 - i.west - i.east)));
  const h = Math.max(1, Math.round(height * (1 - i.north - i.south)));
  return {
    x: Math.max(0, Math.min(width - 1, x)),
    y: Math.max(0, Math.min(height - 1, y)),
    w: Math.max(1, Math.min(width - Math.max(0, x), w)),
    h: Math.max(1, Math.min(height - Math.max(0, y), h)),
  };
}

export function clipPathForFace(_face: TerrainFaceName, insets: FaceEdgeInsets): string {
  const i = clampInsets(insets);
  const pct = (n: number) => `${(n * 100).toFixed(3)}%`;
  return `inset(${pct(i.north)} ${pct(i.east)} ${pct(i.south)} ${pct(i.west)})`;
}

/** Stretch the remaining photo region to fill the CSS face (live table preview). */
export function faceCropBackgroundStyle(insets: FaceEdgeInsets | null | undefined): {
  'background-size': string;
  'background-position': string;
  'background-repeat': string;
} {
  const i = clampInsets(insets || emptyInsets());
  const wf = Math.max(0.05, 1 - i.west - i.east);
  const hf = Math.max(0.05, 1 - i.north - i.south);
  const posX = i.west + i.east > 1e-6 ? (i.west / (i.west + i.east)) * 100 : 50;
  const posY = i.north + i.south > 1e-6 ? (i.north / (i.north + i.south)) * 100 : 50;
  return {
    'background-size': `${(100 / wf).toFixed(4)}% ${(100 / hf).toFixed(4)}%`,
    'background-position': `${posX}% ${posY}%`,
    'background-repeat': 'no-repeat',
  };
}

export function emptyPerFaceInsets(): PerFaceInsets {
  return {};
}

export function clonePerFaceInsets(faces: PerFaceInsets | null | undefined): PerFaceInsets {
  const out: PerFaceInsets = {};
  for (const face of BAKE_CROP_FACES) {
    const src = faces?.[face];
    if (src) out[face] = clampInsets(src);
  }
  return out;
}

export function insetsAlmostZero(insets: FaceEdgeInsets | null | undefined): boolean {
  const i = clampInsets(insets || emptyInsets());
  return i.west + i.east + i.south + i.north < 1e-6;
}

export function insetAabbXz(aabb: MeshAabb, insets: FaceEdgeInsets): MeshAabb {
  const i = clampInsets(insets);
  const sx = aabb.max[0] - aabb.min[0];
  const sz = aabb.max[2] - aabb.min[2];
  return {
    min: [aabb.min[0] + sx * i.west, aabb.min[1], aabb.min[2] + sz * i.north],
    max: [aabb.max[0] - sx * i.east, aabb.max[1], aabb.max[2] - sz * i.south],
  };
}

export async function insetsFromFaceBlob(blob: Blob | undefined): Promise<FaceEdgeInsets> {
  if (!blob) return emptyInsets();
  const decoded = await decodeRgba(blob);
  if (!decoded) return emptyInsets();
  return insetsFromOpaqueRgba(decoded.data, decoded.width, decoded.height);
}

export async function insetsFromFloorBlob(blob: Blob | undefined): Promise<FaceEdgeInsets> {
  return insetsFromFaceBlob(blob);
}

export async function autoPerFaceInsets(blobs: BakedFaceBlobs): Promise<PerFaceInsets> {
  const out: PerFaceInsets = {};
  for (const face of BAKE_CROP_FACES) {
    const blob = blobs[face];
    if (!blob) continue;
    out[face] = await insetsFromFaceBlob(blob);
  }
  return out;
}

/**
 * True when insets look like the old manual "bleed" crops (half a wall), which
 * means the bake still included sibling geometry — clipping should prevent this.
 */
export function insetsLookLikeSiblingBleed(insets: FaceEdgeInsets): boolean {
  const i = clampInsets(insets);
  return i.west >= 0.45 || i.east >= 0.45 || i.north >= 0.45 || i.south >= 0.45;
}

export async function cropFaceBlob(
  blob: Blob,
  face: TerrainFaceName,
  insets: FaceEdgeInsets,
): Promise<Blob> {
  const img = await loadImage(blob);
  const w = img.naturalWidth || img.width;
  const h = img.naturalHeight || img.height;
  const rect = cropRectForFace(face, w, h, insets);
  if (rect.x === 0 && rect.y === 0 && rect.w === w && rect.h === h) return blob;
  const canvas = document.createElement('canvas');
  canvas.width = rect.w;
  canvas.height = rect.h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return blob;
  ctx.clearRect(0, 0, rect.w, rect.h);
  ctx.drawImage(img, rect.x, rect.y, rect.w, rect.h, 0, 0, rect.w, rect.h);
  const out = await canvasToPng(canvas);
  return out || blob;
}

export async function cropAllFaceBlobs(
  blobs: BakedFaceBlobs,
  faces: PerFaceInsets,
): Promise<BakedFaceBlobs> {
  const out: BakedFaceBlobs = {};
  for (const face of Object.keys(blobs) as TerrainFaceName[]) {
    const src = blobs[face];
    if (!src) continue;
    const insets = faces[face] || emptyInsets();
    out[face] = insetsAlmostZero(insets) ? src : await cropFaceBlob(src, face, insets);
  }
  return out;
}

export function parseBakeCropState(raw: string | null | undefined): TerrainBakeCropState | null {
  if (!raw) return null;
  try {
    const j = JSON.parse(raw);
    if (!j || typeof j !== 'object') return null;
    const sources = j.sources && typeof j.sources === 'object' ? j.sources : {};
    const faces: PerFaceInsets = {};
    if (j.faces && typeof j.faces === 'object') {
      for (const face of BAKE_CROP_FACES) {
        const src = j.faces[face];
        if (src) faces[face] = clampInsets(src);
      }
    } else if (j.insets) {
      const legacy = clampInsets(j.insets);
      for (const face of BAKE_CROP_FACES) faces[face] = { ...legacy };
    }
    return {
      sources,
      faces,
      insets: j.insets ? clampInsets(j.insets) : emptyInsets(),
      fullWidth: Math.max(TERRAIN_SIZE_MIN, +j.fullWidth || 0),
      fullDepth: Math.max(TERRAIN_SIZE_MIN, +j.fullDepth || 0),
      fullHeight: Math.max(0, +j.fullHeight || 0),
      anchorX: +j.anchorX || 0,
      anchorY: +j.anchorY || 0,
      groupLocalX: typeof j.groupLocalX === 'number' ? j.groupLocalX : undefined,
      groupLocalY: typeof j.groupLocalY === 'number' ? j.groupLocalY : undefined,
    };
  } catch {
    return null;
  }
}

export function serializeBakeCropState(state: TerrainBakeCropState): string {
  return JSON.stringify(state);
}

export function hasBakeCropSources(terrain: Terrain | null | undefined): boolean {
  const state = parseBakeCropState(terrain?.bakeCropJson);
  if (!state) return false;
  return !!(state.sources.floor || state.sources.wallBottom);
}

export async function applyBakeCropToTerrain(terrain: Terrain, faces: PerFaceInsets): Promise<void> {
  const state = parseBakeCropState(terrain.bakeCropJson);
  if (!state) return;
  const next = clonePerFaceInsets(faces);
  const cropped: Partial<Record<TerrainFaceName, string>> = {};
  for (const face of BAKE_CROP_FACES) {
    const id = state.sources[face];
    if (!id) continue;
    const file = ImageStorage.instance.get(id);
    const blob = file?.blob;
    if (!blob) continue;
    const insets = next[face] || emptyInsets();
    const out = await cropFaceBlob(blob, face, insets);
    const img = await ImageStorage.instance.addAsync(out);
    cropped[face] = img.identifier;
  }

  terrain.mutateAppearance(() => {
    terrain.bakeCropJson = serializeBakeCropState({ ...state, faces: next });
    if (cropped.floor) terrain.setFaceImage('floor', cropped.floor);
    if (cropped.wallBottom) {
      terrain.setFaceImage('wall', cropped.wallBottom);
      terrain.setFaceImage('wallBottom', cropped.wallBottom);
    }
    if (cropped.underside) terrain.setFaceImage('underside', cropped.underside);
    if (cropped.wallTop) terrain.setFaceImage('wallTop', cropped.wallTop);
    if (cropped.wallLeft) terrain.setFaceImage('wallLeft', cropped.wallLeft);
    if (cropped.wallRight) terrain.setFaceImage('wallRight', cropped.wallRight);
  });
}

function clamp01(n: number): number {
  if (!Number.isFinite(n) || n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

function loadImage(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = image.onabort = () => {
      URL.revokeObjectURL(url);
      reject(new Error('MODEL_BAKE_FAILED'));
    };
    image.src = url;
  });
}

async function decodeRgba(blob: Blob): Promise<{ data: Uint8ClampedArray; width: number; height: number } | null> {
  try {
    const img = await loadImage(blob);
    const w = img.naturalWidth || img.width;
    const h = img.naturalHeight || img.height;
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0);
    const imgData = ctx.getImageData(0, 0, w, h);
    return { data: imgData.data, width: w, height: h };
  } catch {
    return null;
  }
}

function canvasToPng(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise(resolve => {
    canvas.toBlob(b => resolve(b), 'image/png');
  });
}
