import {
  assembleBakeGroupAt,
  clearBakeGroup,
  rotateBakeGroupBy,
  scaleBakeGroupFrom,
} from './bake-group';
import { serializeBakeCropState } from './bake-crop';
import { Terrain } from '@udonarium/terrain';

function stubTerrain(opts: {
  groupId: string;
  localX: number;
  localY: number;
  width?: number;
  depth?: number;
  x?: number;
  y?: number;
}): Terrain {
  const t = {
    bakeGroupId: opts.groupId,
    width: opts.width ?? 2,
    depth: opts.depth ?? 2,
    rotate: 0,
    location: { name: 'table', x: opts.x ?? 0, y: opts.y ?? 0 },
    posZ: 0,
    tablePlacements: '',
    bakeCropJson: serializeBakeCropState({
      sources: {},
      faces: {},
      fullWidth: opts.width ?? 2,
      fullDepth: opts.depth ?? 2,
      fullHeight: 1,
      anchorX: 0,
      anchorY: 0,
      groupLocalX: opts.localX,
      groupLocalY: opts.localY,
    }),
    update() { /* no-op */ },
    addToTable() { /* no-op in unit stub */ },
    mutateAppearance(fn: () => void) { fn(); },
  };
  return t as unknown as Terrain;
}

describe('bake-group', () => {
  it('assembles parts using group locals around a center', () => {
    const a = stubTerrain({ groupId: 'g1', localX: 0, localY: 0, width: 2, depth: 2 });
    const b = stubTerrain({ groupId: 'g1', localX: 200, localY: 0, width: 2, depth: 2 });
    assembleBakeGroupAt([a, b], { x: 500, y: 400, z: 0 });
    // Combined width 200+100=300 → originX = 500 - 150 = 350
    expect(a.location.x).toBe(350);
    expect(b.location.x).toBe(550);
    expect(a.location.y).toBe(b.location.y);
  });

  it('keeps different groupLocalY so U wings are not 一字排', () => {
    const bar = stubTerrain({ groupId: 'g1', localX: 0, localY: 0, width: 8, depth: 3 });
    const wing = stubTerrain({ groupId: 'g1', localX: 0, localY: 200, width: 2, depth: 4 });
    assembleBakeGroupAt([bar, wing], { x: 500, y: 400, z: 0 });
    expect(Math.abs(wing.location.y - bar.location.y)).toBeGreaterThan(100);
  });

  it('rotateBakeGroupBy orbits parts around the group center', () => {
    const a = stubTerrain({ groupId: 'g1', localX: 0, localY: 0, width: 2, depth: 2, x: 0, y: 0 });
    const b = stubTerrain({ groupId: 'g1', localX: 200, localY: 0, width: 2, depth: 2, x: 200, y: 0 });
    // Centers at (50,50) and (250,50); group center (150,50). 180° → swap sides.
    rotateBakeGroupBy([a, b], 180);
    expect(a.location.x).toBeCloseTo(200, 0);
    expect(b.location.x).toBeCloseTo(0, 0);
    expect(a.rotate).toBeCloseTo(180, 0);
    expect(b.rotate).toBeCloseTo(180, 0);
  });

  it('scaleBakeGroupFrom scales size and shifts from anchor', () => {
    const a = stubTerrain({ groupId: 'g1', localX: 0, localY: 0, width: 2, depth: 2, x: 0, y: 0 });
    const b = stubTerrain({ groupId: 'g1', localX: 200, localY: 0, width: 2, depth: 2, x: 200, y: 0 });
    scaleBakeGroupFrom([a, b], { x: 0, y: 0 }, 2, 1);
    expect(a.width).toBeCloseTo(4, 5);
    expect(b.width).toBeCloseTo(4, 5);
    expect(b.location.x).toBeCloseTo(400, 0);
  });

  it('clearBakeGroup drops id and locals', () => {
    const a = stubTerrain({ groupId: 'g1', localX: 10, localY: 20 });
    clearBakeGroup([a]);
    expect(a.bakeGroupId).toBe('');
    expect(JSON.parse(a.bakeCropJson).groupLocalX).toBeUndefined();
  });
});
