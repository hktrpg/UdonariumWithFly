/** Geographic WGS84 bbox (degrees). Same shape as PlateauGmlEnvelope. */
export type LatLonBox = {
  minLat: number;
  maxLat: number;
  minLon: number;
  maxLon: number;
};

/** WGS84 / Web Mercator sphere radius (EPSG:3857). */
const R = 6378137;

export type MercatorXy = { x: number; y: number };

/**
 * Local pack frame matching GSI aerial (north at image top / table Y≈0):
 * X = east from west edge, Z = south from north edge.
 */
export type PlateauLocalFrame = {
  west: number;
  east: number;
  north: number;
  south: number;
  width: number;
  depth: number;
};

/** EPSG:3857 metres from WGS84 lat/lon degrees. */
export function latLonToWebMercatorMeters(lat: number, lon: number): MercatorXy {
  const clamped = Math.max(-85.05112878, Math.min(85.05112878, lat));
  const x = (R * lon * Math.PI) / 180;
  const y = R * Math.log(Math.tan(Math.PI / 4 + (clamped * Math.PI) / 360));
  return { x, y };
}

/** Envelope → local metres with origin at NW (Z increases south). */
export function envelopeToLocalFrame(env: LatLonBox): PlateauLocalFrame {
  const sw = latLonToWebMercatorMeters(env.minLat, env.minLon);
  const se = latLonToWebMercatorMeters(env.minLat, env.maxLon);
  const nw = latLonToWebMercatorMeters(env.maxLat, env.minLon);
  const ne = latLonToWebMercatorMeters(env.maxLat, env.maxLon);
  const west = Math.min(sw.x, se.x, nw.x, ne.x);
  const east = Math.max(sw.x, se.x, nw.x, ne.x);
  const south = Math.min(sw.y, se.y, nw.y, ne.y);
  const north = Math.max(sw.y, se.y, nw.y, ne.y);
  return {
    west,
    east,
    north,
    south,
    width: Math.max(40, east - west),
    depth: Math.max(40, north - south),
  };
}

/** Lat/lon point → pack local metres (X east, Z south from NW). */
export function latLonToPlateauLocal(
  lat: number,
  lon: number,
  frame: PlateauLocalFrame,
): { x: number; z: number } {
  const m = latLonToWebMercatorMeters(lat, lon);
  return {
    x: m.x - frame.west,
    z: frame.north - m.y,
  };
}

/** Building geographic bbox → pack min-corner + size in the local frame. */
export function buildingBboxToLocal(
  box: LatLonBox,
  frame: PlateauLocalFrame,
): { x: number; z: number; w: number; d: number } {
  const a = latLonToPlateauLocal(box.minLat, box.minLon, frame);
  const b = latLonToPlateauLocal(box.minLat, box.maxLon, frame);
  const c = latLonToPlateauLocal(box.maxLat, box.minLon, frame);
  const d = latLonToPlateauLocal(box.maxLat, box.maxLon, frame);
  const xs = [a.x, b.x, c.x, d.x];
  const zs = [a.z, b.z, c.z, d.z];
  const x0 = Math.min(...xs);
  const z0 = Math.min(...zs);
  return {
    x: x0,
    z: z0,
    w: Math.max(2, Math.max(...xs) - x0),
    d: Math.max(2, Math.max(...zs) - z0),
  };
}

export type OrientedLocalBox = {
  /** Axis-aligned min-corner before yaw (center − half size). */
  x: number;
  z: number;
  w: number;
  d: number;
  /** Degrees; positive rotates the box from +X toward +Z (east toward south). */
  yawDeg: number;
  cx: number;
  cz: number;
};

/**
 * Min-area oriented box for a lat/lon ring in the pack local frame.
 * Terrain is authored axis-aligned then rotated by `yawDeg` around its center.
 */
export function buildingRingToOrientedLocal(
  ring: { lat: number; lon: number }[],
  frame: PlateauLocalFrame,
): OrientedLocalBox {
  const pts = (ring || [])
    .filter(p => Number.isFinite(p.lat) && Number.isFinite(p.lon))
    .map(p => latLonToPlateauLocal(p.lat, p.lon, frame));
  if (pts.length < 3) {
    const xs = pts.map(p => p.x);
    const zs = pts.map(p => p.z);
    const x0 = xs.length ? Math.min(...xs) : 0;
    const z0 = zs.length ? Math.min(...zs) : 0;
    const w = xs.length ? Math.max(2, Math.max(...xs) - x0) : 2;
    const d = zs.length ? Math.max(2, Math.max(...zs) - z0) : 2;
    return { x: x0, z: z0, w, d, yawDeg: 0, cx: x0 + w / 2, cz: z0 + d / 2 };
  }
  // Drop duplicate closing vertex.
  if (pts.length > 1) {
    const a = pts[0];
    const b = pts[pts.length - 1];
    if (Math.hypot(a.x - b.x, a.z - b.z) < 1e-6) pts.pop();
  }

  let bestArea = Infinity;
  let best = { yaw: 0, w: 2, d: 2, cx: 0, cz: 0 };
  for (let deg = 0; deg < 180; deg += 1) {
    const rad = (deg * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (const p of pts) {
      const rx = p.x * cos + p.z * sin;
      const rz = -p.x * sin + p.z * cos;
      if (rx < minX) minX = rx;
      if (rx > maxX) maxX = rx;
      if (rz < minZ) minZ = rz;
      if (rz > maxZ) maxZ = rz;
    }
    const w = Math.max(1e-6, maxX - minX);
    const d = Math.max(1e-6, maxZ - minZ);
    const area = w * d;
    if (area >= bestArea) continue;
    const rcx = (minX + maxX) / 2;
    const rcz = (minZ + maxZ) / 2;
    // Inverse rotation back to pack frame.
    best = {
      yaw: deg,
      w,
      d,
      cx: rcx * cos - rcz * sin,
      cz: rcx * sin + rcz * cos,
    };
    bestArea = area;
  }

  let w = Math.max(2, best.w);
  let d = Math.max(2, best.d);
  // Points were rotated clockwise by `yaw` to axis-align ⇒ box rotates by the same angle.
  let yawDeg = best.yaw;
  // Prefer width ≥ depth so yaw is unique mod 180°.
  if (w < d) {
    const t = w;
    w = d;
    d = t;
    yawDeg += 90;
  }
  if (yawDeg > 90) yawDeg -= 180;
  if (yawDeg <= -90) yawDeg += 180;
  return {
    x: best.cx - w / 2,
    z: best.cz - d / 2,
    w,
    d,
    yawDeg,
    cx: best.cx,
    cz: best.cz,
  };
}
