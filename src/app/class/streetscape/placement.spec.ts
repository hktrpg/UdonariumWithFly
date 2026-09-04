import { BUILTIN_STREETSCAPE_CAPS } from './caps';
import { StreetscapePackV1 } from './pack-schema';
import { featureCenterTablePx, streetscapeScaleFromPack } from './placement';

const pack: StreetscapePackV1 = {
  version: 1,
  id: 'n',
  title: 't',
  attribution: '',
  metersPerUnit: 1,
  origin: { x: 0, z: 0 },
  extentMeters: { width: 80, depth: 40 },
  floor: { path: 'floor.png' },
  features: [
    { id: 'a', kind: 'building', path: 'a.stl', positionMeters: { x: 0, z: 0 }, sizeMeters: { w: 10, d: 10, h: 20 } },
    { id: 'b', kind: 'building', path: 'b.stl', positionMeters: { x: 20, z: 0 }, sizeMeters: { w: 10, d: 10, h: 20 } },
  ],
};

describe('streetscape placement', () => {
  it('keeps two buildings 20 m apart on the table', () => {
    const scale = streetscapeScaleFromPack(pack, BUILTIN_STREETSCAPE_CAPS, 50);
    expect(scale.tableCellsX).toBe(40);
    expect(scale.tableCellsY).toBe(20);
    expect(scale.metersPerGrid).toBeCloseTo(2, 5);
    expect(scale.metersPerGridX).toBeCloseTo(2, 5);
    expect(scale.metersPerGridY).toBeCloseTo(2, 5);
    expect(scale.mmPerGrid).toBeCloseTo(2, 5);
    const a = featureCenterTablePx(pack.features[0], pack, scale);
    const b = featureCenterTablePx(pack.features[1], pack, scale);
    expect((b.x - a.x) / scale.gridPx).toBeCloseTo(10, 5);
  });

  it('places south-edge midpoint at tableCellsY/2 when mpgX ≠ mpgY', () => {
    // Anjo-like extents: maxCells=100 shrink + rounding → anisotropic metres/cell.
    const wide: StreetscapePackV1 = {
      ...pack,
      extentMeters: { width: 1023.5, depth: 480.3 },
      features: [
        {
          id: 'mid',
          kind: 'building',
          path: 'm.stl',
          positionMeters: { x: 1023.5 / 2 - 5, z: 480.3 / 2 - 5 },
          sizeMeters: { w: 10, d: 10, h: 12 },
        },
      ],
    };
    const scale = streetscapeScaleFromPack(wide, BUILTIN_STREETSCAPE_CAPS, 50);
    expect(Math.abs(scale.metersPerGridX - scale.metersPerGridY)).toBeGreaterThan(0.01);
    const c = featureCenterTablePx(wide.features[0], wide, scale);
    expect(c.y / scale.gridPx).toBeCloseTo(scale.tableCellsY / 2, 5);
    expect(c.x / scale.gridPx).toBeCloseTo(scale.tableCellsX / 2, 5);
  });
});
