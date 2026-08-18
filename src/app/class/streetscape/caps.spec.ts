import { BUILTIN_STREETSCAPE_CAPS, mergeStreetscapeQuality, resolveStreetscapeCaps } from './caps';

describe('StreetscapeCaps', () => {
  it('does not let a pack raise hard limits', () => {
    const caps = resolveStreetscapeCaps({
      maxFeatures: 99,
      maxEstimatedSyncMiB: 999,
      maxTableCells: 500,
    });
    expect(caps.maxFeatures).toBe(BUILTIN_STREETSCAPE_CAPS.maxFeatures);
    expect(caps.maxEstimatedSyncMiB).toBe(BUILTIN_STREETSCAPE_CAPS.maxEstimatedSyncMiB);
    expect(caps.maxTableCells).toBe(BUILTIN_STREETSCAPE_CAPS.maxTableCells);
  });

  it('allows tightening below builtin caps', () => {
    const caps = resolveStreetscapeCaps({ maxFeatures: 3 });
    expect(caps.maxFeatures).toBe(3);
  });

  it('clamps quality bake size to caps', () => {
    const caps = resolveStreetscapeCaps({ maxBakeEdgePx: 256 });
    const q = mergeStreetscapeQuality({ bakeMaxEdgePx: 2048 }, { bakeMaxEdgePx: 1024 }, caps);
    expect(q.bakeMaxEdgePx).toBe(256);
    expect(q.fitGrid).toBe(false);
  });
});
