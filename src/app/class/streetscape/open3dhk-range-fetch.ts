import { BlobWriter, Entry, ZipReader, configure } from '@zip.js/zip.js';

import {
  attachPackagePath,
  normalizePackagePath,
} from '@udonarium/terrain-model/model-package-files';

import { filterOutOpen3dhkBuildingIds, matchOpen3dhkBuildingsByIds } from './open3dhk-building-id';
import { open3dhkDebug, open3dhkDebugHeartbeat, open3dhkDebugWarn } from './open3dhk-debug';
import { isStreetscapeAbort, STREETSCAPE_ERRORS } from './errors';
import {
  chooseBuildingsForSheet,
  filterBuildingsOnTerrain,
  nextBuildingProbeCount,
  Open3dhkTerrainBox,
} from './open3dhk-map-select';
import {
  Open3dhkHttpRangeReader,
  probeOpen3dhkZipByteLength,
} from './open3dhk-range-reader';
import {
  localizeOpen3dhkGltf,
  Open3dhkBuildingMember,
  selectOpen3dhkBuildings,
} from './open3dhk-sheet-pack';
import {
  getCachedOpen3dhkProbe,
  loadOpen3dhkCdCached,
  mergeCachedOpen3dhkProbe,
  open3dhkSheetCacheKeyFromUrl,
  setCachedOpen3dhkCd,
} from './open3dhk-sheet-cache';
import { StreetscapeSourceProgress, throwIfAborted } from './source';

/** Larger than zip.js default 512 KiB — fewer Range RTTs on multi‑MB JPEG facades. */
const OPEN3DHK_ZIP_CHUNK_BYTES = 2 * 1024 * 1024;

let open3dhkZipConfigured = false;
function ensureOpen3dhkZipConfig(): void {
  if (open3dhkZipConfigured) return;
  open3dhkZipConfigured = true;
  configure({
    chunkSize: OPEN3DHK_ZIP_CHUNK_BYTES,
    // Main-thread inflate keeps Range progress hooks on the UI timeline.
    useWebWorkers: false,
  });
}

const BUILDING_GLTF_RE = /^building\/([^/]+)\/\1\.gltf$/;
const TERRAIN_GLTF_RE = /^terrain\(tb\)\/([^/]+)\/\1\.gltf$/;

export type Open3dhkRangeMode = 'all' | 'floorOnly' | 'buildings';

export type Open3dhkRangeFetchOpts = {
  url: string;
  maxFeatures?: number;
  /** all = terrain + buildings; floorOnly = aerial map; buildings = facades (+ tiny terrain glTF for AABB). */
  mode?: Open3dhkRangeMode;
  /** Prefer these building folder ids (skip size/probe ranking). */
  buildingIds?: string[];
  /** Skip already-placed buildings when ranking the next batch. */
  excludeBuildingIds?: string[];
  signal?: AbortSignal;
  onProgress?: (p: StreetscapeSourceProgress) => void;
};

export type Open3dhkRangeEstimate = {
  buildingCount: number;
  selectedCount: number;
  /** Compressed bytes for selected building folders (approx). */
  facadeCompressedBytes: number;
  /** Compressed bytes for terrain aerial (+ glTF). */
  floorCompressedBytes: number;
  /** facade + floor when mode is all. */
  totalCompressedBytes: number;
};

/** Soft UX warn threshold lives in the UI; this is a hard download cap. */
export const OPEN3DHK_MAX_FEATURES_CAP = 100;

/**
 * Count building folders from the ZIP central directory only (no glTF body downloads).
 * Fast enough for the pre-download confirm dialog; total may slightly exceed on-map buildings.
 */
export async function countOpen3dhkRangeBuildings(
  opts: Pick<Open3dhkRangeFetchOpts, 'url' | 'signal' | 'onProgress'>,
): Promise<number> {
  throwIfAborted(opts.signal);
  opts.onProgress?.({ phase: 'download', current: 0, total: 0, message: 'index' });

  const cacheKey = open3dhkSheetCacheKeyFromUrl(opts.url);
  const cached = await loadOpen3dhkCdCached(cacheKey, async () => {
    open3dhkDebug('count: open ZIP', opts.url);
    const { zipReader } = await openProbedZipReader(opts.url, opts.signal);
    try {
      const stop = open3dhkDebugHeartbeat('getEntries (count)');
      open3dhkDebug('count: getEntries start');
      const entries = await zipReader.getEntries();
      stop();
      throwIfAborted(opts.signal);
      const byPath = indexEntries(entries);
      const buildings = listBuildingsFromCentralDirectory(byPath);
      open3dhkDebug('count: result', { buildings: buildings.length });
      return { buildingCount: buildings.length, buildings };
    } catch (err) {
      open3dhkDebugWarn('count: failed', err);
      if (isStreetscapeAbort(err)) throw err;
      throw err instanceof Error ? err : new Error(STREETSCAPE_ERRORS.FETCH_FAILED);
    } finally {
      await zipReader.close().catch(() => undefined);
    }
  });
  return cached.buildingCount;
}

