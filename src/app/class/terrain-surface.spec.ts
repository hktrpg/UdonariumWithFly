import { SlopeDirection, Terrain } from './terrain';
import {
  SLOPE_DEG_MAX,
  effectiveSlopeDirection,
  floorModCss,
  sampleTerrainSurface,
  setSlopeDegrees,
  slopeDegrees,
  slopeRun,
  surfaceAlignCss,
} from './terrain-surface';

describe('terrain-surface', () => {
  function makeSlope(opts: {
    width?: number;
    depth?: number;
    height?: number;
    altitude?: number;
    direction?: SlopeDirection;
    x?: number;
    y?: number;
    rotate?: number;
  } = {}): Terrain {
    const t = Terrain.create('bridge', opts.width ?? 2, opts.depth ?? 4, opts.height ?? 1, 'wall', 'floor');
    t.isSlope = true;
    t.slopeDirection = opts.direction ?? SlopeDirection.BOTTOM;
    t.altitude = opts.altitude ?? 0;
    t.location.x = opts.x ?? 0;
    t.location.y = opts.y ?? 0;
    t.rotate = opts.rotate ?? 0;
    return t;
  }

  it('computes slope degrees from height/run and setSlopeDegrees rewrites height', () => {
    const t = makeSlope({ depth: 4, height: 1, direction: SlopeDirection.BOTTOM });
    expect(slopeRun(t)).toBe(4);
    const deg = slopeDegrees(t);
    expect(deg).toBeCloseTo((Math.atan(1 / 4) * 180) / Math.PI, 5);

    setSlopeDegrees(t, 20);
    expect(t.isSlope).toBeTrue();
    expect(slopeDegrees(t)).toBeCloseTo(20, 4);
    expect(t.height).toBeCloseTo(Math.tan((20 * Math.PI) / 180) * 4, 5);
  });

  it('clamps setSlopeDegrees and clears slope below minimum', () => {
    const t = makeSlope();
    setSlopeDegrees(t, 90);
    expect(slopeDegrees(t)).toBeCloseTo(SLOPE_DEG_MAX, 4);
    setSlopeDegrees(t, 0);
    expect(t.isSlope).toBeFalse();
    expect(effectiveSlopeDirection(t)).toBe(SlopeDirection.NONE);
  });

  it('floorModCss matches direction signs', () => {
    const bottom = makeSlope({ direction: SlopeDirection.BOTTOM, height: 1, depth: 4 });
    expect(floorModCss(bottom)).toContain('rotateX(-');
    const top = makeSlope({ direction: SlopeDirection.TOP, height: 1, depth: 4 });
    expect(floorModCss(top)).toContain('rotateX(');
    expect(floorModCss(top)).not.toContain('rotateX(-');
  });

  it('samples altitude along BOTTOM slope and builds align css', () => {
    const t = makeSlope({
      width: 2, depth: 4, height: 2, altitude: 1,
      direction: SlopeDirection.BOTTOM, x: 0, y: 0,
    });
    const grid = 50;
    // Top edge (v=0) → low; bottom edge (v=1) → high
    const low = sampleTerrainSurface(50, 0, [t], grid);
    const high = sampleTerrainSurface(50, 4 * grid, [t], grid);
    expect(low).toBeTruthy();
    expect(high).toBeTruthy();
    expect(low!.altitude).toBeCloseTo(1, 2);
    expect(high!.altitude).toBeCloseTo(3, 2);
    expect(low!.pitchXDeg).toBeLessThan(0);
    expect(surfaceAlignCss(low!, 0)).toContain('rotateX(');
  });

  it('ignores non-slope terrain (signs / flat roofs)', () => {
    const flat = Terrain.create('roof', 2, 2, 1, 'wall', 'floor');
    flat.isSlope = false;
    flat.altitude = 5;
    flat.location.x = 0;
    flat.location.y = 0;
    expect(sampleTerrainSurface(50, 50, [flat], 50)).toBeNull();
  });

  it('faceImage falls back to wall/floor', () => {
    const t = Terrain.create('sign', 2, 0.2, 1, 'wallId', 'floorId');
    t.ensureFaceImageElements();
    expect(t.faceImage('wallBottom')).toBe(t.wallImage);
    expect(t.faceImage('underside')).toBe(t.floorImage);
    t.setFaceImage('wallBottom', 'frontId');
    // ImageStorage may not have frontId — hasOwnFaceImage checks element value
    expect(t.hasOwnFaceImage('wallBottom')).toBeTrue();
  });
});
