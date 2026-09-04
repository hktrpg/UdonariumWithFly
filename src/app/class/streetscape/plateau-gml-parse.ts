export type PlateauLatLon = { lat: number; lon: number };

export type PlateauBuildingFootprint = {
  id: string;
  /** Metres. */
  height: number;
  /** Geographic bbox (EPSG:6697 / WGS84 lat-lon). */
  minLat: number;
  maxLat: number;
  minLon: number;
  maxLon: number;
  /** Exterior ring (lat/lon), closed or open. */
  ring: PlateauLatLon[];
};

export type PlateauGmlEnvelope = {
  minLat: number;
  maxLat: number;
  minLon: number;
  maxLon: number;
};

/** Parse PLATEAU Building CityGML (lod0RoofEdge / lod0FootPrint + measuredHeight). */
export function parsePlateauBuildingsFromGml(text: string): {
  envelope: PlateauGmlEnvelope | null;
  buildings: PlateauBuildingFootprint[];
} {
  const envelope = parseEnvelope(text);
  const parts = String(text || '').split(/<bldg:Building\b/i);
  const buildings: PlateauBuildingFootprint[] = [];
  for (let i = 1; i < parts.length; i++) {
    const part = parts[i];
    const idMatch = /gml:id="([^"]+)"/i.exec(part);
    if (!idMatch) continue;
    const heightMatch = /<bldg:measuredHeight[^>]*>([^<]+)<\/bldg:measuredHeight>/i.exec(part);
    const rawH = Number(heightMatch?.[1]);
    // PLATEAU sentinel -9999 / non-positive → default storey height.
    const height = (Number.isFinite(rawH) && rawH > 0) ? Math.max(3, rawH) : 10;
    const posMatch = /<bldg:lod0RoofEdge>[\s\S]*?<gml:posList>([^<]+)<\/gml:posList>/i.exec(part)
      || /<bldg:lod0FootPrint>[\s\S]*?<gml:posList>([^<]+)<\/gml:posList>/i.exec(part);
    if (!posMatch) continue;
    const nums = posMatch[1].trim().split(/[\s]+/).map(Number).filter(n => Number.isFinite(n));
    if (nums.length < 6) continue;
    const ring: PlateauLatLon[] = [];
    for (let k = 0; k + 1 < nums.length; k += 3) {
      ring.push({ lat: nums[k], lon: nums[k + 1] });
    }
    if (ring.length < 3) continue;
    const lats = ring.map(p => p.lat);
    const lons = ring.map(p => p.lon);
    buildings.push({
      id: idMatch[1],
      height,
      minLat: Math.min(...lats),
      maxLat: Math.max(...lats),
      minLon: Math.min(...lons),
      maxLon: Math.max(...lons),
      ring,
    });
  }
  return { envelope, buildings };
}

function parseEnvelope(text: string): PlateauGmlEnvelope | null {
  const lower = /<gml:lowerCorner>([^<]+)<\/gml:lowerCorner>/i.exec(text);
  const upper = /<gml:upperCorner>([^<]+)<\/gml:upperCorner>/i.exec(text);
  if (!lower || !upper) return null;
  const a = lower[1].trim().split(/[\s]+/).map(Number);
  const b = upper[1].trim().split(/[\s]+/).map(Number);
  if (a.length < 2 || b.length < 2) return null;
  if (![...a.slice(0, 2), ...b.slice(0, 2)].every(Number.isFinite)) return null;
  return {
    minLat: Math.min(a[0], b[0]),
    maxLat: Math.max(a[0], b[0]),
    minLon: Math.min(a[1], b[1]),
    maxLon: Math.max(a[1], b[1]),
  };
}

/** Equirectangular metres relative to origin (lat0, lon0). X=east, Z=north. */
export function latLonToLocalMeters(
  lat: number,
  lon: number,
  lat0: number,
  lon0: number,
): { x: number; z: number } {
  const mPerDegLat = 110540;
  const mPerDegLon = 111320 * Math.cos((lat0 * Math.PI) / 180);
  return {
    x: (lon - lon0) * mPerDegLon,
    z: (lat - lat0) * mPerDegLat,
  };
}

export function selectPlateauBuildings(
  buildings: PlateauBuildingFootprint[],
  maxN: number,
  excludeIds?: string[] | null,
): PlateauBuildingFootprint[] {
  const exclude = new Set((excludeIds || []).map(id => String(id || '').trim().toLowerCase()).filter(Boolean));
  let pool = buildings.filter(b => !exclude.has(b.id.toLowerCase()));
  if (!pool.length) return [];
  const cx = pool.reduce((s, b) => s + (b.minLon + b.maxLon) / 2, 0) / pool.length;
  const cy = pool.reduce((s, b) => s + (b.minLat + b.maxLat) / 2, 0) / pool.length;
  const cap = Math.max(1, Math.floor(Number(maxN) || 1));
  return pool
    .slice()
    .sort((a, b) => {
      const da = Math.hypot(((a.minLon + a.maxLon) / 2) - cx, ((a.minLat + a.maxLat) / 2) - cy);
      const db = Math.hypot(((b.minLon + b.maxLon) / 2) - cx, ((b.minLat + b.maxLat) / 2) - cy);
      const areaA = Math.max(1e-12, (a.maxLat - a.minLat) * (a.maxLon - a.minLon));
      const areaB = Math.max(1e-12, (b.maxLat - b.minLat) * (b.maxLon - b.minLon));
      return (da - db) || (areaB - areaA);
    })
    .slice(0, cap);
}
