import { EventSystem, Network } from '../system';
import { BufferSharingTask } from './buffer-sharing-task';
import { FileReceiveScheduler } from './file-transfer-scheduler';
import { deferRequestIfPeerNotOpen } from './defer-request-if-peer-not-open';
import { StartTransmissionDeclineGate } from './start-transmission-decline';
import {
  hasActiveMediaTasks,
  meshCandidatePeerIds,
} from './media-sharing-helpers';
import {
  collectMissingDownloadRequests,
  ensureRoomMissingDownloads,
  MissingDownloadHooks,
  queueMissingDownloads,
} from './missing-download-pipeline';
import {
  acceptOrDeclineStartTransmission,
  applyReceiveProgressPercent,
  buildBlobOrUrlSendContext,
  fulfillOrRelaySingleFileRequest,
  startSingleFileReceiveTask,
  startSingleFileSendTask,
} from './single-file-media-transfer';
import { isUrlBackedMediaIdentifier } from './media-identifier';
import { VideoFile, VideoFileContext, VideoState } from './video-file';
import { VideoCatalogItem, VideoStorage } from './video-storage';

export class VideoSharingSystem {
  private static _instance: VideoSharingSystem;
  static get instance(): VideoSharingSystem {
    if (!VideoSharingSystem._instance) VideoSharingSystem._instance = new VideoSharingSystem();
    return VideoSharingSystem._instance;
  }

  private sendTaskMap: Map<string, BufferSharingTask<VideoFileContext>> = new Map();
  private receiveTaskMap: Map<string, BufferSharingTask<VideoFileContext>> = new Map();
  private readonly startDeclineGate = new StartTransmissionDeclineGate();

  private constructor() { }

  initialize() {
    EventSystem.unregister(this);
    EventSystem.register(this)
      .on('CONNECT_PEER', -1, event => {
        if (!event.isSendFromSelf) return;
        VideoStorage.instance.synchronize(event.data.peerId);
        VideoStorage.instance.lazySynchronize(1000, event.data.peerId);
      })
      .on('SYNCHRONIZE_VIDEO_LIST', event => {
        if (event.isSendFromSelf) return;
        const otherCatalog: VideoCatalogItem[] = event.data;
        const hooks = this.missingDownloadHooks();
        const request = collectMissingDownloadRequests(otherCatalog, hooks);
        if (request.length < 1 && !hasActiveMediaTasks(this.sendTaskMap.size, this.receiveTaskMap.size) && otherCatalog.length < VideoStorage.instance.getCatalog().length) {
          VideoStorage.instance.synchronize(event.sendFrom);
        }
        if (request.length < 1) return;
        queueMissingDownloads(request, event.sendFrom, otherCatalog, hooks);
      })
      .on('REQUEST_VIDEO_RESOURE', event => {
        if (event.isSendFromSelf) return;
        fulfillOrRelaySingleFileRequest({
          kind: 'video',
          identifiers: event.data.identifiers,
          receiver: event.data.receiver,
          candidatePeers: event.data.candidatePeers,
          sendTaskCount: this.sendTaskMap.size,
          getLocalState: id => VideoStorage.instance.get(id)?.state ?? null,
          startSend: (id, receiver) => {
            const video = VideoStorage.instance.get(id);
            if (video) this.startSendTask(video, receiver);
          },
          relayTo: peerId => EventSystem.call(event, peerId),
        });
      })
      .on('UPDATE_VIDEO_RESOURE', 1000, event => {
        const updateVideos: VideoFileContext[] = event.data;
        for (const context of updateVideos) {
          if (context.blob) context.blob = new Blob([context.blob], { type: context.type || 'video/mp4' });
          VideoStorage.instance.add(context);
        }
      })
      .on('START_VIDEO_TRANSMISSION', event => {
        const identifier: string = event.data.fileIdentifier;
        acceptOrDeclineStartTransmission({
          identifier,
          sendFrom: event.sendFrom,
          isReceiving: this.receiveTaskMap.has(identifier),
          localState: VideoStorage.instance.get(identifier)?.state ?? null,
          completeState: VideoState.COMPLETE,
          declineGate: this.startDeclineGate,
          startReceive: (id, from) => this.startReceiveTask(id, from),
        });
      });
  }

