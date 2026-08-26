import { actorCenter, rotateTableOffset, shadowCastsForPoint, shadowVectorForPoint, PointLightSource } from './table-lighting.service';

describe('table-lighting shadows', () => {
  const leftLight: PointLightSource = {
    x: 0, y: 50, brightRadius: 40, dimRadius: 80, intensity: 0.9,
  };
  const rightLight: PointLightSource = {
    x: 100, y: 50, brightRadius: 40, dimRadius: 80, intensity: 0.9,
  };
  const topLight: PointLightSource = {
    x: 50, y: 0, brightRadius: 40, dimRadius: 80, intensity: 0.9,
  };

  it('casts one silhouette per nearby light, away from each source', () => {
    const casts = shadowCastsForPoint(50, 50, [leftLight, rightLight]);
    expect(casts.length).toBe(2);
    // Left light → shadow should push to the right (positive dx)
    const fromLeft = casts.find(c => c.dx > 0)!;
    const fromRight = casts.find(c => c.dx < 0)!;
    expect(fromLeft).toBeTruthy();
    expect(fromRight).toBeTruthy();
    expect(Math.abs(fromLeft.dx)).toBeGreaterThan(10);
    expect(Math.abs(fromRight.dx)).toBeGreaterThan(10);
  });

  it('ignores lights out of reach', () => {
    const far: PointLightSource = {
      x: 1000, y: 1000, brightRadius: 10, dimRadius: 20, intensity: 1,
    };
    expect(shadowCastsForPoint(50, 50, [far])).toEqual([]);
  });

  it('casts downward when light is above (symmetric map Y)', () => {
    const casts = shadowCastsForPoint(50, 50, [topLight]);
    expect(casts.length).toBe(1);
    expect(casts[0].dy).toBeGreaterThan(0);
    expect(Math.abs(casts[0].dx)).toBeLessThan(Math.abs(casts[0].dy) * 0.2);
  });

  it('skips self token light via actorId', () => {
    const self: PointLightSource = {
      x: 50, y: 50, brightRadius: 40, dimRadius: 80, intensity: 0.9, actorId: 'tok-1',
    };
    expect(shadowCastsForPoint(50, 50, [self], 'tok-1')).toEqual([]);
    expect(shadowCastsForPoint(50, 50, [self, leftLight], 'tok-1').length).toBe(1);
  });

  it('uses live pose for actor center when provided', () => {
    const actor = {
      identifier: 'tok-2',
      location: { x: 0, y: 0 },
      size: 1,
      visionRangeGrid: 0,
      brightLightGrid: 0,
      dimLightGrid: 0,
      getPoseForView: () => ({ x: 100, y: 200, posZ: 0 }),
    };
    const c = actorCenter(actor, 50);
    expect(c.x).toBe(125);
    expect(c.y).toBe(225);
  });

  it('rotates map offset into token-local space', () => {
    const r = rotateTableOffset(10, 0, 90);
    expect(r.dx).toBeCloseTo(0, 5);
    expect(r.dy).toBeCloseTo(-10, 5);
  });

  it('casts longer shadows when closer and brighter', () => {
    const near = shadowCastsForPoint(50, 50, [{
      x: 35, y: 50, brightRadius: 80, dimRadius: 120, intensity: 1,
    }]);
    const far = shadowCastsForPoint(50, 50, [{
      x: 0, y: 50, brightRadius: 40, dimRadius: 80, intensity: 0.35,
    }]);
    expect(near.length).toBe(1);
    expect(far.length).toBe(1);
    expect(Math.abs(near[0].dx)).toBeGreaterThan(Math.abs(far[0].dx));
  });

  it('still provides a blended vector for legacy callers', () => {
    const v = shadowVectorForPoint(50, 50, [leftLight]);
    expect(v.dx).toBeGreaterThan(0);
    expect(v.strength).toBeGreaterThan(0);
  });
});
