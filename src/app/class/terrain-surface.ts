import { SlopeDirection, Terrain } from '@udonarium/terrain';

export type TerrainSurfaceSample = {
  terrain: Terrain;
  /** Absolute table Z in px (movable posZ). */
  posZ: number;
  /** Slope tip in terrain-local degrees (matches floorModCss). */
  localRotateXDeg: number;
  localRotateYDeg: number;
  /** Terrain yaw (degrees) for composing world tip. */
  terrainRotateDeg: number;
  /** Slope angle magnitude in degrees (0 = flat). */
  slopeDeg: number;
};

function gridOf(terrain: Terrain): number {
  return 50;
}

function footprintContains(
  terrain: Terrain,
  worldX: number,
  worldY: number,
  gridSize: number,
): { u: number; v: number } | null {
  const w = Math.max(0.001, (terrain.width || 1) * gridSize);
  const d = Math.max(0.001, (terrain.depth || 1) * gridSize);
  const cx = (terrain.location?.x ?? 0) + w / 2;
  const cy = (terrain.location?.y ?? 0) + d / 2;
  const rad = -((terrain.rotate || 0) * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const dx = worldX - cx;
  const dy = worldY - cy;
  const localX = dx * cos - dy * sin;
  const localY = dx * sin + dy * cos;
  const halfW = w / 2;
  const halfD = d / 2;
  if (localX < -halfW || localX > halfW || localY < -halfD || localY > halfD) return null;
  return {
    u: (localX + halfW) / w,
    v: (localY + halfD) / d,
  };
}

/**
 * Slope tip angle matching terrain floorModCss:
 * θ = atan(height/run), applied as rotateX/Y with mid-pivot + scale compensation.
 * Along the footprint, Z rises linearly by height*grid from the low end to the high end.
 */
export function slopeAngleRad(terrain: Terrain): number {
  if (!terrain?.isSlope) return 0;
  const dir = terrain.slopeDirection;
  const h = Math.max(0, terrain.height || 0);
  if (h <= 0) return 0;
  if (dir === SlopeDirection.LEFT || dir === SlopeDirection.RIGHT) {
    return Math.atan(h / Math.max(0.001, terrain.width || 1));
  }
  if (dir === SlopeDirection.TOP || dir === SlopeDirection.BOTTOM) {
    return Math.atan(h / Math.max(0.001, terrain.depth || 1));
  }
  return 0;
}

/**
 * Fraction 0..1 along the rise axis (0 = low end, 1 = high end) for a point in footprint UV.
 * Returns null when not a slope / unknown direction.
 */
export function slopeRiseFraction(terrain: Terrain, u: number, v: number): number | null {
  if (!terrain?.isSlope) return null;
  switch (terrain.slopeDirection) {
    case SlopeDirection.TOP:
      // CSS rotateX(+θ): south (v=1) is high, north (v=0) is low.
      return v;
    case SlopeDirection.BOTTOM:
      return 1 - v;
    case SlopeDirection.LEFT:
      // CSS rotateY(-θ): east (u=1) is high, west (u=0) is low.
      return u;
    case SlopeDirection.RIGHT:
      return 1 - u;
    default:
      return null;
  }
}

/** Local tip axes matching floorModCss (degrees). */
export function slopeLocalTipDeg(terrain: Terrain): { rotateX: number; rotateY: number; slopeDeg: number } {
  const rad = slopeAngleRad(terrain);
  const deg = (rad * 180) / Math.PI;
  if (!deg) return { rotateX: 0, rotateY: 0, slopeDeg: 0 };
  switch (terrain.slopeDirection) {
    case SlopeDirection.TOP:
      return { rotateX: deg, rotateY: 0, slopeDeg: deg };
    case SlopeDirection.BOTTOM:
      return { rotateX: -deg, rotateY: 0, slopeDeg: deg };
    case SlopeDirection.LEFT:
      return { rotateX: 0, rotateY: -deg, slopeDeg: deg };
    case SlopeDirection.RIGHT:
      return { rotateX: 0, rotateY: deg, slopeDeg: deg };
    default:
      return { rotateX: 0, rotateY: 0, slopeDeg: 0 };
  }
}

/**
 * Absolute table Z (px) of the terrain floor under (worldX, worldY), or null if outside / no floor.
 * Matches CSS mid-pivot ramp: Z = posZ + altitude*g + height*g * riseFraction (slopes),
 * or posZ + (altitude+height)*g for flat boxes with floor.
 */
export function terrainSurfacePosZPx(
  terrain: Terrain,
  worldX: number,
  worldY: number,
  gridSize: number = gridOf(terrain),
): number | null {
  if (!terrain || !terrain.hasFloor) return null;
  const uv = footprintContains(terrain, worldX, worldY, gridSize);
  if (!uv) return null;

  const g = gridSize;
  const base = (terrain.posZ || 0) + (terrain.altitude || 0) * g;
  const h = Math.max(0, terrain.height || 0) * g;

  if (!terrain.isSlope || terrain.slopeDirection === SlopeDirection.NONE || h <= 0) {
    return base + h;
  }

  const rise = slopeRiseFraction(terrain, uv.u, uv.v);
  if (rise == null) return base + h / 2;
  return base + h * rise;
}

/** Highest floor surface under a table point (stacked bridges / roofs). */
export function sampleHighestTerrainSurface(
  terrains: Terrain[],
  worldX: number,
  worldY: number,
  gridSize: number = 50,
): TerrainSurfaceSample | null {
  let best: TerrainSurfaceSample | null = null;
  for (const terrain of terrains || []) {
    if (!terrain || terrain.location?.name !== 'table') continue;
    if (!terrain.isInteract) continue;
    const posZ = terrainSurfacePosZPx(terrain, worldX, worldY, gridSize);
    if (posZ == null) continue;
    const tip = slopeLocalTipDeg(terrain);
    const sample: TerrainSurfaceSample = {
      terrain,
      posZ,
      localRotateXDeg: tip.rotateX,
      localRotateYDeg: tip.rotateY,
      terrainRotateDeg: terrain.rotate || 0,
      slopeDeg: tip.slopeDeg,
    };
    if (!best || sample.posZ >= best.posZ) best = sample;
  }
  return best;
}

/**
 * CSS transform that tips a table-flat pedestal onto the slope plane.
 * Applied in table space around the footprint center (before character yaw is fine —
 * tip is world-fixed like the bridge deck).
 */
export function slopeAlignCss(sample: TerrainSurfaceSample | null): string {
  if (!sample || sample.slopeDeg < 0.05) return '';
  const yaw = sample.terrainRotateDeg || 0;
  const rx = sample.localRotateXDeg || 0;
  const ry = sample.localRotateYDeg || 0;
  if (!rx && !ry) return '';
  // Conjugate local tip by terrain yaw so the deck matches a rotated bridge.
  return `rotateZ(${yaw}deg) rotateX(${rx}deg) rotateY(${ry}deg) rotateZ(${-yaw}deg)`;
}