/**
 * HTTP Range-read ZIP central directory, peek building glTFs for on-map positions,
 * then estimate download size for ≤N buildings that fit the sheet terrain.
 */
export async function estimateOpen3dhkRangeDownload(
  opts: Omit<Open3dhkRangeFetchOpts, 'mode'>,
): Promise<Open3dhkRangeEstimate> {
  const maxN = clampMaxFeatures(opts.maxFeatures);
  throwIfAborted(opts.signal);
  opts.onProgress?.({ phase: 'download', current: 0, total: 0, message: 'index' });

  open3dhkDebug('estimate: open ZIP', opts.url);
  const { zipReader, size, rangeReader } = await openProbedZipReader(opts.url, opts.signal);
  open3dhkDebug('estimate: zip size known', { size, sizeMiB: (size / (1024 * 1024)).toFixed(1) });
  try {
    const stop = open3dhkDebugHeartbeat('getEntries (estimate)');
    open3dhkDebug('estimate: getEntries start');
    const entries = await zipReader.getEntries();
    stop();
    open3dhkDebug('estimate: getEntries done', { count: entries?.length ?? 0 });
    throwIfAborted(opts.signal);
    const byPath = indexEntries(entries);
    const est = await estimateByProbingMapPlacement(byPath, maxN, opts, rangeReader);
    open3dhkDebug('estimate: result', {
      buildings: est.buildingCount,
      selected: est.selectedCount,
      facadeMiB: (est.facadeCompressedBytes / (1024 * 1024)).toFixed(1),
      floorMiB: (est.floorCompressedBytes / (1024 * 1024)).toFixed(1),
    });
    return est;
  } catch (err) {
    open3dhkDebugWarn('estimate: failed', err);
    if (isStreetscapeAbort(err)) throw err;
    throw err instanceof Error ? err : new Error(STREETSCAPE_ERRORS.FETCH_FAILED);
  } finally {
    await zipReader.close().catch(() => undefined);
  }
}

export function estimateFromCentralDirectory(
  byPath: Map<string, { compressedSize?: number; uncompressedSize?: number }>,
  maxFeatures?: number,
): Open3dhkRangeEstimate {
  const maxN = clampMaxFeatures(maxFeatures);
  const buildings = listBuildingsFromCentralDirectory(byPath);
  // CD-only fallback (no positions): largest .bin folders. Prefer estimateByProbingMapPlacement.
  const selected = selectOpen3dhkBuildings(
    buildings.map(b => ({ ...b, worldX: 0, worldZ: 0 })),
    maxN,
  );
  return estimateForSelected(byPath, buildings.length, selected);
}

