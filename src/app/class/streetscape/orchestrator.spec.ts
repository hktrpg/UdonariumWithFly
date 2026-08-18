import { GameTable } from '@udonarium/game-table';
import { Terrain } from '@udonarium/terrain';

import { resolveStreetscapeCaps } from './caps';
import { generateStreetscapeFromLoad } from './orchestrator';
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
        const t = { name: opts?.name || '', location: { x: position.x, y: position.y } } as Terrain;
        placed.push({ name: String(opts?.name), x: position.x });
        return { terrain: t, terrains: [t], warnings: [] };
      },
    });

    expect(result.table.name).toBe('Sample street');
    expect(result.attribution).toContain('Open3Dhk');
    expect(placed.map(p => p.name)).toEqual(['a', 'b']);
    const grid = result.table.gridSize || 50;
    expect((placed[1].x - placed[0].x) / grid).toBeCloseTo(20, 5);
    expect(result.warnings.some(w => w.startsWith('bad:'))).toBeTrue();
    expect(result.table.width).toBeGreaterThan(0);
  });
});
