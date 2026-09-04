import { EventSystem } from '../system';
import { Network } from '../system';
import { BufferSharingTask } from './buffer-sharing-task';
import { FileReceiveScheduler } from './file-transfer-scheduler';

function listenerCountFor(key: unknown): number {
  const map = (EventSystem as unknown as { keyMap: Map<unknown, unknown[]> }).keyMap;
  return map.get(key)?.length ?? 0;
}

function totalListenersFor(tasks: BufferSharingTask<unknown>[]): number {
  return tasks.reduce((n, t) => n + listenerCountFor(t), 0);
}

/**
 * Additional pressure scenarios beyond the basic reconnect-stress suite.
 * Goal: prove cancel / backoff / scheduler fixes hold under varied remesh patterns.
 */
describe('Reconnect pressure matrix (effectiveness)', () => {
  const peerA = 'peer-pressure-a';
  const peerB = 'peer-pressure-b';
  const live: BufferSharingTask<unknown>[] = [];
  let peerIds: string[];

  beforeEach(() => {
    FileReceiveScheduler.resetForTests();
    peerIds = [peerA, peerB];
    spyOnProperty(Network, 'peerIds', 'get').and.callFake(() => peerIds);
    spyOn(console, 'warn');
    spyOn(console, 'log');
  });

  afterEach(() => {
    for (const t of live) {
      try { t.cancel(); } catch { /* disposed */ }
    }
    live.length = 0;
    FileReceiveScheduler.resetForTests();
  });

  function startPartialReceive(id: string, from: string, chunksHeld: number, totalChunks: number): BufferSharingTask<Uint8Array> {
    const task = BufferSharingTask.createReceiveTask<Uint8Array>(id, from);
    live.push(task);
    task.onfinish = (t) => {
      FileReceiveScheduler.noteReceiveEnded('image', id, t.didCompleteSuccessfully || t.didCancel);
      FileReceiveScheduler.markReceiveEnd('image', id);
    };
    task.start();
    FileReceiveScheduler.markReceiveStart('image', id);
    // 1KB chunks — enough to allocate chanks[] without flooding the test runner log.
    for (let i = 0; i < chunksHeld; i++) {
      EventSystem.trigger({
        eventName: `FILE_SEND_CHANK_${id}`,
        sendFrom: from,
        data: { index: i, length: totalChunks, chank: new Uint8Array(1024) },
      });
    }
    return task;
  }

  it('A-only disconnect: cancels A receives, leaves B receives alive', () => {
    const aTasks = [0, 1, 2].map(i => startPartialReceive(`a-${i}`, peerA, 8, 32));
    const bTasks = [0, 1, 2].map(i => startPartialReceive(`b-${i}`, peerB, 8, 32));

    EventSystem.trigger('DISCONNECT_PEER', { peerId: peerA });

    for (const t of aTasks) {
      expect(t.didCancel).toBe(true);
      expect(listenerCountFor(t)).toBe(0);
    }
    for (const t of bTasks) {
      expect(t.didCancel).toBe(false);
      expect(listenerCountFor(t)).toBeGreaterThan(0);
    }
  });

  it('wrong-peer DISCONNECT does not cancel (isolation)', () => {
    const task = startPartialReceive('iso-1', peerA, 4, 16);
    EventSystem.trigger('DISCONNECT_PEER', { peerId: peerB });
    expect(task.didCancel).toBe(false);
    expect(listenerCountFor(task)).toBeGreaterThan(0);
  });

  it('heavy partial buffers × 80 flaps: listeners return to 0 (no orphan growth)', () => {
    const CYCLES = 80;
    let peakListeners = 0;
    let endOrphans = 0;

    for (let i = 0; i < CYCLES; i++) {
      const id = `heavy-${i}`;
      // 32 of 128 slots filled (~32KB) — stresses chanks retention without huge logs.
      const task = startPartialReceive(id, peerA, 32, 128);
      peakListeners = Math.max(peakListeners, listenerCountFor(task));
      EventSystem.trigger('DISCONNECT_PEER', { peerId: peerA });
      endOrphans += listenerCountFor(task);
      expect(task.didCancel).toBe(true);
      expect(FileReceiveScheduler.canEnqueueReceive('image', id)).toBe(true);
    }

    expect(peakListeners).toBeGreaterThan(0);
    expect(endOrphans).toBe(0);
    expect(FileReceiveScheduler.activeReceiveCount()).toBe(0);
  });

  it('alternating send+receive flaps: both sides cancel locally, never as peer-decline', () => {
    const CYCLES = 30;
    for (let i = 0; i < CYCLES; i++) {
      const rid = `recv-alt-${i}`;
      const sid = `send-alt-${i}`;
      const recv = BufferSharingTask.createReceiveTask<Uint8Array>(rid, peerA);
      const send = BufferSharingTask.createSendTask(sid, peerA, { n: i });
      live.push(recv, send);
      let recvLocal = false;
      let sendFromPeer = false;
      recv.oncancel = (t) => { recvLocal = t.didCancelLocally; };
      send.oncancel = (t) => { sendFromPeer = t.didCancelFromPeer; };
      recv.start();
      send.start();

      EventSystem.trigger('DISCONNECT_PEER', { peerId: peerA });

      expect(recvLocal).toBe(true);
      expect(sendFromPeer).toBe(false);
      expect(send.didCancelLocally).toBe(true);
      expect(listenerCountFor(recv) + listenerCountFor(send)).toBe(0);
    }
  });

  it('rapid remesh: cancel then re-enqueue same id immediately across many peers', () => {
    FileReceiveScheduler.ensureNetworkHooks();
    const CYCLES = 40;
    for (let i = 0; i < CYCLES; i++) {
      const dead = `dead-${i}`;
      const alive = `alive-${i}`;
      peerIds = [dead, alive];
      const id = `file-${i % 5}`;

      FileReceiveScheduler.enqueueReceiveRequest('image', dead, id, 8_000, () => {});
      FileReceiveScheduler.schedule();
      EventSystem.trigger('DISCONNECT_PEER', { peerId: dead });

      expect(FileReceiveScheduler.canEnqueueReceive('image', id)).toBe(true);

      peerIds = [alive];
      let ran = false;
      FileReceiveScheduler.enqueueReceiveRequest('image', alive, id, 8_000, () => { ran = true; });
      FileReceiveScheduler.schedule();
      expect(ran).toBe(true);

      // Finish slot so next cycle can enqueue same id.
      FileReceiveScheduler.markReceiveStart('image', id);
      FileReceiveScheduler.noteReceiveEnded('image', id, true);
      FileReceiveScheduler.markReceiveEnd('image', id);
    }
    expect(FileReceiveScheduler.pendingReceiveCount()).toBe(0);
    expect(FileReceiveScheduler.outboundPendingCount()).toBe(0);
  });

  it('concurrent multi-file storm then mass disconnect: zero leftover listeners', () => {
    const N = 24;
    const tasks: BufferSharingTask<Uint8Array>[] = [];
    for (let i = 0; i < N; i++) {
      const from = i % 2 === 0 ? peerA : peerB;
      tasks.push(startPartialReceive(`storm-${i}`, from, 10, 40));
    }
    expect(totalListenersFor(tasks)).toBeGreaterThan(0);

    EventSystem.trigger('DISCONNECT_PEER', { peerId: peerA });
    EventSystem.trigger('DISCONNECT_PEER', { peerId: peerB });

    expect(totalListenersFor(tasks)).toBe(0);
    for (const t of tasks) expect(t.didCancel).toBe(true);
  });

  it('timeout-style failure still applies backoff (cancel path must not break real fails)', () => {
    const id = 'fail-backoff';
    FileReceiveScheduler.markReceiveStart('image', id);
    FileReceiveScheduler.noteReceiveEnded('image', id, false);
    FileReceiveScheduler.markReceiveEnd('image', id);
    expect(FileReceiveScheduler.canEnqueueReceive('image', id)).toBe(false);

    // Cancel contract clears; failure must not.
    const id2 = 'cancel-clear';
    FileReceiveScheduler.markReceiveStart('image', id2);
    const task = BufferSharingTask.createReceiveTask<Uint8Array>(id2, peerA);
    live.push(task);
    task.onfinish = (t) => {
      FileReceiveScheduler.noteReceiveEnded('image', id2, t.didCompleteSuccessfully || t.didCancel);
      FileReceiveScheduler.markReceiveEnd('image', id2);
    };
    task.start();
    FileReceiveScheduler.noteReceiveEnded('image', id2, false);
    EventSystem.trigger('DISCONNECT_PEER', { peerId: peerA });
    expect(FileReceiveScheduler.canEnqueueReceive('image', id2)).toBe(true);
    // id failure backoff still in effect
    expect(FileReceiveScheduler.canEnqueueReceive('image', id)).toBe(false);
  });
});
