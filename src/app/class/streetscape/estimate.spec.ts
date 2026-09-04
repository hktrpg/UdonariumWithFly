import { BUILTIN_STREETSCAPE_CAPS } from './caps';
import { estimateSyncMiB, maxFeaturesForSyncBudget } from './estimate';
import { BUILTIN_STREETSCAPE_QUALITY } from './caps';

describe('streetscape estimate', () => {
  it('honors requested feature count (no hard cap)', () => {
    const n = maxFeaturesForSyncBudget(40, BUILTIN_STREETSCAPE_QUALITY, BUILTIN_STREETSCAPE_CAPS);
    expect(n).toBe(40);
    expect(estimateSyncMiB(n, BUILTIN_STREETSCAPE_QUALITY, BUILTIN_STREETSCAPE_CAPS)).toBeGreaterThan(0);
  });
});
