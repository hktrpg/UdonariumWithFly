import { MeshAabb } from './mesh-ir';
import { preferFullAabbIfShards } from './photo-gltf-faces';

describe('preferFullAabbIfShards', () => {
  it('replaces a single thin wall remnant with the full AABB', () => {
    const root: MeshAabb = {
      min: [-2.921875, 0.00698, -2.745117],
      max: [2.952148, 4.844016, 2.764648],
    };
    const shard: MeshAabb = {
      min: [-1.728714, 0.00698, -2.716420],
      max: [0.229294, 4.844016, -1.855520],
    };
    const out = preferFullAabbIfShards([shard], root);
    expect(out.length).toBe(1);
    expect(out[0].min[0]).toBeCloseTo(root.min[0], 5);
    expect(out[0].max[0]).toBeCloseTo(root.max[0], 5);
    expect(out[0].min[2]).toBeCloseTo(root.min[2], 5);
    expect(out[0].max[2]).toBeCloseTo(root.max[2], 5);
  });

  it('drops thin wall strips beside a solid core', () => {
    const root: MeshAabb = {
      min: [-2.921875, 0, -2.745117],
      max: [2.952148, 5, 2.764648],
    };
    const left: MeshAabb = {
      min: [-1.728714, 0, -2.716420],
      max: [0.229294, 5, -1.855520],
    };
    const core: MeshAabb = {
      min: [-2.8, 0, -1.8],
      max: [2.9, 5, 2.0],
    };
    const right: MeshAabb = {
      min: [1.0, 0, 1.8],
      max: [2.95, 5, 2.75],
    };
    const out = preferFullAabbIfShards([left, core, right], root);
    expect(out.length).toBe(1);
    expect(out[0].min[0]).toBeCloseTo(core.min[0], 5);
    expect(out[0].max[2]).toBeCloseTo(core.max[2], 5);
  });

  it('keeps a real L split (two chunky wings)', () => {
    const root: MeshAabb = { min: [0, 0, 0], max: [10, 5, 10] };
    const stem: MeshAabb = { min: [0, 0, 0], max: [4, 5, 10] };
    const arm: MeshAabb = { min: [0, 0, 0], max: [10, 5, 4] };
    const out = preferFullAabbIfShards([stem, arm], root);
    expect(out.length).toBe(2);
  });
});
