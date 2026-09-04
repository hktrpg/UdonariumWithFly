import { StreetscapeCapsV1 } from './caps';
import { StreetscapeFeatureV1, StreetscapePackV1 } from './pack-schema';

export type StreetscapeScale = {
  tableCellsX: number;
  tableCellsY: number;
  /** Metres per cell on table X (east). Also exposed as metersPerGrid for mesh mm scaling. */
  metersPerGridX: number;
  /** Metres per cell on table Y (south). */
  metersPerGridY: number;
  /** Alias of metersPerGridX (STL / mmPerGrid path). */
  metersPerGrid: number;
  mmPerGrid: number;
  gridPx: number;
};

/** One table cell covers this many metres (streetscape maps are halved vs 1 m/cell). */
export const STREETSCAPE_METERS_PER_CELL = 2;

/** Scale: independent metres-per-cell on X and Y so placement matches anisotropic table stretch. */
export function streetscapeScaleFromPack(
  pack: StreetscapePackV1,
  caps: StreetscapeCapsV1,
  gridPx = 50,
): StreetscapeScale {
  const grid = Math.max(1, gridPx);
  const maxCells = Math.max(1, caps.maxTableCells);
  const metersPerCell = Math.max(1, STREETSCAPE_METERS_PER_CELL);
  const derivedX = Math.max(1, Math.round(pack.extentMeters.width / metersPerCell));
  const derivedY = Math.max(1, Math.round(pack.extentMeters.depth / metersPerCell));
  const scale = Math.min(1, maxCells / Math.max(derivedX, derivedY, 1));
  const tableCellsX = Math.max(1, Math.min(maxCells, Math.round(derivedX * scale)));
  const tableCellsY = Math.max(1, Math.min(maxCells, Math.round(derivedY * scale)));
  const metersPerGridX = pack.extentMeters.width / tableCellsX;
  const metersPerGridY = pack.extentMeters.depth / tableCellsY;
  const metersPerGrid = metersPerGridX;
  // importModel treats mesh units as millimetres: grids = units / mmPerGrid.
  // meters = units * metersPerUnit ⇒ mmPerGrid = metersPerGrid / metersPerUnit.
  const mmPerGrid = metersPerGrid / Math.max(1e-9, pack.metersPerUnit);
  return {
    tableCellsX,
    tableCellsY,
    metersPerGridX,
    metersPerGridY,
    metersPerGrid,
    mmPerGrid,
    gridPx: grid,
  };
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
  const mpgX = scale.metersPerGridX || scale.metersPerGrid;
  const mpgY = scale.metersPerGridY || scale.metersPerGrid;
  return {
    x: (dx / mpgX) * scale.gridPx,
    y: (dz / mpgY) * scale.gridPx,
  };
}

export function featureDistanceToOrigin(feature: StreetscapeFeatureV1, pack: StreetscapePackV1): number {
  const dx = feature.positionMeters.x - pack.origin.x;
  const dz = feature.positionMeters.z - pack.origin.z;
  return Math.hypot(dx, dz);
}
