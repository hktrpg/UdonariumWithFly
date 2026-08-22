import { FileReceiveScheduler } from './file-transfer-scheduler';
import { FileSyncProgress } from './file-sync-progress';
import { AudioStorage } from './audio-storage';
import { ImageFile } from './image-file';
import { ImageStorage } from './image-storage';
import { PdfStorage } from './pdf-storage';
import { VideoStorage } from './video-storage';

describe('FileSyncProgress', () => {
  let images: ImageFile[] = [];

  beforeEach(() => {
    FileSyncProgress.reset();
    images = [];
    spyOnProperty(ImageStorage.instance, 'images', 'get').and.callFake(() => images);
    spyOnProperty(AudioStorage.instance, 'audios', 'get').and.returnValue([]);
    spyOnProperty(PdfStorage.instance, 'pdfs', 'get').and.returnValue([]);
    spyOnProperty(VideoStorage.instance, 'videos', 'get').and.returnValue([]);
    spyOn(FileReceiveScheduler, 'activeReceiveCount').and.returnValue(0);
    spyOn(FileReceiveScheduler, 'outboundPendingCount').and.returnValue(0);
    spyOn(FileReceiveScheduler, 'pendingReceiveCount').and.returnValue(0);
    spyOn(FileReceiveScheduler, 'isTransferActive').and.returnValue(false);
    spyOn(FileReceiveScheduler, 'isTransferPending').and.returnValue(false);
  });

  it('returns idle when nothing is loading', () => {
    const snap = FileSyncProgress.snapshot(10);
    expect(snap.active).toBeFalse();
    expect(snap.percentLoaded).toBe(0);
    expect(snap.filledSegments).toBe(0);
  });

  it('ignores incomplete assets that are not actively syncing', () => {
    const image = ImageFile.createEmpty('img-1');
    const thumbBlob = new Blob([new Uint8Array(100)], { type: 'image/png' });
    image.apply({
      identifier: 'img-1',
      name: '',
      type: 'image/png',
      blob: thumbBlob,
      url: 'blob:test',
      thumbnail: { type: 'image/png', blob: thumbBlob, url: 'blob:test' },
    });
    images.push(image);

    const snap = FileSyncProgress.snapshot(20);
    expect(snap.active).toBeFalse();
  });

  it('starts at 0% and grows while chunks arrive', () => {
    const image = ImageFile.createEmpty('img-1');
    const thumbBlob = new Blob([new Uint8Array(100)], { type: 'image/png' });
    image.apply({
      identifier: 'img-1',
      name: '',
      type: 'image/png',
      blob: thumbBlob,
      url: 'blob:test',
      thumbnail: { type: 'image/png', blob: thumbBlob, url: 'blob:test' },
    });
    images.push(image);
    (FileReceiveScheduler.isTransferActive as jasmine.Spy).and.returnValue(true);

    FileSyncProgress.noteChunkProgress('img-1', 0, 9);
    const start = FileSyncProgress.snapshot(20);
    expect(start.active).toBeTrue();
    expect(start.percentLoaded).toBeGreaterThanOrEqual(0);
    expect(start.percentLoaded).toBeLessThan(50);

    FileSyncProgress.noteChunkProgress('img-1', 8, 9);
    const later = FileSyncProgress.snapshot(20);
    expect(later.percentLoaded).toBeGreaterThan(start.percentLoaded);
  });

  it('clears transfer progress on clearTransfer when nothing else is loading', () => {
    FileSyncProgress.noteChunkProgress('gone', 1, 4);
    FileSyncProgress.clearTransfer('gone');
    const snap = FileSyncProgress.snapshot(10);
    expect(snap.active).toBeFalse();
  });
});
