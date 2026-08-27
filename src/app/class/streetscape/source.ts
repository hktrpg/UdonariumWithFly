import { StreetscapePackV1 } from './pack-schema';

export type StreetscapeQuery =
  | { type: 'file'; files: File[] }
  | { type: 'catalog'; id: string; catalogUrl?: string }
  | {
    type: 'open3dhk';
    street?: string;
    sheet?: string;
    radiusMeters?: number;
    packUrl?: string;
    /** Official ZIP format. Default GLTF0; use GLTF + useRange for textured facades. */
    format?: 'GLTF' | 'GLTF0';
    /** Buildings to keep after select (≥1; no fixed host upper bound). */
    maxFeatures?: number;
    /**
     * HTTP Range-read only selected ZIP members.
     * Defaults to true for Open3Dhk (whole sheet ZIPs are huge).
     */
    useRange?: boolean;
    /** floorOnly = aerial map; buildings = facades only; all = both (default). */
    rangeMode?: 'all' | 'floorOnly' | 'buildings';
    /** Align deferred facade positions with a prior map-only pack. */
    reuseWorldExtent?: { minX: number; maxX: number; minZ: number; maxZ: number };
    /** When set, Range-fetch / select only these Open3Dhk building folder ids. */
    buildingIds?: string[];
    /** Skip these ids (and GLTF0↔GLTF variants) when picking the next N buildings. */
    excludeBuildingIds?: string[];
  };

export type StreetscapePackLoad = {
  pack: StreetscapePackV1;
  openFeature(id: string, signal?: AbortSignal): Promise<File[]>;
  openFloor(signal?: AbortSignal): Promise<Blob>;
  /** Package members used to build this load (for「另存街景包」). */
  files?: File[];
  /** Open3Dhk HK1980 AABB used when localizing features (deferred facades). */
  worldExtent?: { minX: number; maxX: number; minZ: number; maxZ: number };
};

/** Progress from a Source while resolving (e.g. live sheet download). */
export type StreetscapeSourceProgress = {
  phase: 'download' | 'unpack';
  /** Bytes received (download) or step index (unpack). */
  current: number;
  /** Content-Length bytes, or 0 if unknown; unpack total steps. */
  total: number;
  /** `index` = reading ZIP CD; `fetch` = pulling members. */
  message?: string;
};

export type StreetscapeSource = {
  readonly id: string;
  resolve(
    query: StreetscapeQuery,
    signal?: AbortSignal,
    onProgress?: (p: StreetscapeSourceProgress) => void,
  ): Promise<StreetscapePackLoad>;
};

export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    const err = new Error('STREETSCAPE_CANCELLED');
    err.name = 'AbortError';
    throw err;
  }
}
