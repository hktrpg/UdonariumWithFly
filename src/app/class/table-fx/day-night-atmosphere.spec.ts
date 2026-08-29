import {
  animateDayNightAtmosphere,
  darknessOverlayAlpha,
  darknessOverlayRgb,
  darknessOverlayWarmth,
  DAY_NIGHT_ATMOSPHERE,
  isDayAtmosphere,
  isDuskAtmosphere,
  isNightAtmosphere,
  NIGHT_DARKNESS_THRESHOLD,
  surroundingsDimAlpha,
} from './day-night-atmosphere';

describe('day-night-atmosphere', () => {
  it('darknessOverlayAlpha stays soft in dusk then commits to night black', () => {
    expect(darknessOverlayAlpha(0)).toBe(0);
    expect(darknessOverlayAlpha(1)).toBeCloseTo(0.95, 5);
    expect(darknessOverlayAlpha(0.4)).toBeLessThan(0.35);
    expect(darknessOverlayAlpha(0.5)).toBeLessThan(darknessOverlayAlpha(0.7));
    expect(darknessOverlayAlpha(NIGHT_DARKNESS_THRESHOLD)).toBeCloseTo(0.48, 5);
    expect(darknessOverlayAlpha(0.85)).toBeGreaterThan(0.7);
  });

  it('darknessOverlayWarmth is amber at dusk and gone by night', () => {
    expect(darknessOverlayWarmth(0.4)).toBeGreaterThan(0.9);
    expect(darknessOverlayWarmth(0.55)).toBeGreaterThan(0);
    expect(darknessOverlayWarmth(0.55)).toBeLessThan(darknessOverlayWarmth(0.4));
    expect(darknessOverlayWarmth(NIGHT_DARKNESS_THRESHOLD)).toBe(0);
    expect(darknessOverlayWarmth(0.85)).toBe(0);
  });

  it('darknessOverlayRgb stays cool at night', () => {
    expect(darknessOverlayRgb(0.85)).toMatch(/^rgb\(/);
    expect(darknessOverlayRgb(0.85)).not.toContain('220');
  });

  it('surroundingsDimAlpha follows ambient only (parallax brightness)', () => {
    expect(surroundingsDimAlpha(1)).toBe(0);
    expect(surroundingsDimAlpha(0)).toBe(1);
    expect(surroundingsDimAlpha(0.55)).toBeCloseTo(0.45, 5);
  });

  it('presets keep ambient paired with darkness', () => {
    expect(DAY_NIGHT_ATMOSPHERE.day.ambient).toBe(1);
    expect(DAY_NIGHT_ATMOSPHERE.dusk.ambient).toBeLessThan(DAY_NIGHT_ATMOSPHERE.day.ambient);
    expect(DAY_NIGHT_ATMOSPHERE.night.ambient).toBeLessThan(DAY_NIGHT_ATMOSPHERE.dusk.ambient);
    expect(DAY_NIGHT_ATMOSPHERE.night.darkness).toBe(0.85);
  });

  it('day/dusk/night classifiers keep a wide dusk band before night', () => {
    expect(isDayAtmosphere(0)).toBeTrue();
    expect(isDuskAtmosphere(0.4)).toBeTrue();
    expect(isDuskAtmosphere(0.65)).toBeTrue();
    expect(isNightAtmosphere(0.7)).toBeTrue();
    expect(isNightAtmosphere(0.85)).toBeTrue();
  });

  it('animateDayNightAtmosphere tweens both darkness and ambient', () => {
    const frames: FrameRequestCallback[] = [];
    spyOn(window, 'requestAnimationFrame').and.callFake((cb: FrameRequestCallback) => {
      frames.push(cb);
      return frames.length;
    });
    const table = {
      darkness: 0.85,
      globalIllumination: 0.08,
      backgroundFilterType: '',
    } as any;
    animateDayNightAtmosphere(table, 'day', 800);
    expect(frames.length).toBe(1);
    frames[0](performance.now() + 10_000);
    expect(table.darkness).toBe(0);
    expect(table.globalIllumination).toBe(1);
  });
});
