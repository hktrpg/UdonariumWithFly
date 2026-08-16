import { MeshAabb } from './mesh-ir';

/** World-space half-spaces: keep points with normal·p + constant >= 0. */
export type ClipPlane = {
  normal: [number, number, number];
  constant: number;
};

export type AabbClipOpts = {
  /** Expand the keep-volume on every axis (fraction of that axis length). */
  inflateFrac?: number;
  /** Extra world units added on every side (seam / parapet slack). */
  inflateWorld?: number;
};

/**
 * Six planes that keep the interior of `aabb`, expanded so shared cut faces and
 * parapets are not shaved (tight clips caused transparent terrain seams).
 */
export function aabbClipPlanes(aabb: MeshAabb, opts: AabbClipOpts | number = {}): ClipPlane[] {
  const o: AabbClipOpts = typeof opts === 'number' ? { inflateFrac: opts } : opts;
  const inflateFrac = o.inflateFrac ?? 0.02;
  const inflateWorld = o.inflateWorld ?? 0;
  const sx = Math.max(1e-9, aabb.max[0] - aabb.min[0]);
  const sy = Math.max(1e-9, aabb.max[1] - aabb.min[1]);
  const sz = Math.max(1e-9, aabb.max[2] - aabb.min[2]);
  const ix = sx * inflateFrac + inflateWorld;
  const iy = sy * inflateFrac + inflateWorld;
  const iz = sz * inflateFrac + inflateWorld;
  return planesForBounds(
    aabb.min[0] - ix,
    aabb.max[0] + ix,
    aabb.min[1] - iy,
    aabb.max[1] + iy,
    aabb.min[2] - iz,
    aabb.max[2] + iz,
  );
}

/**
 * Clip only toward siblings that are separated by a gap (F/U wings).
 * Abutting cut faces are left open so seam geometry stays opaque.
 * Y is never clipped (roof trim / antennas).
 */
export function siblingBleedClipPlanes(
  box: MeshAabb,
  siblings: MeshAabb[],
  slackWorld: number,
): ClipPlane[] {
  const slack = Math.max(1e-4, slackWorld);
  const planes: ClipPlane[] = [];
  for (const sib of siblings) {
    // Fully east of this box (gap) → keep x <= box.max + slack
    if (sib.min[0] >= box.max[0] + slack * 0.25) {
      planes.push({ normal: [-1, 0, 0], constant: box.max[0] + slack });
    }
    // Fully west
    if (sib.max[0] <= box.min[0] - slack * 0.25) {
      planes.push({ normal: [1, 0, 0], constant: -(box.min[0] - slack) });
    }
    // Fully north (+Z)
    if (sib.min[2] >= box.max[2] + slack * 0.25) {
      planes.push({ normal: [0, 0, -1], constant: box.max[2] + slack });
    }
    // Fully south (−Z)
    if (sib.max[2] <= box.min[2] - slack * 0.25) {
      planes.push({ normal: [0, 0, 1], constant: -(box.min[2] - slack) });
    }
  }
  return dedupePlanes(planes);
}

function planesForBounds(
  minX: number,
  maxX: number,
  minY: number,
  maxY: number,
  minZ: number,
  maxZ: number,
): ClipPlane[] {
  return [
    { normal: [1, 0, 0], constant: -minX },
    { normal: [-1, 0, 0], constant: maxX },
    { normal: [0, 1, 0], constant: -minY },
    { normal: [0, -1, 0], constant: maxY },
    { normal: [0, 0, 1], constant: -minZ },
    { normal: [0, 0, -1], constant: maxZ },
  ];
}

function dedupePlanes(planes: ClipPlane[]): ClipPlane[] {
  const out: ClipPlane[] = [];
  for (const p of planes) {
    const dup = out.some(
      q =>
        q.normal[0] === p.normal[0]
        && q.normal[1] === p.normal[1]
        && q.normal[2] === p.normal[2]
        && Math.abs(q.constant - p.constant) < 1e-9,
    );
    if (!dup) out.push(p);
  }
  return out;
}

/** True if a world point is inside all planes (same test as GPU clipping). */
export function pointInsideClipPlanes(
  x: number,
  y: number,
  z: number,
  planes: ClipPlane[],
): boolean {
  for (const p of planes) {
    if (p.normal[0] * x + p.normal[1] * y + p.normal[2] * z + p.constant < -1e-9) {
      return false;
    }
  }
  return true;
}
