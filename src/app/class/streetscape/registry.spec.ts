import { STREETSCAPE_ERRORS } from './errors';
import { getStreetscapeSource, registerStreetscapeSource, resetStreetscapeSourcesForTests, resolveStreetscapeSource } from './registry';
import { StreetscapeSource } from './source';

describe('StreetscapeSource registry', () => {
  beforeEach(() => resetStreetscapeSourcesForTests());

  it('resolves by query type without a switch in the orchestrator', () => {
    const src: StreetscapeSource = {
      id: 'pack-file',
      resolve: async () => { throw new Error('unused'); },
    };
    registerStreetscapeSource(src);
    expect(getStreetscapeSource('pack-file')).toBe(src);
    expect(resolveStreetscapeSource({ type: 'file', files: [] })).toBe(src);
  });

  it('throws for an unregistered source', () => {
    expect(() => resolveStreetscapeSource({ type: 'open3dhk', street: '彌敦道' }))
      .toThrowError(STREETSCAPE_ERRORS.UNKNOWN_SOURCE);
  });
});
