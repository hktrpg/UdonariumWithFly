import { Jukebox } from '@udonarium/Jukebox';

import { ObjectStore } from '../synchronize-object/object-store';

import {
  FileSyncPriorityTier,
  JUKEBOX_OBJECT_ID,
  clearPlayingMusicCache,
  compareFileSyncPriority,
  fileSyncPriorityTier,
  primePlayingMusicCache,
} from './file-sync-priority';
import { ImageFile, ImageState } from './image-file';
import { ImageStorage } from './image-storage';

describe('fileSyncPriority', () => {
  it('keeps Jukebox object id and sync alias aligned with markForChanged events', () => {
    expect(JUKEBOX_OBJECT_ID).toBe('Jukebox');
    expect(Jukebox.aliasName).toBe('jukebox');
  });

  afterEach(() => {
    clearPlayingMusicCache();
    ObjectStore.instance.get(JUKEBOX_OBJECT_ID)?.destroy();
    ObjectStore.instance.clearDeleted(JUKEBOX_OBJECT_ID);
    ImageStorage.instance.delete('img-thumb');
    ImageStorage.instance.delete('img-full');
  });

  it('ranks thumbnails → playing BGM → full images → audio/pdf by size', () => {
    const thumb = ImageFile.createEmpty('img-thumb');
    ImageStorage.instance.add(thumb);

    const full = ImageFile.createEmpty('img-full');
    const thumbBlob = new Blob([new Uint8Array(4)], { type: 'image/png' });
    (full as any).context.thumbnail = { blob: thumbBlob, type: 'image/png', url: '' };
    (full as any).context.blob = null;
    ImageStorage.instance.add(full);

    expect(thumb.state).toBe(ImageState.NULL);
    expect(full.state).toBe(ImageState.THUMBNAIL);

    expect(fileSyncPriorityTier('image', 'img-thumb')).toBe(FileSyncPriorityTier.IMAGE_THUMB);
    expect(fileSyncPriorityTier('image', 'img-full')).toBe(FileSyncPriorityTier.IMAGE_FULL);
    expect(fileSyncPriorityTier('pdf', 'rules')).toBe(FileSyncPriorityTier.DEFAULT);
    expect(fileSyncPriorityTier('audio', 'idle')).toBe(FileSyncPriorityTier.DEFAULT);

    expect(compareFileSyncPriority('image', 'img-thumb', 4_000, 'image', 'img-full', 500_000)).toBeLessThan(0);
    expect(compareFileSyncPriority('image', 'img-full', 500_000, 'audio', 'idle', 1_000)).toBeLessThan(0);
    // Same DEFAULT tier: smaller pdf before larger idle audio.
    expect(compareFileSyncPriority('pdf', 'rules', 1_000, 'audio', 'idle', 8_000_000)).toBeLessThan(0);
  });

  it('keeps playing BGM after thumbnails and before full images / pdf', () => {
    ObjectStore.instance.clearDeleted(JUKEBOX_OBJECT_ID);
    const jukebox = new Jukebox(JUKEBOX_OBJECT_ID);
    jukebox.initialize();
    jukebox.tracks = [{
      audioIdentifier: 'bgm-playing',
      isPlaying: true,
      isPaused: false,
      currentTime: 0,
      isLoop: true,
      roomGain: 1,
      label: '',
      queue: ['bgm-next'],
      queueMode: 'single',
      fadeSec: 2.5,
      overlapSec: 6,
    }, ...Array.from({ length: 4 }, () => ({
      audioIdentifier: '',
      isPlaying: false,
      isPaused: false,
      currentTime: 0,
      isLoop: true,
      roomGain: 1,
      label: '',
      queue: [],
      queueMode: 'single' as const,
      fadeSec: 2.5,
      overlapSec: 6,
    }))];
    primePlayingMusicCache();

    const full = ImageFile.createEmpty('img-full');
    const thumbBlob = new Blob([new Uint8Array(4)], { type: 'image/png' });
    (full as any).context.thumbnail = { blob: thumbBlob, type: 'image/png', url: '' };
    (full as any).context.blob = null;
    ImageStorage.instance.add(full);

    expect(fileSyncPriorityTier('audio', 'bgm-playing')).toBe(FileSyncPriorityTier.PLAYING_AUDIO);
    expect(fileSyncPriorityTier('audio', 'bgm-next')).toBe(FileSyncPriorityTier.PLAYING_AUDIO);

    expect(compareFileSyncPriority('image', 'missing-thumb', 4_000, 'audio', 'bgm-playing', 8_000_000)).toBeLessThan(0);
    expect(compareFileSyncPriority('audio', 'bgm-playing', 8_000_000, 'image', 'img-full', 500_000)).toBeLessThan(0);
    expect(compareFileSyncPriority('audio', 'bgm-playing', 8_000_000, 'pdf', 'rules', 1_000)).toBeLessThan(0);

    jukebox.destroy();
  });
});
