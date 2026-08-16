import { TableSelecter } from '@udonarium/table-selecter';
import { Terrain } from '@udonarium/terrain';
import { UUID } from '@udonarium/core/system/util/uuid';
import { PointerCoordinate } from 'service/pointer-device.service';

import { parseBakeCropState, serializeBakeCropState } from './bake-crop';
import { footprintDebug } from './footprint-debug';

export function newBakeGroupId(): string {
  return UUID.generateUuid();
}

export function terrainsInBakeGroup(groupId: string): Terrain[] {
  if (!groupId) return [];
  const table = TableSelecter.instance?.viewTable;
  const list = table?.terrains || [];
  return list.filter(t => t?.bakeGroupId === groupId);
}

export function bakeGroupLocalOf(terrain: Terrain): { x: number; y: number } | null {
  const state = parseBakeCropState(terrain?.bakeCropJson);
  if (!state) return null;
  if (typeof state.groupLocalX === 'number' && typeof state.groupLocalY === 'number') {
    return { x: state.groupLocalX, y: state.groupLocalY };
  }
  return null;
}

/**
 * Place bake-group parts in their modeled relative layout, centered on `center`.
 * Uses groupLocalX/Y from bakeCropJson when present; otherwise keeps current
 * relative deltas between members.
 */
export function assembleBakeGroupAt(terrains: Terrain[], center: PointerCoordinate): boolean {
  const parts = terrains.filter(t => !!t);
  if (parts.length < 2) return false;

  const locals = parts.map(t => {
    const local = bakeGroupLocalOf(t);
    if (local) return { terrain: t, lx: local.x, ly: local.y };
    return { terrain: t, lx: t.location.x, ly: t.location.y };
  });

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of locals) {
    const w = Math.max(0.1, p.terrain.width || 1) * 50;
    const d = Math.max(0.1, p.terrain.depth || 1) * 50;
    if (p.lx < minX) minX = p.lx;
    if (p.ly < minY) minY = p.ly;
    if (p.lx + w > maxX) maxX = p.lx + w;
    if (p.ly + d > maxY) maxY = p.ly + d;
  }
  const originX = center.x - (minX + maxX) / 2;
  const originY = center.y - (minY + maxY) / 2;

  footprintDebug('assembleBakeGroupAt', {
    center,
    originX: +originX.toFixed(2),
    originY: +originY.toFixed(2),
    bounds: { minX, minY, maxX, maxY },
    parts: locals.map(p => ({
      name: p.terrain.name,
      lx: +p.lx.toFixed(2),
      ly: +p.ly.toFixed(2),
      w: p.terrain.width,
      d: p.terrain.depth,
      fromJson: !!bakeGroupLocalOf(p.terrain),
      before: { x: p.terrain.location?.x, y: p.terrain.location?.y },
    })),
  });

  for (const p of locals) {
    placeTerrainAt(p.terrain, originX + p.lx, originY + p.ly, center.z);
  }

  footprintDebug('assembleBakeGroupAt after', {
    parts: locals.map(p => ({
      name: p.terrain.name,
      location: { ...p.terrain.location },
      pose: p.terrain.getPoseForView?.() ?? null,
      placements: (p.terrain.tablePlacements || '').slice(0, 180),
    })),
    ySpan: (() => {
      const ys = locals.map(p => p.terrain.location?.y ?? 0);
      return +(Math.max(...ys) - Math.min(...ys)).toFixed(2);
    })(),
  });
  return true;
}

/** Table pose for one bake-group part (whole SyncVar write + optional map placement). */
export function placeTerrainAt(terrain: Terrain, x: number, y: number, posZ: number): void {
  const hadPlacements = !!terrain.tablePlacements;
  terrain.location = { name: 'table', x, y };
  terrain.posZ = posZ;
  const tableId = TableSelecter.instance?.viewTable?.identifier;
  if (tableId) {
    terrain.addToTable(tableId, { x, y, posZ }, !hadPlacements);
  } else {
    terrain.update();
  }
  footprintDebug('placeTerrainAt', {
    name: terrain.name,
    x: +x.toFixed(2),
    y: +y.toFixed(2),
    posZ,
    tableId: tableId || '(none)',
    exclusive: !hadPlacements,
    location: { ...terrain.location },
    pose: terrain.getPoseForView?.() ?? null,
    placements: (terrain.tablePlacements || '').slice(0, 180),
  });
}

export function clearBakeGroup(terrains: Terrain[]): void {
  for (const t of terrains) {
    if (!t?.bakeGroupId) continue;
    t.bakeGroupId = '';
    const state = parseBakeCropState(t.bakeCropJson);
    if (!state) continue;
    delete state.groupLocalX;
    delete state.groupLocalY;
    t.bakeCropJson = serializeBakeCropState(state);
  }
}

