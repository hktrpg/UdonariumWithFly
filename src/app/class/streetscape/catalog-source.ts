import { normalizePackagePath, packagePathOf } from '@udonarium/terrain-model/model-package-files';

import { STREETSCAPE_ERRORS } from './errors';
import { createPackLoad, expandStreetscapePackFiles, parseManifestText } from './pack-file-source';
import { StreetscapePackLoad, StreetscapeQuery, StreetscapeSource, throwIfAborted } from './source';

export const DEFAULT_STREETSCAPE_CATALOG_URL = 'assets/streetscape/catalog.json';

export type StreetscapeCatalogEntry = {
  id: string;
  title: string;
  packUrl: string;
  street?: string;
  sheet?: string;
  attribution?: string;
};

export type StreetscapeCatalogV1 = {
  version: 1;
  streets: StreetscapeCatalogEntry[];
};

export const packCatalogSource: StreetscapeSource = {
  id: 'pack-catalog',
  async resolve(query: StreetscapeQuery, signal?: AbortSignal): Promise<StreetscapePackLoad> {
    if (query.type !== 'catalog' || !query.id) throw new Error(STREETSCAPE_ERRORS.NO_QUERY);
    const catalog = await fetchStreetscapeCatalog(query.catalogUrl, signal);
    const entry = catalog.streets.find(s => s.id === query.id);
    if (!entry) throw new Error(STREETSCAPE_ERRORS.NO_QUERY);
    return loadPackFromUrl(entry.packUrl, signal);
  },
};

export async function fetchStreetscapeCatalog(
  url = DEFAULT_STREETSCAPE_CATALOG_URL,
  signal?: AbortSignal,
): Promise<StreetscapeCatalogV1> {
  throwIfAborted(signal);
  const res = await fetch(url, { cache: 'no-store', signal });
  if (!res.ok) throw new Error(STREETSCAPE_ERRORS.FETCH_FAILED);
  const json = await res.json();
  if (!json || json.version !== 1 || !Array.isArray(json.streets)) {
    throw new Error(STREETSCAPE_ERRORS.INVALID_PACK);
  }
  const streets = json.streets.filter((s: unknown) => {
    if (!s || typeof s !== 'object') return false;
    const o = s as Record<string, unknown>;
    return typeof o.id === 'string' && typeof o.title === 'string' && typeof o.packUrl === 'string';
  }) as StreetscapeCatalogEntry[];
  return { version: 1, streets };
}

export async function loadPackFromUrl(url: string, signal?: AbortSignal): Promise<StreetscapePackLoad> {
  throwIfAborted(signal);
  if (/manifest\.json(\?|$)/i.test(url)) return loadPackFromManifestUrl(url, signal);
  const res = await fetch(url, { cache: 'no-store', signal });
  if (!res.ok) throw new Error(STREETSCAPE_ERRORS.FETCH_FAILED);
  const blob = await res.blob();
  const name = url.split('/').pop() || 'streetscape.zip';
  const file = new File([blob], name, { type: blob.type || 'application/zip' });
  const files = await expandStreetscapePackFiles([file]);
  const manifest = files.find(f => /(^|\/)manifest\.json$/i.test(packagePathOf(f)));
  if (!manifest) throw new Error(STREETSCAPE_ERRORS.NOT_A_PACK);
  const pack = parseManifestText(await manifest.text());
  return createPackLoad(pack, files);
}

export async function loadPackFromManifestUrl(url: string, signal?: AbortSignal): Promise<StreetscapePackLoad> {
  throwIfAborted(signal);
  const res = await fetch(url, { cache: 'no-store', signal });
  if (!res.ok) throw new Error(STREETSCAPE_ERRORS.FETCH_FAILED);
  const pack = parseManifestText(await res.text());
  const base = url.replace(/\/[^/]*$/, '/');
  return {
    pack,
    async openFeature(id: string, inner?: AbortSignal): Promise<File[]> {
      throwIfAborted(inner || signal);
      const feature = pack.features.find(f => f.id === id);
      if (!feature) throw new Error(STREETSCAPE_ERRORS.NO_FEATURE);
      return [await fetchPackMember(joinPackMemberUrl(base, feature.path), feature.path, inner || signal)];
    },
    async openFloor(inner?: AbortSignal): Promise<Blob> {
      throwIfAborted(inner || signal);
      const file = await fetchPackMember(joinPackMemberUrl(base, pack.floor.path), pack.floor.path, inner || signal);
      return file;
    },
  };
}

export function joinPackMemberUrl(base: string, rel: string): string {
  const clean = normalizePackagePath(rel);
  if (!clean || clean.includes('..') || /^(https?:|\/\/)/i.test(rel.trim())) {
    throw new Error(STREETSCAPE_ERRORS.NO_FEATURE);
  }
  const root = base.endsWith('/') ? base : `${base}/`;
  return new URL(clean, root).href;
}

async function fetchPackMember(url: string, path: string, signal?: AbortSignal): Promise<File> {
  const res = await fetch(url, { cache: 'no-store', signal });
  if (!res.ok) throw new Error(STREETSCAPE_ERRORS.FETCH_FAILED);
  const blob = await res.blob();
  const name = path.split('/').pop() || 'file';
  return new File([blob], name, { type: blob.type || 'application/octet-stream' });
}
