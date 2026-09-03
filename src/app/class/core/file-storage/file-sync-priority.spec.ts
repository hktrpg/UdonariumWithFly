import { GameTable } from '@udonarium/game-table';
import { Jukebox } from '@udonarium/Jukebox';
import { TableSelecter } from '@udonarium/table-selecter';

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
    for (const id of ['img-thumb', 'img-full', 'map-thumb', 'map-full', 'map-active-img', 'map-other-img']) {
      ImageStorage.instance.delete(id);
    }
    for (const table of [...ObjectStore.instance.getObjects(GameTable)]) {
      table.destroy();
    }
  });

  it('ranks map thumbs → other thumbs → playing BGM → map full → other full → audio/pdf by size', () => {
    const table = new GameTable('map-prio');
    table.initialize();
    table.imageIdentifier = 'map-thumb';
    table.backgroundImageIdentifier = 'map-full';

    const mapThumb = ImageFile.createEmpty('map-thumb');
    ImageStorage.instance.add(mapThumb);

    const otherThumb = ImageFile.createEmpty('img-thumb');
    ImageStorage.instance.add(otherThumb);

    const thumbBlob = new Blob([new Uint8Array(4)], { type: 'image/png' });
    const mapFull = ImageFile.createEmpty('map-full');
    (mapFull as any).context.thumbnail = { blob: thumbBlob, type: 'image/png', url: '' };
    (mapFull as any).context.blob = null;
    ImageStorage.instance.add(mapFull);

    const otherFull = ImageFile.createEmpty('img-full');
    (otherFull as any).context.thumbnail = { blob: thumbBlob, type: 'image/png', url: '' };
    (otherFull as any).context.blob = null;
    ImageStorage.instance.add(otherFull);

    primePlayingMusicCache();

    expect(mapThumb.state).toBe(ImageState.NULL);
    expect(otherThumb.state).toBe(ImageState.NULL);
    expect(mapFull.state).toBe(ImageState.THUMBNAIL);
    expect(otherFull.state).toBe(ImageState.THUMBNAIL);

    expect(fileSyncPriorityTier('image', 'map-thumb')).toBe(FileSyncPriorityTier.IMAGE_MAP_THUMB);
    expect(fileSyncPriorityTier('image', 'img-thumb')).toBe(FileSyncPriorityTier.IMAGE_THUMB);
    expect(fileSyncPriorityTier('image', 'map-full')).toBe(FileSyncPriorityTier.IMAGE_MAP_FULL);
    expect(fileSyncPriorityTier('image', 'img-full')).toBe(FileSyncPriorityTier.IMAGE_FULL);
    expect(fileSyncPriorityTier('pdf', 'rules')).toBe(FileSyncPriorityTier.DEFAULT);
    expect(fileSyncPriorityTier('audio', 'idle')).toBe(FileSyncPriorityTier.DEFAULT);

    expect(compareFileSyncPriority('image', 'map-thumb', 4_000, 'image', 'img-thumb', 1_000)).toBeLessThan(0);
    expect(compareFileSyncPriority('image', 'img-thumb', 4_000, 'image', 'map-full', 500_000)).toBeLessThan(0);
    expect(compareFileSyncPriority('image', 'map-full', 500_000, 'image', 'img-full', 1_000)).toBeLessThan(0);
    expect(compareFileSyncPriority('image', 'img-full', 500_000, 'audio', 'idle', 1_000)).toBeLessThan(0);
    expect(compareFileSyncPriority('pdf', 'rules', 1_000, 'audio', 'idle', 8_000_000)).toBeLessThan(0);
  });

  it('keeps playing BGM after thumbs and before full images / pdf', () => {
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

  it('prefers the active/view table map over other maps in the same tier', () => {
    const active = new GameTable('map-active');
    active.initialize();
    active.imageIdentifier = 'map-active-img';
    const other = new GameTable('map-other');
    other.initialize();
    other.imageIdentifier = 'map-other-img';

    TableSelecter.instance.viewTableIdentifier = active.identifier;
    TableSelecter.instance.viewedTableIdentifier = active.identifier;

    ImageStorage.instance.add(ImageFile.createEmpty('map-active-img'));
    ImageStorage.instance.add(ImageFile.createEmpty('map-other-img'));
    primePlayingMusicCache();

    expect(fileSyncPriorityTier('image', 'map-active-img')).toBe(FileSyncPriorityTier.IMAGE_MAP_THUMB);
    expect(fileSyncPriorityTier('image', 'map-other-img')).toBe(FileSyncPriorityTier.IMAGE_MAP_THUMB);
    expect(compareFileSyncPriority(
      'image', 'map-active-img', 900_000,
      'image', 'map-other-img', 1_000,
    )).toBeLessThan(0);
  });
});
