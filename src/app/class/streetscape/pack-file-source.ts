import { BlobReader, BlobWriter, ZipReader } from '@zip.js/zip.js';

import { MimeType } from '@udonarium/core/file-storage/mime-type';
import { MODEL_MAX_FILE_BYTES } from '@udonarium/terrain-model/mesh-ir';
import {
  attachPackagePath,
  expandModelDropFiles,
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
    const pack = parseStreetscapePackV1(JSON.parse(await manifestFile.text()));
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
      return expandModelDropFiles([primary, ...sidecarFiles(files, primary)]);
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

function sidecarFiles(files: File[], primary: File): File[] {
  const dir = packagePathOf(primary).replace(/\/[^/]+$/, '');
  if (!dir || dir === packagePathOf(primary)) return files.filter(f => f !== primary);
  const prefix = dir + '/';
  return files.filter(f => f !== primary && packagePathOf(f).startsWith(prefix));
}
