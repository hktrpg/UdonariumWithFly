import { Open3dhkBuildingMember, selectOpen3dhkBuildings } from './open3dhk-sheet-pack';

export type Open3dhkTerrainBox = {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
};

/** Expand sheet terrain slightly so edge buildings are not dropped. */
export function padTerrainBox(box: Open3dhkTerrainBox, frac = 0.08): Open3dhkTerrainBox {
  const dx = Math.max(2, (box.maxX - box.minX) * frac);
  const dz = Math.max(2, (box.maxZ - box.minZ) * frac);
  return {
    minX: box.minX - dx,
    maxX: box.maxX + dx,
    minZ: box.minZ - dz,
    maxZ: box.maxZ + dz,
  };
}

/**
 * True when the building footprint overlaps the terrain box (not only the centroid).
 * Open3Dhk selection used to keep a sparse in-terrain set of 2–3 large towers
 * and stop — use overlap + keep probing until maxN on-map.
 */
export function buildingOverlapsTerrain(
  m: Open3dhkBuildingMember,
  box: Open3dhkTerrainBox,
): boolean {
  const hw = Math.max(1, (m.sizeMeters?.w ?? 8) * 0.5);
  const hd = Math.max(1, (m.sizeMeters?.d ?? 8) * 0.5);
  const minX = m.worldX - hw;
  const maxX = m.worldX + hw;
  const minZ = m.worldZ - hd;
  const maxZ = m.worldZ + hd;
  return !(maxX < box.minX || minX > box.maxX || maxZ < box.minZ || minZ > box.maxZ);
}

export function filterBuildingsOnTerrain(
  members: Open3dhkBuildingMember[],
  box: Open3dhkTerrainBox | null,
): Open3dhkBuildingMember[] {
  if (!box) return members.slice();
  const padded = padTerrainBox(box);
  return members.filter(m => buildingOverlapsTerrain(m, padded));
}

/**
 * Prefer on-map buildings. If the on-map pool is non-empty, never fall back to
 * off-map giants (that was discarding map coverage for 1–2 huge remote meshes).
 */
export function chooseBuildingsForSheet(
  located: Open3dhkBuildingMember[],
  maxN: number,
  terrain: Open3dhkTerrainBox | null,
): Open3dhkBuildingMember[] {
  const onMap = filterBuildingsOnTerrain(located, terrain);
  const pool = onMap.length ? onMap : located;
  return selectOpen3dhkBuildings(pool, maxN);
}

/**
 * Peek a small batch of glTFs until on-map count reaches maxN.
 * Cap at 12: a large maxN (or MAX_SAFE_INTEGER) used to request the whole
 * sheet in one probe storm (3 Range GETs × hundreds of glTFs).
 */
export function nextBuildingProbeCount(
  maxN: number,
  alreadyProbed: number,
  totalBuildings: number,
): number {
  if (alreadyProbed >= totalBuildings) return 0;
  const want = Math.min(12, Math.max(maxN, 6));
  return Math.min(want, totalBuildings - alreadyProbed);
}
