import {
  buildingBboxToLocal,
  buildingRingToOrientedLocal,
  envelopeToLocalFrame,
  latLonToPlateauLocal,
  latLonToWebMercatorMeters,
} from './geo-mercator';

describe('geo-mercator', () => {
  // Rough Tokyo / Shibuya box
  const tokyo = {
    minLat: 35.65,
    maxLat: 35.66,
    minLon: 139.69,
    maxLon: 139.71,
  };

  it('latLonToWebMercatorMeters grows east and north', () => {
    const a = latLonToWebMercatorMeters(35.65, 139.69);
    const b = latLonToWebMercatorMeters(35.66, 139.71);
    expect(b.x).toBeGreaterThan(a.x);
    expect(b.y).toBeGreaterThan(a.y);
  });

  it('envelopeToLocalFrame has positive width/depth', () => {
    const frame = envelopeToLocalFrame(tokyo);
    expect(frame.width).toBeGreaterThan(100);
    expect(frame.depth).toBeGreaterThan(100);
    expect(frame.east).toBeGreaterThan(frame.west);
    expect(frame.north).toBeGreaterThan(frame.south);
  });

  it('NW corner has smaller Z than SE (Z increases south)', () => {
    const frame = envelopeToLocalFrame(tokyo);
    const nw = latLonToPlateauLocal(tokyo.maxLat, tokyo.minLon, frame);
    const se = latLonToPlateauLocal(tokyo.minLat, tokyo.maxLon, frame);
    expect(nw.x).toBeLessThan(se.x);
    expect(nw.z).toBeLessThan(se.z);
    expect(nw.z).toBeCloseTo(0, 0);
  });

  it('northern building bbox has smaller z and UV v near 0', () => {
    const frame = envelopeToLocalFrame(tokyo);
    const northBldg = buildingBboxToLocal(
      { minLat: 35.658, maxLat: 35.659, minLon: 139.695, maxLon: 139.696 },
      frame,
    );
    const southBldg = buildingBboxToLocal(
      { minLat: 35.651, maxLat: 35.652, minLon: 139.695, maxLon: 139.696 },
      frame,
    );
    expect(northBldg.z).toBeLessThan(southBldg.z);
    const vNorth = (northBldg.z + northBldg.d / 2) / frame.depth;
    const vSouth = (southBldg.z + southBldg.d / 2) / frame.depth;
    expect(vNorth).toBeLessThan(0.4);
    expect(vSouth).toBeGreaterThan(0.6);
  });

  it('oriented box is tighter than geo AABB for a rotated footprint', () => {
    const frame = envelopeToLocalFrame(tokyo);
    const cx = frame.width / 2;
    const cz = frame.depth / 2;
    const yaw = 30 * Math.PI / 180;
    const cos = Math.cos(yaw);
    const sin = Math.sin(yaw);
    const localCorners = [
      [-15, -10], [15, -10], [15, 10], [-15, 10],
    ].map(([dx, dz]) => ({
      x: cx + dx * cos + dz * sin,
      z: cz - dx * sin + dz * cos,
    }));
    const ring = localCorners.map(p => {
      const mx = frame.west + p.x;
      const my = frame.north - p.z;
      const lon = (mx / 6378137) * (180 / Math.PI);
      const lat = (2 * Math.atan(Math.exp(my / 6378137)) - Math.PI / 2) * (180 / Math.PI);
      return { lat, lon };
    });
    const aabb = buildingBboxToLocal(
      {
        minLat: Math.min(...ring.map(c => c.lat)),
        maxLat: Math.max(...ring.map(c => c.lat)),
        minLon: Math.min(...ring.map(c => c.lon)),
        maxLon: Math.max(...ring.map(c => c.lon)),
      },
      frame,
    );
    const obb = buildingRingToOrientedLocal(ring, frame);
    expect(obb.w * obb.d).toBeLessThan(aabb.w * aabb.d * 0.85);
    expect(Math.abs(Math.abs(obb.yawDeg) - 30)).toBeLessThan(3);
    expect(obb.w).toBeCloseTo(30, 0);
    expect(obb.d).toBeCloseTo(20, 0);
  });
});
