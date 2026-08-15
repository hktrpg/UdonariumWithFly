import { SlopeDirection } from './terrain';
import {
  sampleHighestTerrainSurface,
  slopeAlignCss,
  slopeAngleRad,
  slopeLocalTipDeg,
  slopeRiseFraction,
  terrainSurfacePosZPx,
} from './terrain-surface';
import {
  makeTable,
  makeTerrain,
  resetTabletopStore,
  viewTables,
} from '../../testing/tabletop-test.util';

describe('terrain-surface (skybridge ride)', () => {
  beforeEach(() => resetTabletopStore());
  afterEach(() => resetTabletopStore());

  it('TOP slope rises toward south (v=1) matching floorModCss rotateX(+θ)', () => {
    makeTable('t1');
    viewTables('t1');
    const terrain = makeTerrain('bridge_top');
    terrain.location.name = 'table';
    terrain.location.x = 0;
    terrain.location.y = 0;
    terrain.width = 2;
    terrain.depth = 4;
    terrain.height = 2;
    terrain.altitude = 1;
    terrain.isSlope = true;
    terrain.slopeDirection = SlopeDirection.TOP;
    terrain.mode = 1; // FLOOR

    const g = 50;
    const north = terrainSurfacePosZPx(terrain, 50, 0, g)!;
    const south = terrainSurfacePosZPx(terrain, 50, 4 * g, g)!;
    const mid = terrainSurfacePosZPx(terrain, 50, 2 * g, g)!;

    expect(north).toBeCloseTo((1 + 0) * g, 5); // altitude only at low end
    expect(south).toBeCloseTo((1 + 2) * g, 5);
    expect(mid).toBeCloseTo((1 + 1) * g, 5);
    expect(slopeRiseFraction(terrain, 0.5, 0)!).toBeCloseTo(0, 5);
    expect(slopeRiseFraction(terrain, 0.5, 1)!).toBeCloseTo(1, 5);
    expect(slopeAngleRad(terrain)).toBeCloseTo(Math.atan(2 / 4), 5);
  });

  it('rotated LEFT slope still samples inside footprint', () => {
    makeTable('t2');
    viewTables('t2');
    const terrain = makeTerrain('bridge_left');
    terrain.location.name = 'table';
    terrain.location.x = 100;
    terrain.location.y = 100;
    terrain.width = 4;
    terrain.depth = 1;
    terrain.height = 2;
    terrain.altitude = 0;
    terrain.rotate = 90;
    terrain.isSlope = true;
    terrain.slopeDirection = SlopeDirection.LEFT;
    terrain.mode = 1;

    const g = 50;
    const cx = 100 + (4 * g) / 2;
    const cy = 100 + (1 * g) / 2;
    // Outside unrotated box but on rotated footprint — center should hit.
    expect(terrainSurfacePosZPx(terrain, cx, cy, g)).not.toBeNull();
    expect(terrainSurfacePosZPx(terrain, 0, 0, g)).toBeNull();
  });

  it('sampleHighestTerrainSurface prefers the taller deck', () => {
    makeTable('t3');
    viewTables('t3');
    const low = makeTerrain('low');
    low.location.name = 'table';
    low.location.x = 0;
    low.location.y = 0;
    low.width = 2;
    low.depth = 2;
    low.height = 1;
    low.altitude = 0;
    low.mode = 1;

    const high = makeTerrain('high');
    high.location.name = 'table';
    high.location.x = 0;
    high.location.y = 0;
    high.width = 2;
    high.depth = 2;
    high.height = 1;
    high.altitude = 3;
    high.mode = 1;

    const sample = sampleHighestTerrainSurface([low, high], 50, 50, 50)!;
    expect(sample.terrain).toBe(high);
    expect(sample.posZ).toBeCloseTo((3 + 1) * 50, 5);
  });

  it('slopeAlignCss conjugates local tip by terrain yaw', () => {
    const tip = slopeLocalTipDeg({
      isSlope: true,
      slopeDirection: SlopeDirection.TOP,
      height: 1,
      depth: 1,
      width: 1,
    } as any);
    expect(tip.rotateX).toBeCloseTo(45, 5);
    const css = slopeAlignCss({
      terrain: null as any,
      posZ: 0,
      localRotateXDeg: tip.rotateX,
      localRotateYDeg: 0,
      terrainRotateDeg: 30,
      slopeDeg: tip.slopeDeg,
    });
    expect(css).toContain('rotateZ(30deg)');
    expect(css).toContain('rotateX(45');
    expect(css).toContain('rotateZ(-30deg)');
  });
});
