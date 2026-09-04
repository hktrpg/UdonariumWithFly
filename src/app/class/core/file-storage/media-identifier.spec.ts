import { Card, CardState } from '@udonarium/card';
import { AudioState } from './audio-file';
import { AudioStorage } from './audio-storage';
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

/**
 * Join regression: host no longer advertises ./assets trump paths in the catalog
 * (COMPLETE-only). Joiner still receives Card objects whose front/back are those
 * paths; without local hydrate, ImageService falls back to skeleton.png.
 */
describe('ImageStorage URL hydrate for joiners', () => {
  const front = './assets/images/trump/h01.gif';
  const back = './assets/images/trump/z02.gif';

  afterEach(() => {
    ImageStorage.instance.delete(front);
    ImageStorage.instance.delete(back);
  });

  it('lazily registers asset-path ids so poker faces resolve without P2P', () => {
    expect(ImageStorage.instance.getCatalog().some(c => c.identifier === front)).toBe(false);

    const image = ImageStorage.instance.get(front);
    expect(image).withContext('joiner must resolve ./assets trump without catalog entry').not.toBeNull();
    expect(image.state).toBe(ImageState.URL);
    expect(image.url).toBe(front);
    expect(image.isEmpty).toBe(false);

    // Still must not re-enter the P2P catalog.
    expect(ImageStorage.instance.getCatalog().map(c => c.identifier)).not.toContain(front);
  });

  it('resolves face-down poker card image for joiner without prior add()', () => {
    const card = Card.create('紅心的A', front, back);
    card.state = CardState.BACK;
    expect(card.imageFile).withContext('cover must not be skeleton/null after join').not.toBeNull();
    expect(card.imageFile.url).toBe(back);
    expect(card.imageFile.isEmpty).toBe(false);
  });
});

describe('AudioStorage URL hydrate for joiners', () => {
  const soundId = './assets/sounds/soundeffect-lab/card-turn-over1.mp3';

  afterEach(() => {
    AudioStorage.instance.delete(soundId);
  });

  it('lazily registers preset sound paths without P2P catalog entry', () => {
    const audio = AudioStorage.instance.get(soundId);
    expect(audio).not.toBeNull();
    expect(audio.state).toBe(AudioState.URL);
    expect(audio.url).toBe(soundId);
    expect(AudioStorage.instance.getCatalog().map(c => c.identifier)).not.toContain(soundId);
  });
});
