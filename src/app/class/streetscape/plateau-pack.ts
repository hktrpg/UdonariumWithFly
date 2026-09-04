import { attachPackagePath } from '@udonarium/terrain-model/model-package-files';

import { composeStreetscapeFloor } from './floor-composer';
import {
  buildingRingToOrientedLocal,
  envelopeToLocalFrame,
} from './geo-mercator';
import { composeGsiAerialFloorWithFootprints, GSI_AERIAL_ATTRIBUTION } from './gsi-aerial-floor';
import { createPackLoad } from './pack-file-source';
import {
  PlateauBuildingFootprint,
  PlateauGmlEnvelope,
  selectPlateauBuildings,
} from './plateau-gml-parse';
import { StreetscapeFeatureV1, StreetscapePackV1, parseStreetscapePackV1 } from './pack-schema';
import { streetscapeScaleFromPack } from './placement';
import { BUILTIN_STREETSCAPE_CAPS } from './caps';
import { StreetscapePackLoad } from './source';

/** Build a Streetscape pack from parsed PLATEAU footprints (GSI aerial floor + OBB boxes). */
export async function buildPlateauStreetscapePack(opts: {
  cityCode: string;
  cityName: string;
  meshCode: string;
  envelope: PlateauGmlEnvelope | null;
  buildings: PlateauBuildingFootprint[];
  maxFeatures: number;
  excludeBuildingIds?: string[];
  title?: string;
  signal?: AbortSignal;
}): Promise<StreetscapePackLoad> {
  const selected = selectPlateauBuildings(opts.buildings, opts.maxFeatures, opts.excludeBuildingIds);
  const env = opts.envelope || envelopeFromBuildings(opts.buildings);
  // Same Web Mercator frame as GSI aerial: X east, Z south from NW (aerial top = Z≈0).
  const frame = envelopeToLocalFrame(env);
  const width = frame.width;
  const depth = frame.depth;

  const features: StreetscapeFeatureV1[] = selected.map(b => {
    const box = buildingRingToOrientedLocal(b.ring, frame);
    const safeId = sanitizeFeatureId(b.id);
    return {
      id: b.id,
      kind: 'building',
      path: `buildings/${safeId}.stl`,
      positionMeters: { x: box.x, z: box.z },
      sizeMeters: { w: box.w, d: box.d, h: b.height },
      ...(Math.abs(box.yawDeg) > 0.5 ? { yawDeg: box.yawDeg } : {}),
    };
  });

  let attribution =
    `Project PLATEAU / MLIT — ${opts.cityName} (${opts.meshCode}); CC BY 4.0`;
  const packRaw: StreetscapePackV1 = {
    version: 1,
    id: `plateau-${opts.cityCode}-${opts.meshCode}`,
    title: opts.title || `PLATEAU ${opts.cityName} ${opts.meshCode}`,
    attribution,
    metersPerUnit: 1,
    axis: 'y-up',
    origin: { x: 0, z: 0 },
    extentMeters: { width, depth },
    floor: { path: 'floor.jpg' },
    features,
    quality: { bakeMaxEdgePx: 512, fitGrid: false, featureSort: 'distanceToOrigin' },
  };

  const scaleProbe = streetscapeScaleFromPack(
    parseStreetscapePackV1({ ...packRaw, floor: { path: 'floor.png' } }),
    BUILTIN_STREETSCAPE_CAPS,
    50,
  );
  let floorBlob: Blob | null = null;
  let floorName = 'floor.jpg';
  try {
    floorBlob = await composeGsiAerialFloorWithFootprints(env, selected, { signal: opts.signal });
    attribution = `${attribution}; ${GSI_AERIAL_ATTRIBUTION}`;
  } catch {
    floorBlob = null;
  }
  if (!floorBlob) {
    floorName = 'floor.png';
    try {
      floorBlob = composeStreetscapeFloor(
        parseStreetscapePackV1({ ...packRaw, floor: { path: 'floor.png' }, attribution }),
        scaleProbe,
        features,
        { pavementCssColor: '#7a7a7a' },
      );
    } catch {
      const b64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      floorBlob = new Blob([bytes], { type: 'image/png' });
    }
  }
  packRaw.floor = { path: floorName };
  packRaw.attribution = attribution;
  const pack = parseStreetscapePackV1(packRaw);
  const files: File[] = [
    attachPackagePath(
      new File([floorBlob], floorName, { type: floorBlob.type || 'image/jpeg' }),
      floorName,
    ),
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

/**
 * Print-convention Z-up box (X=width, Y=depth, Z=height).
 * `parseStl` always applies Z-up→Y-up; a Y-up box here would swap height/depth and look like huge slabs.
 */
export function asciiStlBox(name: string, w: number, h: number, d: number): string {
  const x1 = Math.max(0.5, w);
  const y1 = Math.max(0.5, d);
  const z1 = Math.max(0.5, h);
  const v = [
    [0, 0, 0], [x1, 0, 0], [x1, y1, 0], [0, y1, 0],
    [0, 0, z1], [x1, 0, z1], [x1, y1, z1], [0, y1, z1],
  ];
  const faces: [number, number, number][] = [
    [0, 2, 1], [0, 3, 2],
    [4, 5, 6], [4, 6, 7],
    [0, 1, 5], [0, 5, 4],
    [3, 7, 6], [3, 6, 2],
    [0, 4, 7], [0, 7, 3],
    [1, 2, 6], [1, 6, 5],
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
