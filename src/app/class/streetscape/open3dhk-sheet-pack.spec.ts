import { attachPackagePath } from '@udonarium/terrain-model/model-package-files';

import {
  findOpen3dhkTerrainFloor,
  listOpen3dhkBuildings,
  localizeOpen3dhkGltf,
  packLoadFromOpen3dhkSheetFiles,
  selectOpen3dhkBuildings,
} from './open3dhk-sheet-pack';

function gltfDoc(id: string, tx: number, tz: number, binName: string, extent = 5): string {
  return JSON.stringify({
    asset: { version: '2.0' },
    nodes: [{
      name: id,
      matrix: [1, 0, 0, 0, 0, 0, -1, 0, 0, 1, 0, 0, tx, 5, tz, 1],
      children: [1],
    }, { mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }],
    accessors: [{
      type: 'VEC3',
      componentType: 5126,
      count: 3,
      min: [-extent, -extent, 0],
      max: [extent, extent, 12],
    }],
    buffers: [{ uri: binName, byteLength: 12 }],
    scenes: [{ nodes: [0] }],
    scene: 0,
  });
}

function terrainDoc(id: string, tx: number, tz: number, jpg: string): string {
  return JSON.stringify({
    asset: { version: '2.0' },
    images: [{ uri: jpg }],
    nodes: [{
      name: id,
      matrix: [1, 0, 0, 0, 0, 0, -1, 0, 0, 1, 0, 0, tx, 1, tz, 1],
      children: [1],
    }, { mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }],
    accessors: [{
      type: 'VEC3',
      componentType: 5126,
      count: 3,
      min: [-100, -80, 0],
      max: [100, 80, 10],
    }],
    buffers: [{ uri: `${id}.bin`, byteLength: 12 }],
    scenes: [{ nodes: [0] }],
    scene: 0,
  });
}

/** Tiny solid PNG (red) for aerial stand-in. */
function tinyPngFile(name: string): File {
  const b64 = 'iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAYAAACNMs+9AAAAFUlEQVR42mP8z8BQz0AEYBxVSF+FABJADveWkH6aAAAAAElFTkSuQmCC';
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new File([bytes], name, { type: 'image/png' });
}

