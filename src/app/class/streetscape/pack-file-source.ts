import { BlobReader, BlobWriter, ZipReader } from '@zip.js/zip.js';

import { MimeType } from '@udonarium/core/file-storage/mime-type';
import { MODEL_MAX_FILE_BYTES } from '@udonarium/terrain-model/mesh-ir';
import {
  attachPackagePath,
  dirOfPackagePath,
  expandModelDropFiles,
  isPrimaryModelFile,
  isZipFile,
  normalizePackagePath,
  packagePathOf,
  resolvePackageFile,
} from '@udonarium/terrain-model/model-package-files';

import { STREETSCAPE_ERRORS } from './errors';
import { parseStreetscapePackV1, StreetscapePackV1 } from './pack-schema';
import { StreetscapePackLoad, StreetscapeQuery, StreetscapeSource, throwIfAborted } from './source';

const PACK_MEMBER_RE = /\.(json|stl|obj|mtl|glb|gltf|fbx|bin|png|jpe?g|webp|gif|bmp|zip)$/i;

export const packFileSource: StreetscapeSource = {
  id: 'pack-file',
  async resolve(query: StreetscapeQuery, signal?: AbortSignal): Promise<StreetscapePackLoad> {
    if (query.type !== 'file' || !query.files?.length) throw new Error(STREETSCAPE_ERRORS.NO_QUERY);
    throwIfAborted(signal);
    const files = await expandStreetscapePackFiles(query.files);
    throwIfAborted(signal);
    const manifestFile = findManifest(files);
    if (!manifestFile) throw new Error(STREETSCAPE_ERRORS.NO_MANIFEST);
    const pack = parseManifestText(await manifestFile.text());
    return createPackLoad(pack, files);
  },
};

export function createPackLoad(pack: StreetscapePackV1, files: File[]): StreetscapePackLoad {
  return {
    pack,
    async openFeature(id: string, signal?: AbortSignal): Promise<File[]> {
      throwIfAborted(signal);
      const feature = pack.features.find(f => f.id === id);
      if (!feature) throw new Error(STREETSCAPE_ERRORS.NO_FEATURE);
      const primary = resolvePackageFile(files, feature.path);
      if (!primary) throw new Error(STREETSCAPE_ERRORS.NO_FEATURE);
      return expandModelDropFiles([primary, ...sidecarFilesForPrimary(files, primary)]);
    },
    async openFloor(signal?: AbortSignal): Promise<Blob> {
      throwIfAborted(signal);
      const file = resolvePackageFile(files, pack.floor.path);
      if (!file) throw new Error(STREETSCAPE_ERRORS.NO_FLOOR);
      return file;
    },
  };
}

export async function expandStreetscapePackFiles(files: File[]): Promise<File[]> {
  const out: File[] = [];
  for (const file of files || []) {
    if (!isZipFile(file) && !/\.zip$/i.test(packagePathOf(file))) {
      out.push(attachPackagePath(file, packagePathOf(file)));
      continue;
    }
    out.push(...await unzipStreetscapePack(file));
  }
  return out;
}

async function unzipStreetscapePack(zipFile: File): Promise<File[]> {
  const zipReader = new ZipReader(new BlobReader(zipFile));
  try {
    const entries = await zipReader.getEntries();
    const out: File[] = [];
    for (const entry of entries || []) {
      if (entry.directory) continue;
      const rawPath = (entry.filename || '').replace(/\\/g, '/');
      const path = normalizePackagePath(rawPath);
      if (!path || path.endsWith('/') || path.startsWith('__macosx/')) continue;
      if (/(^|\/)\./.test(path)) continue;
      if (!PACK_MEMBER_RE.test(path)) continue;
      const listedSize = (entry as { uncompressedSize?: number }).uncompressedSize;
      if (listedSize && listedSize > MODEL_MAX_FILE_BYTES) continue;
      const blob = await entry.getData(new BlobWriter());
      if (blob.size > MODEL_MAX_FILE_BYTES) continue;
      const base = rawPath.replace(/^.*\//, '') || 'file';
      const file = new File([blob], base, { type: MimeType.type(base) });
      out.push(attachPackagePath(file, path));
    }
    return out;
  } finally {
    await zipReader.close();
  }
}

function findManifest(files: File[]): File | undefined {
  const indexed = files.map(f => ({ file: f, path: packagePathOf(f) }));
  return (indexed.find(x => x.path === 'manifest.json')
    || indexed.find(x => x.path.endsWith('/manifest.json')))?.file;
}

const SIDECAR_RE = /\.(mtl|bin|png|jpe?g|webp|gif|bmp)$/i;

/** Textures / MTL / BIN next to a primary — never other buildings. */
export function sidecarFilesForPrimary(files: File[], primary: File): File[] {
  const primaryPath = packagePathOf(primary);
  const dir = dirOfPackagePath(primaryPath);
  const prefix = dir ? `${dir}/` : '';
  return files.filter(f => {
    if (f === primary) return false;
    if (isPrimaryModelFile(f)) return false;
    const p = packagePathOf(f);
    if (dir && !p.startsWith(prefix)) return false;
    if (!dir && p.includes('/')) return false;
    return SIDECAR_RE.test(p);
  });
}

export function parseManifestText(text: string): StreetscapePackV1 {
  try {
    return parseStreetscapePackV1(JSON.parse(text));
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('STREETSCAPE_')) throw err;
    throw new Error(STREETSCAPE_ERRORS.INVALID_PACK);
  }
}
