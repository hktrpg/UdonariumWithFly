import { AudioState } from './audio-file';
import { FileSyncPriorityTier } from './file-sync-priority';
import { FileReceiveScheduler, estimateNextReceiveBytes } from './file-transfer-scheduler';
import { ImageState } from './image-file';
import { EventSystem, Network } from '../system';
import { Jukebox } from '@udonarium/Jukebox';
import { ObjectStore } from '../synchronize-object/object-store';

describe('FileReceiveScheduler', () => {
  let peerIds: string[];

  beforeEach(() => {
    FileReceiveScheduler.resetForTests();
    peerIds = ['p1'];
    spyOnProperty(Network, 'peerIds', 'get').and.callFake(() => peerIds);
  });

  afterEach(() => {
    ObjectStore.instance.get('Jukebox')?.destroy();
    ObjectStore.instance.clearDeleted('Jukebox');
  });

  it('finishes thumbnail phase before dispatching audio/pdf by size', () => {
    const order: string[] = [];
    FileReceiveScheduler.enqueueReceiveRequest('video', 'p1', 'big', 5_000_000, () => order.push('big'));
    FileReceiveScheduler.enqueueReceiveRequest('audio', 'p1', 'small', 100_000, () => order.push('small'));
    FileReceiveScheduler.enqueueReceiveRequest('pdf', 'p1', 'mid', 1_000_000, () => order.push('mid'));
    FileReceiveScheduler.enqueueReceiveRequest('image', 'p1', 'thumb', 4_000, () => order.push('thumb'));
    FileReceiveScheduler.schedule();
    expect(order).toEqual(['thumb']);
    FileReceiveScheduler.markReceiveStart('image', 'thumb');
    FileReceiveScheduler.markReceiveEnd('image', 'thumb');
    expect(order).toEqual(['thumb', 'small', 'mid', 'big']);
  });

  it('estimateNextReceiveBytes prefers thumbBytes for incomplete images', () => {
    const bytes = estimateNextReceiveBytes('image', ImageState.NULL, {
      identifier: 'a',
      state: ImageState.COMPLETE,
      byteSize: 500_000,
      thumbBytes: 8_000,
    });
    expect(bytes).toBe(8_000);
  });

  it('abortOutboundRequest frees a slot for a later retry', () => {
    const order: string[] = [];
    FileReceiveScheduler.enqueueReceiveRequest('pdf', 'p1', 'doc', 1_000_000, () => order.push('first'));
    FileReceiveScheduler.schedule();
    expect(order).toEqual(['first']);
    FileReceiveScheduler.abortOutboundRequest('pdf', 'doc');
    FileReceiveScheduler.enqueueReceiveRequest('pdf', 'p1', 'doc', 1_000_000, () => order.push('retry'));
    FileReceiveScheduler.schedule();
    expect(order).toEqual(['first', 'retry']);
  });

  it('estimateNextReceiveBytes uses byteSize for audio', () => {
    const bytes = estimateNextReceiveBytes('audio', AudioState.NULL, {
      identifier: 'a',
      state: AudioState.COMPLETE,
      byteSize: 42_000,
    });
    expect(bytes).toBe(42_000);
  });

  it('logs receive order only when new files enter the queue', () => {
    const log = spyOn(console, 'log');
    peerIds = [];
    FileReceiveScheduler.enqueueReceiveRequest('audio', 'p1', 'a1', 100_000, () => {});
    FileReceiveScheduler.enqueueReceiveRequest('image', 'p1', 'i1', 4_000, () => {});
    FileReceiveScheduler.schedule();
    expect(log.calls.all().filter(c => String(c.args[0]).includes('[file-sync] receive order')).length).toBe(1);
    const rows = log.calls.mostRecent().args[1] as Array<{ tier: string; id: string }>;
    expect(rows[0].tier).toBe('IMAGE_THUMB');
    expect(rows.map(r => r.id)).toEqual(['i1', 'a1']);
    expect(FileSyncPriorityTier.IMAGE_THUMB).toBe(0);

    log.calls.reset();
    FileReceiveScheduler.schedule();
    expect(log.calls.all().filter(c => String(c.args[0]).includes('[file-sync] receive order')).length).toBe(0);

    FileReceiveScheduler.enqueueReceiveRequest('pdf', 'p1', 'p1doc', 1_000_000, () => {});
    FileReceiveScheduler.schedule();
    expect(log.calls.all().filter(c => String(c.args[0]).includes('[file-sync] receive order')).length).toBe(1);
  });

  it('promotes playing BGM after markForChanged-style Jukebox identifier event', () => {
    const log = spyOn(console, 'log');
    peerIds = []; // keep queue pending so tiers stay visible
    FileReceiveScheduler.ensureNetworkHooks();
    spyOn(FileReceiveScheduler as any, 'scheduleDeferred').and.callFake(() => {
      FileReceiveScheduler.schedule();
    });

    FileReceiveScheduler.enqueueReceiveRequest('audio', 'p1', 'bgm-playing', 8_000_000, () => {});
    FileReceiveScheduler.enqueueReceiveRequest('pdf', 'p1', 'rules', 1_000_000, () => {});
    FileReceiveScheduler.schedule();

    let rows = log.calls.mostRecent().args[1] as Array<{ tier: string; id: string }>;
    expect(rows.find(r => r.id === 'bgm-playing')?.tier).toBe('DEFAULT');

    ObjectStore.instance.clearDeleted('Jukebox');
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
      queue: [],
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
    expect(jukebox.tracks[0].isPlaying).toBe(true);

    // Simulate join: files queued before jukebox apply; forget any earlier priority snapshot.
    (FileReceiveScheduler as any).playingMusicPriorityKey = '';
    log.calls.reset();
    // Same event markForChanged fires after inbound apply / releasePeerSync.
    EventSystem.trigger('UPDATE_GAME_OBJECT/identifier/Jukebox', {
      aliasName: 'jukebox',
      identifier: 'Jukebox',
    });

    const orderLogs = log.calls.all().filter(c => String(c.args[0]).includes('[file-sync] receive order'));
    expect(orderLogs.length).toBeGreaterThan(0);
    rows = orderLogs[orderLogs.length - 1].args[1] as Array<{ tier: string; id: string; order: number }>;
    expect(rows.find(r => r.id === 'bgm-playing')?.tier).toBe('PLAYING_AUDIO');
    expect(rows[0].id).toBe('bgm-playing');
    expect(rows[1].id).toBe('rules');
  });
});