async function probeBuildingsOnTerrain(
  cacheKey: string,
  buildings: Open3dhkBuildingMember[],
  maxN: number,
  byPath: Map<string, Entry>,
  planned: Map<string, Entry>,
  addPath: (path: string) => void,
  opts: Pick<Open3dhkRangeFetchOpts, 'url' | 'signal' | 'onProgress'>,
  rangeReader: Open3dhkHttpRangeReader,
  bag: Map<string, File>,
  terrainBox: Open3dhkTerrainBox | null,
  logPrefix: string,
): Promise<{ selected: Open3dhkBuildingMember[]; terrainBox: Open3dhkTerrainBox | null }> {
  const probeHit = getCachedOpen3dhkProbe(cacheKey);
  let box = terrainBox || probeHit?.terrainBox || null;
  const buildingById = new Map(buildings.map(b => [b.id.toLowerCase(), b]));
  const located: Open3dhkBuildingMember[] = [];
  const probed = new Set<string>();

  for (const m of probeHit?.located || []) {
    const base = buildingById.get(m.id.toLowerCase());
    if (!base || probed.has(base.id)) continue;
    if (!Number.isFinite(m.worldX) || !Number.isFinite(m.worldZ)) continue;
    probed.add(base.id);
    located.push({
      ...base,
      worldX: m.worldX,
      worldZ: m.worldZ,
      sizeMeters: m.sizeMeters,
    });
  }

  const ordered = buildings.slice().sort((a, b) => {
    const da = Math.abs(Math.log1p(a.binBytes) - 14);
    const db = Math.abs(Math.log1p(b.binBytes) - 14);
    return da - db || b.binBytes - a.binBytes;
  });
  let onMap = filterBuildingsOnTerrain(located, box);
  while (onMap.length < maxN) {
    const n = nextBuildingProbeCount(maxN, probed.size, ordered.length);
    if (n <= 0) break;
    const batch = ordered.filter(b => !probed.has(b.id)).slice(0, n);
    for (const b of batch) {
      probed.add(b.id);
      addPath(b.gltfPath);
    }
    open3dhkDebug(`${logPrefix}: probe glTF batch`, {
      batch: batch.length,
      probed: probed.size,
      onMap: onMap.length,
      cached: (probeHit?.located.length || 0),
    });
    await pullPlanned(planned, byPath, opts, rangeReader, bag, 'probe');
    for (const b of batch) {
      const gltf = bag.get(b.gltfPath);
      if (!gltf) continue;
      const parsed = localizeOpen3dhkGltf(await gltf.text());
      located.push({
        ...b,
        worldX: parsed.worldX,
        worldZ: parsed.worldZ,
        sizeMeters: parsed.sizeMeters,
      });
    }
    onMap = filterBuildingsOnTerrain(located, box);
  }

  mergeCachedOpen3dhkProbe(cacheKey, box, located);
  const selected = chooseBuildingsForSheet(located, maxN, box);
  open3dhkDebug(`${logPrefix}: on-map selection`, {
    selected: selected.length,
    onMap: onMap.length,
    probed: probed.size,
    ids: selected.map(s => s.id),
  });
  return { selected, terrainBox: box };
}

async function estimateByProbingMapPlacement(
  byPath: Map<string, Entry>,
  maxN: number,
  opts: Omit<Open3dhkRangeFetchOpts, 'mode'>,
  rangeReader: Open3dhkHttpRangeReader,
): Promise<Open3dhkRangeEstimate> {
  const buildingsAll = listBuildingsFromCentralDirectory(byPath);
  const buildings = filterOutOpen3dhkBuildingIds(buildingsAll, opts.excludeBuildingIds);
  if (!buildings.length) {
    return {
      buildingCount: buildingsAll.length,
      selectedCount: 0,
      facadeCompressedBytes: 0,
      floorCompressedBytes: estimateTerrainFloorBytes(byPath),
      totalCompressedBytes: estimateTerrainFloorBytes(byPath),
    };
  }

  const planned = new Map<string, Entry>();
  const addPath = (path: string) => {
    const e = byPath.get(path);
    if (e && !e.directory) planned.set(path, e);
  };
  const terrainGltfPath = [...byPath.keys()].find(p => TERRAIN_GLTF_RE.test(p));
  if (terrainGltfPath) addPath(terrainGltfPath);

  const bag = await pullPlanned(planned, byPath, opts, rangeReader, undefined, 'index');
  let terrainBox: Open3dhkTerrainBox | null = null;
  if (terrainGltfPath) {
    const terrainFile = bag.get(terrainGltfPath);
    if (terrainFile) {
      const parsed = localizeOpen3dhkGltf(await terrainFile.text());
      const doc = JSON.parse(parsed.json) as Record<string, unknown>;
      const local = localXzExtentFromGltf(doc);
      terrainBox = {
        minX: parsed.worldX + local.minX,
        maxX: parsed.worldX + local.maxX,
        minZ: parsed.worldZ - local.maxY,
        maxZ: parsed.worldZ - local.minY,
      };
    }
  }

  const cacheKey = open3dhkSheetCacheKeyFromUrl(opts.url);
  if (terrainBox) {
    mergeCachedOpen3dhkProbe(cacheKey, terrainBox, getCachedOpen3dhkProbe(cacheKey)?.located || []);
  }

  const { selected } = await probeBuildingsOnTerrain(
    cacheKey,
    buildings,
    maxN,
    byPath,
    planned,
    addPath,
    opts,
    rangeReader,
    bag,
    terrainBox,
    'estimate',
  );
  return estimateForSelected(byPath, buildingsAll.length, selected);
}

