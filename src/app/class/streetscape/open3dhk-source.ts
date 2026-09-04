import { fetchStreetscapeCatalog, loadPackFromUrl, StreetscapeCatalogEntry } from './catalog-source';
import { isStreetscapeAbort, STREETSCAPE_ERRORS } from './errors';
import { expandStreetscapePackFiles } from './pack-file-source';
import { open3dhkDebug, open3dhkDebugWarn } from './open3dhk-debug';
import {
  clampOpen3dhkMaxFeatures,
  countOpen3dhkRangeBuildings,
  estimateOpen3dhkRangeDownload,
  fetchOpen3dhkRangeSubsetFiles,
  OPEN3DHK_MAX_FEATURES_CAP,
  Open3dhkRangeEstimate,
  Open3dhkRangeMode,
} from './open3dhk-range-fetch';
import {
  Open3dhkZipFormat,
  packLoadFromOpen3dhkSheetFiles,
} from './open3dhk-sheet-pack';
import {
  open3dhkSheetZipFetchUrls,
} from './open3dhk-url';
import {
  loadStreetSheetIndex,
  looksLikeOpen3dhkSheetId,
  resolveStreetToSheet,
} from './street-sheet-index';
import {
  StreetscapePackLoad,
  StreetscapeQuery,
  StreetscapeSource,
  StreetscapeSourceProgress,
  throwIfAborted,
} from './source';

export {
  OPEN3DHK_DATA11_ZIP_BASE,
  OPEN3DHK_DIRECT_ZIP_BASE,
  OPEN3DHK_DOWNLOAD_ZIP_BASE,
  OPEN3DHK_PROXY_PATH,
  open3dhkSheetZipDirectUrl,
  open3dhkSheetZipFetchUrls,
  open3dhkSheetZipProxyUrl,
  open3dhkSheetZipUrl,
} from './open3dhk-url';

/** Textured Individualised GLTF — large whole-sheet ZIP; prefer HTTP Range subset. */
export const OPEN3DHK_FORMAT_TEXTURED: Open3dhkZipFormat = 'GLTF';
/** Non-textured Individualised GLTF — ~35–60MB/sheet. */
export const OPEN3DHK_FORMAT_UNTEXTURED: Open3dhkZipFormat = 'GLTF0';

/** @deprecated Prefer OPEN3DHK_FORMAT_UNTEXTURED / explicit format on the query. */
export const OPEN3DHK_LIVE_FORMAT = OPEN3DHK_FORMAT_UNTEXTURED;

export type { Open3dhkRangeEstimate, Open3dhkRangeMode };
export { OPEN3DHK_MAX_FEATURES_CAP };

export const open3dhkSource: StreetscapeSource = {
  id: 'open3dhk',
  async resolve(
    query: StreetscapeQuery,
    signal?: AbortSignal,
    onProgress?: (p: StreetscapeSourceProgress) => void,
  ): Promise<StreetscapePackLoad> {
    if (query.type !== 'open3dhk') throw new Error(STREETSCAPE_ERRORS.NO_QUERY);
    throwIfAborted(signal);
    if (query.packUrl) return loadPackFromUrl(query.packUrl, signal);

    let sheet = (query.sheet || '').trim();
    let title: string | undefined;
    if (!sheet) {
      try {
        const catalog = await fetchStreetscapeCatalog(undefined, signal);
        const matched = matchCatalogStreet(catalog.streets, query);
        if (matched?.sheet) {
          sheet = matched.sheet;
          title = matched.title;
        } else if (matched?.packUrl) {
          return loadPackFromUrl(matched.packUrl, signal);
        }
      } catch (err) {
        if (isStreetscapeAbort(err)) throw err;
      }
    } else {
      try {
        const catalog = await fetchStreetscapeCatalog(undefined, signal);
        title = matchCatalogStreet(catalog.streets, { sheet })?.title;
      } catch (err) {
        if (isStreetscapeAbort(err)) throw err;
      }
    }

    if (!sheet && query.street) {
      const streetQ = query.street.trim();
      if (looksLikeOpen3dhkSheetId(streetQ)) {
        sheet = streetQ;
      } else {
        try {
          const index = await loadStreetSheetIndex(undefined, signal);
          const hit = resolveStreetToSheet(index, streetQ);
          if (hit?.sheet) {
            sheet = hit.sheet;
            title = title || hit.label;
          }
        } catch (err) {
          if (isStreetscapeAbort(err)) throw err;
        }
      }
    }

    if (!sheet) throw new Error(STREETSCAPE_ERRORS.NO_QUERY);
    return fetchOfficialSheetAsPack(sheet, {
      title,
      format: normalizeFormat(query.format),
      maxFeatures: query.maxFeatures,
      useRange: query.useRange,
      rangeMode: query.rangeMode,
      reuseWorldExtent: query.reuseWorldExtent,
      buildingIds: query.buildingIds,
      excludeBuildingIds: query.excludeBuildingIds,
      signal,
      onProgress,
    });
  },
};

