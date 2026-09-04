import { BlobReader, BlobWriter, ZipWriter } from '@zip.js/zip.js';
import { saveAs } from 'file-saver';

import { packagePathOf } from '@udonarium/terrain-model/model-package-files';

import { StreetscapePackV1 } from './pack-schema';
import { StreetscapePackLoad } from './source';

/**
 * Build a re-importable streetscape pack ZIP (manifest.json + members).
 * Does not include a pre-existing manifest from `files` — always writes `pack`.
 */
export async function zipStreetscapePack(
  pack: StreetscapePackV1,
  files: File[],
): Promise<Blob> {
  const writer = new ZipWriter(new BlobWriter('application/zip'), { bufferedWrite: true });
  const manifestBody = JSON.stringify(pack, null, 2);
  await writer.add(
    'manifest.json',
    new BlobReader(new Blob([manifestBody], { type: 'application/json' })),
  );
  const seen = new Set<string>(['manifest.json']);
  for (const file of files || []) {
    const path = normalizeExportPath(file);
    if (!path || seen.has(path)) continue;
    seen.add(path);
    await writer.add(path, new BlobReader(file));
  }
  return writer.close();
}

export function streetscapePackDownloadName(pack: StreetscapePackV1): string {
  const raw = (pack.id || pack.title || 'streetscape').trim() || 'streetscape';
  const safe = raw
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80) || 'streetscape';
  return `${safe}.zip`;
}

export async function downloadStreetscapePack(
  pack: StreetscapePackV1,
  files: File[],
  fileName?: string,
): Promise<void> {
  const blob = await zipStreetscapePack(pack, files);
  saveAs(blob, fileName || streetscapePackDownloadName(pack));
}

/** Files available for export from a resolved pack load (Open3Dhk / file / catalog). */
export function packFilesForExport(load: StreetscapePackLoad): File[] {
  return load.files ? load.files.slice() : [];
}

function normalizeExportPath(file: File): string {
  const path = (packagePathOf(file) || file.name || '').replace(/\\/g, '/').replace(/^\/+/, '');
  if (!path || path.endsWith('/') || path === 'manifest.json') return '';
  if (path.startsWith('__macosx/') || /(^|\/)\./.test(path)) return '';
  return path;
}
