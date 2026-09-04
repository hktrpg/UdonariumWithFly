/**
 * Compose a top-down aerial floor from GSI seamlessphoto XYZ tiles
 * (https://cyberjapandata.gsi.go.jp/xyz/seamlessphoto/{z}/{x}/{y}.jpg).
 * Attribution: 国土地理院 / 地理院タイル.
 */

import {
  LatLonBox,
} from './geo-mercator';

export const GSI_SEAMLESSPHOTO_URL =
  'https://cyberjapandata.gsi.go.jp/xyz/seamlessphoto/{z}/{x}/{y}.jpg';

export const GSI_AERIAL_ATTRIBUTION =
  'Aerial: 国土地理院（地理院タイル／全国最新写真）';

const TILE_PX = 256;
const ZOOM_MIN = 14;
const ZOOM_MAX = 18;
/** Cap tile downloads so a city mesh stays interactive. */
const MAX_TILES = 36;
const MAX_EDGE_PX = 2048;

export type GsiLatLonBox = {
  minLat: number;
  maxLat: number;
  minLon: number;
  maxLon: number;
};

/**
 * Fraction of the GSI crop image (u east, v south from NW) for a lat/lon point.
 * Must match `latLonToPlateauLocal` / frame.width|depth when the 40 m pad does not apply.
 */
export function latLonToGsiCropUv(
  lat: number,
  lon: number,
  box: GsiLatLonBox,
): { u: number; v: number } {
  const west = lonToTileX(box.minLon, 0);
  const east = lonToTileX(box.maxLon, 0);
  const north = latToTileY(box.maxLat, 0);
  const south = latToTileY(box.minLat, 0);
  const x = lonToTileX(lon, 0);
  const y = latToTileY(lat, 0);
  const spanX = Math.max(1e-15, east - west);
  const spanY = Math.max(1e-15, south - north);
  return {
    u: (x - west) / spanX,
    v: (y - north) / spanY,
  };
}

export function lonToTileX(lon: number, z: number): number {
  const n = 2 ** z;
  return ((lon + 180) / 360) * n;
}

export function latToTileY(lat: number, z: number): number {
  const n = 2 ** z;
  const rad = (clampLat(lat) * Math.PI) / 180;
  return (1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2 * n;
}

export function tileXToLon(x: number, z: number): number {
  const n = 2 ** z;
  return (x / n) * 360 - 180;
}

export function tileYToLat(y: number, z: number): number {
  const n = 2 ** z;
  const rad = Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n)));
  return (rad * 180) / Math.PI;
}

export function chooseGsiAerialZoom(box: GsiLatLonBox, maxTiles = MAX_TILES): number {
  let best = ZOOM_MIN;
  for (let z = ZOOM_MIN; z <= ZOOM_MAX; z++) {
    const range = tileRangeForBox(box, z);
    const count = (range.maxX - range.minX + 1) * (range.maxY - range.minY + 1);
    if (count <= maxTiles) best = z;
    else break;
  }
  return best;
}

export function tileRangeForBox(box: GsiLatLonBox, z: number): {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
} {
  const x0 = lonToTileX(box.minLon, z);
  const x1 = lonToTileX(box.maxLon, z);
  // Tile Y increases southward.
  const y0 = latToTileY(box.maxLat, z);
  const y1 = latToTileY(box.minLat, z);
  const n = 2 ** z;
  return {
    minX: Math.max(0, Math.floor(Math.min(x0, x1))),
    maxX: Math.min(n - 1, Math.floor(Math.max(x0, x1))),
    minY: Math.max(0, Math.floor(Math.min(y0, y1))),
    maxY: Math.min(n - 1, Math.floor(Math.max(y0, y1))),
  };
}

export function gsiSeamlessphotoUrl(z: number, x: number, y: number): string {
  return GSI_SEAMLESSPHOTO_URL
    .replace('{z}', String(z))
    .replace('{x}', String(x))
    .replace('{y}', String(y));
}

/**
 * Fetch and stitch GSI aerial tiles covering `box`, then crop to the bbox.
 * Falls back by throwing — callers should keep a gray FloorComposer floor.
 */
