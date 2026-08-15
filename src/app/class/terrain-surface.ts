import { MathUtil } from './core/system/util/math-util';
import { TableSelecter } from './table-selecter';
import { SlopeDirection, Terrain } from './terrain';

export const TERRAIN_GRID_SIZE = 50;
/** Soft floor for thin signs / bridges (settings + sampling). */
export const TERRAIN_SIZE_MIN = 0.1;
export const SLOPE_DEG_MIN = 1;
export const SLOPE_DEG_MAX = 45;

export type TerrainFaceName =
  | 'floor'
  | 'underside'
  | 'wall'
  | 'wallTop'
  | 'wallBottom'
  | 'wallLeft'
  | 'wallRight';

export interface TerrainSurfaceSample {
  terrain: Terrain;
  /** Surface height above table in grid cells (maps to posZ / gridSize). */
  altitude: number;
  /** Absolute incline magnitude in degrees. */
  inclineDeg: number;
  /** Local rotateX before terrain yaw (matches floorModCss sign). */
  pitchXDeg: number;
  /** Local rotateY before terrain yaw. */
  pitchYDeg: number;
}

/** Run length (grid) along the slope axis. */
export function slopeRun(terrain: Terrain): number {
  const dir = effectiveSlopeDirection(terrain);
  if (dir === SlopeDirection.LEFT || dir === SlopeDirection.RIGHT) {
    return Math.max(TERRAIN_SIZE_MIN, MathUtil.clampMin(terrain.width, 0));
  }
  return Math.max(TERRAIN_SIZE_MIN, MathUtil.clampMin(terrain.depth, 0));
}

export function effectiveSlopeDirection(terrain: Terrain): SlopeDirection {
  if (!terrain?.isSlope) return SlopeDirection.NONE;
  if (terrain.slopeDirection === SlopeDirection.NONE) return SlopeDirection.BOTTOM;
  return terrain.slopeDirection;
}

/** Radians of incline from height / run (same as terrain floor CSS). */
export function slopeRadians(terrain: Terrain): number {
  if (!terrain?.isSlope) return 0;
  const rise = MathUtil.clampMin(terrain.height, 0);
  const run = slopeRun(terrain);
  if (rise <= 0 || run <= 0) return 0;
  return Math.atan(rise / run);
}

export function slopeDegrees(terrain: Terrain): number {
  return MathUtil.degrees(slopeRadians(terrain));
}

/**
 * Set incline by rewriting height = tan(deg) * run.
 * Keeps existing slope direction; enables isSlope when deg > 0.
 */
export function setSlopeDegrees(terrain: Terrain, degrees: number): void {
  if (!terrain) return;
  const clamped = Math.min(SLOPE_DEG_MAX, Math.max(0, degrees));
  terrain.mutateAppearance(() => {
    if (clamped < SLOPE_DEG_MIN) {
      terrain.isSlope = false;
      terrain.slopeDirection = SlopeDirection.NONE;
      return;
    }
    if (!terrain.isSlope || terrain.slopeDirection === SlopeDirection.NONE) {
      terrain.isSlope = true;
      if (terrain.slopeDirection === SlopeDirection.NONE) {
        terrain.slopeDirection = SlopeDirection.BOTTOM;
      }
    }
    const run = slopeRun(terrain);
    const rad = MathUtil.radians(clamped);
    terrain.height = Math.max(TERRAIN_SIZE_MIN, Math.tan(rad) * run);
  });
}

/** CSS fragment for floor tilt (shared with TerrainComponent.floorModCss). */
export function floorModCss(terrain: Terrain): string {
  const dir = effectiveSlopeDirection(terrain);
  if (dir === SlopeDirection.NONE) return '';
  const tmp = slopeRadians(terrain);
  if (tmp <= 0) return '';
  const scale = 1 / Math.cos(tmp);
  switch (dir) {
    case SlopeDirection.TOP:
      return ` rotateX(${tmp}rad) scaleY(${scale})`;
    case SlopeDirection.BOTTOM:
      return ` rotateX(${-tmp}rad) scaleY(${scale})`;
    case SlopeDirection.LEFT:
      return ` rotateY(${-tmp}rad) scaleX(${scale})`;
    case SlopeDirection.RIGHT:
      return ` rotateY(${tmp}rad) scaleX(${scale})`;
    default:
      return '';
  }
}

