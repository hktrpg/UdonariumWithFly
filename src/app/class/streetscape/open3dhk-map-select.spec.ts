import {
  buildingOverlapsTerrain,
  chooseBuildingsForSheet,
  filterBuildingsOnTerrain,
  nextBuildingProbeCount,
  padTerrainBox,
} from './open3dhk-map-select';
import { Open3dhkBuildingMember } from './open3dhk-sheet-pack';

function b(
  id: string,
  worldX: number,
  worldZ: number,
  binBytes: number,
  size = { w: 10, d: 10, h: 20 },
): Open3dhkBuildingMember {
  return {
    id,
    gltfPath: `building/${id}/${id}.gltf`,
    binPath: `building/${id}/${id}.bin`,
    binBytes,
    worldX,
    worldZ,
    sizeMeters: size,
  };
}

describe('open3dhk-map-select', () => {
  const terrain = { minX: 0, maxX: 100, minZ: 0, maxZ: 100 };

  it('keeps edge buildings that overlap terrain even if centroid is outside', () => {
    const edge = b('edge', -3, 50, 1000, { w: 20, d: 10, h: 20 });
    expect(buildingOverlapsTerrain(edge, padTerrainBox(terrain, 0))).toBeTrue();
    expect(filterBuildingsOnTerrain([edge], terrain).map(m => m.id)).toEqual(['edge']);
  });

  it('does not prefer a sparse on-map set of giants — wait, chooses on-map only', () => {
    // Two tiny on-map + huge off-map: must pick on-map (not the off-map giant).
    const onA = b('a', 40, 40, 500);
    const onB = b('b', 50, 50, 600);
    const offHuge = b('huge', 5000, 5000, 9_000_000);
    const picked = chooseBuildingsForSheet([onA, onB, offHuge], 4, terrain);
    expect(picked.map(m => m.id).sort()).toEqual(['a', 'b']);
    expect(picked.length).toBe(2);
  });

  it('fills up to maxN from many on-map buildings', () => {
    const many = Array.from({ length: 12 }, (_, i) => b(`m${i}`, 10 + i * 5, 20, 1000 + i * 10));
    const picked = chooseBuildingsForSheet(many, 4, terrain);
    expect(picked.length).toBe(4);
  });

  it('asks for more glTF probes while on-map count is short', () => {
    expect(nextBuildingProbeCount(4, 0, 100)).toBe(6);
    expect(nextBuildingProbeCount(4, 90, 100)).toBe(6);
    expect(nextBuildingProbeCount(4, 100, 100)).toBe(0);
    expect(nextBuildingProbeCount(20, 0, 100)).toBe(12);
    expect(nextBuildingProbeCount(Number.MAX_SAFE_INTEGER, 0, 500)).toBe(12);
  });
});
