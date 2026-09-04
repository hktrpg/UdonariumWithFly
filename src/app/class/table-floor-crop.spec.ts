import {
  clampFloorCropInsets,
  emptyFloorCropInsets,
  floorCropClipPath,
  floorCropInsetsAlmostZero,
  parseFloorCropJson,
  serializeFloorCropJson,
} from '@udonarium/table-floor-crop';

describe('table-floor-crop', () => {
  it('clamps insets and keeps ≥10% remaining', () => {
    const i = clampFloorCropInsets({ top: 50, right: 50, bottom: 50, left: 50 });
    expect(i.top + i.bottom).toBeLessThanOrEqual(90);
    expect(i.left + i.right).toBeLessThanOrEqual(90);
  });

  it('builds clip-path from insets without stretch', () => {
    expect(floorCropClipPath({ top: 10, right: 5, bottom: 8, left: 12 }))
      .toBe('inset(10% 5% 8% 12%)');
    expect(floorCropClipPath(emptyFloorCropInsets())).toBe('none');
  });

  it('round-trips JSON for reversible % storage', () => {
    const raw = serializeFloorCropJson({ top: 5, right: 10, bottom: 0, left: 7.5 });
    expect(raw).toContain('"top":5');
    expect(parseFloorCropJson(raw)).toEqual({ top: 5, right: 10, bottom: 0, left: 7.5 });
    expect(serializeFloorCropJson(emptyFloorCropInsets())).toBe('');
    expect(floorCropInsetsAlmostZero(parseFloorCropJson(''))).toBe(true);
  });
});
