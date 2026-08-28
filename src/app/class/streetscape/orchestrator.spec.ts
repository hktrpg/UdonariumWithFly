import { ImageStorage } from '@udonarium/core/file-storage/image-storage';
import { GameTable } from '@udonarium/game-table';
import { Terrain } from '@udonarium/terrain';

import { resolveStreetscapeCaps } from './caps';
import {
  appendStreetscapeModelsToTable,
  generateStreetscapeFromLoad,
  resolveStreetscapeFloorBlob,
  streetscapeTerrainNameMatches,
} from './orchestrator';
import { StreetscapePackV1 } from './pack-schema';
import { StreetscapePackLoad } from './source';

const pack: StreetscapePackV1 = {
  version: 1,
  id: 'n',
  title: 'Sample street',
  attribution: 'LandsD / Open3Dhk',
  metersPerUnit: 1,
  origin: { x: 0, z: 0 },
  extentMeters: { width: 80, depth: 40 },
  floor: { path: 'floor.png' },
  features: [
    { id: 'a', kind: 'building', path: 'a.stl', positionMeters: { x: 0, z: 0 }, sizeMeters: { w: 10, d: 10, h: 12 } },
    { id: 'b', kind: 'building', path: 'b.stl', positionMeters: { x: 20, z: 0 }, sizeMeters: { w: 10, d: 10, h: 12 } },
    { id: 'bad', kind: 'building', path: 'missing.stl', positionMeters: { x: 40, z: 0 } },
  ],
};

describe('streetscapeTerrainNameMatches', () => {
  it('matches exact ids and Open3Dhk GLTF0↔GLTF product letters', () => {
    expect(streetscapeTerrainNameMatches('b1', 'b1')).toBe(true);
    expect(streetscapeTerrainNameMatches('B352541799701063C0', 'b352541799701063a0')).toBe(true);
    expect(streetscapeTerrainNameMatches('b391661694001063c1', 'b391661694001063a1')).toBe(true);
    expect(streetscapeTerrainNameMatches('b352541799701063c0', 'b352541799701063a1')).toBe(false);
    expect(streetscapeTerrainNameMatches('b1', 'b2')).toBe(false);
  });
});

describe('generateStreetscapeFromLoad', () => {
  it('places two buildings with world spacing and skips a failed feature', async () => {
    const placed: { name: string; x: number }[] = [];
    const load: StreetscapePackLoad = {
      pack,
      openFeature: async (id) => {
        if (id === 'bad') throw new Error('MODEL_EMPTY');
        return [new File([new Uint8Array([1])], `${id}.stl`)];
      },
      openFloor: async () => new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' }),
    };

    const result = await generateStreetscapeFromLoad(load, {
      caps: resolveStreetscapeCaps(),
      addFloorImage: async () => 'floor-id',
      importModel: async (files, position, opts) => {
        const table = opts?.parentTable as GameTable;
        expect(table).toBeTruthy();
        expect(opts?.locked).toBeTrue();
        expect(opts?.fitGrid).toBeFalse();
        expect(opts?.metersPerGrid).toBeGreaterThan(0);
        const t = { name: opts?.name || '', location: { x: position.x, y: position.y } } as Terrain;
        placed.push({ name: String(opts?.name), x: position.x });
        return { terrain: t, terrains: [t], warnings: [] };
      },
    });

    expect(result.table.name).toBe('Sample street');
    expect(result.attribution).toContain('Open3Dhk');
    expect(result.table.mapCredit).toBe('landsd-open3dhk');
    expect(result.table.mapAttribution).toContain('Open3Dhk');
    expect(placed.map(p => p.name)).toEqual(['a', 'b']);
    const grid = result.table.gridSize || 50;
    expect((placed[1].x - placed[0].x) / grid).toBeCloseTo(20, 5);
    expect(result.warnings.some(w => w.startsWith('bad:'))).toBeTrue();
    expect(result.table.width).toBeGreaterThan(0);
  });

  it('destroys the new table when generation is aborted', async () => {
    const load: StreetscapePackLoad = {
      pack,
      openFeature: async () => {
        const err = new Error('STREETSCAPE_CANCELLED');
        err.name = 'AbortError';
        throw err;
      },
      openFloor: async () => new Blob([new Uint8Array([1])], { type: 'image/png' }),
    };
    await expectAsync(generateStreetscapeFromLoad(load, {
      caps: resolveStreetscapeCaps(),
      addFloorImage: async () => 'floor-id',
      importModel: async () => { throw new Error('unused'); },
    })).toBeRejected();
  });
});

describe('resolveStreetscapeFloorBlob', () => {
  async function makeSolidPng(w: number, h: number): Promise<Blob> {
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('NO_CANVAS');
    ctx.fillStyle = '#b4aa9c';
    ctx.fillRect(0, 0, w, h);
    return new Promise((resolve, reject) => {
      canvas.toBlob(blob => (blob ? resolve(blob) : reject(new Error('PNG'))), 'image/png');
    });
  }

  it('prefers the live table floor over a tiny pack placeholder', async () => {
    const table = new GameTable();
    table.initialize();
    const floorImage = await ImageStorage.instance.addAsync(await makeSolidPng(64, 64));
    table.imageIdentifier = floorImage.identifier;

    const tiny = new Blob([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], { type: 'image/png' });
    const resolved = await resolveStreetscapeFloorBlob(table, {
      pack: pack,
      openFloor: async () => tiny,
      openFeature: async () => [],
    });

    expect(resolved).toBe(floorImage.blob);
    expect(resolved!.size).toBeGreaterThan(512);
    table.destroy();
  });
});

describe('appendStreetscapeModelsToTable', () => {
  async function makeSolidPng(w: number, h: number, rgb: [number, number, number]): Promise<Blob> {
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('NO_CANVAS');
    ctx.fillStyle = `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
    ctx.fillRect(0, 0, w, h);
    return new Promise((resolve, reject) => {
      canvas.toBlob(blob => (blob ? resolve(blob) : reject(new Error('PNG'))), 'image/png');
    });
  }

  it('passes aerial tint to glTF imports when appending onto an existing table', async () => {
    const table = new GameTable();
    table.name = 'Existing';
    table.initialize();

    const floorBlob = await makeSolidPng(64, 64, [180, 170, 160]);
    const floorImage = await ImageStorage.instance.addAsync(floorBlob);
    table.imageIdentifier = floorImage.identifier;

    const appendPack: StreetscapePackV1 = {
      ...pack,
      features: [
        { id: 'c', kind: 'building', path: 'building/c/c.gltf', positionMeters: { x: 40, z: 0 }, sizeMeters: { w: 10, d: 10, h: 12 } },
      ],
    };
    const tints: ({ r: number; g: number; b: number } | undefined)[] = [];
    const load: StreetscapePackLoad = {
      pack: appendPack,
      openFeature: async () => [new File(['{}'], 'c.gltf', { type: 'model/gltf+json' })],
      openFloor: async () => new Blob([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], { type: 'image/png' }),
    };

    await appendStreetscapeModelsToTable(table, load, {
      caps: resolveStreetscapeCaps(),
      importModel: async (_files, _position, opts) => {
        tints.push(opts?.colorTint);
        const t = { name: opts?.name || '', location: { x: 0, y: 0 } } as Terrain;
        return { terrain: t, terrains: [t], warnings: [] };
      },
    });

    expect(tints.length).toBe(1);
    expect(tints[0]).toEqual(jasmine.objectContaining({
      r: jasmine.any(Number),
      g: jasmine.any(Number),
      b: jasmine.any(Number),
    }));
    table.destroy();
  });
});
