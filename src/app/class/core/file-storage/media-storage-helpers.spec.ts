import {
  addPackedByContentHash,
  buildCompleteBlobCatalog,
  deleteMediaFromHash,
  getFromHash,
  insertOrUpdateMediaFile,
  LazyCatalogSynchronizer,
  MEDIA_LAZY_SYNC_MIN_MS,
} from './media-storage-helpers';

describe('media-storage-helpers', () => {
  it('MEDIA_LAZY_SYNC_MIN_MS floors short lazySynchronize delays', () => {
    expect(MEDIA_LAZY_SYNC_MIN_MS).toBe(1500);
    expect(Math.max(100, MEDIA_LAZY_SYNC_MIN_MS)).toBe(1500);
    expect(Math.max(2000, MEDIA_LAZY_SYNC_MIN_MS)).toBe(2000);
  });

  it('LazyCatalogSynchronizer.synchronize publishes immediately', () => {
    const published: Array<string | undefined> = [];
    const sync = new LazyCatalogSynchronizer(peer => published.push(peer));
    sync.synchronize('peer-b');
    expect(published).toEqual(['peer-b']);
  });

  it('addPackedByContentHash returns existing COMPLETE hit', async () => {
    const hashName = `${'a'.repeat(64)}.mp3`;
    const existing = { state: 2 };
    const result = await addPackedByContentHash({
      file: new File([new Uint8Array([1])], hashName),
      completeState: 2,
      get: () => existing,
      addAsync: () => fail('should not addAsync') as any,
      createPacked: () => fail('should not createPacked') as any,
      store: () => fail('should not store') as any,
    });
    expect(result).toBe(existing);
  });

  it('addPackedByContentHash falls back to addAsync for non-hash names', async () => {
    const created = { state: 0 };
    const result = await addPackedByContentHash({
      file: new File([new Uint8Array([1])], 'theme.mp3'),
      completeState: 2,
      get: () => null,
      addAsync: async () => created,
      createPacked: () => fail('should not createPacked') as any,
      store: () => fail('should not store') as any,
    });
    expect(result).toBe(created);
  });

  it('insertOrUpdateMediaFile updates existing and lazy-syncs COMPLETE', () => {
    const hash: { [id: string]: { identifier: string; state: number } } = {
      a: { identifier: 'a', state: 0 },
    };
    const delays: number[] = [];
    const updated = insertOrUpdateMediaFile({
      hash,
      file: { identifier: 'a', state: 2 },
      completeState: 2,
      lazySynchronize: ms => delays.push(ms),
      tryUpdate: () => true,
    });
    expect(updated).toBe(hash.a);
    expect(delays).toEqual([100]);
  });

  it('insertOrUpdateMediaFile inserts when missing', () => {
    const hash: { [id: string]: { identifier: string; state: number } } = {};
    const file = { identifier: 'b', state: 0 };
    const inserted = insertOrUpdateMediaFile({
      hash,
      file,
      completeState: 2,
      lazySynchronize: () => fail('incomplete should not lazy sync'),
      tryUpdate: () => false,
    });
    expect(inserted).toBe(file);
    expect(hash.b).toBe(file);
  });

  it('buildCompleteBlobCatalog keeps COMPLETE only', () => {
    const catalog = buildCompleteBlobCatalog([
      { identifier: 'ok', state: 2, blob: new Blob([new Uint8Array(4)]) },
      { identifier: 'url', state: 1000, blob: null },
      { identifier: 'wip', state: 0, blob: new Blob([new Uint8Array(8)]) },
    ], 2);
    expect(catalog).toEqual([{ identifier: 'ok', state: 2, byteSize: 4 }]);
  });

  it('deleteMediaFromHash / getFromHash', () => {
    const destroyed: string[] = [];
    const hash = {
      x: { destroy: () => destroyed.push('x') },
    };
    expect(getFromHash(hash, 'x')).toBe(hash.x);
    expect(deleteMediaFromHash(hash, 'x')).toBe(true);
    expect(destroyed).toEqual(['x']);
    expect(getFromHash(hash, 'x')).toBeNull();
    expect(deleteMediaFromHash(hash, 'x')).toBe(false);
  });
});