/** CSS that orients a rider to the sampled slope (does not touch SyncVar roll). */
export function surfaceAlignCss(sample: TerrainSurfaceSample | null, terrainRotateDeg: number = 0): string {
  if (!sample || sample.inclineDeg <= 0) return '';
  const rot = terrainRotateDeg || 0;
  return `rotateZ(${rot}deg) rotateX(${sample.pitchXDeg}deg) rotateY(${sample.pitchYDeg}deg) rotateZ(${-rot}deg)`;
}

export function terrainsOnViewTable(): Terrain[] {
  const table = TableSelecter.instance?.viewTable;
  return table?.terrains ?? [];
}

/**
 * Sample walkable isSlope floor under a table-space point (pixels).
 * Flat roofs / signs (non-slope) are ignored so 1A only affects true inclines.
 */
export function sampleTerrainSurface(
  tableX: number,
  tableY: number,
  terrains: Terrain[] = terrainsOnViewTable(),
  gridSize: number = TERRAIN_GRID_SIZE,
): TerrainSurfaceSample | null {
  if (TableSelecter.instance?.viewTable?.is2DMode) return null;
  let best: TerrainSurfaceSample | null = null;

  for (const terrain of terrains) {
    if (!terrain?.isSlope || !terrain.hasFloor) continue;
    const local = toTerrainLocal(terrain, tableX, tableY, gridSize);
    if (!local) continue;

    const dir = effectiveSlopeDirection(terrain);
    const t = heightFraction(dir, local.u, local.v);
    const rise = MathUtil.clampMin(terrain.height, 0);
    const altitude = terrain.altitude + t * rise;
    const incline = slopeDegrees(terrain);
    let pitchXDeg = 0;
    let pitchYDeg = 0;
    switch (dir) {
      case SlopeDirection.TOP: pitchXDeg = incline; break;
      case SlopeDirection.BOTTOM: pitchXDeg = -incline; break;
      case SlopeDirection.LEFT: pitchYDeg = -incline; break;
      case SlopeDirection.RIGHT: pitchYDeg = incline; break;
    }

    const sample: TerrainSurfaceSample = {
      terrain,
      altitude,
      inclineDeg: incline,
      pitchXDeg,
      pitchYDeg,
    };
    if (!best || sample.altitude >= best.altitude) best = sample;
  }
  return best;
}

export function sampleSurfacePosZ(
  tableX: number,
  tableY: number,
  terrains?: Terrain[],
  gridSize: number = TERRAIN_GRID_SIZE,
): number | null {
  const sample = sampleTerrainSurface(tableX, tableY, terrains, gridSize);
  if (!sample) return null;
  return sample.altitude * gridSize;
}

/** Characters (and token copies) auto-follow isSlope surfaces (1A). */
export function shouldFollowSlope(object: { aliasName?: string } | null | undefined): boolean {
  const a = object?.aliasName;
  return a === 'character' || a === 'character-token';
}

/** Apply slope posZ when the object center sits on an isSlope floor. */
export function applySlopePosZToObject(
  object: { location: { x: number; y: number }; posZ: number; size?: number; aliasName?: string },
  gridSize: number = TERRAIN_GRID_SIZE,
): boolean {
  if (!shouldFollowSlope(object)) return false;
  const size = typeof object.size === 'number' ? object.size : 1;
  const half = (size * gridSize) / 2;
  const cx = object.location.x + half;
  const cy = object.location.y + half;
  const z = sampleSurfacePosZ(cx, cy, undefined, gridSize);
  if (z == null) return false;
  if (Math.abs(object.posZ - z) < 0.05) return false;
  object.posZ = z;
  return true;
}