function estimateForSelected(
  byPath: Map<string, { compressedSize?: number; uncompressedSize?: number }>,
  buildingCount: number,
  selected: Open3dhkBuildingMember[],
): Open3dhkRangeEstimate {
  let facadeCompressedBytes = 0;
  for (const m of selected) {
    facadeCompressedBytes += folderCompressedBytes(byPath, `building/${m.id}/`);
  }
  const floorCompressedBytes = estimateTerrainFloorBytes(byPath);
  return {
    buildingCount,
    selectedCount: selected.length,
    facadeCompressedBytes,
    floorCompressedBytes,
    totalCompressedBytes: facadeCompressedBytes + floorCompressedBytes,
  };
}

/**
 * HTTP Range-read an Open3Dhk Individualised sheet ZIP and return only the
 * requested subset (floor and/or ≤N building folders).
 */
export async function fetchOpen3dhkRangeSubsetFiles(
  opts: Open3dhkRangeFetchOpts,
): Promise<File[]> {
  const maxN = clampMaxFeatures(opts.maxFeatures);
  const mode: Open3dhkRangeMode = opts.mode || 'all';
  throwIfAborted(opts.signal);

  opts.onProgress?.({ phase: 'download', current: 0, total: 0, message: 'index' });
  open3dhkDebug('fetch subset: open ZIP', { url: opts.url, mode, maxN });
  const { zipReader, size, rangeReader } = await openProbedZipReader(opts.url, opts.signal);
  open3dhkDebug('fetch subset: zip size known', { size, sizeMiB: (size / (1024 * 1024)).toFixed(1) });

  try {
    const stop = open3dhkDebugHeartbeat('getEntries (fetch)');
    open3dhkDebug('fetch subset: getEntries start');
    const entries = await zipReader.getEntries();
    stop();
    open3dhkDebug('fetch subset: getEntries done', { count: entries?.length ?? 0 });
    throwIfAborted(opts.signal);
    const byPath = indexEntries(entries);
    const cacheKey = open3dhkSheetCacheKeyFromUrl(opts.url);
    const buildingsAll = listBuildingsFromCentralDirectory(byPath);
    setCachedOpen3dhkCd(cacheKey, { buildingCount: buildingsAll.length, buildings: buildingsAll });

    const buildings = filterOutOpen3dhkBuildingIds(buildingsAll, opts.excludeBuildingIds);
    if (mode !== 'floorOnly' && !buildingsAll.length) {
      throw new Error(STREETSCAPE_ERRORS.NOT_A_PACK);
    }
    if (mode !== 'floorOnly' && !buildings.length && !(opts.buildingIds || []).length) {
      throw new Error(STREETSCAPE_ERRORS.NO_MORE_MODELS);
    }

    const terrainGltfPath = [...byPath.keys()].find(p => TERRAIN_GLTF_RE.test(p));
    const terrainId = terrainGltfPath
      ? (TERRAIN_GLTF_RE.exec(terrainGltfPath)?.[1] || '')
      : '';

    if (mode === 'floorOnly') {
      if (!terrainGltfPath || !terrainId) throw new Error(STREETSCAPE_ERRORS.NO_FLOOR);
      const planned = new Map<string, Entry>();
      const addPath = (path: string) => {
        const e = byPath.get(path);
        if (e && !e.directory) planned.set(path, e);
      };
      addPath(terrainGltfPath);
      const bag = await pullPlanned(planned, byPath, opts, rangeReader);
      const terrainFile = bag.get(terrainGltfPath);
      if (!terrainFile) throw new Error(STREETSCAPE_ERRORS.NO_FLOOR);
      const parsed = localizeOpen3dhkGltf(await terrainFile.text());
      const doc = JSON.parse(parsed.json) as Record<string, unknown>;
      const imageUri = firstImageUri(doc);
      if (!imageUri) throw new Error(STREETSCAPE_ERRORS.NO_FLOOR);
      const imagePath = `terrain(tb)/${terrainId}/${basenameUri(imageUri)}`;
      const imageEntry = byPath.get(imagePath);
      if (!imageEntry) throw new Error(STREETSCAPE_ERRORS.NO_FLOOR);
      planned.set(imagePath, imageEntry);
      await pullPlanned(planned, byPath, opts, rangeReader, bag);
      return Array.from(bag.values());
    }

    const planned = new Map<string, Entry>();
    const addPath = (path: string) => {
      const e = byPath.get(path);
      if (e && !e.directory) planned.set(path, e);
    };

    const wantIds = (opts.buildingIds || [])
      .map(id => String(id || '').trim())
      .filter(Boolean);
    const fixedIds = wantIds.length > 0;
    // Terrain glTF first → sheet footprint for on-map selection (skip when ids are known).
    const bag = new Map<string, File>();
    let terrainBox: Open3dhkTerrainBox | null = null;
    let terrainImagePath = '';
    if (!fixedIds || mode === 'all') {
      if (terrainGltfPath) addPath(terrainGltfPath);
      await pullPlanned(planned, byPath, opts, rangeReader, bag, 'index');
      if (terrainGltfPath && terrainId) {
        const terrainFile = bag.get(terrainGltfPath);
        if (terrainFile) {
          const parsed = localizeOpen3dhkGltf(await terrainFile.text());
          const doc = JSON.parse(parsed.json) as Record<string, unknown>;
          if (mode === 'all') {
            const imageUri = firstImageUri(doc);
            if (imageUri) {
              terrainImagePath = `terrain(tb)/${terrainId}/${basenameUri(imageUri)}`;
            }
          }
          const local = localXzExtentFromGltf(doc);
          terrainBox = {
            minX: parsed.worldX + local.minX,
            maxX: parsed.worldX + local.maxX,
            minZ: parsed.worldZ - local.maxY,
            maxZ: parsed.worldZ - local.minY,
          };
        }
      }
    }

    if (terrainBox) {
      mergeCachedOpen3dhkProbe(cacheKey, terrainBox, getCachedOpen3dhkProbe(cacheKey)?.located || []);
    }

    let selected: Open3dhkBuildingMember[];
    if (fixedIds) {
      selected = matchOpen3dhkBuildingsByIds(buildingsAll, wantIds, maxN);
      open3dhkDebug('fetch subset: fixed building ids', {
        want: wantIds.length,
        selected: selected.length,
        zipBuildings: buildingsAll.length,
        wantSample: wantIds.slice(0, 3),
        zipSample: buildingsAll.slice(0, 3).map(b => b.id),
        ids: selected.map(s => s.id),
      });
    } else {
      const { selected: picked } = await probeBuildingsOnTerrain(
        cacheKey,
        buildings,
        maxN,
        byPath,
        planned,
        addPath,
        opts,
        rangeReader,
        bag,
        terrainBox,
        'fetch subset',
      );
      selected = picked;
    }

    if (terrainImagePath) addPath(terrainImagePath);
    for (const m of selected) {
      const prefix = `building/${m.id}/`;
      for (const [path, entry] of byPath) {
        if (!path.startsWith(prefix) || entry.directory) continue;
        addPath(path);
      }
    }

    await pullPlanned(planned, byPath, opts, rangeReader, bag);
    return Array.from(bag.values());
  } catch (err) {
    open3dhkDebugWarn('fetch subset: failed', err);
    if (isStreetscapeAbort(err)) throw err;
    throw err instanceof Error ? err : new Error(STREETSCAPE_ERRORS.FETCH_FAILED);
  } finally {
    await zipReader.close().catch(() => undefined);
  }
}

