import { EventSystem, Network } from '../system';
import { BufferSharingTask } from './buffer-sharing-task';
import { FileReceiveScheduler } from './file-transfer-scheduler';
import { StartTransmissionDeclineGate } from './start-transmission-decline';
import {
  acceptOrDeclineStartTransmission,
  applyBlobContextsToStorage,
  applyReceiveProgressPercent,
  fulfillOrRelaySingleFileRequest,
  repackTransferredBlob,
  startSingleFileSendTask,
} from './single-file-media-transfer';

describe('single-file-media-transfer', () => {
  let peerIds: string[];

  beforeEach(() => {
    FileReceiveScheduler.resetForTests();
    peerIds = ['self', 'other'];
    spyOnProperty(Network, 'peerId', 'get').and.returnValue('self');
    spyOnProperty(Network, 'peerIds', 'get').and.callFake(() => peerIds);
  });

  afterEach(() => {
    FileReceiveScheduler.resetForTests();
  });

  it('fulfillOrRelaySingleFileRequest sends the highest-priority upgradable file', () => {
    const sent: string[] = [];
    fulfillOrRelaySingleFileRequest({
      kind: 'pdf',
      identifiers: [
        { identifier: 'big', state: 0 },
        { identifier: 'small', state: 0 },
      ],
      receiver: 'peer-b',
      candidatePeers: ['self', 'other'],
      sendTaskCount: 0,
      getLocalState: id => (id === 'big' ? 2 : id === 'small' ? 2 : null),
      startSend: (id, receiver) => sent.push(`${receiver}:${id}`),
      relayTo: () => fail('should not relay'),
    });
    // Both same state; sort by size meta missing → stable first after sortByNextReceiveBytes
    expect(sent.length).toBe(1);
    expect(sent[0].startsWith('peer-b:')).toBe(true);
  });

  it('fulfillOrRelaySingleFileRequest relays when send limit reached', () => {
    const relayed: string[] = [];
    fulfillOrRelaySingleFileRequest({
      kind: 'audio',
      identifiers: [{ identifier: 'a', state: 0 }],
      receiver: 'peer-b',
      candidatePeers: ['self', 'other'],
      sendTaskCount: 2,
      getLocalState: () => 2,
      startSend: () => fail('should not send'),
      relayTo: peerId => relayed.push(peerId),
    });
    expect(relayed).toEqual(['other']);
  });

  it('acceptOrDeclineStartTransmission declines when complete', () => {
    const gate = new StartTransmissionDeclineGate((id, to) => {
      expect(id).toBe('doc');
      expect(to).toBe('peer-a');
    });
    let started = false;
    acceptOrDeclineStartTransmission({
      identifier: 'doc',
      sendFrom: 'peer-a',
      isReceiving: false,
      localState: 2,
      completeState: 2,
      declineGate: gate,
      startReceive: () => { started = true; },
    });
    expect(started).toBe(false);
  });

  it('acceptOrDeclineStartTransmission starts receive when incomplete', () => {
    const started: string[] = [];
    acceptOrDeclineStartTransmission({
      identifier: 'doc',
      sendFrom: 'peer-a',
      isReceiving: false,
      localState: 0,
      completeState: 2,
      declineGate: new StartTransmissionDeclineGate(),
      startReceive: (id, from) => started.push(`${from}:${id}`),
    });
    expect(started).toEqual(['peer-a:doc']);
  });

  it('applyReceiveProgressPercent writes percent name', () => {
    let applied = '';
    applyReceiveProgressPercent({
      toContext: () => ({ name: 'x' }),
      apply: ctx => { applied = ctx.name; },
    }, 50, 100);
    expect(applied).toBe('50.0%');
  });

  it('startSingleFileSendTask clears map when buildContext throws', async () => {
    spyOn(EventSystem, 'call');
    const sendTaskMap = new Map<string, BufferSharingTask<{ id: string }>>();
    spyOn(BufferSharingTask, 'createSendTask').and.returnValue({
      cancel: jasmine.createSpy('cancel'),
      start: jasmine.createSpy('start'),
      didCompleteSuccessfully: false,
    } as any);

    await expectAsync(startSingleFileSendTask({
      identifier: 'f1',
      sendTo: 'peer-b',
      sendTaskMap,
      startEventName: 'START_PDF_TRANSMISSION',
      synchronizeWhen: 'always',
      synchronize: () => {},
      buildContext: async () => { throw new Error('pack failed'); },
    })).toBeRejectedWithError('pack failed');

    expect(sendTaskMap.size).toBe(0);
  });

  it('repackTransferredBlob / applyBlobContextsToStorage restore MIME', () => {
    const raw = new Blob([new Uint8Array([1, 2])], { type: '' });
    const packed = repackTransferredBlob(raw, '', 'application/pdf') as Blob;
    expect(packed.type).toBe('application/pdf');

    const added: Array<{ type?: string }> = [];
    applyBlobContextsToStorage(
      [{ blob: raw, type: '' }],
      ctx => added.push(ctx),
      'video/mp4',
    );
    expect(added[0].type).toBe('');
    expect((added[0] as any).blob.type).toBe('video/mp4');
  });
});
