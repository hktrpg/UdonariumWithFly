import { LocalDataStream, P2PConnection, Publication, RemoteDataStream, RemoteMember, Subscription, TransportConnectionState } from '@skyway-sdk/core';
import { EventEmitter } from 'events';
import { MessagePack } from '../../util/message-pack';
import { UUID } from '../../util/uuid';
import { setZeroTimeout } from '../../util/zero-timeout';
import { IPeerContext, PeerContext } from '../peer-context';
import { PeerSessionGrade } from '../peer-session-state';
import { CandidateType, WebRTCStats } from '../webrtc/webrtc-stats';
import { WebRTCConnection, WebRTCStatsMonitor } from '../webrtc/webrtc-stats-monitor';
import { meshWarnThrottled, netDebug } from '../net-debug';
import { navigatorEffectiveType, poorNetworkCloseDebounceMs } from '@udonarium/room-reconnect.util';
import { isRetriableSubscribeError } from './skyway-log';
import { computeStreamHealthMetrics, isInboundStale, shouldRecycleStaleDataChannel } from './skyway-stream-health';
import { SkyWayFacade } from './skyway-facade';

interface Ping {
  from: string;
  ping: number;
};

interface DataChank {
  id: string;
  data: Uint8Array;
  index: number;
  total: number;
};

interface ReceivedChank {
  id: string;
  chanks: Uint8Array[];
  length: number;
  byteLength: number;
};

export class SkyWayDataStream extends EventEmitter implements WebRTCConnection {
  readonly peer: PeerContext;

  /** Pause outbound sends while bufferedAmount exceeds this (bytes). */
  private static readonly MAX_BUFFERED_BYTES = 1024 * 1024;
  private static readonly QUEUE_RETRY_MS = 50;

  private chunkSize = 15.5 * 1024;
  private receivedMap: Map<string, ReceivedChank> = new Map();

  private stats: WebRTCStats;

  get open(): boolean {
    return this.peer.isOpen && this.dataChannel?.readyState === 'open';
  }
  get member(): RemoteMember { return this.skyWay.room?.members.find(member => member.name === this.peer.peerId); }

  private isQueuing = false;
  private sendQueue: Set<Uint8Array> = new Set();
  private prioritySendQueue: Set<Uint8Array> = new Set();
  private static readonly PRIORITY_SEND_MAX_BYTES = 32 * 1024;
  private queueRetryTimer: ReturnType<typeof setTimeout> | null = null;

  private _timestamp: number = performance.now();
  get timestamp(): number { return this._timestamp; }
  private set timestamp(timestamp: number) { this._timestamp = timestamp };

  private _ping: number = 0;
  get ping(): number { return this._ping; }
  private set ping(ping: number) { this._ping = ping };

  private _candidateType: CandidateType = CandidateType.UNKNOWN;
  get candidateType(): CandidateType { return this._candidateType; }
  private set candidateType(candidateType: CandidateType) { this._candidateType = candidateType };

  sortKey = '';
  isPublication = false;
  private isCanceled = false;
  private isRejected = false;
  private isOpend = false;

  private state: TransportConnectionState = 'new';
  private subscription: Subscription<RemoteDataStream>;
  private dataChannel: RTCDataChannel;

  private onStreamAdded: { removeListener: () => void };
  private onStreamPublished: { removeListener: () => void };
  private onConnectionStateChanged: { removeListener: () => void };
  private subscribeInFlight = false;
  private subscribeRetryTimer: ReturnType<typeof setTimeout> | null = null;
  private closeDebounceTimer: ReturnType<typeof setTimeout> | null = null;

  private onopen = () => {
    netDebug(`peer ${this.peer.peerId} dataChannel is open`);
    this.refresh();
  }

  private onmessage = (event: MessageEvent<any>) => {
    this.onData(event.data as ArrayBuffer);
  }

  private onbufferedamountlow = () => {
    if ((this.prioritySendQueue.size > 0 || this.sendQueue.size > 0) && !this.isQueuing) {
      this.execQueue();
    }
  }

  private constructor(readonly skyWay: SkyWayFacade, peer: IPeerContext) {
    super();

    this.peer = PeerContext.parse(peer.peerId);
    this.peer.userId = peer.userId;
    this.peer.password = peer.password;
    this.peer.meshPassword = peer.meshPassword || '';
  }

