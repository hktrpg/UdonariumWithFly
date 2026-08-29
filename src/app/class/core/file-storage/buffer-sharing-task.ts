import { EventSystem } from '../system';
import { FileSyncProgress } from './file-sync-progress';
import { meshWarnThrottled, netDebug } from '../system/network/net-debug';
import { MessagePack } from '../system/util/message-pack';
import { ResettableTimeout } from '../system/util/resettable-timeout';
import { clearZeroTimeout, setZeroTimeout } from '../system/util/zero-timeout';

interface ChankData {
  index: number;
  length: number;
  chank: Uint8Array;
}

export class BufferSharingTask<T> {
  readonly identifier: string;
  readonly sendTo: string;

  private data: T;
  private uint8Array: Uint8Array;
  private chanks: Uint8Array[] = [];
  private chankSize: number = 32 * 1024;
  private chankReceiveCount: number = 0;
  private sendChankTimer: number;
  /** Peer we are exchanging chunks with. Send tasks set this from sendTo; receive from first FILE_SEND_CHANK. */
  private remotePeerId: string = null;

  private sentChankIndex = 0;
  private bufferingChankRange: number = 4;
  private completedChankIndex = 0;

  private startTime = 0;
  private isCanceled = false;
  private completedSuccessfully = false;
  /** Local cancel (DISCONNECT, cancel(), receive CANCEL_TASK). Distinct from peer declining a send. */
  private canceledLocally = false;
  /** Peer sent CANCEL_TASK on a send task (_cancelFromPeer). */
  private canceledByPeer = false;

  get didCompleteSuccessfully(): boolean { return this.completedSuccessfully; }
  /** True when the task ended via cancel (local or peer), not success or timeout. */
  get didCancel(): boolean { return this.canceledLocally || this.canceledByPeer; }
  get didCancelLocally(): boolean { return this.canceledLocally; }
  get didCancelFromPeer(): boolean { return this.canceledByPeer; }

  private onstart: () => void;
  onprogress: (task: BufferSharingTask<T>, loaded: number, total: number) => void;
  onfinish: (task: BufferSharingTask<T>, data: T) => void;
  ontimeout: (task: BufferSharingTask<T>) => void;
  oncancel: (task: BufferSharingTask<T>) => void;

  private timeoutTimer: ResettableTimeout;

  private constructor(identifier: string, sendTo?: string, data?: T) {
    this.identifier = identifier;
    this.sendTo = sendTo;
    this.data = data;
  }

  static createSendTask<T>(identifier: string, sendTo: string, data?: T): BufferSharingTask<T> {
    let task = new BufferSharingTask(identifier, sendTo, data);
    task.onstart = () => task.initializeSend();
    return task;
  }

  static createReceiveTask<T>(identifier: string, fromPeerId?: string): BufferSharingTask<T> {
    let task = new BufferSharingTask<T>(identifier);
    if (fromPeerId) task.remotePeerId = fromPeerId;
    task.onstart = () => task.initializeReceive();
    return task;
  }

  start(data?: T) {
    if (!this.onstart) {
      console.warn('No restart behavior is defined.');
      return;
    }
    this.data = data;
    this.onstart();
    this.onstart = null;
  }

  private progress(loaded: number, total: number) {
    FileSyncProgress.noteChunkProgress(this.identifier, loaded, total);
    if (this.onprogress) this.onprogress(this, loaded, total);
  }

  private finish() {
    if (this.isCanceled) return;
    this.isCanceled = true;
    this.completedSuccessfully = true;
    if (this.onfinish) this.onfinish(this, this.data);
    this.dispose();
  }

  private timeout() {
    if (this.isCanceled) return;
    this.isCanceled = true;
    if (this.ontimeout) this.ontimeout(this);
    if (this.onfinish) this.onfinish(this, this.data);
    this.dispose();
  }

  cancel() {
    if (this.isCanceled) return;
    if (this.sendTo != null) EventSystem.call('CANCEL_TASK_' + this.identifier, null, this.sendTo);
    this._cancelLocal();
  }

  /** Remote peer asked to stop — do not echo CANCEL_TASK or treat as a finished send. */
  private _cancelFromPeer() {
    if (this.isCanceled) return;
    this.isCanceled = true;
    this.canceledByPeer = true;
    if (this.oncancel) this.oncancel(this);
    this.dispose();
  }

  private _cancelLocal() {
    if (this.isCanceled) return;
    this.isCanceled = true;
    this.canceledLocally = true;
    if (this.oncancel) this.oncancel(this);
    if (this.onfinish) this.onfinish(this, this.data);
    this.dispose();
  }

  private _cancel() {
    this._cancelLocal();
  }

  private dispose() {
    FileSyncProgress.clearTransfer(this.identifier);
    EventSystem.unregister(this);
    if (this.sendChankTimer) clearZeroTimeout(this.sendChankTimer);
    if (this.timeoutTimer) this.timeoutTimer.clear();
    this.sendChankTimer = null;
    this.timeoutTimer = null;
    this.chanks = [];
    this.uint8Array = null;
    this.data = null;
    this.remotePeerId = null;
    this.onprogress = this.onfinish = this.ontimeout = this.oncancel = null;
  }

