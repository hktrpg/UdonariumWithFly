import {
  aabbClipPlanes,
  pointInsideClipPlanes,
  siblingBleedClipPlanes,
} from './aabb-clip-planes';
import { MeshAabb } from './mesh-ir';

describe('aabbClipPlanes', () => {
  const box: MeshAabb = { min: [0, 0, 0], max: [10, 4, 6] };

  it('keeps the box center and rejects far outliers', () => {
    const planes = aabbClipPlanes(box, { inflateFrac: 0, inflateWorld: 0 });
    expect(pointInsideClipPlanes(5, 2, 3, planes)).toBe(true);
    expect(pointInsideClipPlanes(-1, 2, 3, planes)).toBe(false);
    expect(pointInsideClipPlanes(11, 2, 3, planes)).toBe(false);
  });

  it('inflate keeps cut-face surfaces inside', () => {
    const planes = aabbClipPlanes(box, { inflateFrac: 0.02, inflateWorld: 0.1 });
    expect(pointInsideClipPlanes(10, 2, 3, planes)).toBe(true);
    expect(pointInsideClipPlanes(10.05, 2, 3, planes)).toBe(true);
  });
});

describe('siblingBleedClipPlanes', () => {
  const spine: MeshAabb = { min: [0, 0, 0], max: [2, 10, 12] };
  const wing: MeshAabb = { min: [3, 0, 8], max: [8, 10, 12] };

  it('clips the east wing away from the west spine without shaving the shared gap face hard', () => {
    const planes = siblingBleedClipPlanes(spine, [wing], 0.2);
    // Wing sample must be rejected.
    expect(pointInsideClipPlanes(5, 5, 10, planes)).toBe(false);
    // Spine west facade and cut face stay.
    expect(pointInsideClipPlanes(0.1, 5, 6, planes)).toBe(true);
    expect(pointInsideClipPlanes(2.0, 5, 6, planes)).toBe(true);
  });

  it('does not add a plane toward an abutting sibling', () => {
    const abut: MeshAabb = { min: [2, 0, 0], max: [5, 10, 4] };
    const planes = siblingBleedClipPlanes(spine, [abut], 0.05);
    // No X clip toward the abutter — only possible planes would be Z if any.
    expect(planes.every(p => p.normal[0] === 0)).toBe(true);
  });
});
