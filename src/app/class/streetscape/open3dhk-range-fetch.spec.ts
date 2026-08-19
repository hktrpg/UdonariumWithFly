import { matchOpen3dhkBuildingsByIds } from './open3dhk-building-id';
import {
  buildingFolderPathsForIds,
  clampOpen3dhkMaxFeatures,
  estimateFromCentralDirectory,
  listBuildingsFromCentralDirectory,
} from './open3dhk-range-fetch';

describe('clampOpen3dhkMaxFeatures', () => {
  it('floors to ≥1 with no upper bound (default 4)', () => {
    expect(clampOpen3dhkMaxFeatures(undefined)).toBe(4);
    expect(clampOpen3dhkMaxFeatures(0)).toBe(4);
    expect(clampOpen3dhkMaxFeatures(3)).toBe(3);
    expect(clampOpen3dhkMaxFeatures(99)).toBe(99);
  });
});

describe('listBuildingsFromCentralDirectory', () => {
  it('pairs building glTF with .bin sizes from the CD index', () => {
    const byPath = new Map([
      ['building/b1/b1.gltf', { compressedSize: 100, uncompressedSize: 200 }],
      ['building/b1/b1.bin', { compressedSize: 1000, uncompressedSize: 5000 }],
      ['building/b2/b2.gltf', { compressedSize: 80, uncompressedSize: 160 }],
      ['building/b2/b2.bin', { compressedSize: 800, uncompressedSize: 4000 }],
      ['building/orphan/orphan.gltf', { compressedSize: 10, uncompressedSize: 20 }],
      ['terrain(tb)/t1/t1.gltf', { compressedSize: 50, uncompressedSize: 100 }],
    ]);
    const list = listBuildingsFromCentralDirectory(byPath);
    expect(list.map(m => m.id).sort()).toEqual(['b1', 'b2']);
    expect(list.find(m => m.id === 'b1')?.binBytes).toBe(5000);
  });

  it('maps GLTF0 folder ids onto textured GLTF central-directory members', () => {
    const byPath = new Map([
      ['building/b352541799701063a0/b352541799701063a0.gltf', { compressedSize: 10, uncompressedSize: 20 }],
      ['building/b352541799701063a0/b352541799701063a0.bin', { compressedSize: 1000, uncompressedSize: 5000 }],
    ]);
    const list = listBuildingsFromCentralDirectory(byPath);
    const selected = matchOpen3dhkBuildingsByIds(list, ['B352541799701063C0'], 1);
    expect(selected.map(m => m.id)).toEqual(['b352541799701063a0']);
  });
});

describe('estimateFromCentralDirectory', () => {
  it('sums selected building folders plus terrain aerial bytes', () => {
    const byPath = new Map([
      ['building/b1/b1.gltf', { compressedSize: 10 }],
      ['building/b1/b1.bin', { compressedSize: 1000 }],
      ['building/b1/b1_001.jpg', { compressedSize: 9000 }],
      ['building/b2/b2.gltf', { compressedSize: 10 }],
      ['building/b2/b2.bin', { compressedSize: 100 }],
      ['terrain(tb)/t1/t1.gltf', { compressedSize: 20 }],
      ['terrain(tb)/t1/t1_001.jpg', { compressedSize: 5000 }],
    ]);
    const est = estimateFromCentralDirectory(byPath, 1);
    expect(est.selectedCount).toBe(1);
    expect(est.facadeCompressedBytes).toBe(10010);
    expect(est.floorCompressedBytes).toBe(5020);
    expect(est.totalCompressedBytes).toBe(15030);
  });
});

describe('buildingFolderPathsForIds', () => {
  it('keeps only members under selected building folders', () => {
    const paths = [
      'BUILDING/B1/B1.gltf',
      'BUILDING/B1/B1.bin',
      'BUILDING/B1/B1_001.jpg',
      'BUILDING/B2/B2.gltf',
      'TERRAIN(TB)/T1/T1.gltf',
    ];
    expect(buildingFolderPathsForIds(paths, ['b1'])).toEqual([
      'building/b1/b1.gltf',
      'building/b1/b1.bin',
      'building/b1/b1_001.jpg',
    ]);
  });
});
