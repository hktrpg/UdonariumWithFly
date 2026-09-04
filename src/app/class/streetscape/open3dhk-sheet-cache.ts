import { Open3dhkTerrainBox } from './open3dhk-map-select';
import { Open3dhkBuildingMember } from './open3dhk-sheet-pack';

/** Central-directory building list + count (no glTF bodies). */
export type Open3dhkCdCacheEntry = {
  buildingCount: number;
  buildings: Open3dhkBuildingMember[];
  at: number;
};

/** Probed glTF world positions per building id (session reuse on download). */
export type Open3dhkProbeCacheEntry = {
  terrainBox: Open3dhkTerrainBox | null;
  located: Open3dhkBuildingMember[];
  at: number;
};

const CD_CACHE_TTL_MS = 10 * 60 * 1000;
const PROBE_CACHE_TTL_MS = 30 * 60 * 1000;

const cdCache = new Map<string, Open3dhkCdCacheEntry>();
const probeCache = new Map<string, Open3dhkProbeCacheEntry>();
const inflightCd = new Map<string, Promise<Open3dhkCdCacheEntry>>();

export function open3dhkSheetCacheKey(sheet: string, format: string): string {
  return `${format}:${sheet.trim().toLowerCase()}`;
}

/** Derive cache key from a fetch URL (`…/GLTF0/11-SW-4B.zip`). */
export function open3dhkSheetCacheKeyFromUrl(url: string): string {
  try {
    const path = new URL(url, 'http://local/').pathname;
    const m = /\/(GLTF0|GLTF)\/([^/]+)\.zip$/i.exec(decodeURIComponent(path));
    if (m) return open3dhkSheetCacheKey(m[2], m[1].toUpperCase() === 'GLTF' ? 'GLTF' : 'GLTF0');
  } catch {
    // fall through
  }
  return url;
}

export function getCachedOpen3dhkCd(key: string): Open3dhkCdCacheEntry | null {
  const hit = cdCache.get(key);
  if (!hit || Date.now() - hit.at > CD_CACHE_TTL_MS) return null;
  return hit;
}

export function setCachedOpen3dhkCd(
  key: string,
  entry: Pick<Open3dhkCdCacheEntry, 'buildingCount' | 'buildings'>,
): void {
  cdCache.set(key, { ...entry, at: Date.now() });
}

export function getCachedOpen3dhkProbe(key: string): Open3dhkProbeCacheEntry | null {
  const hit = probeCache.get(key);
  if (!hit || Date.now() - hit.at > PROBE_CACHE_TTL_MS) return null;
  return hit;
}

export function mergeCachedOpen3dhkProbe(
  key: string,
  terrainBox: Open3dhkTerrainBox | null,
  located: Open3dhkBuildingMember[],
): void {
  const prev = getCachedOpen3dhkProbe(key);
  const byId = new Map<string, Open3dhkBuildingMember>();
  for (const m of prev?.located || []) byId.set(m.id.toLowerCase(), m);
  for (const m of located) {
    if (Number.isFinite(m.worldX) && Number.isFinite(m.worldZ)) {
      byId.set(m.id.toLowerCase(), m);
    }
  }
  probeCache.set(key, {
    terrainBox: terrainBox || prev?.terrainBox || null,
    located: [...byId.values()],
    at: Date.now(),
  });
}

/** Dedupe concurrent CD reads for the same sheet (count / confirm). */
export function loadOpen3dhkCdCached(
  key: string,
  loader: () => Promise<Pick<Open3dhkCdCacheEntry, 'buildingCount' | 'buildings'>>,
): Promise<Open3dhkCdCacheEntry> {
  const cached = getCachedOpen3dhkCd(key);
  if (cached) return Promise.resolve(cached);

  let inflight = inflightCd.get(key);
  if (!inflight) {
    inflight = loader().then((result) => {
      const entry: Open3dhkCdCacheEntry = { ...result, at: Date.now() };
      cdCache.set(key, entry);
      return entry;
    }).finally(() => {
      inflightCd.delete(key);
    });
    inflightCd.set(key, inflight);
  }
  return inflight;
}

/** Test helper — clear session caches. */
export function clearOpen3dhkSheetCachesForTests(): void {
  cdCache.clear();
  probeCache.clear();
  inflightCd.clear();
}
