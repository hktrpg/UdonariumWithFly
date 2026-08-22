import { AudioState } from './audio-file';
import { FileReceiveScheduler, estimateNextReceiveBytes } from './file-transfer-scheduler';
import { ImageState } from './image-file';
import { Network } from '../system';

describe('FileReceiveScheduler', () => {
  beforeEach(() => {
    spyOnProperty(Network, 'peerIds', 'get').and.returnValue(['p1']);
  });
  it('schedules smallest transfers first across resource kinds', () => {
    const order: string[] = [];
    FileReceiveScheduler.enqueueReceiveRequest('video', 'p1', 'big', 5_000_000, () => order.push('big'));
    FileReceiveScheduler.enqueueReceiveRequest('audio', 'p1', 'small', 100_000, () => order.push('small'));
    FileReceiveScheduler.enqueueReceiveRequest('pdf', 'p1', 'mid', 1_000_000, () => order.push('mid'));
    FileReceiveScheduler.schedule();
    expect(order).toEqual(['small', 'mid', 'big']);
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
});
