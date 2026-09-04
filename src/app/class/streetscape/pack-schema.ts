import { STREETSCAPE_ERRORS } from './errors';

export type StreetscapeQualityV1 = {
  bakeMaxEdgePx: number;
  fitGrid: boolean;
  featureSort: 'distanceToOrigin' | 'manifestOrder';
  unknownKind: 'import' | 'skip';
};

export type StreetscapeFeatureV1 = {
  id: string;
  kind: string;
  path: string;
  positionMeters: { x: number; z: number };
  yawDeg?: number;
  sizeMeters?: { w: number; d: number; h: number };
};

export type StreetscapePackV1 = {
  version: 1;
  id: string;
  title: string;
  attribution: string;
  metersPerUnit: number;
  axis?: 'y-up' | 'z-up';
  origin: { x: number; z: number };
  extentMeters: { width: number; depth: number };
  floor: { path: string };
  features: StreetscapeFeatureV1[];
  quality?: Partial<StreetscapeQualityV1>;
  /**
   * Open3Dhk live-download hint so「另存街景包」→ re-import can still
   * download textured facades for the same sheet / building ids.
   */
  open3dhk?: {
    sheet: string;
    format?: 'GLTF' | 'GLTF0';
    worldExtent: { minX: number; maxX: number; minZ: number; maxZ: number };
  };
};

const QUALITY_SORT = new Set(['distanceToOrigin', 'manifestOrder']);
const UNKNOWN_KIND = new Set(['import', 'skip']);

export function parseStreetscapePackV1(raw: unknown): StreetscapePackV1 {
  if (!raw || typeof raw !== 'object') throw new Error(STREETSCAPE_ERRORS.INVALID_PACK);
  const o = raw as Record<string, unknown>;
  if (o.version !== 1) throw new Error(STREETSCAPE_ERRORS.INVALID_PACK);
  const id = asNonEmptyString(o.id);
  const title = asNonEmptyString(o.title);
  const attribution = typeof o.attribution === 'string' ? o.attribution : '';
  const metersPerUnit = asPositiveNumber(o.metersPerUnit);
  const origin = asXZ(o.origin);
  const extent = asExtent(o.extentMeters);
  const floor = asFloor(o.floor);
  if (!id || !title || metersPerUnit == null || !origin || !extent || !floor) {
    throw new Error(STREETSCAPE_ERRORS.INVALID_PACK);
  }
  if (!Array.isArray(o.features)) {
    throw new Error(STREETSCAPE_ERRORS.INVALID_PACK);
  }
  // Empty features allowed for map-only (floor) packs; facades can be appended later.
  const features = o.features.map(parseFeature);
  const axis = o.axis === 'z-up' ? 'z-up' : 'y-up';
  const quality = parseQualityPartial(o.quality);
  const open3dhk = parseOpen3dhkMeta(o.open3dhk);
  return {
    version: 1,
    id,
    title,
    attribution,
    metersPerUnit,
    axis,
    origin,
    extentMeters: extent,
    floor,
    features,
    ...(quality ? { quality } : {}),
    ...(open3dhk ? { open3dhk } : {}),
  };
}

function parseOpen3dhkMeta(raw: unknown): StreetscapePackV1['open3dhk'] | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const o = raw as Record<string, unknown>;
  const sheet = asNonEmptyString(o.sheet);
  const extent = asWorldExtent(o.worldExtent);
  if (!sheet || !extent) return undefined;
  const format = o.format === 'GLTF' || o.format === 'GLTF0' ? o.format : undefined;
  return { sheet, worldExtent: extent, ...(format ? { format } : {}) };
}

function asWorldExtent(v: unknown): { minX: number; maxX: number; minZ: number; maxZ: number } | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const minX = typeof o.minX === 'number' && Number.isFinite(o.minX) ? o.minX : null;
  const maxX = typeof o.maxX === 'number' && Number.isFinite(o.maxX) ? o.maxX : null;
  const minZ = typeof o.minZ === 'number' && Number.isFinite(o.minZ) ? o.minZ : null;
  const maxZ = typeof o.maxZ === 'number' && Number.isFinite(o.maxZ) ? o.maxZ : null;
  if (minX == null || maxX == null || minZ == null || maxZ == null) return null;
  if (!(maxX > minX) || !(maxZ > minZ)) return null;
  return { minX, maxX, minZ, maxZ };
}

function parseFeature(raw: unknown): StreetscapeFeatureV1 {
  if (!raw || typeof raw !== 'object') throw new Error(STREETSCAPE_ERRORS.INVALID_PACK);
  const o = raw as Record<string, unknown>;
  const id = asNonEmptyString(o.id);
  const path = asNonEmptyString(o.path);
  const pos = asXZ(o.positionMeters);
  if (!id || !path || !pos) throw new Error(STREETSCAPE_ERRORS.INVALID_PACK);
  const kind = typeof o.kind === 'string' && o.kind.trim() ? o.kind.trim() : 'building';
  const yawDeg = typeof o.yawDeg === 'number' && Number.isFinite(o.yawDeg) ? o.yawDeg : undefined;
  const size = asSize(o.sizeMeters);
  return { id, kind, path, positionMeters: pos, ...(yawDeg != null ? { yawDeg } : {}), ...(size ? { sizeMeters: size } : {}) };
}

function parseQualityPartial(raw: unknown): Partial<StreetscapeQualityV1> | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const o = raw as Record<string, unknown>;
  const out: Partial<StreetscapeQualityV1> = {};
  if (typeof o.bakeMaxEdgePx === 'number' && o.bakeMaxEdgePx > 0) out.bakeMaxEdgePx = o.bakeMaxEdgePx;
  if (typeof o.fitGrid === 'boolean') out.fitGrid = o.fitGrid;
  if (typeof o.featureSort === 'string' && QUALITY_SORT.has(o.featureSort)) {
    out.featureSort = o.featureSort as StreetscapeQualityV1['featureSort'];
  }
  if (typeof o.unknownKind === 'string' && UNKNOWN_KIND.has(o.unknownKind)) {
    out.unknownKind = o.unknownKind as StreetscapeQualityV1['unknownKind'];
  }
  return Object.keys(out).length ? out : undefined;
}

function asNonEmptyString(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

function asPositiveNumber(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null;
}

function asXZ(v: unknown): { x: number; z: number } | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  if (typeof o.x !== 'number' || !Number.isFinite(o.x)) return null;
  if (typeof o.z !== 'number' || !Number.isFinite(o.z)) return null;
  return { x: o.x, z: o.z };
}

function asExtent(v: unknown): { width: number; depth: number } | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const width = asPositiveNumber(o.width);
  const depth = asPositiveNumber(o.depth);
  if (width == null || depth == null) return null;
  return { width, depth };
}

function asFloor(v: unknown): { path: string } | null {
  if (!v || typeof v !== 'object') return null;
  const path = asNonEmptyString((v as Record<string, unknown>).path);
  return path ? { path } : null;
}

function asSize(v: unknown): { w: number; d: number; h: number } | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const o = v as Record<string, unknown>;
  const w = asPositiveNumber(o.w);
  const d = asPositiveNumber(o.d);
  const h = asPositiveNumber(o.h);
  if (w == null || d == null || h == null) return undefined;
  return { w, d, h };
}