  static createPublication(skyWay: SkyWayFacade, peer: IPeerContext): SkyWayDataStream {
    let instance = new SkyWayDataStream(skyWay, peer);
    instance.sortKey = instance.skyWay.peer.peerId;
    instance.isPublication = true;
    return instance;
  }

  static createSubscription(skyWay: SkyWayFacade, peer: IPeerContext): SkyWayDataStream {
    let instance = new SkyWayDataStream(skyWay, peer);
    instance.sortKey = instance.peer.peerId;
    instance.isPublication = false;
    return instance;
  }

  connect() {
    netDebug(`connect ${this.peer.peerId}, isPublication: ${this.isPublication}`);
    if (this.isPublication) {
      return this.initializePublication();
    } else {
      return this.initializeSubscription();
    }
  }

  disconnect() {
    netDebug(`disconnect ${this.peer.peerId}, isPublication: ${this.isPublication}`);
    this.isCanceled = true;
    this.clearQueueRetryTimer();
    this.prioritySendQueue.clear();
    this.sendQueue.clear();
    this.isQueuing = false;
    this.clearCloseDebounce();
    this.clearSubscribeRetry();
    this.onStreamPublished?.removeListener();
    // Intentional teardown — never refresh() (would retry subscribe / ICE on prune or member left).
    this.dispose();
  }

  reject() {
    netDebug(`reject ${this.peer.peerId}, isPublication: ${this.isPublication}`);
    this.isRejected = true;
    this.connect();
  }

  private dispose() {
    netDebug(`dispose ${this.peer.peerId}, isPublication: ${this.isPublication}`);
    this.clearCloseDebounce();
    this.clearQueueRetryTimer();
    this.prioritySendQueue.clear();
    this.sendQueue.clear();
    this.isQueuing = false;
    this.peer.isOpen = false;
    this.stopMonitoring();
    this.removeAllListeners();

    this.onStreamAdded?.removeListener();
    this.onStreamPublished?.removeListener();
    this.onConnectionStateChanged?.removeListener();
    this.onStreamAdded = null;
    this.onStreamPublished = null;
    this.onConnectionStateChanged = null;

    this.releaseSubscription();

    this.dataChannel?.removeEventListener('open', this.onopen);
    this.dataChannel?.removeEventListener('message', this.onmessage);
    this.dataChannel?.removeEventListener('bufferedamountlow', this.onbufferedamountlow);
    this.dataChannel?.close();
    this.dataChannel = null;
  }

  private initializePublication() {
    //
    let member = this.member;
    let subscription = member?.subscriptions.find(subscription => subscription.publication.contentType === 'data'
      && subscription.publication.metadata === 'udonarium-data-stream'
      && subscription.publication.publisher.name === this.skyWay.peer.peerId) as Subscription<RemoteDataStream>;

    //
    if (!subscription) {
      console.error(`subscription is not found ${this.peer.peerId}`);
    }

    //
    this.onConnectionStateChanged?.removeListener();
    this.onConnectionStateChanged = this.skyWay.publication.onConnectionStateChanged.add(event => {
      if (event.remoteMember.name !== this.peer.peerId) return;
      this.onStateChanged(event.state);
    });

    //
    netDebug(`initializePublication ${member.name} ${subscription.id}`);
    this.subscription = subscription;
    this.refresh();
  }

