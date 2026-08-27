import { attachPackagePath } from '@udonarium/terrain-model/model-package-files';

import { composeStreetscapeFloor } from './floor-composer';
import { createPackLoad } from './pack-file-source';
import {
  latLonToLocalMeters,
  PlateauBuildingFootprint,
  PlateauGmlEnvelope,
  selectPlateauBuildings,
} from './plateau-gml-parse';
import { StreetscapeFeatureV1, StreetscapePackV1, parseStreetscapePackV1 } from './pack-schema';
import { streetscapeScaleFromPack } from './placement';
import { BUILTIN_STREETSCAPE_CAPS } from './caps';
import { StreetscapePackLoad } from './source';

/** Build a Streetscape pack from parsed PLATEAU footprints (gray AABB boxes). */
export function buildPlateauStreetscapePack(opts: {
  cityCode: string;
  cityName: string;
  meshCode: string;
  envelope: PlateauGmlEnvelope | null;
  buildings: PlateauBuildingFootprint[];
  maxFeatures: number;
  excludeBuildingIds?: string[];
  title?: string;
}): StreetscapePackLoad {
  const selected = selectPlateauBuildings(opts.buildings, opts.maxFeatures, opts.excludeBuildingIds);
  const env = opts.envelope || envelopeFromBuildings(opts.buildings);
  const lat0 = env.minLat;
  const lon0 = env.minLon;
  const sw = latLonToLocalMeters(env.minLat, env.minLon, lat0, lon0);
  const ne = latLonToLocalMeters(env.maxLat, env.maxLon, lat0, lon0);
  const minX = Math.min(sw.x, ne.x);
  const maxX = Math.max(sw.x, ne.x);
  const minZ = Math.min(sw.z, ne.z);
  const maxZ = Math.max(sw.z, ne.z);
  const width = Math.max(40, maxX - minX);
  const depth = Math.max(40, maxZ - minZ);

  const features: StreetscapeFeatureV1[] = selected.map(b => {
    const a = latLonToLocalMeters(b.minLat, b.minLon, lat0, lon0);
    const c = latLonToLocalMeters(b.maxLat, b.maxLon, lat0, lon0);
    const x0 = Math.min(a.x, c.x) - minX;
    const z0 = Math.min(a.z, c.z) - minZ;
    const w = Math.max(2, Math.abs(c.x - a.x));
    const d = Math.max(2, Math.abs(c.z - a.z));
    const safeId = sanitizeFeatureId(b.id);
    return {
      id: b.id,
      kind: 'building',
      path: `buildings/${safeId}.stl`,
      positionMeters: { x: x0, z: z0 },
      sizeMeters: { w, d, h: b.height },
    };
  });

  const packRaw: StreetscapePackV1 = {
    version: 1,
    id: `plateau-${opts.cityCode}-${opts.meshCode}`,
    title: opts.title || `PLATEAU ${opts.cityName} ${opts.meshCode}`,
    attribution: `Project PLATEAU / MLIT — ${opts.cityName} (${opts.meshCode}); CC BY 4.0`,
    metersPerUnit: 1,
    axis: 'y-up',
    origin: { x: 0, z: 0 },
    extentMeters: { width, depth },
    floor: { path: 'floor.png' },
    features,
    quality: { bakeMaxEdgePx: 512, fitGrid: false, featureSort: 'distanceToOrigin' },
  };
  const pack = parseStreetscapePackV1(packRaw);
  const scale = streetscapeScaleFromPack(pack, BUILTIN_STREETSCAPE_CAPS, 50);
  let floorBlob: Blob;
  try {
    floorBlob = composeStreetscapeFloor(pack, scale, features, { pavementCssColor: '#7a7a7a' });
  } catch {
    const b64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    floorBlob = new Blob([bytes], { type: 'image/png' });
  }
  const files: File[] = [
    attachPackagePath(new File([floorBlob], 'floor.png', { type: 'image/png' }), 'floor.png'),
  ];
  for (const feature of features) {
    const size = feature.sizeMeters || { w: 8, d: 8, h: 12 };
    const stl = asciiStlBox(feature.id, size.w, size.h, size.d);
    files.push(attachPackagePath(
      new File([stl], feature.path.split('/').pop() || 'b.stl', { type: 'model/stl' }),
      feature.path,
    ));
  }
  return {
    ...createPackLoad(pack, files),
    worldExtent: { minX: 0, maxX: width, minZ: 0, maxZ: depth },
  };
}

function envelopeFromBuildings(buildings: PlateauBuildingFootprint[]): PlateauGmlEnvelope {
  if (!buildings.length) {
    return { minLat: 35.68, maxLat: 35.69, minLon: 139.7, maxLon: 139.71 };
  }
  return {
    minLat: Math.min(...buildings.map(b => b.minLat)),
    maxLat: Math.max(...buildings.map(b => b.maxLat)),
    minLon: Math.min(...buildings.map(b => b.minLon)),
    maxLon: Math.max(...buildings.map(b => b.maxLon)),
  };
}

function sanitizeFeatureId(id: string): string {
  return String(id || 'bldg').replace(/[^a-zA-Z0-9_-]+/g, '_').slice(0, 80) || 'bldg';
}

/** Y-up box from origin (0,0,0) to (w,h,d) in metres — import treats units via metersPerUnit. */
export function asciiStlBox(name: string, w: number, h: number, d: number): string {
  const x1 = Math.max(0.5, w);
  const y1 = Math.max(0.5, h);
  const z1 = Math.max(0.5, d);
  const v = [
    [0, 0, 0], [x1, 0, 0], [x1, 0, z1], [0, 0, z1],
    [0, y1, 0], [x1, y1, 0], [x1, y1, z1], [0, y1, z1],
  ];
  const faces: [number, number, number][] = [
    [0, 1, 2], [0, 2, 3],
    [4, 6, 5], [4, 7, 6],
    [0, 4, 5], [0, 5, 1],
    [3, 2, 6], [3, 6, 7],
    [0, 3, 7], [0, 7, 4],
    [1, 5, 6], [1, 6, 2],
  ];
  const lines = [`solid ${sanitizeFeatureId(name)}`];
  for (const [a, b, c] of faces) {
    const n = faceNormal(v[a], v[b], v[c]);
    lines.push(` facet normal ${n[0]} ${n[1]} ${n[2]}`);
    lines.push('  outer loop');
    lines.push(`   vertex ${v[a][0]} ${v[a][1]} ${v[a][2]}`);
    lines.push(`   vertex ${v[b][0]} ${v[b][1]} ${v[b][2]}`);
    lines.push(`   vertex ${v[c][0]} ${v[c][1]} ${v[c][2]}`);
    lines.push('  endloop');
    lines.push(' endfacet');
  }
  lines.push('endsolid');
  return lines.join('\n');
}

function faceNormal(a: number[], b: number[], c: number[]): [number, number, number] {
  const ux = b[0] - a[0]; const uy = b[1] - a[1]; const uz = b[2] - a[2];
  const vx = c[0] - a[0]; const vy = c[1] - a[1]; const vz = c[2] - a[2];
  let nx = uy * vz - uz * vy;
  let ny = uz * vx - ux * vz;
  let nz = ux * vy - uy * vx;
  const len = Math.hypot(nx, ny, nz) || 1;
  return [nx / len, ny / len, nz / len];
}
