import { Network } from '../system';
import { FileReceiveScheduler } from './file-transfer-scheduler';
import { deferRequestIfPeerNotOpen, PEER_NOT_OPEN_LAZY_MS } from './defer-request-if-peer-not-open';

describe('deferRequestIfPeerNotOpen', () => {
  let peerIds: string[];
  let lazyMs: number[];
  let lazyPeer: string[];

  beforeEach(() => {
    FileReceiveScheduler.resetForTests();
    peerIds = ['open'];
    spyOnProperty(Network, 'peerIds', 'get').and.callFake(() => peerIds);
    lazyMs = [];
    lazyPeer = [];
  });

  afterEach(() => {
    FileReceiveScheduler.resetForTests();
  });

  it('returns false when peer is open and does not abort', () => {
    const abortSpy = spyOn(FileReceiveScheduler, 'abortOutboundRequest');
    const deferred = deferRequestIfPeerNotOpen('audio', 'open', 'a1', (ms, peer) => {
      lazyMs.push(ms);
      if (peer) lazyPeer.push(peer);
    });
    expect(deferred).toBe(false);
    expect(abortSpy).not.toHaveBeenCalled();
    expect(lazyMs).toEqual([]);
  });

  it('aborts outbound, remeshes, and returns true when peer is closed', () => {
    peerIds = [];
    const abortSpy = spyOn(FileReceiveScheduler, 'abortOutboundRequest');

    const deferred = deferRequestIfPeerNotOpen('pdf', 'closed', 'doc', (ms, peer) => {
      lazyMs.push(ms);
      if (peer) lazyPeer.push(peer);
    });

    expect(deferred).toBe(true);
    expect(abortSpy).toHaveBeenCalledWith('pdf', 'doc');
    expect(lazyMs).toEqual([PEER_NOT_OPEN_LAZY_MS]);
    expect(lazyPeer).toEqual(['closed']);
  });

  it('still remeshes when identifier is missing', () => {
    peerIds = [];
    const abortSpy = spyOn(FileReceiveScheduler, 'abortOutboundRequest');
    const deferred = deferRequestIfPeerNotOpen('video', 'gone', undefined, (ms, peer) => {
      lazyMs.push(ms);
      if (peer) lazyPeer.push(peer);
    });
    expect(deferred).toBe(true);
    expect(abortSpy).not.toHaveBeenCalled();
    expect(lazyMs).toEqual([PEER_NOT_OPEN_LAZY_MS]);
  });
});
