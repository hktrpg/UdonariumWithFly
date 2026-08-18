import { StreetscapeCapsV1 } from './caps';
import { StreetscapeFeatureV1, StreetscapePackV1 } from './pack-schema';

export type StreetscapeScale = {
  tableCellsX: number;
  tableCellsY: number;
  metersPerGrid: number;
  mmPerGrid: number;
  gridPx: number;
};

/** Single scale formula: metersPerGrid = extent.width / tableCellsX. */
export function streetscapeScaleFromPack(
  pack: StreetscapePackV1,
  caps: StreetscapeCapsV1,
  gridPx = 50,
): StreetscapeScale {
  const grid = Math.max(1, gridPx);
  const maxCells = Math.max(1, caps.maxTableCells);
  const derivedX = Math.max(1, Math.round(pack.extentMeters.width));
  const derivedY = Math.max(1, Math.round(pack.extentMeters.depth));
  const scale = Math.min(1, maxCells / Math.max(derivedX, derivedY, 1));
  const tableCellsX = Math.max(1, Math.min(maxCells, Math.round(derivedX * scale)));
  const tableCellsY = Math.max(1, Math.min(maxCells, Math.round(derivedY * scale)));
  const metersPerGrid = pack.extentMeters.width / tableCellsX;
  // importModel treats mesh units as millimetres: grids = units / mmPerGrid.
  // meters = units * metersPerUnit ⇒ mmPerGrid = metersPerGrid / metersPerUnit.
  const mmPerGrid = metersPerGrid / Math.max(1e-9, pack.metersPerUnit);
  return { tableCellsX, tableCellsY, metersPerGrid, mmPerGrid, gridPx: grid };
}

/** Feature center in table pixels (positionMeters is min-corner when sizeMeters is set). */
export function featureCenterTablePx(
  feature: StreetscapeFeatureV1,
  pack: StreetscapePackV1,
  scale: StreetscapeScale,
): { x: number; y: number } {
  let dx = feature.positionMeters.x - pack.origin.x;
  let dz = feature.positionMeters.z - pack.origin.z;
  if (feature.sizeMeters) {
    dx += feature.sizeMeters.w / 2;
    dz += feature.sizeMeters.d / 2;
  }
  return {
    x: (dx / scale.metersPerGrid) * scale.gridPx,
    y: (dz / scale.metersPerGrid) * scale.gridPx,
  };
}

export function featureDistanceToOrigin(feature: StreetscapeFeatureV1, pack: StreetscapePackV1): number {
  const dx = feature.positionMeters.x - pack.origin.x;
  const dz = feature.positionMeters.z - pack.origin.z;
  return Math.hypot(dx, dz);
}