  private initializeSend() {
    this.remotePeerId = this.sendTo;
    this.uint8Array = MessagePack.encode(this.data);
    let total = Math.ceil(this.uint8Array.byteLength / this.chankSize);
    this.chanks = new Array(total);

    netDebug('chunk split ' + this.identifier, this.chanks.length);

    EventSystem.register(this)
      .on<number>('FILE_MORE_CHANK_' + this.identifier, event => {
        if (this.sendTo !== event.sendFrom) return;
        this.completedChankIndex = event.data;
        if (this.sendChankTimer == null && this.sentChankIndex + 1 < this.chanks.length) {
          this.sendChank(this.sentChankIndex + 1);
        }
        this.resetTimeout();
      })
      .on('DISCONNECT_PEER', event => {
        if (!this.remotePeerId || event.data.peerId !== this.remotePeerId) return;
        console.warn('send canceled (peer disconnected)', this, event.data.peerId);
        this._cancel();
      })
      .on('CANCEL_TASK_' + this.identifier, event => {
        meshWarnThrottled(
          `buffer-send-cancel-${this.identifier}-${event.sendFrom}`,
          'send canceled BufferSharingTask',
          this.identifier,
          event.sendFrom?.slice(0, 16),
        );
        this._cancelFromPeer();
      });
    this.sentChankIndex = this.completedChankIndex = 0;
    this.startTime = performance.now();
    this.sendChankTimer = setZeroTimeout(() => this.sendChank(0));
  }

  private sendChank(index: number) {
    if (this.isCanceled || !this.uint8Array) return;
    let chank = this.uint8Array.slice(index * this.chankSize, (index + 1) * this.chankSize);
    let data = { index: index, length: this.chanks.length, chank: chank };
    EventSystem.call('FILE_SEND_CHANK_' + this.identifier, data, this.sendTo);
    this.sentChankIndex = index;
    this.progress(index, this.chanks.length);
    this.sendChankTimer = null;
    if (this.chanks.length <= index + 1) {
      netDebug('buffer send complete', this.identifier);
      this.outputTransferRate(this.uint8Array.byteLength);
      setZeroTimeout(() => {
        if (!this.isCanceled) this.finish();
      });
    } else if (this.completedChankIndex + this.bufferingChankRange <= index) {
      this.resetTimeout();
    } else {
      this.sendChankTimer = setZeroTimeout(() => { this.sendChank(this.sentChankIndex + 1); });
    }
  }

  private initializeReceive() {
    this.resetTimeout();
    this.startTime = performance.now();
    this.chankReceiveCount = 0;
    EventSystem.register(this)
      .on<ChankData>('FILE_SEND_CHANK_' + this.identifier, event => {
        if (!this.remotePeerId && event.sendFrom) this.remotePeerId = event.sendFrom;
        if (this.chanks.length < 1) this.chanks = new Array(event.data.length);

        if (this.chanks[event.data.index] != null) {
          netDebug(`already received. [${event.data.index}] <${this.identifier}>`);
          return;
        }
        this.chankReceiveCount++;
        this.chanks[event.data.index] = event.data.chank;
        this.progress(event.data.index, event.data.length);
        if (this.chanks.length <= this.chankReceiveCount) {
          this.finishReceive();
        } else {
          this.resetTimeout();
          EventSystem.call('FILE_MORE_CHANK_' + this.identifier, event.data.index, event.sendFrom);
        }
      })
      .on('DISCONNECT_PEER', event => {
        // Receive tasks have no sendTo — remotePeerId is set from the first chunk's sendFrom.
        if (!this.remotePeerId || event.data.peerId !== this.remotePeerId) return;
        console.warn('receive canceled (peer disconnected)', this, event.data.peerId);
        this._cancel();
      })
      .on('CANCEL_TASK_' + this.identifier, event => {
        meshWarnThrottled(
          `buffer-receive-cancel-${this.identifier}-${event.sendFrom}`,
          'receive canceled BufferSharingTask',
          this.identifier,
          event.sendFrom?.slice(0, 16),
        );
        this._cancel();
      });
  }

  private finishReceive() {
    netDebug('buffer receive complete', this.identifier);

    let sumLength = 0;
    for (let chank of this.chanks) { sumLength += chank.byteLength; }

    this.outputTransferRate(sumLength);
    let uint8Array = new Uint8Array(sumLength);
    let pos = 0;

    for (let chank of this.chanks) {
      uint8Array.set(chank, pos);
      pos += chank.byteLength;
    }

    this.data = MessagePack.decode(uint8Array) as T;
    this.finish();
  }

  private resetTimeout() {
    if (this.timeoutTimer == null) this.timeoutTimer = new ResettableTimeout(() => this.timeout(), 10 * 1000);
    this.timeoutTimer.reset();
  }

  private outputTransferRate(byteLength: number) {
    let time = performance.now() - this.startTime;
    let rate = (byteLength / 1024 / 1024) / (time / 1000);
    netDebug(`${(byteLength / 1024).toFixed(2)}KB ${(time / 1000).toFixed(2)}? ????: ${rate.toFixed(2)}MB/s`);
  }
}