export function clampOpen3dhkMaxFeatures(n?: number): number {
  return clampMaxFeatures(n);
}

/** Buildings listed from ZIP central directory (no body download). */
export function listBuildingsFromCentralDirectory(
  byPath: Map<string, { compressedSize?: number; uncompressedSize?: number }>,
): Open3dhkBuildingMember[] {
  const out: Open3dhkBuildingMember[] = [];
  for (const path of byPath.keys()) {
    const m = BUILDING_GLTF_RE.exec(path);
    if (!m) continue;
    const id = m[1];
    const binPath = `building/${id}/${id}.bin`;
    const bin = byPath.get(binPath);
    if (!bin) continue;
    const binBytes = Number(bin.uncompressedSize) || Number(bin.compressedSize) || 0;
    out.push({
      id,
      gltfPath: path,
      binPath,
      binBytes,
      worldX: 0,
      worldZ: 0,
    });
  }
  return out;
}

export function buildingFolderPathsForIds(
  entryPaths: string[],
  ids: string[],
): string[] {
  const idSet = new Set(ids.map(id => id.toLowerCase()));
  const out: string[] = [];
  for (const raw of entryPaths) {
    const path = normalizePackagePath(raw);
    const m = /^building\/([^/]+)\//.exec(path);
    if (!m || !idSet.has(m[1])) continue;
    if (path.endsWith('/')) continue;
    out.push(path);
  }
  return out;
}

