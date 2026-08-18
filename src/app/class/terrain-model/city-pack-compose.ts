import { MeshAabb } from './mesh-ir';
import { BakedFaceBlobs } from './ortho-bake';
import {
  CITY_PACK_MAP_MAX_PX,
  CITY_PACK_SKYLINE_H,
  CITY_PACK_SKYLINE_W,
  CITY_PACK_STREET_FILL,
  aabbSize,
} from './city-pack';

export type CityPackStamp = {
  aabb: MeshAabb;
  blobs: BakedFaceBlobs;
};

function blobToImage(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('MODEL_BAKE_FAILED'));
    };
    img.src = url;
  });
}

function canvasToPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('MODEL_BAKE_FAILED'))),
      'image/png',
    );
  });
}

/**
 * Stamp each building's baked roof (floor face) onto a street-colored ortho.
 * Aligns 1:1 with Terrain footprints — no extra WebGL pass.
 */
export async function composeCityPackOrthoMap(
  stamps: CityPackStamp[],
  union: MeshAabb,
  maxPx: number = CITY_PACK_MAP_MAX_PX,
): Promise<Blob> {
  const { sx, sz } = aabbSize(union);
  const scale = maxPx / Math.max(sx, sz, 1e-9);
  const width = Math.max(32, Math.round(sx * scale));
  const height = Math.max(32, Math.round(sz * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('MODEL_BAKE_FAILED');
  ctx.fillStyle = CITY_PACK_STREET_FILL;
  ctx.fillRect(0, 0, width, height);

  for (const stamp of stamps) {
    const roof = stamp.blobs.floor;
    if (!roof) continue;
    const { sx: bw, sz: bd } = aabbSize(stamp.aabb);
    const dx = (stamp.aabb.min[0] - union.min[0]) * scale;
    const dy = (stamp.aabb.min[2] - union.min[2]) * scale;
    const dw = Math.max(1, bw * scale);
    const dh = Math.max(1, bd * scale);
    try {
      const img = await blobToImage(roof);
      ctx.drawImage(img, dx, dy, dw, dh);
    } catch {
      // Skip a failed stamp; street fill remains.
    }
  }
  return canvasToPng(canvas);
}

/**
 * 2.5D skyline: wall photos along X, height from world Y. Not a live 3D view.
 */
export async function composeCityPackSkyline(
  stamps: CityPackStamp[],
  union: MeshAabb,
): Promise<Blob | null> {
  if (!stamps.length) return null;
  const canvas = document.createElement('canvas');
  canvas.width = CITY_PACK_SKYLINE_W;
  canvas.height = CITY_PACK_SKYLINE_H;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  const sky = ctx.createLinearGradient(0, 0, 0, canvas.height);
  sky.addColorStop(0, '#7eb6d9');
  sky.addColorStop(0.55, '#d7c4a8');
  sky.addColorStop(1, '#8a8f7a');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const { sx: unionSx } = aabbSize(union);
  let maxSy = 1e-6;
  for (const stamp of stamps) {
    const { sy } = aabbSize(stamp.aabb);
    if (sy > maxSy) maxSy = sy;
  }

  const ground = canvas.height * 0.82;
  ctx.fillStyle = '#4d5348';
  ctx.fillRect(0, ground, canvas.width, canvas.height - ground);

  const ordered = stamps.slice().sort((a, b) => a.aabb.min[0] - b.aabb.min[0]);
  for (const stamp of ordered) {
    const wall = stamp.blobs.wallBottom || stamp.blobs.wall;
    if (!wall) continue;
    const { sx, sy } = aabbSize(stamp.aabb);
    const x = ((stamp.aabb.min[0] - union.min[0]) / Math.max(unionSx, 1e-9)) * canvas.width;
    const w = Math.max(4, (sx / Math.max(unionSx, 1e-9)) * canvas.width);
    const h = Math.max(8, (sy / maxSy) * (ground * 0.88));
    try {
      const img = await blobToImage(wall);
      ctx.drawImage(img, x, ground - h, w, h);
    } catch {
      // Skip.
    }
  }
  return canvasToPng(canvas);
}
