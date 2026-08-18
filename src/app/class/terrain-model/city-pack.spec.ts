import { attachPackagePath } from './model-package-files';
import {
  buildingsHaveWorldSpread,
  buildingTableCenter,
  cityPackErrorI18nKey,
  cityPackShouldInteract,
  cityPackTableLayout,
  dropLooksLikeCityPack,
  findCityPackBackgroundImage,
  findCityPackMapImage,
  groupCityPackBuildings,
  mergeAabbs,
} from './city-pack';
import { MeshAabb } from './mesh-ir';

function fileAt(path: string, body = 'x'): File {
  const base = path.replace(/^.*[\\/]/, '') || 'file';
  return attachPackagePath(new File([body], base, { type: 'application/octet-stream' }), path);
}

function box(min: [number, number, number], max: [number, number, number]): MeshAabb {
  return { min, max };
}

describe('groupCityPackBuildings', () => {
  it('makes one group per folder and shares sidecars', () => {
    const files = [
      fileAt('11-se-21a/b1/b1.gltf'),
      fileAt('11-se-21a/b1/textures/wall.png'),
      fileAt('11-se-21a/b2/b2.glb'),
    ];
    const groups = groupCityPackBuildings(files);
    expect(groups.length).toBe(2);
    expect(groups.map(g => g.name)).toEqual(['b1', 'b2']);
    expect(groups[0].files.some(f => f.name === 'wall.png')).toBeTrue();
    expect(groups[1].files.some(f => f.name === 'wall.png')).toBeTrue();
  });

  it('prefers glb over gltf with the same basename', () => {
    const files = [
      fileAt('house/house.gltf'),
      fileAt('house/house.glb'),
    ];
    const groups = groupCityPackBuildings(files);
    expect(groups.length).toBe(1);
    expect(groups[0].primary.name).toBe('house.glb');
  });
});

describe('dropLooksLikeCityPack', () => {
  it('is true for two primaries', () => {
    expect(dropLooksLikeCityPack([
      fileAt('a.glb'),
      fileAt('b.glb'),
    ])).toBeTrue();
  });

  it('is true for one primary plus map.png', () => {
    expect(dropLooksLikeCityPack([
      fileAt('tower.glb'),
      fileAt('map.png'),
    ])).toBeTrue();
  });

  it('is true for Open3Dhk-ish sheet names', () => {
    expect(dropLooksLikeCityPack([
      fileAt('11-SE-21A/building.gltf'),
    ])).toBeTrue();
  });

  it('is false for a single untitled model', () => {
    expect(dropLooksLikeCityPack([fileAt('mini.stl')])).toBeFalse();
  });
});

describe('city pack overlay images', () => {
  it('finds map.png and does not treat it as a building', () => {
    const files = [
      fileAt('block/a.glb'),
      fileAt('map.png'),
      fileAt('background.jpg'),
    ];
    expect(findCityPackMapImage(files)?.name).toBe('map.png');
    expect(findCityPackBackgroundImage(files)?.name).toBe('background.jpg');
    expect(groupCityPackBuildings(files).every(g => !g.files.some(f => f.name === 'map.png'))).toBeTrue();
  });
});

describe('shared city-pack scale', () => {
  it('keeps 20m buildings 30m apart at 1 grid per meter on a 50×50 table', () => {
    const a = box([0, 0, 0], [20, 10, 20]);
    const b = box([30, 0, 0], [50, 10, 20]);
    const union = mergeAabbs([a, b]);
    expect(union.max[0] - union.min[0]).toBe(50);
    const layout = cityPackTableLayout(union, 50, 50);
    expect(layout.gridPerWorld).toBeCloseTo(1, 5);
    const ca = buildingTableCenter(a, union, layout);
    const cb = buildingTableCenter(b, union, layout);
    expect((cb.x - ca.x) / 50).toBeCloseTo(30, 5);
  });

  it('detects stacked local-origin models', () => {
    const a = box([0, 0, 0], [20, 10, 12]);
    const b = box([0.2, 0, 0.1], [18, 8, 11]);
    expect(buildingsHaveWorldSpread([a, b])).toBeFalse();
    const c = box([80, 0, 0], [100, 10, 20]);
    expect(buildingsHaveWorldSpread([a, c])).toBeTrue();
  });
});

describe('cityPackShouldInteract', () => {
  it('turns off walk for flat signs', () => {
    expect(cityPackShouldInteract(4, 0.2, 0.2)).toBeFalse();
    expect(cityPackShouldInteract(4, 4, 8)).toBeTrue();
  });
});

describe('cityPackErrorI18nKey', () => {
  it('maps 3D Tiles and photogrammetry codes', () => {
    expect(cityPackErrorI18nKey(new Error('CITY_PACK_3D_TILES'))).toBe('modelImport.error.cityPackTiles');
    expect(cityPackErrorI18nKey(new Error('MODEL_3D_TILES'))).toBe('modelImport.error.cityPackTiles');
    expect(cityPackErrorI18nKey(new Error('CITY_PACK_PHOTOGRAMMETRY'))).toBe('modelImport.error.cityPackPhotogrammetry');
    expect(cityPackErrorI18nKey(new Error('MODEL_EMPTY'))).toBe('');
  });
});
