import { composeStreetscapeFloor } from './floor-composer';
import { StreetscapePackV1 } from './pack-schema';
import { streetscapeScaleFromPack } from './placement';
import { BUILTIN_STREETSCAPE_CAPS } from './caps';

describe('composeStreetscapeFloor', () => {
  it('returns a PNG blob', () => {
    const pack: StreetscapePackV1 = {
      version: 1,
      id: 'n',
      title: 't',
      attribution: '',
      metersPerUnit: 1,
      origin: { x: 0, z: 0 },
      extentMeters: { width: 40, depth: 20 },
      floor: { path: 'floor.png' },
      features: [
        { id: 'a', kind: 'building', path: 'a.stl', positionMeters: { x: 2, z: 2 }, sizeMeters: { w: 6, d: 4, h: 10 } },
      ],
    };
    const blob = composeStreetscapeFloor(pack, streetscapeScaleFromPack(pack, BUILTIN_STREETSCAPE_CAPS), pack.features);
    expect(blob.type).toBe('image/png');
    expect(blob.size).toBeGreaterThan(20);
  });
});