const GRID = 50;

export function bakeGroupPartsOf(terrain: Terrain | null | undefined): Terrain[] {
  if (!terrain?.bakeGroupId) return terrain ? [terrain] : [];
  const parts = terrainsInBakeGroup(terrain.bakeGroupId);
  return parts.length ? parts : [terrain];
}

/** Axis-aligned bounds of parts in table px (location = min corner). */
export function bakeGroupBoundsPx(terrains: Terrain[]): {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  cx: number;
  cy: number;
} {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const t of terrains) {
    const x = t.location?.x ?? 0;
    const y = t.location?.y ?? 0;
    const w = Math.max(0.1, t.width || 1) * GRID;
    const d = Math.max(0.1, t.depth || 1) * GRID;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x + w > maxX) maxX = x + w;
    if (y + d > maxY) maxY = y + d;
  }
  return {
    minX,
    minY,
    maxX,
    maxY,
    cx: (minX + maxX) / 2,
    cy: (minY + maxY) / 2,
  };
}

function writeGroupLocal(terrain: Terrain, lx: number, ly: number): void {
  const state = parseBakeCropState(terrain.bakeCropJson);
  if (!state) return;
  state.groupLocalX = lx;
  state.groupLocalY = ly;
  terrain.bakeCropJson = serializeBakeCropState(state);
}

function refreshGroupLocalsFromPose(terrains: Terrain[]): void {
  const b = bakeGroupBoundsPx(terrains);
  for (const t of terrains) {
    writeGroupLocal(t, (t.location?.x ?? 0) - b.minX, (t.location?.y ?? 0) - b.minY);
  }
}

/**
 * Rigid rotate: orbit each part around the group center and add delta to facing.
 */
export function rotateBakeGroupBy(terrains: Terrain[], deltaDeg: number): void {
  const parts = terrains.filter(t => !!t);
  if (parts.length < 1 || !Number.isFinite(deltaDeg) || deltaDeg === 0) return;
  if (parts.length === 1) {
    const t = parts[0];
    t.rotate = ((t.rotate || 0) + deltaDeg + 720) % 360;
    if (t.rotate > 180) t.rotate -= 360;
    t.update();
    return;
  }
  const { cx, cy } = bakeGroupBoundsPx(parts);
  const rad = (deltaDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  for (const t of parts) {
    const w = Math.max(0.1, t.width || 1) * GRID;
    const d = Math.max(0.1, t.depth || 1) * GRID;
    const pcx = (t.location?.x ?? 0) + w / 2;
    const pcy = (t.location?.y ?? 0) + d / 2;
    const dx = pcx - cx;
    const dy = pcy - cy;
    const nx = cx + dx * cos - dy * sin;
    const ny = cy + dx * sin + dy * cos;
    placeTerrainAt(t, nx - w / 2, ny - d / 2, t.posZ || 0);
    let rot = ((t.rotate || 0) + deltaDeg + 720) % 360;
    if (rot > 180) rot -= 360;
    t.rotate = rot;
  }
  refreshGroupLocalsFromPose(parts);
}

/**
 * Scale footprint around an anchor (table px). Updates size, position, groupLocal.
 * Height is unchanged.
 */
export function scaleBakeGroupFrom(
  terrains: Terrain[],
  anchor: { x: number; y: number },
  scaleX: number,
  scaleY: number,
): void {
  const parts = terrains.filter(t => !!t);
  if (parts.length < 1) return;
  const sx = Math.max(0.05, scaleX);
  const sy = Math.max(0.05, scaleY);
  if (Math.abs(sx - 1) < 1e-6 && Math.abs(sy - 1) < 1e-6) return;

  for (const t of parts) {
    const w0 = Math.max(0.1, t.width || 1);
    const d0 = Math.max(0.1, t.depth || 1);
    const x0 = t.location?.x ?? 0;
    const y0 = t.location?.y ?? 0;
    const w1 = Math.max(0.1, w0 * sx);
    const d1 = Math.max(0.1, d0 * sy);
    // Min-corner relative to anchor scales; size change keeps the scaled corner.
    const x1 = anchor.x + (x0 - anchor.x) * sx;
    const y1 = anchor.y + (y0 - anchor.y) * sy;
    t.mutateAppearance(() => {
      t.width = w1;
      t.depth = d1;
    });
    placeTerrainAt(t, x1, y1, t.posZ || 0);
  }
  if (parts.length > 1) refreshGroupLocalsFromPose(parts);
}

