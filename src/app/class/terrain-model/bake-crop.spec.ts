import {
  BAKE_CROP_PAD_MAX_PX,
  BAKE_CROP_PAD_MIN_PX,
  clampInsets,
  cropRectForFace,
  faceCropBackgroundStyle,
  insetsFromOpaqueRgba,
  insetsLookLikeSiblingBleed,
  padPxForLongEdge,
} from './bake-crop';

describe('padPxForLongEdge', () => {
  it('uses 0.8% of the long edge, clamped 1–16 px', () => {
    expect(padPxForLongEdge(1000)).toBe(8);
    expect(padPxForLongEdge(50)).toBe(BAKE_CROP_PAD_MIN_PX);
    expect(padPxForLongEdge(10_000)).toBe(BAKE_CROP_PAD_MAX_PX);
  });
});

describe('insetsFromOpaqueRgba', () => {
  it('pads the opaque bbox and converts to W/E/S/N fractions', () => {
    const w = 100;
    const h = 100;
    const data = new Uint8ClampedArray(w * h * 4);
    for (let y = 10; y <= 89; y++) {
      for (let x = 10; x <= 89; x++) {
        const i = (y * w + x) * 4;
        data[i + 3] = 255;
      }
    }
    const insets = insetsFromOpaqueRgba(data, w, h);
    // 100px long edge → 1px pad (0.8% rounds to 1, min 1)
    expect(insets.west).toBeCloseTo(0.09, 5);
    expect(insets.east).toBeCloseTo(0.09, 5);
    expect(insets.north).toBeCloseTo(0.09, 5);
    expect(insets.south).toBeCloseTo(0.09, 5);
  });
});

describe('cropRectForFace', () => {
  const insets = { west: 0.1, east: 0.2, north: 0.05, south: 0.15 };

  it('crops floor with west/east/north/south as image edges', () => {
    expect(cropRectForFace('floor', 100, 80, insets)).toEqual({ x: 10, y: 4, w: 70, h: 64 });
  });

  it('crops the top of a south wall with north (image top)', () => {
    expect(cropRectForFace('wallBottom', 100, 50, insets)).toEqual({ x: 10, y: 3, w: 70, h: 40 });
  });
});

describe('clampInsets', () => {
  it('keeps opposite sides from collapsing the box', () => {
    const c = clampInsets({ west: 0.6, east: 0.6, north: 0, south: 0 });
    expect(c.west + c.east).toBeCloseTo(0.9, 5);
  });
});

describe('insetsLookLikeSiblingBleed', () => {
  it('flags the manual NYC west-wall east≥50% crop pattern', () => {
    expect(insetsLookLikeSiblingBleed({ west: 0, east: 0.5, north: 0, south: 0 })).toBe(true);
    expect(insetsLookLikeSiblingBleed({ west: 0, east: 0.1, north: 0, south: 0.175 })).toBe(false);
  });
});

describe('faceCropBackgroundStyle', () => {
  it('zooms the remaining region to fill the CSS face', () => {
    const css = faceCropBackgroundStyle({ west: 0, east: 0, north: 0.2, south: 0 });
    expect(css['background-size']).toContain('125');
    expect(css['background-position']).toBe('50% 100%');
  });
});
