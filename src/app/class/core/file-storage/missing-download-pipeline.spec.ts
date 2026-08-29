import { Network } from '../system';
import { FileReceiveScheduler } from './file-transfer-scheduler';
import { ImageState } from './image-file';
import {
  collectMissingDownloadRequests,
  ensureRoomMissingDownloads,
  MissingDownloadHooks,
  queueMissingDownloads,
} from './missing-download-pipeline';
import { FolderMediaHydrator } from 'service/folder-media-hydrator';

describe('missing-download-pipeline', () => {
  let peerIds: string[];
  let local = new Map<string, number>();
  let receiving = new Set<string>();
  let hydrated: string[];
  let enqueued: Array<{ id: string; peerId: string; state: number }>;
  let hooks: MissingDownloadHooks;

  beforeEach(() => {
    FileReceiveScheduler.resetForTests();
    peerIds = ['peer-a'];
    spyOnProperty(Network, 'peerIds', 'get').and.callFake(() => peerIds);
    local = new Map();
    receiving = new Set();
    hydrated = [];
    enqueued = [];
    spyOn(FolderMediaHydrator.instance, 'beginHydrateMissing');

    hooks = {
      kind: 'image',
      completeState: ImageState.COMPLETE,
      nullState: ImageState.NULL,
      isReceiving: id => receiving.has(id),
      getLocalState: id => (local.has(id) ? local.get(id)! : null),
      ensurePlaceholder: id => { local.set(id, ImageState.NULL); },
      hydrateUrlBacked: item => {
        if (item.state === ImageState.URL) {
          hydrated.push(item.identifier);
          return true;
        }
        return false;
      },
      requestOne: (identifier, localState, peerId) => {
        enqueued.push({ id: identifier, peerId, state: localState });
      },
    };
  });

  afterEach(() => {
    FileReceiveScheduler.resetForTests();
  });

  it('collectMissingDownloadRequests skips url-backed and complete/receiving', () => {
    local.set('done', ImageState.COMPLETE);
    receiving.add('busy');
    local.set('busy', ImageState.NULL);
    const request = collectMissingDownloadRequests([
      { identifier: 'url', state: ImageState.URL },
      { identifier: 'done', state: ImageState.COMPLETE },
      { identifier: 'busy', state: ImageState.NULL },
      { identifier: 'need', state: ImageState.COMPLETE },
    ], hooks);
    expect(hydrated).toEqual(['url']);
    expect(request).toEqual([{ identifier: 'need', state: ImageState.NULL }]);
    expect(local.get('need')).toBe(ImageState.NULL);
  });

  it('queueMissingDownloads enqueues and invokes requestOne', () => {
    local.set('need', ImageState.NULL);
    queueMissingDownloads(
      [{ identifier: 'need', state: ImageState.NULL }],
      'peer-a',
      [{ identifier: 'need', state: ImageState.COMPLETE, byteSize: 1000 }],
      hooks,
    );
    FileReceiveScheduler.schedule();
    expect(enqueued).toEqual([{ id: 'need', peerId: 'peer-a', state: ImageState.NULL }]);
    expect(FolderMediaHydrator.instance.beginHydrateMissing)
      .toHaveBeenCalledWith('image', ['need']);
  });

  it('ensureRoomMissingDownloads skips closed peers', () => {
    peerIds = [];
    local.set('need', ImageState.NULL);
    ensureRoomMissingDownloads(
      new Map([['peer-a', [{ identifier: 'need', state: ImageState.COMPLETE }]]]),
      hooks,
    );
    FileReceiveScheduler.schedule();
    expect(enqueued).toEqual([]);
  });
});
