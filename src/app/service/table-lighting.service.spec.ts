import {
  actorCenter,
  directionalShadowStretch,
  MAX_SHADOW_LENGTH_FACTOR,
  rotateTableOffset,
  shadowCastsForPoint,
  shadowStretchForDistance,
  PointLightSource,
} from './table-lighting.service';

describe('table-lighting shadows', () => {
  const metrics = { radiusPx: 25, heightPx: 50 };
  const leftLight: PointLightSource = {
    x: 0, y: 50, brightRadius: 40, dimRadius: 80, intensity: 0.9,
  };
  const rightLight: PointLightSource = {
    x: 100, y: 50, brightRadius: 40, dimRadius: 80, intensity: 0.9,
  };
  const topLight: PointLightSource = {
    x: 50, y: 0, brightRadius: 40, dimRadius: 80, intensity: 0.9,
  };

  it('keeps up to three strongest casts from multiple lights', () => {
    const casts = shadowCastsForPoint(50, 50, [leftLight, rightLight], metrics);
    expect(casts.length).toBe(2);
    expect(casts[0].stretch).toBeGreaterThan(1);
  });

  it('ignores lights out of reach', () => {
    const far: PointLightSource = {
      x: 1000, y: 1000, brightRadius: 10, dimRadius: 20, intensity: 1,
    };
    expect(shadowCastsForPoint(50, 50, [far], metrics)).toEqual([]);
  });

  it('casts downward when light is above (symmetric map Y)', () => {
    const casts = shadowCastsForPoint(50, 50, [topLight], metrics);
    expect(casts.length).toBe(1);
    expect(casts[0].dirY).toBeGreaterThan(0);
    expect(Math.abs(casts[0].dirX)).toBeLessThan(Math.abs(casts[0].dirY) * 0.2);
  });

  it('skips self token light via actorId', () => {
    const self: PointLightSource = {
      x: 50, y: 50, brightRadius: 40, dimRadius: 80, intensity: 0.9, actorId: 'tok-1',
    };
    expect(shadowCastsForPoint(50, 50, [self], { ...metrics, excludeActorId: 'tok-1' })).toEqual([]);
    expect(shadowCastsForPoint(50, 50, [self, leftLight], { ...metrics, excludeActorId: 'tok-1' }).length).toBe(1);
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

  it('leans more when closer to the light, up to 2.3×', () => {
    const near = shadowStretchForDistance(10, 100, 1);
    const far = shadowStretchForDistance(90, 100, 1);
    expect(near).toBeGreaterThan(far);
    expect(near).toBeLessThanOrEqual(MAX_SHADOW_LENGTH_FACTOR);
    expect(shadowStretchForDistance(0, 100, 1)).toBeCloseTo(MAX_SHADOW_LENGTH_FACTOR, 5);
  });

  it('caps at 3 casts even with many lights, strongest first', () => {
    const lights: PointLightSource[] = [
      { x: 0, y: 50, brightRadius: 40, dimRadius: 100, intensity: 1 },
      { x: 100, y: 50, brightRadius: 40, dimRadius: 100, intensity: 0.9 },
      { x: 50, y: 0, brightRadius: 40, dimRadius: 100, intensity: 0.8 },
      { x: 50, y: 100, brightRadius: 40, dimRadius: 100, intensity: 0.7 },
    ];
    const casts = shadowCastsForPoint(50, 50, lights, metrics);
    expect(casts.length).toBe(3);
    expect(casts[0].strength).toBeGreaterThanOrEqual(casts[1].strength);
    expect(casts[1].strength).toBeGreaterThanOrEqual(casts[2].strength);
  });

  it('aligns silhouette up (−Y) with cast +X and elongates on the floor', () => {
    const factor = 1.5;
    const width = 0.95 - 0.22 * ((factor - 1) / (MAX_SHADOW_LENGTH_FACTOR - 1));
    const t = directionalShadowStretch(1, 0, factor);
    expect(t).toBe(`rotateZ(90deg) scale(${width}, ${0.66 * factor})`);
  });

  it('aligns silhouette up (−Y) with cast +Y (CSS down = away “south”)', () => {
    const factor = 1.5;
    const width = 0.95 - 0.22 * ((factor - 1) / (MAX_SHADOW_LENGTH_FACTOR - 1));
    const t = directionalShadowStretch(0, 1, factor);
    expect(t).toBe(`rotateZ(180deg) scale(${width}, ${0.66 * factor})`);
  });

  it('keeps silhouette up when cast is −Y (CSS up)', () => {
    const t = directionalShadowStretch(0, -1, 1);
    expect(t).toBe('rotateZ(0deg) scale(0.95, 0.66)');
  });

  it('token yaw: map cast converted to local then aligned', () => {
    const local = rotateTableOffset(1, 0, 90);
    expect(local.dx).toBeCloseTo(0, 5);
    expect(local.dy).toBeCloseTo(-1, 5);
    expect(directionalShadowStretch(local.dx, local.dy, 1))
      .toBe('rotateZ(0deg) scale(0.95, 0.66)');
  });

  it('caps length at 2.3× base floor projection', () => {
    const t = directionalShadowStretch(1, 0, 99);
    expect(t).toBe(`rotateZ(90deg) scale(0.73, ${0.66 * MAX_SHADOW_LENGTH_FACTOR})`);
  });

  it('narrows as it elongates (deform)', () => {
    const short = directionalShadowStretch(1, 0, 1);
    const long = directionalShadowStretch(1, 0, MAX_SHADOW_LENGTH_FACTOR);
    const shortW = Number(/scale\(([^,]+),/.exec(short)[1]);
    const longW = Number(/scale\(([^,]+),/.exec(long)[1]);
    expect(longW).toBeLessThan(shortW);
  });

  it('radiates away from a center light (four cardinal tokens)', () => {
    const light: PointLightSource = {
      x: 100, y: 100, brightRadius: 50, dimRadius: 200, intensity: 1,
    };
    const n = shadowCastsForPoint(100, 50, [light], metrics)[0];
    const e = shadowCastsForPoint(150, 100, [light], metrics)[0];
    const s = shadowCastsForPoint(100, 150, [light], metrics)[0];
    const w = shadowCastsForPoint(50, 100, [light], metrics)[0];
    expect(n.dirY).toBeLessThan(0);
    expect(e.dirX).toBeGreaterThan(0);
    expect(s.dirY).toBeGreaterThan(0);
    expect(w.dirX).toBeLessThan(0);
  });
});