  private async startSendTask(video: VideoFile, sendTo: string) {
    await startSingleFileSendTask({
      identifier: video.identifier,
      sendTo,
      sendTaskMap: this.sendTaskMap,
      startEventName: 'START_VIDEO_TRANSMISSION',
      synchronizeWhen: 'always',
      synchronize: () => VideoStorage.instance.synchronize(),
      buildContext: () => buildBlobOrUrlSendContext({
        identifier: video.identifier,
        name: video.name,
        state: video.state,
        urlState: VideoState.URL,
        url: video.url,
        blob: video.blob,
        defaultMime: 'video/mp4',
      }),
    });
  }

  private startReceiveTask(identifier: string, fromPeerId?: string) {
    const video = VideoStorage.instance.get(identifier);
    startSingleFileReceiveTask({
      kind: 'video',
      identifier,
      fromPeerId,
      receiveTaskMap: this.receiveTaskMap,
      applyProgress: (loaded, total) => {
        if (video) applyReceiveProgressPercent(video, loaded, total);
      },
      updateEventName: 'UPDATE_VIDEO_RESOURE',
      lazySynchronize: ms => VideoStorage.instance.lazySynchronize(ms),
      stopReceiveTask: id => this.stopReceiveTask(id),
    });
  }

  private stopReceiveTask(identifier: string) {
    const task = this.receiveTaskMap.get(identifier);
    if (task) task.cancel();
    this.receiveTaskMap.delete(identifier);
    FileReceiveScheduler.markReceiveEnd('video', identifier);
  }

  ensureRoomDownloads(catalogsByPeer: Map<string, VideoCatalogItem[]>) {
    const hooks = this.missingDownloadHooks();
    ensureRoomMissingDownloads(catalogsByPeer, hooks);
  }

  /** Path/HTTP assets load locally; never enqueue for P2P (compat with older hosts). */
  private hydrateUrlBackedIfNeeded(item: VideoCatalogItem): boolean {
    if (item.state !== VideoState.URL && !isUrlBackedMediaIdentifier(item.identifier)) {
      return false;
    }
    const existing = VideoStorage.instance.get(item.identifier);
    if (!existing || existing.state < VideoState.URL) {
      VideoStorage.instance.add(VideoFile.create(item.identifier));
    }
    return true;
  }

  private missingDownloadHooks(): MissingDownloadHooks {
    return {
      kind: 'video',
      completeState: VideoState.COMPLETE,
      nullState: VideoState.NULL,
      isReceiving: id => this.receiveTaskMap.has(id),
      getLocalState: id => {
        const video = VideoStorage.instance.get(id);
        return video ? video.state : null;
      },
      ensurePlaceholder: id => {
        VideoStorage.instance.add(VideoFile.createEmpty(id));
      },
      hydrateUrlBacked: item => this.hydrateUrlBackedIfNeeded(item),
      requestOne: (identifier, localState, peerId) => {
        this.request([{ identifier, state: localState }], peerId);
      },
    };
  }

  private request(request: VideoCatalogItem[], peerId: string) {
    const identifier = request[0]?.identifier;
    if (deferRequestIfPeerNotOpen('video', peerId, identifier, (ms, peer) => {
      VideoStorage.instance.lazySynchronize(ms, peer);
    })) {
      return;
    }
    EventSystem.call('REQUEST_VIDEO_RESOURE', {
      identifiers: request,
      receiver: Network.peerId,
      candidatePeers: meshCandidatePeerIds()
    }, peerId);
  }
}