export async function composeGsiAerialFloor(
  box: GsiLatLonBox,
  opts?: {
    signal?: AbortSignal;
    maxEdgePx?: number;
    maxTiles?: number;
    fetchImpl?: typeof fetch;
  },
): Promise<Blob> {
  if (!Number.isFinite(box.minLat) || !Number.isFinite(box.maxLat)
    || !Number.isFinite(box.minLon) || !Number.isFinite(box.maxLon)) {
    throw new Error('GSI_BAD_BBOX');
  }
  if (box.maxLat <= box.minLat || box.maxLon <= box.minLon) {
    throw new Error('GSI_BAD_BBOX');
  }

  const maxEdge = Math.max(64, opts?.maxEdgePx ?? MAX_EDGE_PX);
  const maxTiles = Math.max(1, opts?.maxTiles ?? MAX_TILES);
  const z = chooseGsiAerialZoom(box, maxTiles);
  const range = tileRangeForBox(box, z);
  const tilesX = range.maxX - range.minX + 1;
  const tilesY = range.maxY - range.minY + 1;
  if (tilesX * tilesY > maxTiles) throw new Error('GSI_TOO_MANY_TILES');

  const fetchFn = opts?.fetchImpl || fetch;
  const mosaic = document.createElement('canvas');
  mosaic.width = tilesX * TILE_PX;
  mosaic.height = tilesY * TILE_PX;
  const mctx = mosaic.getContext('2d');
  if (!mctx) throw new Error('GSI_NO_CANVAS');

  const jobs: Promise<void>[] = [];
  for (let ty = range.minY; ty <= range.maxY; ty++) {
    for (let tx = range.minX; tx <= range.maxX; tx++) {
      const url = gsiSeamlessphotoUrl(z, tx, ty);
      jobs.push((async () => {
        const res = await fetchFn(url, { signal: opts?.signal, mode: 'cors' });
        if (!res.ok) throw new Error(`GSI_TILE_${res.status}`);
        const blob = await res.blob();
        const bmp = await createImageBitmap(blob);
        try {
          mctx.drawImage(
            bmp,
            (tx - range.minX) * TILE_PX,
            (ty - range.minY) * TILE_PX,
          );
        } finally {
          bmp.close();
        }
      })());
    }
  }
  await Promise.all(jobs);

  // Crop mosaic to exact geographic bbox (fractional tile edges).
  const west = lonToTileX(box.minLon, z);
  const east = lonToTileX(box.maxLon, z);
  const north = latToTileY(box.maxLat, z);
  const south = latToTileY(box.minLat, z);
  const sx = (Math.min(west, east) - range.minX) * TILE_PX;
  const sy = (Math.min(north, south) - range.minY) * TILE_PX;
  const sw = Math.max(1, (Math.max(west, east) - Math.min(west, east)) * TILE_PX);
  const sh = Math.max(1, (Math.max(north, south) - Math.min(north, south)) * TILE_PX);

  let outW = Math.round(sw);
  let outH = Math.round(sh);
  const scale = Math.min(1, maxEdge / Math.max(outW, outH, 1));
  outW = Math.max(64, Math.round(outW * scale));
  outH = Math.max(64, Math.round(outH * scale));

  const out = document.createElement('canvas');
  out.width = outW;
  out.height = outH;
  const octx = out.getContext('2d');
  if (!octx) throw new Error('GSI_NO_CANVAS');
  octx.imageSmoothingEnabled = true;
  octx.drawImage(mosaic, sx, sy, sw, sh, 0, 0, outW, outH);

  const bin = atob(out.toDataURL('image/jpeg', 0.88).split(',')[1] || '');
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: 'image/jpeg' });
}

/**
 * GSI aerial plus true footprint polygons (not axis-aligned AABB).
 * Polygons should sit on roofs when geo alignment is correct; mismatch vs 3D boxes
 * isolates the table-placement / yaw path.
 */
export async function composeGsiAerialFloorWithFootprints(
  box: GsiLatLonBox,
  buildings: Array<LatLonBox & { ring?: { lat: number; lon: number }[] }>,
  opts?: {
    signal?: AbortSignal;
    maxEdgePx?: number;
    maxTiles?: number;
    fetchImpl?: typeof fetch;
  },
): Promise<Blob> {
  const floor = await composeGsiAerialFloor(box, opts);
  if (!buildings.length) return floor;

  const bmp = await createImageBitmap(floor);
  try {
    const canvas = document.createElement('canvas');
    canvas.width = bmp.width;
    canvas.height = bmp.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return floor;
    ctx.drawImage(bmp, 0, 0);
    ctx.strokeStyle = 'rgba(220, 40, 40, 0.95)';
    ctx.lineWidth = Math.max(1, Math.round(Math.min(canvas.width, canvas.height) / 400));
    for (const b of buildings) {
      const ring = b.ring && b.ring.length >= 3
        ? b.ring
        : [
          { lat: b.minLat, lon: b.minLon },
          { lat: b.minLat, lon: b.maxLon },
          { lat: b.maxLat, lon: b.maxLon },
          { lat: b.maxLat, lon: b.minLon },
        ];
      ctx.beginPath();
      ring.forEach((p, i) => {
        const { u, v } = latLonToGsiCropUv(p.lat, p.lon, box);
        const x = u * canvas.width;
        const y = v * canvas.height;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.closePath();
      ctx.stroke();
    }
    const bin = atob(canvas.toDataURL('image/jpeg', 0.88).split(',')[1] || '');
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type: 'image/jpeg' });
  } finally {
    bmp.close();
  }
}

function clampLat(lat: number): number {
  return Math.max(-85.05112878, Math.min(85.05112878, lat));
}
