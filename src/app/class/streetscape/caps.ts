import { IMAGE_STORED_MAX_BYTES } from '@udonarium/core/file-storage/image-normalize';
import { GAME_TABLE_SIZE_MAX } from '@udonarium/game-table-fit';
import { MODEL_BAKE_SIZE_MAX, MODEL_PHOTO_BAKE_SIZE } from '@udonarium/terrain-model/mesh-ir';

import { StreetscapeQualityV1 } from './pack-schema';

/** Host / room hard limits — Pack cannot raise these. */
export type StreetscapeCapsV1 = {
  maxFeatures: number;
  maxEstimatedSyncMiB: number;
  maxTableCells: number;
  maxImageBytes: number;
  maxBakeEdgePx: number;
};

export const BUILTIN_STREETSCAPE_CAPS: StreetscapeCapsV1 = {
  /** Soft host default only — UI / query may request more; not a hard clamp. */
  maxFeatures: Number.MAX_SAFE_INTEGER,
  maxEstimatedSyncMiB: 48,
  maxTableCells: GAME_TABLE_SIZE_MAX,
  maxImageBytes: IMAGE_STORED_MAX_BYTES,
  maxBakeEdgePx: Math.min(MODEL_BAKE_SIZE_MAX, MODEL_PHOTO_BAKE_SIZE),
};

export const BUILTIN_STREETSCAPE_QUALITY: StreetscapeQualityV1 = {
  bakeMaxEdgePx: 512,
  fitGrid: false,
  featureSort: 'distanceToOrigin',
  unknownKind: 'import',
};

export function resolveStreetscapeCaps(override?: Partial<StreetscapeCapsV1>): StreetscapeCapsV1 {
  const base = BUILTIN_STREETSCAPE_CAPS;
  if (!override) return { ...base };
  return {
    maxFeatures: tightenInt(base.maxFeatures, override.maxFeatures),
    maxEstimatedSyncMiB: tightenNum(base.maxEstimatedSyncMiB, override.maxEstimatedSyncMiB),
    maxTableCells: tightenInt(base.maxTableCells, override.maxTableCells),
    maxImageBytes: tightenInt(base.maxImageBytes, override.maxImageBytes),
    maxBakeEdgePx: tightenInt(base.maxBakeEdgePx, override.maxBakeEdgePx),
  };
}

export function mergeStreetscapeQuality(
  packQuality: Partial<StreetscapeQualityV1> | undefined,
  runQuality: Partial<StreetscapeQualityV1> | undefined,
  caps: StreetscapeCapsV1,
): StreetscapeQualityV1 {
  const merged: StreetscapeQualityV1 = {
    ...BUILTIN_STREETSCAPE_QUALITY,
    ...(packQuality || {}),
    ...(runQuality || {}),
  };
  merged.bakeMaxEdgePx = Math.max(32, Math.min(caps.maxBakeEdgePx, Math.round(merged.bakeMaxEdgePx || 512)));
  merged.fitGrid = !!merged.fitGrid;
  if (merged.featureSort !== 'manifestOrder') merged.featureSort = 'distanceToOrigin';
  if (merged.unknownKind !== 'skip') merged.unknownKind = 'import';
  return merged;
}

function tightenInt(cap: number, next?: number): number {
  if (typeof next !== 'number' || !Number.isFinite(next) || next <= 0) return cap;
  return Math.max(1, Math.min(cap, Math.floor(next)));
}

function tightenNum(cap: number, next?: number): number {
  if (typeof next !== 'number' || !Number.isFinite(next) || next <= 0) return cap;
  return Math.min(cap, next);
}
