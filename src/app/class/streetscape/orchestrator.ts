import { ImageStorage } from '@udonarium/core/file-storage/image-storage';
import { ObjectStore } from '@udonarium/core/synchronize-object/object-store';
import { GameTable } from '@udonarium/game-table';
import { TableSelecter } from '@udonarium/table-selecter';
import { Terrain } from '@udonarium/terrain';
import { packagePathOf } from '@udonarium/terrain-model/model-package-files';
import {
  importModelAsTerrain,
  ImportModelAsTerrainOptions,
  ImportModelAsTerrainResult,
} from '@udonarium/terrain-model/model-terrain-import';
import { PointerCoordinate } from 'service/pointer-device.service';

import { open3dhkBuildingVariantKey } from './open3dhk-building-id';
import { StreetscapeCapsV1, mergeStreetscapeQuality, resolveStreetscapeCaps } from './caps';
import { isStreetscapeAbort, STREETSCAPE_ERRORS } from './errors';
import { estimateSyncMiB, maxFeaturesForSyncBudget } from './estimate';
import { composeStreetscapeFloor } from './floor-composer';
import { sampleBlobRgbAtUv } from './floor-tint';
import { StreetscapeFeatureV1, StreetscapePackV1, StreetscapeQualityV1 } from './pack-schema';
import { featureCenterTablePx, featureDistanceToOrigin, streetscapeScaleFromPack } from './placement';
import { applyStreetscapeMapCredit } from './map-credit';

/** Real aerial floors are large; Open3Dhk building-only packs ship a 1×1 placeholder. */
const MIN_FLOOR_BYTES_FOR_TINT = 512;
import { packCatalogSource } from './catalog-source';
import { open3dhkSource } from './open3dhk-source';
import { plateauSource } from './plateau-source';
import { packFileSource } from './pack-file-source';
import { getStreetscapeSource, registerStreetscapeSource, resolveStreetscapeSource } from './registry';
import { StreetscapePackLoad, StreetscapeQuery, throwIfAborted } from './source';

export type StreetscapeImportFn = (
  files: File[],
  position: PointerCoordinate,
  opts?: ImportModelAsTerrainOptions,
) => Promise<ImportModelAsTerrainResult>;

export type StreetscapeProgress = {
  phase: 'resolve' | 'download' | 'unpack' | 'estimate' | 'floor' | 'feature' | 'done';
  current: number;
  total: number;
  featureId?: string;
  message?: string;
  mb?: number;
  /** Download: MiB already received. */
  loadedMb?: number;
  /** Download: total MiB from Content-Length (if known). */
  totalMb?: number;
};

export type GenerateStreetscapeOptions = {
  query: StreetscapeQuery;
  caps?: Partial<StreetscapeCapsV1>;
  quality?: Partial<StreetscapeQualityV1>;
  signal?: AbortSignal;
  onProgress?: (p: StreetscapeProgress) => void;
  importModel?: StreetscapeImportFn;
  addFloorImage?: (blob: Blob) => Promise<string>;
};

export type GenerateStreetscapeResult = {
  table: GameTable;
  pack: StreetscapePackV1;
  terrains: Terrain[];
  warnings: string[];
  estimatedSyncMiB: number;
  attribution: string;
  worldExtent?: { minX: number; maxX: number; minZ: number; maxZ: number };
  /** Members for ZIP export (manifest synthesised on save). */
  exportFiles?: File[];
};

export async function generateStreetscape(opts: GenerateStreetscapeOptions): Promise<GenerateStreetscapeResult> {
  registerBuiltinStreetscapeSources();
  const caps = resolveStreetscapeCaps(opts.caps);
  const signal = opts.signal;
  throwIfAborted(signal);
  opts.onProgress?.({ phase: 'resolve', current: 0, total: 1 });
  const source = resolveStreetscapeSource(opts.query);
  const load = await source.resolve(opts.query, signal, (p) => {
    if (p.phase === 'download') {
      const loadedMb = p.current / (1024 * 1024);
      const totalMb = p.total > 0 ? p.total / (1024 * 1024) : undefined;
      opts.onProgress?.({
        phase: 'download',
        current: p.current,
        total: p.total,
        loadedMb,
        totalMb,
        mb: totalMb,
        message: p.message,
      });
      return;
    }
    opts.onProgress?.({ phase: 'unpack', current: p.current, total: p.total });
  });
  return generateStreetscapeFromLoad(load, { ...opts, caps });
}

/** Import pack features onto an existing table (skip recreating floor). */
export async function appendStreetscapeFacadesToTable(
  table: GameTable,
  load: StreetscapePackLoad,
  opts: Omit<GenerateStreetscapeOptions, 'query'> & { caps?: StreetscapeCapsV1 } = {},
): Promise<GenerateStreetscapeResult> {
  return appendStreetscapeFeaturesToTable(table, load, { ...opts, replaceMatching: true });
}

