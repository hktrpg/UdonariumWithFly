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

  it('stays active for incomplete assets even between chunk transfers', () => {
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
    expect(snap.active).toBeTrue();
    // Thumbnail already local → progress must leave 0% immediately.
    expect(snap.percentLoaded).toBeGreaterThan(0);
    expect(snap.percentLoaded).toBeLessThan(100);
  });

  it('starts above 0% with local thumbnail and grows while chunks arrive', () => {
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
    expect(start.percentLoaded).toBeGreaterThan(0);
    expect(start.percentLoaded).toBeLessThan(50);

    FileSyncProgress.noteChunkProgress('img-1', 8, 9);
    const later = FileSyncProgress.snapshot(20);
    expect(later.percentLoaded).toBeGreaterThanOrEqual(start.percentLoaded);
  });

  it('holds percent between files when one completes and another is queued', () => {
    const a = ImageFile.createEmpty('img-a');
    const b = ImageFile.createEmpty('img-b');
    const thumbBlob = new Blob([new Uint8Array(100)], { type: 'image/png' });
    for (const img of [a, b]) {
      img.apply({
        identifier: img.identifier,
        name: '',
        type: 'image/png',
        blob: thumbBlob,
        url: 'blob:test',
        thumbnail: { type: 'image/png', blob: thumbBlob, url: 'blob:test' },
      });
    }
    images.push(a, b);

    const first = FileSyncProgress.snapshot(20);
    expect(first.active).toBeTrue();

    images.splice(0, 1);
    const between = FileSyncProgress.snapshot(20);
    expect(between.active).toBeTrue();
    expect(between.percentLoaded).toBeGreaterThanOrEqual(first.percentLoaded);
  });

  it('shows 100% briefly when all assets complete then goes idle', () => {
    let now = 0;
    spyOn(performance, 'now').and.callFake(() => now);

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
    FileSyncProgress.snapshot(10);
    images.length = 0;

    const done = FileSyncProgress.snapshot(10);
    expect(done.active).toBeTrue();
    expect(done.percentLoaded).toBe(100);

    now = 900;
    const idle = FileSyncProgress.snapshot(10);
    expect(idle.active).toBeFalse();
  });

  it('clears transfer progress on clearTransfer when nothing else is loading', () => {
    FileSyncProgress.noteChunkProgress('gone', 1, 4);
    FileSyncProgress.clearTransfer('gone');
    const snap = FileSyncProgress.snapshot(10);
    expect(snap.active).toBeFalse();
  });

  it('does not activate for queued transfers without incomplete assets', () => {
    (FileReceiveScheduler.pendingReceiveCount as jasmine.Spy).and.returnValue(3);
    (FileReceiveScheduler.outboundPendingCount as jasmine.Spy).and.returnValue(1);
    const snap = FileSyncProgress.snapshot(20);
    expect(snap.active).toBeFalse();
    expect(snap.percentLoaded).toBe(0);
  });

  it('credits pending queue so percent is not stuck at 0 before transfer starts', () => {
    const image = ImageFile.createEmpty('img-pending');
    images.push(image);
    (FileReceiveScheduler.isTransferPending as jasmine.Spy).and.returnValue(true);

    const snap = FileSyncProgress.snapshot(20);
    expect(snap.active).toBeTrue();
    expect(snap.percentLoaded).toBeGreaterThan(0);
    expect(snap.percentLoaded).toBeLessThan(100);
  });
});
