import { EventSystem, Network } from '../system';
import { meshWarnThrottled } from '../system/network/net-debug';
import { BufferSharingTask } from './buffer-sharing-task';
import { estimateNextReceiveBytes, FileReceiveScheduler } from './file-transfer-scheduler';
import { FileReaderUtil } from './file-reader-util';
import { VideoFile, VideoFileContext, VideoState } from './video-file';
import { VideoCatalogItem, VideoStorage } from './video-storage';
import { FolderMediaHydrator } from 'service/folder-media-hydrator';

export class VideoSharingSystem {
  private static _instance: VideoSharingSystem;
  static get instance(): VideoSharingSystem {
    if (!VideoSharingSystem._instance) VideoSharingSystem._instance = new VideoSharingSystem();
    return VideoSharingSystem._instance;
  }

  private sendTaskMap: Map<string, BufferSharingTask<VideoFileContext>> = new Map();
  private receiveTaskMap: Map<string, BufferSharingTask<VideoFileContext>> = new Map();
  private maxSendTask = 2;
  private maxReceiveTask = 4;

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
        const request: VideoCatalogItem[] = [];
        for (const item of otherCatalog) {
          let video = VideoStorage.instance.get(item.identifier);
          if (video === null) {
            video = VideoFile.createEmpty(item.identifier);
            VideoStorage.instance.add(video);
          }
          if (video.state < VideoState.COMPLETE
          && !this.receiveTaskMap.has(item.identifier)
          && FileReceiveScheduler.canEnqueueReceive('video', item.identifier)) {
            request.push({ identifier: item.identifier, state: video.state });
          }
        }
        if (request.length < 1 && !this.hasActiveTask() && otherCatalog.length < VideoStorage.instance.getCatalog().length) {
          VideoStorage.instance.synchronize(event.sendFrom);
        }
        if (request.length < 1) return;
        void this.queueMissingDownloads(request, event.sendFrom, otherCatalog);
      })
      .on('REQUEST_VIDEO_RESOURE', event => {
        if (event.isSendFromSelf) return;
        const request: VideoCatalogItem[] = event.data.identifiers;
        const randomRequest: VideoCatalogItem[] = [];
        for (const item of request) {
          const video = VideoStorage.instance.get(item.identifier);
          if (video && item.state < video.state) randomRequest.push({ identifier: item.identifier, state: item.state });
        }
        if (!this.isLimitSendTask() && randomRequest.length && !this.existsSendTask(event.data.receiver)) {
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
          EventSystem.call('CANCEL_TASK_' + identifier, null, event.sendFrom);
        } else {
          this.startReceiveTask(identifier);
        }
      });
  }

  private async startSendTask(video: VideoFile, sendTo: string) {
    const taskKey = this.sendTaskKey(sendTo, video.identifier);
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

  private startReceiveTask(identifier: string) {
    FileReceiveScheduler.markReceiveStart('video', identifier);
    const video = VideoStorage.instance.get(identifier);
    const task = BufferSharingTask.createReceiveTask<VideoFileContext>(identifier);
    this.receiveTaskMap.set(identifier, task);
    task.onprogress = (task, loaded, total) => {
      const context = video.toContext();
      context.name = (loaded * 100 / total).toFixed(1) + '%';
      video.apply(context);
    };
    task.onfinish = (task, data) => {
      const ok = task.didCompleteSuccessfully;
      FileReceiveScheduler.noteReceiveEnded('video', task.identifier, ok);
      this.stopReceiveTask(task.identifier);
      if (data) EventSystem.trigger('UPDATE_VIDEO_RESOURE', [data]);
      VideoStorage.instance.lazySynchronize(ok ? 800 : 20_000);
    };
    task.start();
  }

  private stopSendTask(sendKey: string) {
    const task = this.sendTaskMap.get(sendKey);
    if (task) task.cancel();
    this.sendTaskMap.delete(sendKey);
  }

  private sendTaskKey(sendTo: string, identifier: string): string {
    return `${sendTo}:${identifier}`;
  }

  private stopReceiveTask(identifier: string) {
    const task = this.receiveTaskMap.get(identifier);
    if (task) task.cancel();
    this.receiveTaskMap.delete(identifier);
    FileReceiveScheduler.markReceiveEnd('video', identifier);
  }

  ensureRoomDownloads(catalogsByPeer: Map<string, VideoCatalogItem[]>) {
    for (const [peerId, catalog] of catalogsByPeer) {
      if (!Network.peerIds.includes(peerId) || !catalog?.length) continue;
      const request: VideoCatalogItem[] = [];
      for (const item of catalog) {
        let video = VideoStorage.instance.get(item.identifier);
        if (video === null) {
          video = VideoFile.createEmpty(item.identifier);
          VideoStorage.instance.add(video);
        }
        if (video.state < VideoState.COMPLETE
          && !this.receiveTaskMap.has(item.identifier)
          && FileReceiveScheduler.canEnqueueReceive('video', item.identifier)) {
          request.push({ identifier: item.identifier, state: video.state });
        }
      }
      if (request.length) void this.queueMissingDownloads(request, peerId, catalog);
    }
  }

  private async queueMissingDownloads(request: VideoCatalogItem[], peerId: string, catalogMeta: VideoCatalogItem[]) {
    const metaById = new Map(catalogMeta.map(item => [item.identifier, item]));
    const sorted = FileReceiveScheduler.sortByNextReceiveBytes('video', request, item => {
      const video = VideoStorage.instance.get(item.identifier);
      return video?.state ?? VideoState.NULL;
    });
    await FolderMediaHydrator.instance.hydrateMissing('video', sorted.map(item => item.identifier));
    for (const item of sorted) {
      const video = VideoStorage.instance.get(item.identifier);
      const localState = video?.state ?? VideoState.NULL;
      if (localState >= VideoState.COMPLETE) continue;
      const meta = metaById.get(item.identifier) ?? item;
      const bytes = estimateNextReceiveBytes('video', localState, meta);
      FileReceiveScheduler.enqueueReceiveRequest('video', peerId, item.identifier, bytes, () => {
        this.request([{ identifier: item.identifier, state: localState }], peerId);
      });
    }
  }

  private request(request: VideoCatalogItem[], peerId: string) {
    const identifier = request[0]?.identifier;
    if (!Network.peerIds.includes(peerId)) {
      if (identifier) FileReceiveScheduler.abortOutboundRequest('video', identifier);
      meshWarnThrottled(`video-skip-${peerId.slice(0, 12)}`,
        'video request skipped (peer not open)', peerId.slice(0, 16));
      VideoStorage.instance.lazySynchronize(1500, peerId);
      return;
    }
    EventSystem.call('REQUEST_VIDEO_RESOURE', {
      identifiers: request,
      receiver: Network.peerId,
      candidatePeers: this.meshCandidatePeerIds()
    }, peerId);
  }

  private meshCandidatePeerIds(): string[] {
    const ids = new Set<string>();
    for (const id of Network.listRoomMemberPeerIds()) {
      if (id && id !== Network.peerId) ids.add(id);
    }
    for (const id of Network.peerIds) ids.add(id);
    return Array.from(ids);
  }

  private hasActiveTask(): boolean {
    return 0 < this.sendTaskMap.size || 0 < this.receiveTaskMap.size;
  }

  private isLimitSendTask(): boolean {
    return this.maxSendTask <= this.sendTaskMap.size;
  }

  private isLimitReceiveTask(): boolean {
    return FileReceiveScheduler.isReceiveBudgetFull();
  }

  private existsSendTask(peerId: string): boolean {
    for (const task of this.sendTaskMap.values()) {
      if (task && task.sendTo === peerId) return true;
    }
    return false;
  }
}
