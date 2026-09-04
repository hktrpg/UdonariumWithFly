import { StreetscapeCapsV1 } from './caps';
import { StreetscapeQualityV1 } from './pack-schema';

const MEGA = 1024 * 1024;

/** Worst-case stored bytes for one building (six faces). */
export function estimateFeatureSyncBytes(quality: StreetscapeQualityV1, caps: StreetscapeCapsV1): number {
  const px = Math.max(32, Math.min(quality.bakeMaxEdgePx, caps.maxBakeEdgePx));
  const raw = px * px * 4;
  const perFace = Math.min(caps.maxImageBytes, Math.max(32 * 1024, raw * 0.35));
  return perFace * 6;
}

export function estimateSyncMiB(featureCount: number, quality: StreetscapeQualityV1, caps: StreetscapeCapsV1): number {
  return (Math.max(0, featureCount) * estimateFeatureSyncBytes(quality, caps)) / MEGA;
}

/** Honor requested count (no hard feature / sync-byte cap). */
export function maxFeaturesForSyncBudget(
  wanted: number,
  _quality: StreetscapeQualityV1,
  _caps: StreetscapeCapsV1,
): number {
  if (!Number.isFinite(wanted) || wanted <= 0) return 0;
  return Math.floor(wanted);
}
