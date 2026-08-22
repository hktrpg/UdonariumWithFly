import { Jukebox } from '@udonarium/Jukebox';

import { ObjectStore } from '../synchronize-object/object-store';

import { FileSyncPriorityTier, compareFileSyncPriority, fileSyncPriorityTier } from './file-sync-priority';

describe('fileSyncPriority', () => {
  it('ranks images above playing audio and other files', () => {
    expect(fileSyncPriorityTier('image', 'img-a')).toBe(FileSyncPriorityTier.IMAGE);
    expect(fileSyncPriorityTier('audio', 'bgm-a')).toBe(FileSyncPriorityTier.DEFAULT);
    expect(compareFileSyncPriority('image', 'img-a', 500_000, 'audio', 'bgm-a', 1_000)).toBeLessThan(0);
    expect(compareFileSyncPriority('audio', 'bgm-a', 1_000, 'video', 'clip', 5_000_000)).toBeLessThan(0);
  });

  it('treats jukebox playing tracks as priority audio', () => {
    const existing = ObjectStore.instance.get('Jukebox');
    existing?.destroy();

    const jukebox = new Jukebox('Jukebox');
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

    expect(fileSyncPriorityTier('audio', 'bgm-playing')).toBe(FileSyncPriorityTier.PLAYING_AUDIO);
    expect(fileSyncPriorityTier('audio', 'bgm-next')).toBe(FileSyncPriorityTier.PLAYING_AUDIO);
    expect(fileSyncPriorityTier('audio', 'bgm-idle')).toBe(FileSyncPriorityTier.DEFAULT);
    expect(compareFileSyncPriority('image', 'thumb', 8_000, 'audio', 'bgm-playing', 4_000_000)).toBeLessThan(0);
    expect(compareFileSyncPriority('audio', 'bgm-playing', 4_000_000, 'video', 'clip', 1_000)).toBeLessThan(0);

    jukebox.destroy();
  });
});
