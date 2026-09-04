import { attachPackagePath } from '@udonarium/terrain-model/model-package-files';

import { sidecarFilesForPrimary } from './pack-file-source';

function file(name: string, path = name): File {
  return attachPackagePath(new File([new Uint8Array([1])], name), path);
}

describe('sidecarFilesForPrimary', () => {
  it('does not pull sibling building models from the pack root', () => {
    const b1 = file('b1.stl');
    const b2 = file('b2.stl');
    const mtl = file('b1.mtl');
    const tex = file('wall.png');
    const floor = file('floor.png');
    const sidecars = sidecarFilesForPrimary([b1, b2, mtl, tex, floor], b1);
    expect(sidecars.map(f => f.name).sort()).toEqual(['b1.mtl', 'floor.png', 'wall.png']);
  });

  it('keeps textures under the same folder only', () => {
    const primary = file('house.glb', 'a/house.glb');
    const tex = file('albedo.png', 'a/albedo.png');
    const other = file('other.png', 'b/other.png');
    const otherModel = file('shed.glb', 'a/shed.glb');
    const sidecars = sidecarFilesForPrimary([primary, tex, other, otherModel], primary);
    expect(sidecars.map(f => f.name)).toEqual(['albedo.png']);
  });
});
