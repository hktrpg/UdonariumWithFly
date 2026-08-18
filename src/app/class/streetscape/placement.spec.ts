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
    expect(scale.metersPerGrid).toBeCloseTo(1, 5);
    expect(scale.mmPerGrid).toBeCloseTo(1, 5);
    const a = featureCenterTablePx(pack.features[0], pack, scale);
    const b = featureCenterTablePx(pack.features[1], pack, scale);
    expect((b.x - a.x) / scale.gridPx).toBeCloseTo(20, 5);
  });
});
