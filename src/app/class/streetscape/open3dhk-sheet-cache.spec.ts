import {
  clearOpen3dhkSheetCachesForTests,
  getCachedOpen3dhkCd,
  getCachedOpen3dhkProbe,
  loadOpen3dhkCdCached,
  mergeCachedOpen3dhkProbe,
  open3dhkSheetCacheKey,
  open3dhkSheetCacheKeyFromUrl,
} from './open3dhk-sheet-cache';

describe('open3dhk-sheet-cache', () => {
  afterEach(() => clearOpen3dhkSheetCachesForTests());

  it('builds stable cache keys', () => {
    expect(open3dhkSheetCacheKey('11-SW-4B', 'GLTF0')).toBe('GLTF0:11-sw-4b');
    expect(open3dhkSheetCacheKeyFromUrl('/streetscape-open3dhk/GLTF0/11-SW-4B.zip'))
      .toBe('GLTF0:11-sw-4b');
  });

  it('dedupes concurrent CD loads', async () => {
    const key = open3dhkSheetCacheKey('11-SW-4B', 'GLTF0');
    let loads = 0;
    const p1 = loadOpen3dhkCdCached(key, async () => {
      loads++;
      await new Promise(r => setTimeout(r, 20));
      return { buildingCount: 3, buildings: [] };
    });
    const p2 = loadOpen3dhkCdCached(key, async () => {
      loads++;
      return { buildingCount: 9, buildings: [] };
    });
    const [a, b] = await Promise.all([p1, p2]);
    expect(loads).toBe(1);
    expect(a.buildingCount).toBe(3);
    expect(b.buildingCount).toBe(3);
    expect(getCachedOpen3dhkCd(key)?.buildingCount).toBe(3);
  });

  it('merges probed building positions by id', () => {
    const key = open3dhkSheetCacheKey('11-SW-4B', 'GLTF0');
    mergeCachedOpen3dhkProbe(key, { minX: 0, maxX: 10, minZ: 0, maxZ: 10 }, [{
      id: 'b1',
      gltfPath: 'building/b1/b1.gltf',
      binPath: 'building/b1/b1.bin',
      binBytes: 100,
      worldX: 1,
      worldZ: 2,
    }]);
    mergeCachedOpen3dhkProbe(key, null, [{
      id: 'b2',
      gltfPath: 'building/b2/b2.gltf',
      binPath: 'building/b2/b2.bin',
      binBytes: 200,
      worldX: 3,
      worldZ: 4,
    }]);
    const hit = getCachedOpen3dhkProbe(key);
    expect(hit?.located.map(m => m.id).sort()).toEqual(['b1', 'b2']);
    expect(hit?.terrainBox?.maxX).toBe(10);
  });
});
