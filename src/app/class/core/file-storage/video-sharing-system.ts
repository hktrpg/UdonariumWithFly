import { EventSystem, Network } from '../system';
import { BufferSharingTask } from './buffer-sharing-task';
import { FileReceiveScheduler } from './file-transfer-scheduler';
import { finishMediaReceiveTask } from './receive-task-finish';
import { deferRequestIfPeerNotOpen } from './defer-request-if-peer-not-open';
import { StartTransmissionDeclineGate } from './start-transmission-decline';
import {
  hasActiveMediaTasks,
  isSendTaskLimitReached,
  mediaSendTaskKey,
  meshCandidatePeerIds,
} from './media-sharing-helpers';
import {
  collectMissingDownloadRequests,
  ensureRoomMissingDownloads,
  MissingDownloadHooks,
  queueMissingDownloads,
} from './missing-download-pipeline';
import { FileReaderUtil } from './file-reader-util';
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
        const request: VideoCatalogItem[] = event.data.identifiers;
        const randomRequest: VideoCatalogItem[] = [];
        for (const item of request) {
          const video = VideoStorage.instance.get(item.identifier);
          if (video && item.state < video.state) randomRequest.push({ identifier: item.identifier, state: item.state });
        }
        if (!isSendTaskLimitReached(this.sendTaskMap.size) && randomRequest.length) {
          const sorted = FileReceiveScheduler.sortByNextReceiveBytes('video', randomRequest, item => item.state);
          const item = sorted[0];
          const video = VideoStorage.instance.get(item.identifier);
          this.startSendTask(video, event.data.receiver);
        } else {
          const candidatePeers: string[] = event.data.candidatePeers
            .filter((id: string) => Network.peerIds.includes(id));
          const index = candidatePeers.indexOf(Network.peerId);
          if (-1 < index) candidatePeers.splice(index, 1);
          for (const peerId of candidatePeers) {
            EventSystem.call(event, peerId);
            return;
          }
        }
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
        const video = VideoStorage.instance.get(identifier);
        if (this.receiveTaskMap.has(identifier)) {
          return;
        }
        if (video && VideoState.COMPLETE <= video.state) {
          this.startDeclineGate.cancelRedundantStart(event.sendFrom, identifier);
          return;
        }
        this.startReceiveTask(identifier, event.sendFrom);
      });
  }

  private async startSendTask(video: VideoFile, sendTo: string) {
    const taskKey = mediaSendTaskKey(sendTo, video.identifier);
    if (this.sendTaskMap.has(taskKey)) return;

    const task = BufferSharingTask.createSendTask<VideoFileContext>(video.identifier, sendTo);
    this.sendTaskMap.set(taskKey, task);
    EventSystem.call('START_VIDEO_TRANSMISSION', { fileIdentifier: video.identifier }, sendTo);
    const context: VideoFileContext = {
      identifier: video.identifier,
      name: video.name,
      blob: null,
      type: '',
      url: null
    };
    if (video.state === VideoState.URL) {
      context.url = video.url;
    } else {
      context.blob = <any>await FileReaderUtil.readAsArrayBufferAsync(video.blob);
      context.type = video.blob.type || 'video/mp4';
    }
    task.onfinish = () => {
      this.stopSendTask(taskKey);
      VideoStorage.instance.synchronize();
    };
    task.start(context);
  }

  private startReceiveTask(identifier: string, fromPeerId?: string) {
    FileReceiveScheduler.markReceiveStart('video', identifier);
    const video = VideoStorage.instance.get(identifier);
    const task = BufferSharingTask.createReceiveTask<VideoFileContext>(identifier, fromPeerId);
    this.receiveTaskMap.set(identifier, task);
    task.onprogress = (task, loaded, total) => {
      const context = video.toContext();
      context.name = (loaded * 100 / total).toFixed(1) + '%';
      video.apply(context);
    };
    task.onfinish = (task, data) => {
      finishMediaReceiveTask('video', task, data, {
        stopReceiveTask: id => this.stopReceiveTask(id),
        onSuccess: payload => EventSystem.trigger('UPDATE_VIDEO_RESOURE', [payload]),
        lazySynchronize: ms => VideoStorage.instance.lazySynchronize(ms),
      });
    };
    task.start();
  }

  private stopSendTask(sendKey: string) {
    const task = this.sendTaskMap.get(sendKey);
    if (task) task.cancel();
    this.sendTaskMap.delete(sendKey);
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
