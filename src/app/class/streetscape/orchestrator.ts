import { ImageStorage } from '@udonarium/core/file-storage/image-storage';
import { GameTable } from '@udonarium/game-table';
import { TableSelecter } from '@udonarium/table-selecter';
import { Terrain } from '@udonarium/terrain';
import {
  importModelAsTerrain,
  ImportModelAsTerrainOptions,
  ImportModelAsTerrainResult,
} from '@udonarium/terrain-model/model-terrain-import';
import { PointerCoordinate } from 'service/pointer-device.service';

import { StreetscapeCapsV1, mergeStreetscapeQuality, resolveStreetscapeCaps } from './caps';
import { STREETSCAPE_ERRORS } from './errors';
import { estimateSyncMiB, maxFeaturesForSyncBudget } from './estimate';
import { composeStreetscapeFloor } from './floor-composer';
import { StreetscapeFeatureV1, StreetscapePackV1, StreetscapeQualityV1 } from './pack-schema';
import { featureCenterTablePx, featureDistanceToOrigin, streetscapeScaleFromPack } from './placement';
import { packCatalogSource } from './catalog-source';
import { open3dhkSource } from './open3dhk-source';
import { packFileSource } from './pack-file-source';
import { getStreetscapeSource, registerStreetscapeSource, resolveStreetscapeSource } from './registry';
import { StreetscapePackLoad, StreetscapeQuery, throwIfAborted } from './source';

export type StreetscapeImportFn = (
  files: File[],
  position: PointerCoordinate,
  opts?: ImportModelAsTerrainOptions,
) => Promise<ImportModelAsTerrainResult>;

export type StreetscapeProgress = {
  phase: 'resolve' | 'estimate' | 'floor' | 'feature' | 'done';
  current: number;
  total: number;
  featureId?: string;
  message?: string;
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
};

export async function generateStreetscape(opts: GenerateStreetscapeOptions): Promise<GenerateStreetscapeResult> {
  registerBuiltinStreetscapeSources();
  const caps = resolveStreetscapeCaps(opts.caps);
  const signal = opts.signal;
  throwIfAborted(signal);
  opts.onProgress?.({ phase: 'resolve', current: 0, total: 1 });
  const source = resolveStreetscapeSource(opts.query);
  const load = await source.resolve(opts.query, signal);
  return generateStreetscapeFromLoad(load, { ...opts, caps });
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
    message: `${estimatedSyncMiB.toFixed(1)} MiB`,
  });

  const table = new GameTable();
  table.name = pack.title || 'Streetscape';
  table.initialize();
  TableSelecter.instance.viewTableLocal(table.identifier);

  const scale = streetscapeScaleFromPack(pack, caps, table.gridSize || 50);
  table.width = scale.tableCellsX;
  table.height = scale.tableCellsY;

  const warnings: string[] = [];
  opts.onProgress?.({ phase: 'floor', current: 0, total: selected.length });
  try {
    const floorBlob = await load.openFloor(opts.signal);
    await applyFloorBlob(table, floorBlob, opts.addFloorImage);
  } catch (err) {
    warnings.push(err instanceof Error ? err.message : String(err));
    const composed = composeStreetscapeFloor(pack, scale, selected);
    await applyFloorBlob(table, composed, opts.addFloorImage);
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
      const result = await importModel(files, { x: center.x, y: center.y, z: 0 }, {
        name: feature.id,
        fitGrid: quality.fitGrid,
        bakeSize: quality.bakeMaxEdgePx,
        mmPerGrid: scale.mmPerGrid,
        parentTable: table,
        yawDeg: feature.yawDeg,
      });
      terrains.push(...result.terrains);
      warnings.push(...(result.warnings || []));
    } catch (err) {
      if (err instanceof Error && err.message === STREETSCAPE_ERRORS.CANCELLED) throw err;
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
  };
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
}
