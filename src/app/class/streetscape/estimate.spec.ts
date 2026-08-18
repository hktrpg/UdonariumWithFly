import { BUILTIN_STREETSCAPE_CAPS } from './caps';
import { estimateSyncMiB, maxFeaturesForSyncBudget } from './estimate';
import { BUILTIN_STREETSCAPE_QUALITY } from './caps';

describe('streetscape estimate', () => {
  it('caps feature count by sync budget and maxFeatures', () => {
    const n = maxFeaturesForSyncBudget(40, BUILTIN_STREETSCAPE_QUALITY, BUILTIN_STREETSCAPE_CAPS);
    expect(n).toBeLessThanOrEqual(BUILTIN_STREETSCAPE_CAPS.maxFeatures);
    expect(n).toBeGreaterThan(0);
    expect(estimateSyncMiB(n, BUILTIN_STREETSCAPE_QUALITY, BUILTIN_STREETSCAPE_CAPS))
      .toBeLessThanOrEqual(BUILTIN_STREETSCAPE_CAPS.maxEstimatedSyncMiB + 1e-6);
  });
});