  private async initializeSubscription() {
    if (this.subscribeInFlight || this.isCanceled) return;

    let member = this.member;
    if (!member) {
      netDebug(`[skyWay] ${this.peer.peerId}: member missing; waiting for publication`);
      this.waitForDataStreamPublication();
      return;
    }

    if (!this.skyWay.roomPerson) {
      netDebug(`[skyWay] ${member.name}: roomPerson not joined`);
      return;
    }

    let publication = this.findDataStreamPublication(member);
    if (!publication) {
      this.waitForDataStreamPublication();
      return;
    }

    const existing = this.findLocalDataSubscription(publication.id);
    if (existing) {
      this.bindSubscription(existing, member.name);
      return;
    }

    this.subscribeInFlight = true;
    try {
      publication = this.findDataStreamPublication(this.member);
      if (!publication) {
        netDebug(`[skyWay] ${member.name}: publication gone before subscribe; waiting`);
        this.waitForDataStreamPublication();
        return;
      }

      const racedExisting = this.findLocalDataSubscription(publication.id);
      if (racedExisting) {
        this.bindSubscription(racedExisting, member.name);
        return;
      }

      const { subscription } = await this.skyWay.roomPerson.subscribe<RemoteDataStream>(publication.id);
      netDebug(`initializeSubscription done ${member.name} ${publication.id}`);
      this.bindSubscription(subscription, member.name);
    } catch (e) {
      const msg = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
      if (/alreadySubscribedPublication/i.test(msg)) {
        const retryPublication = this.findDataStreamPublication(this.member);
        const racedExisting = retryPublication && this.findLocalDataSubscription(retryPublication.id);
        if (racedExisting && !this.isCanceled) {
          netDebug(`[skyWay] ${member.name}: reusing existing subscription`);
          this.bindSubscription(racedExisting, member.name);
          return;
        }
      }
      if (isRetriableSubscribeError(msg)) {
        netDebug(`[skyWay] ${member.name}: subscribe skipped (${e instanceof Error ? e.message : 'timeout'})`);
        if (!this.isCanceled && this.member) {
          if (/localPersonNotJoinedChannel/i.test(msg)) {
            this.subscription = null;
            return;
          }
          this.subscription = null;
          if (/publicationNotExist|onStreamAdded/i.test(msg)) {
            this.waitForDataStreamPublication();
          } else {
            this.scheduleSubscriptionRetry();
          }
          return;
        }
      } else if (e instanceof Error) {
        console.warn(`[skyWay] subscribe failed ${member.name}: ${e.name}: ${e.message}`);
      } else {
        console.warn('[skyWay] subscribe failed', e);
      }

      this.subscription = null;
      this.state = 'disconnected';
      this.emit('close');
    } finally {
      this.subscribeInFlight = false;
    }
  }

  private findLocalDataSubscription(publicationId: string): Subscription<RemoteDataStream> | undefined {
    return this.skyWay.roomPerson?.subscriptions?.find(
      sub => sub.publication?.id === publicationId,
    ) as Subscription<RemoteDataStream> | undefined;
  }

  private bindSubscription(subscription: Subscription<RemoteDataStream>, memberName: string) {
    this.onConnectionStateChanged?.removeListener();
    this.onConnectionStateChanged = subscription.onConnectionStateChanged.add(state => {
      this.onStateChanged(state);
    });
    this.subscription = subscription;
    netDebug(`initializeSubscription ready ${memberName}`);
    this.refresh();
  }

  private releaseSubscription() {
    if (this.isPublication || !this.subscription) return;
    const sub = this.subscription;
    this.subscription = null;
    void Promise.resolve(sub.cancel()).catch(() => {
      // SDK may already have torn this down (e.g. peer left / restartIce limit).
    });
  }

  private clearSubscribeRetry() {
    if (this.subscribeRetryTimer != null) {
      clearTimeout(this.subscribeRetryTimer);
      this.subscribeRetryTimer = null;
    }
  }

  private clearCloseDebounce() {
    if (this.closeDebounceTimer != null) {
      clearTimeout(this.closeDebounceTimer);
      this.closeDebounceTimer = null;
    }
  }

  private isTransportRecovering(): boolean {
    return this.state === 'reconnecting' || this.state === 'connecting';
  }

  /** ICE may recover after a brief DataChannel close on poor mobile links. */
  private scheduleCloseEmit() {
    this.clearCloseDebounce();
    const delayMs = poorNetworkCloseDebounceMs(navigatorEffectiveType());
    this.closeDebounceTimer = setTimeout(() => {
      this.closeDebounceTimer = null;
      if (this.isCanceled) return;
      this.refresh();
      if (this.peer.isOpen) return;
      this.subscription = null;
      this.state = 'disconnected';
      this.peer.isOpen = false;
      this.emit('close');
    }, delayMs);
  }

  private subscriptionRetryDelayMs(): number {
    const effectiveType = navigatorEffectiveType();
    if (effectiveType === 'slow-2g' || effectiveType === '2g') return 5000;
    if (effectiveType === '3g') return 3500;
    return 2500;
  }