/**
 * Append new building models onto an existing streetscape table.
 * Skips features already present (by id / Open3Dhk variant). Does not recreate the floor.
 */
export async function appendStreetscapeModelsToTable(
  table: GameTable,
  load: StreetscapePackLoad,
  opts: Omit<GenerateStreetscapeOptions, 'query'> & { caps?: StreetscapeCapsV1 } = {},
): Promise<GenerateStreetscapeResult> {
  return appendStreetscapeFeaturesToTable(table, load, { ...opts, replaceMatching: false });
}

async function appendStreetscapeFeaturesToTable(
  table: GameTable,
  load: StreetscapePackLoad,
  opts: Omit<GenerateStreetscapeOptions, 'query'> & {
    caps?: StreetscapeCapsV1;
    /** When true, destroy matching gray shells before import (facade upgrade). */
    replaceMatching: boolean;
  },
): Promise<GenerateStreetscapeResult> {
  registerBuiltinStreetscapeSources();
  const caps = resolveStreetscapeCaps(opts.caps);
  const pack = load.pack;
  const quality = mergeStreetscapeQuality(pack.quality, opts.quality, caps);
  const selected = selectFeatures(pack, quality, caps);
  const estimatedSyncMiB = estimateSyncMiB(selected.length, quality, caps);
  opts.onProgress?.({
    phase: 'estimate',
    current: 0,
    total: selected.length,
    mb: estimatedSyncMiB,
  });

  const scale = streetscapeScaleFromPack(pack, caps, table.gridSize || 50);
  const warnings: string[] = [];
  const floorBlob = await resolveStreetscapeFloorBlob(table, load, opts.signal);

  const importModel = opts.importModel || importModelAsTerrain;
  const terrains: Terrain[] = [];
  let imported = 0;
  for (let i = 0; i < selected.length; i++) {
    throwIfAborted(opts.signal);
    const feature = selected[i];
    opts.onProgress?.({
      phase: 'feature',
      current: i + 1,
      total: selected.length,
      featureId: feature.id,
    });
    try {
      if (opts.replaceMatching) {
        const replacedName = removeTerrainsNamedOnTable(table, feature.id);
        const files = await load.openFeature(feature.id, opts.signal);
        const center = featureCenterTablePx(feature, pack, scale);
        let colorTint: { r: number; g: number; b: number } | undefined;
        const hasFacadeTexture = files.some(f => /\.(png|jpe?g|webp)$/i.test(packagePathOf(f)));
        if (floorBlob && !hasFacadeTexture) {
          try {
            colorTint = await sampleBlobRgbAtUv(floorBlob, ...featureFloorUv(feature, pack));
          } catch {
            // best-effort
          }
        }
        const result = await importModel(files, { x: center.x, y: center.y, z: 0 }, {
          name: replacedName || feature.id,
          fitGrid: quality.fitGrid,
          bakeSize: quality.bakeMaxEdgePx,
          mmPerGrid: scale.mmPerGrid,
          metersPerGrid: scale.metersPerGrid,
          metersPerGridY: scale.metersPerGridY,
          sizeMeters: feature.sizeMeters,
          parentTable: table,
          yawDeg: feature.yawDeg,
          colorTint,
          locked: true,
          lockAspectRatio: true,
        });
        terrains.push(...result.terrains);
        warnings.push(...(result.warnings || []));
        imported += 1;
        continue;
      }

      if (tableHasTerrainNamed(table, feature.id)) {
        warnings.push(`${feature.id}: already on map`);
        continue;
      }
      const files = await load.openFeature(feature.id, opts.signal);
      const center = featureCenterTablePx(feature, pack, scale);
      let colorTint: { r: number; g: number; b: number } | undefined;
      const hasFacadeTexture = files.some(f => /\.(png|jpe?g|webp)$/i.test(packagePathOf(f)));
      if (floorBlob && !hasFacadeTexture) {
        try {
          colorTint = await sampleBlobRgbAtUv(floorBlob, ...featureFloorUv(feature, pack));
        } catch {
          // best-effort
        }
      }
      const result = await importModel(files, { x: center.x, y: center.y, z: 0 }, {
        name: feature.id,
        fitGrid: quality.fitGrid,
        bakeSize: quality.bakeMaxEdgePx,
        mmPerGrid: scale.mmPerGrid,
        metersPerGrid: scale.metersPerGrid,
        metersPerGridY: scale.metersPerGridY,
        sizeMeters: feature.sizeMeters,
        parentTable: table,
        yawDeg: feature.yawDeg,
        colorTint,
        locked: true,
        lockAspectRatio: true,
      });
      terrains.push(...result.terrains);
      warnings.push(...(result.warnings || []));
      imported += 1;
    } catch (err) {
      if (isStreetscapeAbort(err)) throw err;
      warnings.push(`${feature.id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (!opts.replaceMatching && imported < 1 && selected.length > 0) {
    // All candidates already present or failed — treat as no new models.
    throw new Error(STREETSCAPE_ERRORS.NO_MORE_MODELS);
  }
  if (!opts.replaceMatching && selected.length < 1) {
    throw new Error(STREETSCAPE_ERRORS.NO_MORE_MODELS);
  }

  applyStreetscapeMapCredit(table, pack);
  opts.onProgress?.({ phase: 'done', current: selected.length, total: selected.length });
  return {
    table,
    pack,
    terrains,
    warnings,
    estimatedSyncMiB,
    attribution: pack.attribution || '',
    worldExtent: load.worldExtent,
    exportFiles: load.files?.slice(),
  };
}

function tableHasTerrainNamed(table: GameTable, featureId: string): boolean {
  if (!featureId || !table) return false;
  for (const t of ObjectStore.instance.getObjects(Terrain)) {
    if (!streetscapeTerrainNameMatches(t.name, featureId)) continue;
    if (t.tableIdentifier === table.identifier || t.hasPlacement(table.identifier)) return true;
  }
  return false;
}

/** Exact name, or Open3Dhk GLTF0↔GLTF product-letter variant (`…C0` ↔ `…A0`). */
export function streetscapeTerrainNameMatches(terrainName: string, featureId: string): boolean {
  const a = String(terrainName || '').trim().toLowerCase();
  const b = String(featureId || '').trim().toLowerCase();
  if (!a || !b) return false;
  if (a === b) return true;
  const ka = open3dhkBuildingVariantKey(a);
  const kb = open3dhkBuildingVariantKey(b);
  return !!(ka && kb && ka === kb);
}

/**
 * Destroy terrains on `table` whose name matches `featureId` (incl. C0↔A0).
 * @returns the removed terrain's name (prefer exact / first match) for re-import naming.
 */
export function removeTerrainsNamedOnTable(table: GameTable, featureId: string): string | null {
  if (!featureId || !table) return null;
  let keptName: string | null = null;
  for (const t of ObjectStore.instance.getObjects(Terrain)) {
    if (!streetscapeTerrainNameMatches(t.name, featureId)) continue;
    if (t.tableIdentifier === table.identifier || t.hasPlacement(table.identifier)) {
      if (!keptName) keptName = t.name || featureId;
      t.destroy();
    }
  }
  return keptName;
}

export async function generateStreetscapeFromLoad(
  load: StreetscapePackLoad,
  opts: Omit<GenerateStreetscapeOptions, 'query'> & { caps: StreetscapeCapsV1 },
): Promise<GenerateStreetscapeResult> {
  const pack = load.pack;
  const caps = opts.caps;
  const quality = mergeStreetscapeQuality(pack.quality, opts.quality, caps);
  const selected = selectFeatures(pack, quality, caps);
  const estimatedSyncMiB = estimateSyncMiB(selected.length, quality, caps);
  opts.onProgress?.({
    phase: 'estimate',
    current: 0,
    total: selected.length,
    mb: estimatedSyncMiB,
    message: `${estimatedSyncMiB.toFixed(1)} MiB`,
  });

  let table: GameTable | null = null;
  try {
    table = new GameTable();
    table.name = pack.title || 'Streetscape';
    table.playerCanView = true;
    table.initialize();
    applyStreetscapeMapCredit(table, pack);
    TableSelecter.instance.viewTableLocal(table.identifier);

    const scale = streetscapeScaleFromPack(pack, caps, table.gridSize || 50);
    table.width = scale.tableCellsX;
    table.height = scale.tableCellsY;

    const warnings: string[] = [];
    opts.onProgress?.({ phase: 'floor', current: 0, total: selected.length });
    let floorBlob: Blob | null = null;
    try {
      floorBlob = await load.openFloor(opts.signal);
      await applyFloorBlob(table, floorBlob, opts.addFloorImage);
    } catch (err) {
      if (isStreetscapeAbort(err)) throw err;
      warnings.push(err instanceof Error ? err.message : String(err));
      floorBlob = composeStreetscapeFloor(pack, scale, selected);
      await applyFloorBlob(table, floorBlob, opts.addFloorImage);
    }

    const importModel = opts.importModel || importModelAsTerrain;
    const terrains: Terrain[] = [];
    for (let i = 0; i < selected.length; i++) {
      throwIfAborted(opts.signal);
      const feature = selected[i];
      opts.onProgress?.({
        phase: 'feature',
        current: i + 1,
        total: selected.length,
        featureId: feature.id,
      });
      try {
        const files = await load.openFeature(feature.id, opts.signal);
        const center = featureCenterTablePx(feature, pack, scale);
        let colorTint: { r: number; g: number; b: number } | undefined;
        // Official GLTF textured folders already carry albedo; skip aerial multiply.
        const hasFacadeTexture = files.some(f => /\.(png|jpe?g|webp)$/i.test(packagePathOf(f)));
        if (floorBlob && !hasFacadeTexture) {
          try {
            colorTint = await sampleBlobRgbAtUv(floorBlob, ...featureFloorUv(feature, pack));
          } catch {
            // Tint is best-effort (GLTF0 gray → aerial sample).
          }
        }
        const result = await importModel(files, { x: center.x, y: center.y, z: 0 }, {
          name: feature.id,
          fitGrid: quality.fitGrid,
          bakeSize: quality.bakeMaxEdgePx,
          mmPerGrid: scale.mmPerGrid,
          metersPerGrid: scale.metersPerGrid,
          metersPerGridY: scale.metersPerGridY,
          sizeMeters: feature.sizeMeters,
          parentTable: table,
          yawDeg: feature.yawDeg,
          colorTint,
          locked: true,
          lockAspectRatio: true,
        });
        terrains.push(...result.terrains);
        warnings.push(...(result.warnings || []));
      } catch (err) {
        if (isStreetscapeAbort(err)) throw err;
        warnings.push(`${feature.id}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    opts.onProgress?.({ phase: 'done', current: selected.length, total: selected.length });
    return {
      table,
      pack,
      terrains,
      warnings,
      estimatedSyncMiB,
      attribution: pack.attribution || '',
      worldExtent: load.worldExtent,
      exportFiles: load.files?.slice(),
    };
  } catch (err) {
    table?.destroy();
    throw err;
  }
}

/** Prefer the table's aerial floor when appending (pack may only carry a tiny placeholder). */
export async function resolveStreetscapeFloorBlob(
  table: GameTable | undefined,
  load: StreetscapePackLoad,
  signal?: AbortSignal,
): Promise<Blob | null> {
  const tableId = table?.imageIdentifier;
  if (tableId && tableId !== 'imageIdentifier') {
    const img = ImageStorage.instance.get(tableId);
    if (img?.blob && img.blob.size >= MIN_FLOOR_BYTES_FOR_TINT) {
      return img.blob;
    }
  }
  try {
    const blob = await load.openFloor(signal);
    if (blob && blob.size >= MIN_FLOOR_BYTES_FOR_TINT) return blob;
  } catch {
    // Tint is optional; GLTF textured facades skip it anyway.
  }
  return null;
}

function featureFloorUv(
  feature: StreetscapeFeatureV1,
  pack: StreetscapePackV1,
): [number, number] {
  let x = feature.positionMeters.x - pack.origin.x;
  let z = feature.positionMeters.z - pack.origin.z;
  if (feature.sizeMeters) {
    x += feature.sizeMeters.w / 2;
    z += feature.sizeMeters.d / 2;
  }
  const w = Math.max(1e-6, pack.extentMeters.width);
  const d = Math.max(1e-6, pack.extentMeters.depth);
  return [x / w, z / d];
}

function selectFeatures(
  pack: StreetscapePackV1,
  quality: StreetscapeQualityV1,
  caps: StreetscapeCapsV1,
): StreetscapeFeatureV1[] {
  let list = pack.features.slice();
  if (quality.unknownKind === 'skip') {
    const known = new Set(['building', 'infrastructure', 'prop']);
    list = list.filter(f => known.has(f.kind));
  }
  if (quality.featureSort === 'distanceToOrigin') {
    list = list.slice().sort((a, b) => featureDistanceToOrigin(a, pack) - featureDistanceToOrigin(b, pack));
  }
  const maxN = maxFeaturesForSyncBudget(list.length, quality, caps);
  if (maxN < 1) throw new Error(STREETSCAPE_ERRORS.OVER_CAPS);
  return list.slice(0, maxN);
}

async function applyFloorBlob(
  table: GameTable,
  blob: Blob,
  addFloorImage?: (blob: Blob) => Promise<string>,
): Promise<void> {
  const id = addFloorImage
    ? await addFloorImage(blob)
    : (await ImageStorage.instance.addAsync(blob)).identifier;
  table.imageIdentifier = id;
}

export function registerBuiltinStreetscapeSources(): void {
  if (!getStreetscapeSource('pack-file')) registerStreetscapeSource(packFileSource);
  if (!getStreetscapeSource('pack-catalog')) registerStreetscapeSource(packCatalogSource);
  if (!getStreetscapeSource('open3dhk')) registerStreetscapeSource(open3dhkSource);
  if (!getStreetscapeSource('plateau')) registerStreetscapeSource(plateauSource);
}