function openProbedZipReader(
  url: string,
  signal?: AbortSignal,
): Promise<{ zipReader: ZipReader<unknown>; size: number; rangeReader: Open3dhkHttpRangeReader }> {
  return (async () => {
    ensureOpen3dhkZipConfig();
    const zipUrl = absoluteFetchUrl(url);
    const size = await probeOpen3dhkZipByteLength(zipUrl, signal);
    const rangeReader = new Open3dhkHttpRangeReader(zipUrl, size, signal);
    const zipReader = new ZipReader(rangeReader);
    return { zipReader, size, rangeReader };
  })();
}

function absoluteFetchUrl(url: string): string {
  try {
    return new URL(url, typeof document !== 'undefined' ? document.baseURI : 'http://localhost/').href;
  } catch {
    return url;
  }
}

async function pullPlanned(
  planned: Map<string, Entry>,
  byPath: Map<string, Entry>,
  opts: Open3dhkRangeFetchOpts,
  rangeReader?: Open3dhkHttpRangeReader,
  bag = new Map<string, File>(),
  progressMessage = 'fetch',
): Promise<Map<string, File>> {
  const totalBytes = Math.max(1, sumEntryBytes(planned.values()));
  let done = 0;
  for (const [path] of bag) {
    if (!planned.has(path)) continue;
    done += entryBytes(byPath.get(path) || planned.get(path));
  }
  let inflight = 0;
  let lastReportAt = 0;
  let lastReportMs = 0;
  const report = (force = false) => {
    if (progressMessage === 'index') {
      opts.onProgress?.({ phase: 'download', current: 0, total: 0, message: 'index' });
      return;
    }
    if (progressMessage === 'probe') {
      const probePaths = [...planned.keys()].filter(p => p.startsWith('building/'));
      const filesTotal = Math.max(1, probePaths.length);
      const filesDone = probePaths.filter(p => bag.has(p)).length;
      opts.onProgress?.({
        phase: 'download',
        current: filesDone,
        total: filesTotal,
        message: 'probe',
      });
      return;
    }
    // Cap inflight to the remaining compressed budget so local-header Range
    // reads do not push the bar past 100% mid-entry.
    const remaining = Math.max(0, totalBytes - done);
    const current = done + Math.min(inflight, remaining);
    const nowMs = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const bytesDelta = current - lastReportAt;
    const timeDelta = nowMs - lastReportMs;
    // Byte throttle alone looked "stuck" on multi‑MB JPEGs when UI rounded to 0.1 MiB.
    if (!force && bytesDelta < 256 * 1024 && timeDelta < 250 && current < totalBytes) return;
    lastReportAt = current;
    lastReportMs = nowMs;
    opts.onProgress?.({
      phase: 'download',
      current,
      total: Math.max(current, totalBytes),
      message: 'fetch',
    });
  };
  report(true);

  const prevHook = rangeReader?.onDataBytes;
  if (rangeReader) {
    rangeReader.onDataBytes = (n) => {
      if (n > 0) {
        inflight += n;
        report();
      }
    };
  }
  try {
    for (const path of [...planned.keys()]) {
      if (bag.has(path)) continue;
      throwIfAborted(opts.signal);
      const entry = byPath.get(path) || planned.get(path);
      if (!entry || entry.directory) throw new Error(STREETSCAPE_ERRORS.NO_FEATURE);
      inflight = 0;
      const file = await readZipEntryFile(entry, path, opts.signal);
      bag.set(path, file);
      done += entryBytes(entry) || file.size;
      inflight = 0;
      report(true);
    }
  } finally {
    if (rangeReader) rangeReader.onDataBytes = prevHook;
  }
  return bag;
}