  /** Publication still exists — retry subscribe after transient SDK / ICE errors. */
  private scheduleSubscriptionRetry(delayMs?: number) {
    if (this.isCanceled || this.isPublication) return;
    this.clearSubscribeRetry();
    this.subscribeRetryTimer = setTimeout(() => {
      this.subscribeRetryTimer = null;
      if (!this.isCanceled) void this.initializeSubscription();
    }, delayMs ?? this.subscriptionRetryDelayMs());
  }

  private findDataStreamPublication(member: RemoteMember | undefined) {
    return member?.publications.find(
      publication => publication.contentType === 'data' && publication.metadata === 'udonarium-data-stream',
    );
  }

  /** Stay half-open until the remote publishes udonarium-data-stream (or we disconnect). */
  private waitForDataStreamPublication() {
    this.onStreamPublished?.removeListener();
    if (!this.skyWay.room || this.isCanceled) return;
    this.onStreamPublished = this.skyWay.room.onStreamPublished.add(event => {
      let isMatch = event.publication.contentType === 'data'
        && event.publication.metadata === 'udonarium-data-stream'
        && event.publication.publisher.name === this.peer.peerId;
      if (!isMatch) return;

      netDebug(`onStreamPublished: ${event.publication.publisher.name} <${event.publication.metadata}>`);
      this.onStreamPublished?.removeListener();
      this.initializeSubscription();
    });
  }

  private onStateChanged(state: TransportConnectionState) {
    netDebug(`onStateChanged isPublication: ${this.isPublication}, ${this.peer.peerId} ${this.state} -> ${state}`);
    switch (state) {
      case 'new': break;
      case 'connecting': break;
      case 'connected':
        this.clearCloseDebounce();
        break;
      case 'reconnecting': break;
      case 'disconnected':
        this.clearCloseDebounce();
        this.subscription = null;
        this.emit('close');
        return;
    }
    this.refresh();
    this.state = state;
  }

  private refresh() {
    // ??????
    let member = this.member;

    let p2pconnection = (member as any)?._getOrCreateConnection((this.skyWay.roomPerson as any)?._impl) as P2PConnection;
    let publication = member?.publications.find(publication => publication.metadata === 'udonarium-data-stream');

    let dataChannel = this.isPublication
      ? p2pconnection?.sender.datachannels[this.skyWay.publication?.id]
      : (p2pconnection?.receiver.streams[publication?.id] as RemoteDataStream)?._datachannel;

    // ??????
    let isOpen = dataChannel?.readyState === 'open';
    netDebug(`refresh ${member?.name}, isPublication: ${this.isPublication}, isOpen: ${isOpen}, dataChannel: ${dataChannel?.readyState}`);

    // cancel ? reject ?????
    if (dataChannel && (this.isCanceled && isOpen || this.isRejected)) {
      dataChannel.close();
      this.dispose();
      this.state = 'disconnected';
      this.emit('close');
      return;
    }

    // ?? RTCDataChannel
    if (dataChannel && this.dataChannel && dataChannel !== this.dataChannel) {
      console.warn(`dataChannel is change: ${this.dataChannel?.id} -> ${dataChannel.id}`);
      this.peer.isOpen = false;
    }

    this.dataChannel?.removeEventListener('open', this.onopen);
    this.dataChannel?.removeEventListener('message', this.onmessage);
    this.dataChannel?.removeEventListener('bufferedamountlow', this.onbufferedamountlow);

    if (dataChannel) {
      dataChannel.binaryType = 'arraybuffer';
      dataChannel.bufferedAmountLowThreshold = SkyWayDataStream.MAX_BUFFERED_BYTES / 2;
    }
    dataChannel?.addEventListener('open', this.onopen);
    dataChannel?.addEventListener('message', this.onmessage);
    dataChannel?.addEventListener('bufferedamountlow', this.onbufferedamountlow);

    this.dataChannel = dataChannel;

    // ?? P2PConnection
    netDebug(`p2pconnection: ${p2pconnection?.id}`);
    this.onStreamAdded?.removeListener();
    if (p2pconnection && !dataChannel) {
      this.onStreamAdded = p2pconnection?.receiver.onStreamAdded.add(event => {
        netDebug(`receiver.onStreamAdded: ${event.stream.id} ${(event.stream as RemoteDataStream)?._datachannel?.readyState}`);
        this.refresh();
      });
    }

    // open or close
    if (isOpen !== this.peer.isOpen) {
      if (isOpen) {
        this.clearCloseDebounce();
        this.peer.isOpen = true;
        this.isOpend = true;
        this.state = 'connected';
        this.emit('open');
      } else if (this.isTransportRecovering() || this.state === 'connected') {
        // Soft-down: keep isOpen until debounce expires so heal does not tear the mesh.
        this.stopMonitoring();
        this.scheduleCloseEmit();
        return;
      } else {
        this.subscription = null;
        this.state = 'disconnected';
        this.emit('close');
      }
    }

    // ????
    let peerConnection = this.getPeerConnection();
    this.stats = peerConnection ? new WebRTCStats(peerConnection) : null;

    if (isOpen) {
      this.startMonitoring();
      if (!this.isQueuing) this.execQueue();
    } else {
      this.stopMonitoring();
    }
  }

