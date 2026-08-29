import {
  animateDayNightAtmosphere,
  darknessOverlayAlpha,
  DAY_NIGHT_ATMOSPHERE,
  isDayAtmosphere,
  isDuskAtmosphere,
  isNightAtmosphere,
} from './day-night-atmosphere';

describe('day-night-atmosphere', () => {
  it('darknessOverlayAlpha is controlled fully by ambient bar', () => {
    expect(darknessOverlayAlpha(1, 1)).toBe(0);
    expect(darknessOverlayAlpha(1, 0)).toBe(1);
    expect(darknessOverlayAlpha(0.8, 0.5)).toBeCloseTo(0.4, 5);
    // High darkness must not ignore a high ambient bar (old 0.35 factor left ~0.65 veil).
    expect(darknessOverlayAlpha(1, 1)).toBeLessThan(0.1);
  });

  it('presets keep ambient paired with darkness', () => {
    expect(DAY_NIGHT_ATMOSPHERE.day.ambient).toBe(1);
    expect(DAY_NIGHT_ATMOSPHERE.dusk.ambient).toBeLessThan(DAY_NIGHT_ATMOSPHERE.day.ambient);
    expect(DAY_NIGHT_ATMOSPHERE.night.ambient).toBeLessThan(DAY_NIGHT_ATMOSPHERE.dusk.ambient);
  });

  it('day/dusk/night classifiers match toolbox radio ranges', () => {
    expect(isDayAtmosphere(0)).toBeTrue();
    expect(isDuskAtmosphere(0.4)).toBeTrue();
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
      globalIllumination: 0.15,
      backgroundFilterType: '',
    } as any;
    const t0 = performance.now();
    animateDayNightAtmosphere(table, 'day', 800);
    expect(frames.length).toBe(1);
    frames[0](t0 + 800);
    expect(table.darkness).toBe(0);
    expect(table.globalIllumination).toBe(1);
  });
});
