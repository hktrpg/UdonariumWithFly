import { AudioFile, AudioState } from '@udonarium/core/file-storage/audio-file';
import { AudioStorage } from '@udonarium/core/file-storage/audio-storage';
import { FileReceiveScheduler } from '@udonarium/core/file-storage/file-transfer-scheduler';
import { ImageFile, ImageState } from '@udonarium/core/file-storage/image-file';
import { ImageStorage } from '@udonarium/core/file-storage/image-storage';
import {
  collectRoomMediaStats,
  formatDiagBytes,
  formatMeshDiagStatsLines,
  registerJoinDiagProvider,
} from './mesh-diag-stats';

describe('mesh-diag-stats', () => {
  beforeEach(() => {
    FileReceiveScheduler.resetForTests();
    registerJoinDiagProvider(null);
  });

  afterEach(() => {
    FileReceiveScheduler.resetForTests();
    registerJoinDiagProvider(null);
  });

  it('formatDiagBytes uses KB/MB thresholds', () => {
    expect(formatDiagBytes(500)).toBe('500B');
    expect(formatDiagBytes(2048)).toBe('2.0KB');
    expect(formatDiagBytes(2 * 1024 * 1024)).toBe('2.00MB');
  });

  it('collectRoomMediaStats sums complete blob sizes by kind', () => {
    const imgBlob = new Blob([new Uint8Array(1024)]);
    const image = {
      state: ImageState.COMPLETE,
      blob: imgBlob,
      thumbnail: { blob: null },
    } as ImageFile;
    spyOnProperty(ImageStorage.instance, 'images', 'get').and.returnValue([image]);
    spyOnProperty(AudioStorage.instance, 'audios', 'get').and.returnValue([
      { state: AudioState.COMPLETE, blob: new Blob([new Uint8Array(2048)]) } as AudioFile,
      { state: AudioState.NULL, blob: null } as AudioFile,
    ]);

    const stats = collectRoomMediaStats();
    expect(stats.image.complete).toBe(1);
    expect(stats.image.bytes).toBe(1024);
    expect(stats.audio.complete).toBe(1);
    expect(stats.audio.incomplete).toBe(1);
    expect(stats.audio.bytes).toBe(2048);
    expect(stats.totalBytes).toBe(1024 + 2048);
  });

  it('formatMeshDiagStatsLines includes room-data and load sections', () => {
    FileReceiveScheduler.beginJoinProbeHold();
    FileReceiveScheduler.enqueueReceiveRequest('image', 'p1', 'a', 4096, () => {});
    FileReceiveScheduler.enqueueReceiveRequest('audio', 'p1', 'b', 999_999_999, () => {});
    registerJoinDiagProvider(() => ({
      joinInProgress: true,
      reopenInFlight: false,
      reconnecting: true,
    }));

    const text = formatMeshDiagStatsLines().join('\n');
    expect(text).toContain('room-data (local complete blobs):');
    expect(text).toContain('load:');
    expect(text).toContain('fileSync:');
    expect(text).toContain('hold=true');
    expect(text).toContain('byKind={image=1,audio=1}');
    expect(text).toContain('session: join=true reopen=false reconnecting=true');
  });
});