describe('open3dhk-sheet-pack', () => {
  it('localizeOpen3dhkGltf zeros HK1980 translation and reports world XZ', () => {
    const src = gltfDoc('B1', 839100, -816900, 'B1.bin');
    const out = localizeOpen3dhkGltf(src);
    expect(out.worldX).toBe(839100);
    expect(out.worldZ).toBe(-816900);
    const doc = JSON.parse(out.json);
    expect(doc.nodes[0].matrix.slice(12, 15)).toEqual([0, 0, 0]);
    expect(out.sizeMeters?.h).toBeCloseTo(12, 5);
  });

  it('selectOpen3dhkBuildings prefers near buildings with soft size bias', () => {
    const members = [
      { id: 'far-big', gltfPath: 'a', binPath: 'a', binBytes: 9e6, worldX: 0, worldZ: 0 },
      { id: 'near-mid', gltfPath: 'b', binPath: 'b', binBytes: 2e6, worldX: 100, worldZ: 100 },
      { id: 'near-big', gltfPath: 'c', binPath: 'c', binBytes: 5e6, worldX: 110, worldZ: 110 },
      { id: 'near-tiny', gltfPath: 'd', binPath: 'd', binBytes: 1e3, worldX: 105, worldZ: 105 },
    ];
    const picked = selectOpen3dhkBuildings(members, 2).map(m => m.id);
    expect(picked).toContain('near-mid');
    expect(picked).toContain('near-big');
    expect(picked).not.toContain('far-big');
  });

  it('findOpen3dhkTerrainFloor reads aerial bounds from TERRAIN(TB)', async () => {
    const id = 't100';
    const files = [
      attachPackagePath(
        new File([terrainDoc(id, 835000, -817000, `${id}_001.jpg`)], `${id}.gltf`, { type: 'model/gltf+json' }),
        `terrain(tb)/${id}/${id}.gltf`,
      ),
      attachPackagePath(tinyPngFile(`${id}_001.jpg`), `terrain(tb)/${id}/${id}_001.jpg`),
      attachPackagePath(new File([new Uint8Array(8)], `${id}.bin`), `terrain(tb)/${id}/${id}.bin`),
    ];
    const terrain = await findOpen3dhkTerrainFloor(files);
    expect(terrain).toBeTruthy();
    expect(terrain!.minX).toBeCloseTo(835000 - 100, 5);
    expect(terrain!.maxX).toBeCloseTo(835000 + 100, 5);
    // worldZ = tz - localY → [-817000-80, -817000-(-80)]
    expect(terrain!.minZ).toBeCloseTo(-817000 - 80, 5);
    expect(terrain!.maxZ).toBeCloseTo(-817000 + 80, 5);
  });

  it('packLoadFromOpen3dhkSheetFiles uses terrain aerial as floor when present', async () => {
    const bid = 'b100';
    const tid = 't100';
    const files = [
      attachPackagePath(
        new File([gltfDoc(bid, 835010, -817010, `${bid}.bin`)], `${bid}.gltf`, { type: 'model/gltf+json' }),
        `building/${bid}/${bid}.gltf`,
      ),
      attachPackagePath(new File([new Uint8Array(5000)], `${bid}.bin`), `building/${bid}/${bid}.bin`),
      attachPackagePath(
        new File([terrainDoc(tid, 835000, -817000, `${tid}_001.jpg`)], `${tid}.gltf`, { type: 'model/gltf+json' }),
        `terrain(tb)/${tid}/${tid}.gltf`,
      ),
      attachPackagePath(tinyPngFile(`${tid}_001.jpg`), `terrain(tb)/${tid}/${tid}_001.jpg`),
      attachPackagePath(new File([new Uint8Array(8)], `${tid}.bin`), `terrain(tb)/${tid}/${tid}.bin`),
    ];

    const members = await listOpen3dhkBuildings(files);
    expect(members.length).toBe(1);

    const load = await packLoadFromOpen3dhkSheetFiles(files, { sheet: '11-SW-4B', title: '彌敦道' });
    expect(load.pack.attribution).toContain('Lands Department');
    expect(load.pack.features.length).toBe(1);
    expect(load.pack.floor.path).toBe('floor.png');

    const floor = await load.openFloor();
    expect(floor.size).toBeGreaterThan(50);
    // Aerial crop should not be the tiny gray composer fallback alone — PNG from canvas of aerial.
    expect(floor.type).toMatch(/image\/png/);
  });

  it('packLoadFromOpen3dhkSheetFiles keeps facade texture sidecars for GLTF', async () => {
    const bid = 'b200';
    const gltf = JSON.stringify({
      asset: { version: '2.0' },
      images: [{ uri: `${bid}_001.jpg` }],
      nodes: [{
        name: bid,
        matrix: [1, 0, 0, 0, 0, 0, -1, 0, 0, 1, 0, 0, 835010, 5, -817010, 1],
        children: [1],
      }, { mesh: 0 }],
      meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }],
      accessors: [{
        type: 'VEC3',
        componentType: 5126,
        count: 3,
        min: [-5, -5, 0],
        max: [5, 5, 12],
      }],
      buffers: [{ uri: `${bid}.bin`, byteLength: 12 }],
      scenes: [{ nodes: [0] }],
      scene: 0,
    });
    const files = [
      attachPackagePath(new File([gltf], `${bid}.gltf`, { type: 'model/gltf+json' }), `building/${bid}/${bid}.gltf`),
      attachPackagePath(new File([new Uint8Array(5000)], `${bid}.bin`), `building/${bid}/${bid}.bin`),
      attachPackagePath(tinyPngFile(`${bid}_001.jpg`), `building/${bid}/${bid}_001.jpg`),
    ];
    const load = await packLoadFromOpen3dhkSheetFiles(files, {
      sheet: '11-SW-4B',
      format: 'GLTF',
      maxFeatures: 1,
    });
    expect(load.pack.attribution).toContain('GLTF textured');
    const featureFiles = await load.openFeature(bid);
    const paths = featureFiles.map(f => f.name || '').join(' ');
    expect(paths).toMatch(/b200_001\.jpg/i);
  });
});
