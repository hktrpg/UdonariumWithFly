import { BUILTIN_STREETSCAPE_CAPS } from './caps';
import {
  buildingBboxToLocal,
  envelopeToLocalFrame,
  latLonToPlateauLocal,
} from './geo-mercator';
import {
  latLonToGsiCropUv,
  lonToTileX,
  latToTileY,
} from './gsi-aerial-floor';
import { featureCenterTablePx, streetscapeScaleFromPack } from './placement';
import { StreetscapePackV1 } from './pack-schema';

describe('GSI aerial ↔ local-frame UV align', () => {
  // Anjo-scale box — large enough that envelopeToLocalFrame does not hit the 40 m pad.
  const env = {
    minLat: 34.888,
    maxLat: 34.892,
    minLon: 137.028,
    maxLon: 137.037,
  };

  it('local-frame UV matches GSI tile-crop UV for interior points', () => {
    const frame = envelopeToLocalFrame(env);
    expect(frame.width).toBeGreaterThan(40);
    expect(frame.depth).toBeGreaterThan(40);

    const samples: [number, number][] = [
      [(env.minLat + env.maxLat) / 2, (env.minLon + env.maxLon) / 2],
      [env.minLat + 0.001, env.minLon + 0.002],
      [env.maxLat - 0.0005, env.maxLon - 0.001],
      [env.minLat + 0.0001, env.maxLon - 0.0001],
    ];

    for (const [lat, lon] of samples) {
      const local = latLonToPlateauLocal(lat, lon, frame);
      const uLocal = local.x / frame.width;
      const vLocal = local.z / frame.depth;
      const crop = latLonToGsiCropUv(lat, lon, env);
      expect(uLocal).toBeCloseTo(crop.u, 6);
      expect(vLocal).toBeCloseTo(crop.v, 6);
    }
  });

  it('NW corner is near UV (0,0) and SE near (1,1)', () => {
    const frame = envelopeToLocalFrame(env);
    const nw = latLonToPlateauLocal(env.maxLat, env.minLon, frame);
    const se = latLonToPlateauLocal(env.minLat, env.maxLon, frame);
    expect(nw.x / frame.width).toBeCloseTo(0, 5);
    expect(nw.z / frame.depth).toBeCloseTo(0, 5);
    expect(se.x / frame.width).toBeCloseTo(1, 5);
    expect(se.z / frame.depth).toBeCloseTo(1, 5);

    const nwCrop = latLonToGsiCropUv(env.maxLat, env.minLon, env);
    const seCrop = latLonToGsiCropUv(env.minLat, env.maxLon, env);
    expect(nwCrop.u).toBeCloseTo(0, 5);
    expect(nwCrop.v).toBeCloseTo(0, 5);
    expect(seCrop.u).toBeCloseTo(1, 5);
    expect(seCrop.v).toBeCloseTo(1, 5);
  });

  it('tile X grows with lon and tile Y grows south', () => {
    const z = 16;
    expect(lonToTileX(env.maxLon, z)).toBeGreaterThan(lonToTileX(env.minLon, z));
    expect(latToTileY(env.minLat, z)).toBeGreaterThan(latToTileY(env.maxLat, z));
  });

  it('Anjo-scale building center: table cell fraction equals GSI crop UV', () => {
    // Mesh 52372062 approximate envelope (metres ~1023×480).
    const anjo = {
      minLat: 34.88818026503288,
      maxLat: 34.89171947518546,
      minLon: 137.02780301915928,
      maxLon: 137.0369972696232,
    };
    const bldg = {
      minLat: 34.8895,
      maxLat: 34.8898,
      minLon: 137.031,
      maxLon: 137.0314,
    };
    const frame = envelopeToLocalFrame(anjo);
    const box = buildingBboxToLocal(bldg, frame);
    const pack: StreetscapePackV1 = {
      version: 1,
      id: 'anjo',
      title: 't',
      attribution: '',
      metersPerUnit: 1,
      origin: { x: 0, z: 0 },
      extentMeters: { width: frame.width, depth: frame.depth },
      floor: { path: 'floor.jpg' },
      features: [
        {
          id: 'b1',
          kind: 'building',
          path: 'b.stl',
          positionMeters: { x: box.x, z: box.z },
          sizeMeters: { w: box.w, d: box.d, h: 10 },
        },
      ],
    };
    const scale = streetscapeScaleFromPack(pack, BUILTIN_STREETSCAPE_CAPS, 50);
    const center = featureCenterTablePx(pack.features[0], pack, scale);
    const tableU = (center.x / scale.gridPx) / scale.tableCellsX;
    const tableV = (center.y / scale.gridPx) / scale.tableCellsY;
    const lat = (bldg.minLat + bldg.maxLat) / 2;
    const lon = (bldg.minLon + bldg.maxLon) / 2;
    const crop = latLonToGsiCropUv(lat, lon, anjo);
    expect(tableU).toBeCloseTo(crop.u, 4);
    expect(tableV).toBeCloseTo(crop.v, 4);
  });
});
