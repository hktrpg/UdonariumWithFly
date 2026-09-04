import { StreetscapeFeatureV1, StreetscapePackV1 } from './pack-schema';
import { StreetscapeScale } from './placement';

export type FloorComposeOptions = {
  pavementCssColor?: string;
  maxEdgePx?: number;
};

/** Fallback top-down: pavement fill + feature footprints. Used when pack.floor fails. */
export function composeStreetscapeFloor(
  pack: StreetscapePackV1,
  scale: StreetscapeScale,
  features: StreetscapeFeatureV1[],
  opts: FloorComposeOptions = {},
): Blob {
  const maxEdge = Math.max(64, opts.maxEdgePx ?? 2048);
  const cellsX = Math.max(1, scale.tableCellsX);
  const cellsY = Math.max(1, scale.tableCellsY);
  const aspect = cellsX / cellsY;
  let w = maxEdge;
  let h = Math.round(maxEdge / aspect);
  if (h > maxEdge) {
    h = maxEdge;
    w = Math.round(maxEdge * aspect);
  }
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(64, w);
  canvas.height = Math.max(64, h);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('STREETSCAPE_NO_FLOOR');
  ctx.fillStyle = opts.pavementCssColor || '#6b6b6b';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#8a8a8a';
  const pxPerMeterX = canvas.width / pack.extentMeters.width;
  const pxPerMeterZ = canvas.height / pack.extentMeters.depth;
  for (const feature of features) {
    const size = feature.sizeMeters || { w: 8, d: 8, h: 12 };
    const x = (feature.positionMeters.x - pack.origin.x) * pxPerMeterX;
    const z = (feature.positionMeters.z - pack.origin.z) * pxPerMeterZ;
    ctx.fillRect(x, z, size.w * pxPerMeterX, size.d * pxPerMeterZ);
  }
  const bin = atob(canvas.toDataURL('image/png').split(',')[1] || '');
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: 'image/png' });
}