function estimateTerrainFloorBytes(
  byPath: Map<string, { compressedSize?: number; uncompressedSize?: number }>,
): number {
  const terrainGltfPath = [...byPath.keys()].find(p => TERRAIN_GLTF_RE.test(p));
  if (!terrainGltfPath) return 0;
  const id = TERRAIN_GLTF_RE.exec(terrainGltfPath)?.[1];
  if (!id) return 0;
  const prefix = `terrain(tb)/${id}/`;
  // Prefer image members; fall back to whole terrain folder.
  let images = 0;
  let all = 0;
  for (const [path, e] of byPath) {
    if (!path.startsWith(prefix)) continue;
    const n = entryBytes(e);
    all += n;
    if (/\.(png|jpe?g|webp)$/i.test(path)) images += n;
  }
  return (images || all) + entryBytes(byPath.get(terrainGltfPath)!);
}

function folderCompressedBytes(
  byPath: Map<string, { compressedSize?: number; uncompressedSize?: number }>,
  prefix: string,
): number {
  let n = 0;
  for (const [path, e] of byPath) {
    if (path.startsWith(prefix)) n += entryBytes(e);
  }
  return n;
}

/** Floor to ≥1; cap at OPEN3DHK_MAX_FEATURES_CAP. Invalid → 4. */
function clampMaxFeatures(n?: number): number {
  if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0) return 4;
  return Math.min(OPEN3DHK_MAX_FEATURES_CAP, Math.max(1, Math.floor(n)));
}

function indexEntries(entries: Entry[]): Map<string, Entry> {
  const map = new Map<string, Entry>();
  for (const entry of entries) {
    const path = normalizePackagePath(entry.filename || '');
    if (!path || entry.directory) continue;
    map.set(path, entry);
  }
  return map;
}

function entryBytes(e: { compressedSize?: number; uncompressedSize?: number } | undefined): number {
  if (!e) return 0;
  return Number(e.compressedSize) || Number(e.uncompressedSize) || 0;
}

function sumEntryBytes(entries: Iterable<Entry>): number {
  let n = 0;
  for (const e of entries) n += entryBytes(e);
  return n;
}

async function readZipEntryFile(
  entry: Entry,
  path: string,
  signal?: AbortSignal,
): Promise<File> {
  if (typeof entry.getData !== 'function') throw new Error(STREETSCAPE_ERRORS.FETCH_FAILED);
  const mime = mimeForPath(path);
  const blob = await entry.getData(new BlobWriter(mime), { signal });
  const name = path.split('/').pop() || path;
  return attachPackagePath(new File([blob], name, { type: mime }), path);
}

function mimeForPath(path: string): string {
  if (/\.gltf$/i.test(path)) return 'model/gltf+json';
  if (/\.bin$/i.test(path)) return 'application/octet-stream';
  if (/\.png$/i.test(path)) return 'image/png';
  if (/\.jpe?g$/i.test(path)) return 'image/jpeg';
  if (/\.webp$/i.test(path)) return 'image/webp';
  return 'application/octet-stream';
}

function firstImageUri(doc: Record<string, unknown>): string {
  const images = Array.isArray(doc.images) ? doc.images as Record<string, unknown>[] : [];
  for (const img of images) {
    if (typeof img.uri === 'string' && img.uri.trim()) return img.uri.trim();
  }
  return '';
}

function basenameUri(uri: string): string {
  return uri.replace(/\\/g, '/').split('/').pop()?.toLowerCase() || uri.toLowerCase();
}

function localXzExtentFromGltf(doc: Record<string, unknown>): {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
} {
  const accessors = Array.isArray(doc.accessors) ? doc.accessors as Record<string, unknown>[] : [];
  for (const acc of accessors) {
    if (acc.type !== 'VEC3' || !Array.isArray(acc.min) || !Array.isArray(acc.max)) continue;
    const min = acc.min.map(Number);
    const max = acc.max.map(Number);
    if (min.length < 3 || max.length < 3) continue;
    if (![...min, ...max].every(Number.isFinite)) continue;
    const dx = Math.abs(max[0] - min[0]);
    const dy = Math.abs(max[1] - min[1]);
    if (dx + dy < 10) continue;
    return {
      minX: Math.min(min[0], max[0]),
      maxX: Math.max(min[0], max[0]),
      minY: Math.min(min[1], max[1]),
      maxY: Math.max(min[1], max[1]),
    };
  }
  return { minX: -100, maxX: 100, minY: -100, maxY: 100 };
}
