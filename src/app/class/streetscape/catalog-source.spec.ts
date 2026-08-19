import { fetchFeatureWithSidecars, joinPackMemberUrl } from './catalog-source';
import { STREETSCAPE_ERRORS } from './errors';
import { packagePathOf } from '@udonarium/terrain-model/model-package-files';

describe('joinPackMemberUrl', () => {
  const base = 'https://example.test/assets/streetscape/sample/';

  it('joins a relative member path', () => {
    expect(joinPackMemberUrl(base, 'b1.stl')).toBe('https://example.test/assets/streetscape/sample/b1.stl');
  });

  it('resolves catalog-relative pack bases (Invalid base URL regression)', () => {
    // catalog.json packUrl is relative; member joins must not throw TypeError.
    const href = joinPackMemberUrl('assets/streetscape/sample-nathan/', 'b1.stl');
    expect(href).toBe(new URL('assets/streetscape/sample-nathan/b1.stl', document.baseURI).href);
  });

  it('rejects traversal and absolute URLs', () => {
    expect(() => joinPackMemberUrl(base, '../secret.glb')).toThrowError(STREETSCAPE_ERRORS.NO_FEATURE);
    expect(() => joinPackMemberUrl(base, 'https://evil.test/x.glb')).toThrowError(STREETSCAPE_ERRORS.NO_FEATURE);
  });
});

describe('fetchFeatureWithSidecars', () => {
  const base = 'https://example.test/pack/';
  const bodies: Record<string, string> = {
    'b1.obj': 'mtllib b1.mtl\nv 0 0 0\n',
    'b1.mtl': 'newmtl wall\nKd 0.8 0.4 0.2\nmap_Kd wall.png\n',
    'wall.png': 'fake-png',
  };

  beforeEach(() => {
    spyOn(window, 'fetch').and.callFake((input: RequestInfo | URL) => {
      const href = String(input);
      const name = href.split('/').pop() || '';
      if (!(name in bodies)) {
        return Promise.resolve(new Response(null, { status: 404 }));
      }
      return Promise.resolve(new Response(bodies[name], { status: 200 }));
    });
  });

  it('pulls mtllib + map_Kd next to an OBJ primary', async () => {
    const files = await fetchFeatureWithSidecars(base, 'b1.obj');
    expect(files.map(f => packagePathOf(f)).sort()).toEqual(['b1.mtl', 'b1.obj', 'wall.png']);
  });
});
