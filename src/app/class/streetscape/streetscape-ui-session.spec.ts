import {
  clearStreetscapeUiSession,
  getStreetscapeUiSession,
  setStreetscapeUiSession,
} from './streetscape-ui-session';
import { StreetscapePackV1 } from './pack-schema';

describe('streetscape-ui-session', () => {
  afterEach(() => clearStreetscapeUiSession());

  it('survives clear of component-owned fields via module session', () => {
    const pack: StreetscapePackV1 = {
      version: 1,
      id: 'open3dhk-11-SW-4B',
      title: 'demo',
      attribution: 'LandsD',
      metersPerUnit: 1,
      origin: { x: 0, z: 0 },
      extentMeters: { width: 100, depth: 100 },
      floor: { path: 'floor.png' },
      features: [],
    };
    const file = new File([new Uint8Array([1])], 'floor.png');
    setStreetscapeUiSession({
      status: 'Streetscape ready',
      attribution: 'LandsD / Open3Dhk',
      street: '彌敦道',
      maxFeatures: 6,
      deferred: {
        tableId: 'table-1',
        sheet: '11-SW-4B',
        maxFeatures: 6,
        buildingIds: ['b1', 'b2'],
        estimatedFacadeBytes: 12_000_000,
        worldExtent: { minX: 0, maxX: 10, minZ: 0, maxZ: 10 },
      },
      exportPack: { pack, files: [file], fileName: 'demo.zip' },
    });

    const restored = getStreetscapeUiSession();
    expect(restored.status).toBe('Streetscape ready');
    expect(restored.attribution).toContain('Open3Dhk');
    expect(restored.deferred?.sheet).toBe('11-SW-4B');
    expect(restored.deferred?.buildingIds).toEqual(['b1', 'b2']);
    expect(restored.exportPack?.files.length).toBe(1);
    expect(restored.maxFeatures).toBe(6);
  });

  it('does not clamp maxFeatures to 8', () => {
    setStreetscapeUiSession({
      ...getStreetscapeUiSession(),
      maxFeatures: 24,
    });
    expect(getStreetscapeUiSession().maxFeatures).toBe(24);
  });

  it('clearStreetscapeUiSession resets download info', () => {
    setStreetscapeUiSession({
      ...getStreetscapeUiSession(),
      status: 'done',
      attribution: 'x',
    });
    clearStreetscapeUiSession();
    const s = getStreetscapeUiSession();
    expect(s.status).toBe('');
    expect(s.attribution).toBe('');
    expect(s.deferred).toBeNull();
    expect(s.exportPack).toBeNull();
  });
});
