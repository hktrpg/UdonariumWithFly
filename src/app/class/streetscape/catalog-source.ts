import {
  attachPackagePath,
  dirOfPackagePath,
  expandModelDropFiles,
  normalizePackagePath,
  packagePathOf,
} from '@udonarium/terrain-model/model-package-files';

import { STREETSCAPE_ERRORS } from './errors';
import { createPackLoad, expandStreetscapePackFiles, parseManifestText } from './pack-file-source';
import { StreetscapePackLoad, StreetscapeQuery, StreetscapeSource, throwIfAborted } from './source';

export const DEFAULT_STREETSCAPE_CATALOG_URL = 'assets/streetscape/catalog.json';

export type StreetscapeCatalogEntry = {
  id: string;
  title: string;
  /** Offline / hosted Pack URL. Optional when `sheet` triggers live Open3Dhk download. */
  packUrl?: string;
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
    if (!entry.packUrl) throw new Error(STREETSCAPE_ERRORS.NO_QUERY);
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
    return typeof o.id === 'string' && typeof o.title === 'string'
      && (typeof o.packUrl === 'string' || typeof o.sheet === 'string');
  }).map((s: Record<string, unknown>) => ({
    id: s.id as string,
    title: s.title as string,
    packUrl: typeof s.packUrl === 'string' ? s.packUrl : undefined,
    street: typeof s.street === 'string' ? s.street : undefined,
    sheet: typeof s.sheet === 'string' ? s.sheet : undefined,
    attribution: typeof s.attribution === 'string' ? s.attribution : undefined,
  })) as StreetscapeCatalogEntry[];
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
  // Catalog packUrl may be relative (assets/...); fetch tolerates that, but
  // joinPackMemberUrl needs an absolute base for `new URL(member, base)`.
  const absoluteUrl = new URL(url, document.baseURI).href;
  const res = await fetch(absoluteUrl, { cache: 'no-store', signal });
  if (!res.ok) throw new Error(STREETSCAPE_ERRORS.FETCH_FAILED);
  const pack = parseManifestText(await res.text());
  const base = absoluteUrl.replace(/\/[^/]*$/, '/');
  return {
    pack,
    async openFeature(id: string, inner?: AbortSignal): Promise<File[]> {
      throwIfAborted(inner || signal);
      const feature = pack.features.find(f => f.id === id);
      if (!feature) throw new Error(STREETSCAPE_ERRORS.NO_FEATURE);
      const files = await fetchFeatureWithSidecars(base, feature.path, inner || signal);
      return expandModelDropFiles(files);
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
  const absoluteRoot = new URL(root, document.baseURI).href;
  return new URL(clean, absoluteRoot).href;
}

/** Primary + same-folder MTL / map_Kd (catalog folder packs have no directory listing). */
export async function fetchFeatureWithSidecars(
  base: string,
  featurePath: string,
  signal?: AbortSignal,
): Promise<File[]> {
  const primary = await fetchPackMember(joinPackMemberUrl(base, featurePath), featurePath, signal);
  const out: File[] = [primary];
  if (!/\.obj$/i.test(featurePath)) return out;

  const dir = dirOfPackagePath(featurePath);
  const stem = featurePath.replace(/\.[^.]+$/, '');
  const objText = await primary.text();
  const mtllib = readObjMtllib(objText);
  const mtlCandidates = new Set<string>();
  if (mtllib) mtlCandidates.add(joinRel(dir, mtllib));
  mtlCandidates.add(`${stem}.mtl`);

  for (const mtlRel of mtlCandidates) {
    const mtl = await tryFetchPackMember(base, mtlRel, signal);
    if (!mtl) continue;
    out.push(mtl);
    for (const mapRel of readMtlMapKd(await mtl.text())) {
      const texRel = joinRel(dirOfPackagePath(mtlRel), mapRel);
      const tex = await tryFetchPackMember(base, texRel, signal);
      if (tex) out.push(tex);
    }
  }
  return out;
}

function joinRel(dir: string, name: string): string {
  const clean = normalizePackagePath(name);
  if (!clean || clean.includes('..')) return '';
  return dir ? `${dir}/${clean}` : clean;
}

function readObjMtllib(text: string): string {
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const parts = line.split(/\s+/);
    if (parts[0] === 'mtllib' && parts[1]) return parts.slice(1).join(' ');
  }
  return '';
}

function readMtlMapKd(text: string): string[] {
  const maps: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const parts = line.split(/\s+/);
    if (parts[0] === 'map_Kd' && parts.length >= 2) maps.push(parts[parts.length - 1]);
  }
  return maps;
}

async function tryFetchPackMember(
  base: string,
  rel: string,
  signal?: AbortSignal,
): Promise<File | null> {
  if (!rel) return null;
  try {
    return await fetchPackMember(joinPackMemberUrl(base, rel), rel, signal);
  } catch {
    return null;
  }
}

async function fetchPackMember(url: string, path: string, signal?: AbortSignal): Promise<File> {
  const res = await fetch(url, { cache: 'no-store', signal });
  if (!res.ok) throw new Error(STREETSCAPE_ERRORS.FETCH_FAILED);
  const blob = await res.blob();
  const name = path.split('/').pop() || 'file';
  return attachPackagePath(
    new File([blob], name, { type: blob.type || 'application/octet-stream' }),
    normalizePackagePath(path) || name,
  );
}
