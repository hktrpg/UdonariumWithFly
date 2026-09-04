import { STREETSCAPE_ERRORS } from './errors';
import { parseStreetscapePackV1 } from './pack-schema';

const valid = {
  version: 1,
  id: 'n',
  title: 'Nathan',
  attribution: 'LandsD',
  metersPerUnit: 1,
  origin: { x: 0, z: 0 },
  extentMeters: { width: 80, depth: 50 },
  floor: { path: 'floor.png' },
  features: [
    { id: 'b1', kind: 'building', path: 'b1.glb', positionMeters: { x: 4, z: 2 } },
  ],
};

describe('parseStreetscapePackV1', () => {
  it('accepts a minimal valid pack', () => {
    const pack = parseStreetscapePackV1(valid);
    expect(pack.id).toBe('n');
    expect(pack.features[0].kind).toBe('building');
  });

  it('rejects missing floor', () => {
    expect(() => parseStreetscapePackV1({ ...valid, floor: {} })).toThrowError(STREETSCAPE_ERRORS.INVALID_PACK);
  });

  it('accepts empty features for map-only packs', () => {
    const pack = parseStreetscapePackV1({ ...valid, features: [] });
    expect(pack.features.length).toBe(0);
  });

  it('keeps open3dhk sheet + worldExtent for re-import facades', () => {
    const pack = parseStreetscapePackV1({
      ...valid,
      id: 'open3dhk-11-NW-19B',
      open3dhk: {
        sheet: '11-NW-19B',
        format: 'GLTF0',
        worldExtent: { minX: 100, maxX: 200, minZ: -50, maxZ: 50 },
      },
    });
    expect(pack.open3dhk?.sheet).toBe('11-NW-19B');
    expect(pack.open3dhk?.format).toBe('GLTF0');
    expect(pack.open3dhk?.worldExtent.maxX).toBe(200);
  });
});
