import { BlobReader, BlobWriter, ZipReader } from '@zip.js/zip.js';

import { attachPackagePath } from '@udonarium/terrain-model/model-package-files';

import {
  streetscapePackDownloadName,
  zipStreetscapePack,
} from './export-pack';
import { StreetscapePackV1 } from './pack-schema';

describe('zipStreetscapePack', () => {
  it('writes manifest.json and member files', async () => {
    const pack: StreetscapePackV1 = {
      version: 1,
      id: 'demo-sheet',
      title: 'Demo',
      attribution: 'test',
      metersPerUnit: 1,
      origin: { x: 0, z: 0 },
      extentMeters: { width: 10, depth: 10 },
      floor: { path: 'floor.png' },
      features: [],
    };
    const floor = attachPackagePath(
      new File([new Uint8Array([1, 2, 3])], 'floor.png', { type: 'image/png' }),
      'floor.png',
    );
    const blob = await zipStreetscapePack(pack, [floor]);
    expect(blob.size).toBeGreaterThan(20);
    expect(streetscapePackDownloadName(pack)).toBe('demo-sheet.zip');

    const reader = new ZipReader(new BlobReader(blob));
    const entries = await reader.getEntries();
    await reader.close();
    const names = (entries || []).map(e => e.filename).sort();
    expect(names).toEqual(['floor.png', 'manifest.json']);
  });
});
