import { fetchStreetscapeCatalog, loadPackFromUrl, StreetscapeCatalogEntry } from './catalog-source';
import { isStreetscapeAbort, STREETSCAPE_ERRORS } from './errors';
import { createPackLoad, expandStreetscapePackFiles, parseManifestText } from './pack-file-source';
import { packagePathOf } from '@udonarium/terrain-model/model-package-files';
import { StreetscapePackLoad, StreetscapeQuery, StreetscapeSource, throwIfAborted } from './source';

/** Same-origin proxy; official hosts often block browser CORS. */
export const OPEN3DHK_PROXY_PATH = '/streetscape-open3dhk';

export const open3dhkSource: StreetscapeSource = {
  id: 'open3dhk',
  async resolve(query: StreetscapeQuery, signal?: AbortSignal): Promise<StreetscapePackLoad> {
    if (query.type !== 'open3dhk') throw new Error(STREETSCAPE_ERRORS.NO_QUERY);
    throwIfAborted(signal);
    if (query.packUrl) return loadPackFromUrl(query.packUrl, signal);

    try {
      const catalog = await fetchStreetscapeCatalog(undefined, signal);
      const matched = matchCatalogStreet(catalog.streets, query);
      if (matched) return loadPackFromUrl(matched.packUrl, signal);
    } catch (err) {
      if (isStreetscapeAbort(err)) throw err;
    }

    const proxied = await tryFetchOfficialAsPack(query, signal);
    if (proxied) return proxied;

    throw new Error(STREETSCAPE_ERRORS.NOT_A_PACK);
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

/**
 * Ask the same-origin proxy for a *Pack*. Official figure-sheet ZIPs are not
 * parcelized in the browser — those must be built offline / on a service.
 */
async function tryFetchOfficialAsPack(
  query: { street?: string; sheet?: string },
  signal?: AbortSignal,
): Promise<StreetscapePackLoad | null> {
  const params = new URLSearchParams();
  if (query.sheet) params.set('sheet', query.sheet);
  if (query.street) params.set('street', query.street);
  params.set('format', 'pack');
  try {
    const res = await fetch(`${OPEN3DHK_PROXY_PATH}?${params.toString()}`, { cache: 'no-store', signal });
    if (!res.ok) return null;
    const blob = await res.blob();
    const file = new File([blob], 'open3dhk.zip', { type: blob.type || 'application/zip' });
    const files = await expandStreetscapePackFiles([file]);
    const manifest = files.find(f => /(^|\/)manifest\.json$/i.test(packagePathOf(f)));
    if (!manifest) return null;
    return createPackLoad(parseManifestText(await manifest.text()), files);
  } catch {
    return null;
  }
}