  send(data: any) {
    if (!this.open) return;
    const priority = !!(data && typeof data === 'object' && (data as { priority?: boolean }).priority);
    let encodedData: Uint8Array = MessagePack.encode(data);

    let total = Math.ceil(encodedData.byteLength / this.chunkSize);
    if (total <= 1) {
      this.addSendQueue(encodedData, priority);
      return;
    }

    let id = UUID.generateUuid();

    let sliceData: Uint8Array = null;
    let chank: DataChank = null;
    for (let sliceIndex = 0; sliceIndex < total; sliceIndex++) {
      sliceData = encodedData.slice(sliceIndex * this.chunkSize, (sliceIndex + 1) * this.chunkSize);
      chank = { id: id, data: sliceData, index: sliceIndex, total: total };
      this.addSendQueue(MessagePack.encode(chank), priority);
    }
  }

  private addSendQueue(data: Uint8Array, priority = false) {
    if (!this.open) return;
    if (priority || data.byteLength <= SkyWayDataStream.PRIORITY_SEND_MAX_BYTES) {
      this.prioritySendQueue.add(data);
    } else {
      this.sendQueue.add(data);
    }
    if (!this.isQueuing) {
      this.execQueue();
    } else if (priority) {
      setZeroTimeout(this.execQueue);
    }
  }

  private clearQueueRetryTimer() {
    if (this.queueRetryTimer == null) return;
    clearTimeout(this.queueRetryTimer);
    this.queueRetryTimer = null;
  }

  private scheduleQueueDrain(delayMs = SkyWayDataStream.QUEUE_RETRY_MS) {
    if (this.queueRetryTimer != null) return;
    this.queueRetryTimer = setTimeout(() => {
      this.queueRetryTimer = null;
      this.isQueuing = false;
      this.execQueue();
    }, delayMs);
  }

  private execQueue = () => {
    if (!this.open) {
      this.isQueuing = false;
      return;
    }
    const channel = this.dataChannel;
    if (!channel || channel.readyState !== 'open') {
      this.isQueuing = false;
      return;
    }
    if (this.prioritySendQueue.size === 0 && this.sendQueue.size === 0) {
      this.isQueuing = false;
      return;
    }

    this.isQueuing = true;
    const activeQueue = this.prioritySendQueue.size > 0 ? this.prioritySendQueue : this.sendQueue;
    const data = activeQueue.values().next().value;
    if (!data) {
      this.isQueuing = false;
      return;
    }

    if (channel.bufferedAmount >= SkyWayDataStream.MAX_BUFFERED_BYTES) {
      this.scheduleQueueDrain();
      return;
    }

    // After bulk chunks, yield so newly queued token/cursor updates can preempt.
    if (activeQueue === this.sendQueue && this.prioritySendQueue.size > 0) {
      setZeroTimeout(this.execQueue);
      return;
    }

    try {
      channel.send(data);
      activeQueue.delete(data);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'OperationError') {
        meshWarnThrottled(
          `dc-queue-full-${this.peer.peerId}`,
          'DataChannel send queue full; pausing outbound drain',
          { peer: this.peer.peerId.slice(0, 16), pending: this.prioritySendQueue.size + this.sendQueue.size },
        );
        this.scheduleQueueDrain();
        return;
      }
      console.error(err);
      activeQueue.delete(data);
    }

