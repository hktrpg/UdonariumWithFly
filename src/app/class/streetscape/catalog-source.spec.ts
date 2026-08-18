import { joinPackMemberUrl } from './catalog-source';
import { STREETSCAPE_ERRORS } from './errors';

describe('joinPackMemberUrl', () => {
  const base = 'https://example.test/assets/streetscape/sample/';

  it('joins a relative member path', () => {
    expect(joinPackMemberUrl(base, 'b1.stl')).toBe('https://example.test/assets/streetscape/sample/b1.stl');
  });

  it('rejects traversal and absolute URLs', () => {
    expect(() => joinPackMemberUrl(base, '../secret.glb')).toThrowError(STREETSCAPE_ERRORS.NO_FEATURE);
    expect(() => joinPackMemberUrl(base, 'https://evil.test/x.glb')).toThrowError(STREETSCAPE_ERRORS.NO_FEATURE);
  });
});