/** Movable drag/nudge: set posZ from slope under the footprint center. */
export function refineSlopePosZ(
  object: { aliasName?: string } | null | undefined,
  posX: number,
  posY: number,
  widthPx: number,
  heightPx: number,
  pickedZ: number,
  gridSize: number = TERRAIN_GRID_SIZE,
): number {
  if (!shouldFollowSlope(object)) return pickedZ;
  if (TableSelecter.instance?.viewTable?.is2DMode) return pickedZ;
  const cx = posX + widthPx / 2;
  const cy = posY + heightPx / 2;
  const terrains = terrainsOnViewTable();
  const z = sampleSurfacePosZ(cx, cy, terrains, gridSize);
  if (z != null) return z;
  return pickedZ;
}

/**
 * Keyboard / path: follow slope height when on an incline.
 * When leaving all terrain floors, drop to the table (posZ 0).
 * When over a non-slope floor (rooftop), keep current posZ.
 */
export function applySlopeFollowToMovablePose(
  object: { aliasName?: string } | null | undefined,
  posX: number,
  posY: number,
  widthPx: number,
  heightPx: number,
  currentPosZ: number,
  gridSize: number = TERRAIN_GRID_SIZE,
): number {
  if (!shouldFollowSlope(object)) return currentPosZ;
  if (TableSelecter.instance?.viewTable?.is2DMode) return currentPosZ;
  const cx = posX + widthPx / 2;
  const cy = posY + heightPx / 2;
  const terrains = terrainsOnViewTable();
  const slopeZ = sampleSurfacePosZ(cx, cy, terrains, gridSize);
  if (slopeZ != null) return slopeZ;
  if (!isOverAnyFloor(cx, cy, terrains, gridSize)) return 0;
  return currentPosZ;
}

function isOverAnyFloor(
  tableX: number,
  tableY: number,
  terrains: Terrain[],
  gridSize: number,
): boolean {
  for (const terrain of terrains) {
    if (!terrain?.hasFloor) continue;
    // Thin sign boards are not walkable roofs.
    const w = MathUtil.clampMin(terrain.width, 0);
    const d = MathUtil.clampMin(terrain.depth, 0);
    if (w < 0.45 || d < 0.45) continue;
    if (toTerrainLocal(terrain, tableX, tableY, gridSize)) return true;
  }
  return false;
}

function heightFraction(dir: SlopeDirection, u: number, v: number): number {
  switch (dir) {
    case SlopeDirection.TOP: return 1 - v;
    case SlopeDirection.BOTTOM: return v;
    case SlopeDirection.LEFT: return 1 - u;
    case SlopeDirection.RIGHT: return u;
    default: return 0;
  }
}

/** Map table pixels into terrain footprint u,v in [0,1] (null if outside). */
function toTerrainLocal(
  terrain: Terrain,
  tableX: number,
  tableY: number,
  gridSize: number,
): { u: number; v: number } | null {
  const w = Math.max(TERRAIN_SIZE_MIN, MathUtil.clampMin(terrain.width, 0)) * gridSize;
  const d = Math.max(TERRAIN_SIZE_MIN, MathUtil.clampMin(terrain.depth, 0)) * gridSize;
  if (w <= 0 || d <= 0) return null;

  const cx = terrain.location.x + w / 2;
  const cy = terrain.location.y + d / 2;
  let dx = tableX - cx;
  let dy = tableY - cy;

  const rot = ((terrain.rotate % 360) + 360) % 360;
  if (rot !== 0) {
    const rad = MathUtil.radians(-rot);
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const rx = dx * cos - dy * sin;
    const ry = dx * sin + dy * cos;
    dx = rx;
    dy = ry;
  }

  const localX = dx + w / 2;
  const localY = dy + d / 2;
  const eps = 0.5;
  if (localX < -eps || localY < -eps || localX > w + eps || localY > d + eps) return null;

  return {
    u: Math.min(1, Math.max(0, localX / w)),
    v: Math.min(1, Math.max(0, localY / d)),
  };
}
