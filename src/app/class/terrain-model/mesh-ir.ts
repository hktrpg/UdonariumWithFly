/** Shared mesh intermediate for terrain six-face bake (not a SyncObject). */

export type MeshAabb = {
  min: [number, number, number];
  max: [number, number, number];
};

export type MeshIR = {
  /** Interleaved xyz (length = triangleCount * 9). */
  positions: Float32Array;
  /** Optional interleaved xyz normals (same length as positions). */
  normals?: Float32Array;
  /** Optional interleaved uv (length = triangleCount * 6). */
  uvs?: Float32Array;
  /** Optional interleaved rgb 0–1 (length = triangleCount * 9). */
  vertexColors?: Float32Array;
  /** Optional albedo for UV sampling during bake. */
  albedoImage?: CanvasImageSource;
  triangleCount: number;
  aabb: MeshAabb;
  sourceFormat: 'stl' | 'obj' | 'gltf';
  hadColor: boolean;
  warnings: string[];
};

export const MODEL_MAX_TRIANGLES = 80_000;
export const MODEL_MAX_FILE_BYTES = 20 * 1024 * 1024;
export const MODEL_BAKE_SIZE_DEFAULT = 256;
export const MODEL_BAKE_SIZE_MAX = 512;
/** 1 STL/OBJ unit = 1mm; 50mm = 1 table grid. */
export const MODEL_MM_PER_GRID_DEFAULT = 50;
export const MODEL_GRID_EDGE_MAX = 40;
export const MODEL_IMAGE_TAG = 'terrain-bake';

export function emptyAabb(): MeshAabb {
  return {
    min: [Infinity, Infinity, Infinity],
    max: [-Infinity, -Infinity, -Infinity],
  };
}

export function expandAabb(aabb: MeshAabb, x: number, y: number, z: number): void {
  if (x < aabb.min[0]) aabb.min[0] = x;
  if (y < aabb.min[1]) aabb.min[1] = y;
  if (z < aabb.min[2]) aabb.min[2] = z;
  if (x > aabb.max[0]) aabb.max[0] = x;
  if (y > aabb.max[1]) aabb.max[1] = y;
  if (z > aabb.max[2]) aabb.max[2] = z;
}

export function aabbFromPositions(positions: Float32Array): MeshAabb {
  const aabb = emptyAabb();
  for (let i = 0; i + 2 < positions.length; i += 3) {
    expandAabb(aabb, positions[i], positions[i + 1], positions[i + 2]);
  }
  if (!Number.isFinite(aabb.min[0])) {
    return { min: [0, 0, 0], max: [0, 0, 0] };
  }
  return aabb;
}

/** Print STL convention: Z-up → internal Y-up (Y = old Z, Z = -old Y). */
export function transformPositionsZUpToYUp(positions: Float32Array): void {
  for (let i = 0; i + 2 < positions.length; i += 3) {
    const x = positions[i];
    const y = positions[i + 1];
    const z = positions[i + 2];
    positions[i] = x;
    positions[i + 1] = z;
    positions[i + 2] = -y;
  }
}

export function computeSmoothNormals(positions: Float32Array): Float32Array {
  const normals = new Float32Array(positions.length);
  for (let i = 0; i + 8 < positions.length; i += 9) {
    const ax = positions[i]; const ay = positions[i + 1]; const az = positions[i + 2];
    const bx = positions[i + 3]; const by = positions[i + 4]; const bz = positions[i + 5];
    const cx = positions[i + 6]; const cy = positions[i + 7]; const cz = positions[i + 8];
    const abx = bx - ax; const aby = by - ay; const abz = bz - az;
    const acx = cx - ax; const acy = cy - ay; const acz = cz - az;
    let nx = aby * acz - abz * acy;
    let ny = abz * acx - abx * acz;
    let nz = abx * acy - aby * acx;
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len; ny /= len; nz /= len;
    for (let k = 0; k < 3; k++) {
      normals[i + k * 3] = nx;
      normals[i + k * 3 + 1] = ny;
      normals[i + k * 3 + 2] = nz;
    }
  }
  return normals;
}

export function assertTriangleBudget(triangleCount: number): void {
  if (triangleCount < 1) throw new Error('MODEL_EMPTY');
  if (triangleCount > MODEL_MAX_TRIANGLES) throw new Error('MODEL_TOO_MANY_TRIANGLES');
}

/** AABB size in grid units (mm → grids). */
export function aabbToGridSize(
  aabb: MeshAabb,
  mmPerGrid: number = MODEL_MM_PER_GRID_DEFAULT,
): { width: number; depth: number; height: number } {
  const sx = Math.max(0, aabb.max[0] - aabb.min[0]);
  const sy = Math.max(0, aabb.max[1] - aabb.min[1]);
  const sz = Math.max(0, aabb.max[2] - aabb.min[2]);
  const g = Math.max(1e-6, mmPerGrid);
  return {
    width: sx / g,
    height: sy / g,
    depth: sz / g,
  };
}
