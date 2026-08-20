import { Open3dhkZipFormat } from './open3dhk-sheet-pack';

/** Open3Dhk Download API prod key (same as mapviewer `Global.apiKeysProd["2022Q4"]`). */
export const OPEN3DHK_API_KEY = 'ad5940a63bd344c48b0351ef1c7a905e';

export const OPEN3DHK_PROXY_PATH = '/streetscape-open3dhk';

/** Documented template host. */
export const OPEN3DHK_DOWNLOAD_ZIP_BASE = 'https://download.map.gov.hk/api/3d-zip';
/** Host the mapviewer SPA actually uses (`download.` → `data11.` + key). */
export const OPEN3DHK_DATA11_ZIP_BASE = 'https://data11.map.gov.hk/api/3d-zip';

/** @deprecated Prefer OPEN3DHK_DOWNLOAD_ZIP_BASE or open3dhkSheetZipFetchUrls. */
export const OPEN3DHK_DIRECT_ZIP_BASE = OPEN3DHK_DOWNLOAD_ZIP_BASE;

export function open3dhkSheetZipProxyUrl(
  sheet: string,
  format: Open3dhkZipFormat,
): string {
  const id = sheet.trim();
  return `${OPEN3DHK_PROXY_PATH}/${format}/${encodeURIComponent(id)}.zip`;
}

export function open3dhkSheetZipDirectUrl(
  sheet: string,
  format: Open3dhkZipFormat,
  base = OPEN3DHK_DATA11_ZIP_BASE,
  withKey = true,
): string {
  const id = sheet.trim();
  const path = `${base}/${format}/${encodeURIComponent(id)}.zip`;
  if (!withKey) return path;
  return `${path}?key=${OPEN3DHK_API_KEY}`;
}

/** Same-origin proxy first, then official CDN hosts (data11 before download). */
export function open3dhkSheetZipFetchUrls(
  sheet: string,
  format: Open3dhkZipFormat,
): string[] {
  return [
    open3dhkSheetZipProxyUrl(sheet, format),
    open3dhkSheetZipDirectUrl(sheet, format, OPEN3DHK_DATA11_ZIP_BASE, true),
    open3dhkSheetZipDirectUrl(sheet, format, OPEN3DHK_DOWNLOAD_ZIP_BASE, true),
    open3dhkSheetZipDirectUrl(sheet, format, OPEN3DHK_DOWNLOAD_ZIP_BASE, false),
  ];
}

/** Legacy single URL (download host, no key). */
export function open3dhkSheetZipUrl(
  sheet: string,
  format: Open3dhkZipFormat = 'GLTF0',
): string {
  return open3dhkSheetZipDirectUrl(sheet, format, OPEN3DHK_DOWNLOAD_ZIP_BASE, false);
}
