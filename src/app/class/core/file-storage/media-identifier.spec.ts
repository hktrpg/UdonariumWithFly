import { ImageFile, ImageState } from './image-file';
import { ImageStorage } from './image-storage';
import { isUrlBackedMediaIdentifier } from './media-identifier';

describe('isUrlBackedMediaIdentifier', () => {
  it('detects built-in asset paths and remote URLs', () => {
    expect(isUrlBackedMediaIdentifier('./assets/images/trump/c01.gif')).toBe(true);
    expect(isUrlBackedMediaIdentifier('/assets/images/trump/c01.gif')).toBe(true);
    expect(isUrlBackedMediaIdentifier('https://example.com/a.png')).toBe(true);
    expect(isUrlBackedMediaIdentifier('3e9a03cd043ea5c618bbdb22d5287b223e2db8ecf80407a41053ec4da8bca873')).toBe(false);
  });
});

describe('ImageStorage.getCatalog', () => {
  const urlId = './assets/images/trump/blank_card.png';
  const blobId = 'catalog-blob-complete';

  afterEach(() => {
    ImageStorage.instance.delete(urlId);
    ImageStorage.instance.delete(blobId);
  });

  it('excludes URL/path assets so they are not advertised for P2P sync', () => {
    ImageStorage.instance.add(ImageFile.create(urlId));
    expect(ImageStorage.instance.get(urlId).state).toBe(ImageState.URL);

    const complete = ImageFile.createEmpty(blobId);
    const fullBlob = new Blob([new Uint8Array(8)], { type: 'image/png' });
    const thumbBlob = new Blob([new Uint8Array(2)], { type: 'image/png' });
    (complete as any).context.blob = fullBlob;
    (complete as any).context.type = 'image/png';
    (complete as any).context.url = 'blob:local';
    (complete as any).context.thumbnail = { blob: thumbBlob, type: 'image/png', url: 'blob:thumb' };
    ImageStorage.instance.add(complete);
    expect(complete.state).toBe(ImageState.COMPLETE);

    const catalog = ImageStorage.instance.getCatalog();
    expect(catalog.map(item => item.identifier)).toEqual([blobId]);
    expect(catalog.every(item => item.state === ImageState.COMPLETE)).toBe(true);
  });
});