export function matchCatalogStreet(
  streets: StreetscapeCatalogEntry[],
  query: { street?: string; sheet?: string },
): StreetscapeCatalogEntry | undefined {
  const sheet = (query.sheet || '').trim().toLowerCase();
  if (sheet) {
    const bySheet = streets.find(s => (s.sheet || '').toLowerCase() === sheet);
    if (bySheet) return bySheet;
  }
  const street = (query.street || '').trim().toLowerCase();
  if (!street) return undefined;
  return streets.find(s => {
    const title = (s.title || '').toLowerCase();
    const name = (s.street || '').toLowerCase();
    return name === street || title.includes(street) || name.includes(street);
  });
}

export function normalizeOpen3dhkFormat(format?: string): Open3dhkZipFormat {
  return normalizeFormat(format);
}

/** Count building folders from the ZIP central directory (no glTF probing). */
export async function countOpen3dhkSheetBuildings(
  sheet: string,
  opts: {
    format?: Open3dhkZipFormat;
    signal?: AbortSignal;
    onProgress?: (p: StreetscapeSourceProgress) => void;
  } = {},
): Promise<number> {
  const format = normalizeFormat(opts.format);
  const urls = open3dhkSheetZipFetchUrls(sheet, format);
  let lastErr: unknown;
  for (const url of urls) {
    try {
      open3dhkDebug('countOpen3dhkSheetBuildings: try', { sheet, format, url });
      return await countOpen3dhkRangeBuildings({
        url,
        signal: opts.signal,
        onProgress: opts.onProgress,
      });
    } catch (err) {
      open3dhkDebugWarn('countOpen3dhkSheetBuildings: url failed', { url, err });
      if (isStreetscapeAbort(err)) throw err;
      lastErr = err;
    }
  }
  throw resolveOpen3dhkFetchError(lastErr);
}

/** Probe ZIP CD via Range and estimate compressed bytes for ≤N buildings + floor. */
export async function estimateOpen3dhkSheetDownload(
  sheet: string,
  opts: {
    format?: Open3dhkZipFormat;
    maxFeatures?: number;
    signal?: AbortSignal;
    onProgress?: (p: StreetscapeSourceProgress) => void;
  } = {},
): Promise<Open3dhkRangeEstimate> {
  const format = normalizeFormat(opts.format);
  const maxFeatures = clampOpen3dhkMaxFeatures(opts.maxFeatures);
  const urls = open3dhkSheetZipFetchUrls(sheet, format);
  let lastErr: unknown;
  for (const url of urls) {
    try {
      open3dhkDebug('estimateOpen3dhkSheetDownload: try', { sheet, format, maxFeatures, url });
      return await estimateOpen3dhkRangeDownload({
        url,
        maxFeatures,
        signal: opts.signal,
        onProgress: opts.onProgress,
      });
    } catch (err) {
      open3dhkDebugWarn('estimateOpen3dhkSheetDownload: url failed', { url, err });
      if (isStreetscapeAbort(err)) throw err;
      lastErr = err;
    }
  }
  throw resolveOpen3dhkFetchError(lastErr);
}

async function fetchOfficialSheetAsPack(
  sheet: string,
  opts: {
    title?: string;
    format: Open3dhkZipFormat;
    maxFeatures?: number;
    useRange?: boolean;
    rangeMode?: Open3dhkRangeMode;
    reuseWorldExtent?: StreetscapePackLoad['worldExtent'];
    buildingIds?: string[];
    excludeBuildingIds?: string[];
    signal?: AbortSignal;
    onProgress?: (p: StreetscapeSourceProgress) => void;
  },
): Promise<StreetscapePackLoad> {
  throwIfAborted(opts.signal);
  const maxFeatures = clampOpen3dhkMaxFeatures(opts.maxFeatures);
  const useRange = opts.useRange !== false;
  const rangeMode: Open3dhkRangeMode = opts.rangeMode
    || (opts.buildingIds?.length || opts.reuseWorldExtent ? 'buildings' : 'all');

  if (useRange) {
    const files = await fetchSheetZipSubsetFiles(
      sheet,
      opts.format,
      maxFeatures,
      rangeMode,
      opts.signal,
      opts.onProgress,
      opts.buildingIds,
      opts.excludeBuildingIds,
    );
    opts.onProgress?.({ phase: 'unpack', current: 1, total: 2 });
    const pack = await packLoadFromOpen3dhkSheetFiles(files, {
      sheet,
      title: opts.title,
      maxFeatures,
      format: opts.format,
      floorOnly: rangeMode === 'floorOnly',
      reuseWorldExtent: opts.reuseWorldExtent,
      preferredBuildingIds: opts.buildingIds,
      excludeBuildingIds: opts.excludeBuildingIds,
    });
    opts.onProgress?.({ phase: 'unpack', current: 2, total: 2 });
    return pack;
  }

  opts.onProgress?.({ phase: 'download', current: 0, total: 0 });
  const blob = await fetchSheetZipBlob(sheet, opts.format, opts.signal, opts.onProgress);
  opts.onProgress?.({ phase: 'unpack', current: 0, total: 2 });
  const file = new File([blob], `${sheet}.zip`, { type: blob.type || 'application/zip' });
  const files = await expandStreetscapePackFiles([file]);
  opts.onProgress?.({ phase: 'unpack', current: 1, total: 2 });
  const pack = await packLoadFromOpen3dhkSheetFiles(files, {
    sheet,
    title: opts.title,
    maxFeatures,
    format: opts.format,
    floorOnly: rangeMode === 'floorOnly',
    reuseWorldExtent: opts.reuseWorldExtent,
    preferredBuildingIds: opts.buildingIds,
    excludeBuildingIds: opts.excludeBuildingIds,
  });
  opts.onProgress?.({ phase: 'unpack', current: 2, total: 2 });
  return pack;
}