    if (this.prioritySendQueue.size === 0 && this.sendQueue.size === 0) {
      this.isQueuing = false;
      return;
    }

    if (channel.bufferedAmount < SkyWayDataStream.MAX_BUFFERED_BYTES) {
      setZeroTimeout(this.execQueue);
    } else {
      this.scheduleQueueDrain();
    }
  }

  getPeerConnection(): RTCPeerConnection {
    if (this.isPublication) {
      return (this.subscription?.publication as Publication<LocalDataStream>)?.stream?._getRTCPeerConnection(this.member);
    } else {
      return this.subscription?.stream?._getRTCPeerConnection();
    }
  }

  private startMonitoring() {
    WebRTCStatsMonitor.add(this);
  }

  private stopMonitoring() {
    WebRTCStatsMonitor.remove(this);
  }

  async updateStatsAsync() {
    if (this.stats == null) return;
    this.sendPing();
    await this.stats.updateAsync();
    this.candidateType = this.stats.candidateType;

    const deltaTime = performance.now() - this.timestamp;
    const { healthRate, ping, speed } = computeStreamHealthMetrics(deltaTime, this.ping);

    if (isInboundStale(deltaTime, healthRate)) {
      meshWarnThrottled(
        `stale-dc-${this.peer.peerId}`,
        'DataChannel stale (no inbound); metrics only',
        this.peer.peerId.slice(0, 10),
        { silentMs: Math.round(deltaTime) },
      );
    }

    if (shouldRecycleStaleDataChannel(deltaTime, healthRate)) {
      this.stopMonitoring();
      this.scheduleCloseEmit();
      return;
    }

    this.peer.session.health = healthRate;
    this.peer.session.ping = ping;
    this.peer.session.speed = speed;
    this.peer.session.bitrateInstantBps = this.stats.instantBitrateBps;
    this.peer.session.bitrateBps = this.stats.bitrateBps;

    switch (this.candidateType) {
      case CandidateType.HOST:
        this.peer.session.grade = PeerSessionGrade.HIGH;
        break;
      case CandidateType.SRFLX:
      case CandidateType.PRFLX:
        this.peer.session.grade = PeerSessionGrade.MIDDLE;
        break;
      case CandidateType.RELAY:
        this.peer.session.grade = PeerSessionGrade.LOW;
        break;
      default:
        this.peer.session.grade = PeerSessionGrade.UNSPECIFIED;
        break;
    }
    this.peer.session.description = this.candidateType;

    this.emit('stats', this.stats);
  }

  sendPing() {
    if (!this.open) return;
    let encodedData: Uint8Array = MessagePack.encode({ from: this.skyWay.peer.peerId, ping: performance.now() });
    this.addSendQueue(encodedData);
  }

  private receivePing(ping: Ping) {
    if (ping.from === this.skyWay.peer.peerId) {
      let now = performance.now();
      let rtt = now - ping.ping;
      this.ping = rtt <= this.ping ? (this.ping * 0.5) + (rtt * 0.5) : rtt;
    } else {
      let encodedData = MessagePack.encode(ping);
      this.addSendQueue(encodedData);
    }
  }

  private onData(data: ArrayBuffer) {
    this.timestamp = performance.now();
    let decoded: unknown = MessagePack.decode(new Uint8Array(data));

    let ping: Ping = decoded as Ping;
    if (ping.ping != null) {
      this.receivePing(ping);
      return;
    }

    let chank: DataChank = decoded as DataChank;
    if (chank.id == null) {
      this.emit('data', decoded);
      return;
    }

    let received = this.receivedMap.get(chank.id);
    if (received == null) {
      received = { id: chank.id, chanks: new Array(chank.total), length: 0, byteLength: 0 };
      this.receivedMap.set(chank.id, received);
    }

    if (received.chanks[chank.index] != null) return;

    received.length++;
    received.byteLength += chank.data.byteLength;
    received.chanks[chank.index] = chank.data;

    if (received.length < chank.total) return;
    this.receivedMap.delete(chank.id);

    let uint8Array = new Uint8Array(received.byteLength);

    let pos = 0;
    for (let c of received.chanks) {
      uint8Array.set(c, pos);
      pos += c.byteLength;
    }

    let decodedChank = MessagePack.decode(uint8Array);
    this.emit('data', decodedChank);
  }
}
