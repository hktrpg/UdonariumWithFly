import { EventSystem } from '../system';
import { BufferSharingTask } from './buffer-sharing-task';
import { FileReceiveScheduler } from './file-transfer-scheduler';

/** Count EventSystem listeners keyed by an object (test-only cast). */
function listenerCountFor(key: unknown): number {
  const map = (EventSystem as unknown as { keyMap: Map<unknown, unknown[]> }).keyMap;
  return map.get(key)?.length ?? 0;
}

/**
 * Feedback loop for long-session reconnect OOM:
 * mid-transfer DISCONNECT must cancel receive BufferSharingTasks and drop EventSystem listeners.
 */
describe('BufferSharingTask reconnect stress', () => {
  const peerId = 'peer-reconnect-stress-aaa';
  const liveTasks: BufferSharingTask<unknown>[] = [];

  beforeEach(() => {
    spyOn(console, 'warn');
  });

  afterEach(() => {
    for (const task of liveTasks) {
      try { task.cancel(); } catch { /* already disposed */ }
    }
    liveTasks.length = 0;
    FileReceiveScheduler.resetForTests();
  });

  it('cancels in-flight receives and frees EventSystem listeners across many disconnect cycles', () => {
    const CYCLES = 40;
    let orphanedListeners = 0;
    let canceledCount = 0;

    for (let i = 0; i < CYCLES; i++) {
      const id = `img-stress-${i}`;
      const task = BufferSharingTask.createReceiveTask<Uint8Array>(id);
      liveTasks.push(task);
      let canceled = false;
      task.oncancel = () => { canceled = true; };
      task.onfinish = () => { /* dispose path */ };
      task.start();

      EventSystem.trigger({
        eventName: `FILE_SEND_CHANK_${id}`,
        sendFrom: peerId,
        data: {
          index: 0,
          length: 64,
          chank: new Uint8Array(32 * 1024),
        },
      });

      expect(listenerCountFor(task)).toBeGreaterThan(0);

      EventSystem.trigger('DISCONNECT_PEER', { peerId });

      if (!canceled) {
        orphanedListeners += listenerCountFor(task);
      } else {
        canceledCount++;
        expect(listenerCountFor(task)).toBe(0);
        expect(task.didCancelLocally).toBe(true);
      }
    }

    expect(canceledCount).toBe(CYCLES);
    expect(orphanedListeners).toBe(0);
  });

  it('cancels receive with fromPeerId before any chunk arrives', () => {
    const id = 'img-zero-chunk';
    const task = BufferSharingTask.createReceiveTask<Uint8Array>(id, peerId);
    liveTasks.push(task);
    let canceled = false;
    let finished = false;
    task.oncancel = () => { canceled = true; };
    task.onfinish = () => { finished = true; };
    task.start();

    expect(listenerCountFor(task)).toBeGreaterThan(0);
    EventSystem.trigger('DISCONNECT_PEER', { peerId });

    expect(canceled).toBe(true);
    expect(finished).toBe(true);
    expect(task.didCancel).toBe(true);
    expect(listenerCountFor(task)).toBe(0);
  });

  it('cancels in-flight send on DISCONNECT without didCancelFromPeer', () => {
    const id = 'img-send-mid';
    const task = BufferSharingTask.createSendTask(id, peerId, { hello: 'world' });
    liveTasks.push(task);
    let canceled = false;
    task.oncancel = (t) => {
      canceled = true;
      expect(t.didCancelLocally).toBe(true);
      expect(t.didCancelFromPeer).toBe(false);
    };
    task.start();

    EventSystem.trigger('DISCONNECT_PEER', { peerId });

    expect(canceled).toBe(true);
    expect(task.didCancelFromPeer).toBe(false);
    expect(listenerCountFor(task)).toBe(0);
  });

  it('marks didCancelFromPeer only on CANCEL_TASK for send', () => {
    const id = 'img-send-declined';
    const task = BufferSharingTask.createSendTask(id, peerId, { a: 1 });
    liveTasks.push(task);
    let fromPeer = false;
    task.oncancel = (t) => { fromPeer = t.didCancelFromPeer; };
    task.start();

    EventSystem.trigger({
      eventName: `CANCEL_TASK_${id}`,
      sendFrom: peerId,
      data: null,
    });

    expect(fromPeer).toBe(true);
    expect(task.didCancelFromPeer).toBe(true);
    expect(task.didCancelLocally).toBe(false);
  });

  it('sharing-system cancel contract: canEnqueueReceive is true immediately after DISCONNECT', () => {
    const id = 'img-enqueue-after-cancel';
    FileReceiveScheduler.resetForTests();
    FileReceiveScheduler.markReceiveStart('image', id);

    const task = BufferSharingTask.createReceiveTask<Uint8Array>(id, peerId);
    liveTasks.push(task);
    task.onfinish = (t) => {
      FileReceiveScheduler.noteReceiveEnded('image', id, t.didCompleteSuccessfully || t.didCancel);
      FileReceiveScheduler.markReceiveEnd('image', id);
    };
    task.start();

    FileReceiveScheduler.noteReceiveEnded('image', id, false);
    expect(FileReceiveScheduler.canEnqueueReceive('image', id)).toBe(false);

    EventSystem.trigger('DISCONNECT_PEER', { peerId });

    expect(task.didCancel).toBe(true);
    expect(FileReceiveScheduler.canEnqueueReceive('image', id)).toBe(true);
  });
});