async function fetchSheetZipSubsetFiles(
  sheet: string,
  format: Open3dhkZipFormat,
  maxFeatures: number,
  mode: Open3dhkRangeMode,
  signal?: AbortSignal,
  onProgress?: (p: StreetscapeSourceProgress) => void,
  buildingIds?: string[],
  excludeBuildingIds?: string[],
): Promise<File[]> {
  const urls = open3dhkSheetZipFetchUrls(sheet, format);
  let lastErr: unknown;
  for (const url of urls) {
    try {
      open3dhkDebug('fetchSheetZipSubsetFiles: try', { sheet, format, maxFeatures, mode, url, buildingIds, excludeBuildingIds });
      onProgress?.({ phase: 'download', current: 0, total: 0, message: 'index' });
      const files = await fetchOpen3dhkRangeSubsetFiles({
        url,
        maxFeatures,
        mode,
        buildingIds,
        excludeBuildingIds,
        signal,
        onProgress,
      });
      if (!files.length) {
        lastErr = new Error(STREETSCAPE_ERRORS.FETCH_FAILED);
        open3dhkDebugWarn('fetchSheetZipSubsetFiles: empty files', { url });
        continue;
      }
      open3dhkDebug('fetchSheetZipSubsetFiles: ok', { url, fileCount: files.length });
      return files;
    } catch (err) {
      open3dhkDebugWarn('fetchSheetZipSubsetFiles: url failed', { url, err });
      if (isStreetscapeAbort(err)) throw err;
      lastErr = err;
    }
  }
  throw resolveOpen3dhkFetchError(lastErr);
}

async function fetchSheetZipBlob(
  sheet: string,
  format: Open3dhkZipFormat,
  signal?: AbortSignal,
  onProgress?: (p: StreetscapeSourceProgress) => void,
): Promise<Blob> {
  const urls = open3dhkSheetZipFetchUrls(sheet, format);
  let lastErr: unknown;
  for (const url of urls) {
    try {
      const res = await fetch(url, { cache: 'no-store', signal, credentials: 'omit' });
      if (!res.ok) {
        lastErr = res.status >= 500
          ? new Error(STREETSCAPE_ERRORS.UPSTREAM_UNAVAILABLE)
          : new Error(STREETSCAPE_ERRORS.FETCH_FAILED);
        continue;
      }
      const blob = await readResponseBlobWithProgress(res, signal, onProgress);
      if (blob.size < 1024) {
        lastErr = new Error(STREETSCAPE_ERRORS.FETCH_FAILED);
        continue;
      }
      return blob;
    } catch (err) {
      if (isStreetscapeAbort(err)) throw err;
      lastErr = err;
    }
  }
  throw resolveOpen3dhkFetchError(lastErr);
}

/** Prefer upstream-unavailable when every host returned 5xx. */
function resolveOpen3dhkFetchError(lastErr: unknown): Error {
  if (lastErr instanceof Error) return lastErr;
  return new Error(STREETSCAPE_ERRORS.FETCH_FAILED);
}

/** Stream a Response body so callers can show download %. Falls back to `blob()`. */
export async function readResponseBlobWithProgress(
  res: Response,
  signal?: AbortSignal,
  onProgress?: (p: StreetscapeSourceProgress) => void,
): Promise<Blob> {
  const total = Number(res.headers.get('Content-Length')) || 0;
  const body = res.body;
  if (!body || typeof body.getReader !== 'function') {
    const blob = await res.blob();
    onProgress?.({ phase: 'download', current: blob.size, total: total || blob.size });
    return blob;
  }

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  let lastReport = 0;
  onProgress?.({ phase: 'download', current: 0, total });

  while (true) {
    throwIfAborted(signal);
    const { done, value } = await reader.read();
    if (done) break;
    if (!value?.length) continue;
    chunks.push(value);
    received += value.length;
    // Throttle UI updates (~every 256 KiB or final).
    if (received - lastReport >= 256 * 1024 || (total > 0 && received >= total)) {
      lastReport = received;
      onProgress?.({ phase: 'download', current: received, total });
    }
  }
  onProgress?.({ phase: 'download', current: received, total: total || received });
  return new Blob(chunks as BlobPart[], { type: res.headers.get('Content-Type') || 'application/zip' });
}

function normalizeFormat(format?: string): Open3dhkZipFormat {
  return format === 'GLTF' ? OPEN3DHK_FORMAT_TEXTURED : OPEN3DHK_FORMAT_UNTEXTURED;
}
