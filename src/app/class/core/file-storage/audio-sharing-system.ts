import { EventSystem, Network } from '../system';
import { netDebug, meshWarnThrottled } from '../system/network/net-debug';
import { estimateNextReceiveBytes, FileReceiveScheduler } from './file-transfer-scheduler';
import { AudioFile, AudioFileContext, AudioState } from './audio-file';
import { AudioStorage, CatalogItem } from './audio-storage';
import { BufferSharingTask } from './buffer-sharing-task';
import { FileReaderUtil } from './file-reader-util';
import { isUrlBackedMediaIdentifier } from './media-identifier';
import { FolderMediaHydrator } from 'service/folder-media-hydrator';

export class AudioSharingSystem {
  private static _instance: AudioSharingSystem
  static get instance(): AudioSharingSystem {
    if (!AudioSharingSystem._instance) AudioSharingSystem._instance = new AudioSharingSystem();
    return AudioSharingSystem._instance;
  }

  private sendTaskMap: Map<string, BufferSharingTask<AudioFileContext>> = new Map();
  private receiveTaskMap: Map<string, BufferSharingTask<AudioFileContext>> = new Map();
  private declinedStartKeys = new Map<string, number>();
  private maxSendTask: number = 2;
  private maxReceiveTask: number = 4;

  private constructor() { }

  initialize() {
    this.destroy();
    EventSystem.register(this)
      .on('CONNECT_PEER', -1, event => {
        if (!event.isSendFromSelf) return;
        netDebug('CONNECT_PEER AudioStorageService !!!', event.data.peerId);
        AudioStorage.instance.synchronize(event.data.peerId);
        AudioStorage.instance.lazySynchronize(1000, event.data.peerId);
      })
      .on('SYNCHRONIZE_AUDIO_LIST', event => {
        if (event.isSendFromSelf) return;
        netDebug('SYNCHRONIZE_AUDIO_LIST ' + event.sendFrom);

        let otherCatalog: CatalogItem[] = event.data;
        let request: CatalogItem[] = [];

        netDebug('SYNCHRONIZE_AUDIO_LIST active tasks ', this.sendTaskMap.size + this.receiveTaskMap.size);
        for (let item of otherCatalog) {
          if (this.hydrateUrlBackedIfNeeded(item)) continue;
          let audio: AudioFile = AudioStorage.instance.get(item.identifier);
          if (audio === null) {
            audio = AudioFile.createEmpty(item.identifier);
            AudioStorage.instance.add(audio);
          }
          if (audio.state < AudioState.COMPLETE
          && !this.receiveTaskMap.has(item.identifier)
          && FileReceiveScheduler.canEnqueueReceive('audio', item.identifier)) {
            request.push({ identifier: item.identifier, state: audio.state });
          }
        }

        // Handle edge cases such as Peer disconnect
        if (request.length < 1 && !this.hasActiveTask() && otherCatalog.length < AudioStorage.instance.getCatalog().length) {
          AudioStorage.instance.synchronize(event.sendFrom);
        }

        if (request.length < 1) {
          return;
        }
        void this.queueMissingDownloads(request, event.sendFrom, otherCatalog);
      })
      .on('REQUEST_AUDIO_RESOURE', event => {
        if (event.isSendFromSelf) return;

        let request: CatalogItem[] = event.data.identifiers;
        let randomRequest: CatalogItem[] = [];

        for (let item of request) {
          let audio: AudioFile = AudioStorage.instance.get(item.identifier);
          if (audio && item.state < audio.state) randomRequest.push({ identifier: item.identifier, state: item.state });
        }

        if (this.isLimitSendTask() === false && 0 < randomRequest.length) {
          const sorted = FileReceiveScheduler.sortByNextReceiveBytes('audio', randomRequest, item => item.state);
          const item = sorted[0];
          const audio: AudioFile = AudioStorage.instance.get(item.identifier);
          netDebug('REQUEST_AUDIO_RESOURE Send!!! ' + event.data.receiver + ' -> ' + item.identifier);
          this.startSendTask(audio, event.data.receiver);
        } else {
          // ??
          let candidatePeers: string[] = event.data.candidatePeers
            .filter((id: string) => Network.peerIds.includes(id));
          let index = candidatePeers.indexOf(Network.peerId);
          if (-1 < index) candidatePeers.splice(index, 1);

          for (let peerId of candidatePeers) {
            netDebug('REQUEST_AUDIO_RESOURE AudioStorageService Relay!!! ' + peerId + ' -> ' + event.data.identifiers);
            EventSystem.call(event, peerId);
            return;
          }
          netDebug('REQUEST_FILE_RESOURE AudioStorageService overflow...' + event.data.receiver, randomRequest.length);
        }
      })
      .on('UPDATE_AUDIO_RESOURE', 1000, event => {
        let updateAudios: AudioFileContext[] = event.data;
        netDebug('UPDATE_AUDIO_RESOURE AudioStorageService ' + event.sendFrom + ' -> ', updateAudios);
        for (let context of updateAudios) {
          if (context.blob) context.blob = new Blob([context.blob], { type: context.type });
          AudioStorage.instance.add(context);
        }
      })
      .on('START_AUDIO_TRANSMISSION', event => {
        netDebug('START_AUDIO_TRANSMISSION ' + event.data.fileIdentifier);
        let identifier: string = event.data.fileIdentifier;
        let audio: AudioFile = AudioStorage.instance.get(identifier);
        if (this.receiveTaskMap.has(identifier)) {
          return;
        }
        if (audio && AudioState.COMPLETE <= audio.state) {
          const declineKey = `${event.sendFrom}:${identifier}`;
          const lastDecline = this.declinedStartKeys.get(declineKey) ?? 0;
          if (performance.now() - lastDecline < 60_000) {
            return;
          }
          this.declinedStartKeys.set(declineKey, performance.now());
          EventSystem.call('CANCEL_TASK_' + identifier, null, event.sendFrom);
          return;
        }
        this.startReceiveTask(identifier, event.sendFrom);
      });
  }

  private destroy() {
    EventSystem.unregister(this);
  }

  private async startSendTask(audio: AudioFile, sendTo: string) {
    const taskKey = this.sendTaskKey(sendTo, audio.identifier);
    if (this.sendTaskMap.has(taskKey)) return;

    let task = BufferSharingTask.createSendTask<AudioFileContext>(audio.identifier, sendTo);
    this.sendTaskMap.set(taskKey, task);

    EventSystem.call('START_AUDIO_TRANSMISSION', { fileIdentifier: audio.identifier }, sendTo);

    let context: AudioFileContext = {
      identifier: audio.identifier,
      name: audio.name,
      blob: null,
      type: '',
      url: null
    };

    if (audio.state === AudioState.URL) {
      context.url = audio.url;
    } else {
      context.blob = <any>await FileReaderUtil.readAsArrayBufferAsync(audio.blob);
      context.type = audio.blob.type;
    }

    task.onfinish = () => {
      this.removeSendTask(taskKey);
      if (task.didCompleteSuccessfully) {
        AudioStorage.instance.synchronize();
      }
    }

    task.start(context);
  }

  private startReceiveTask(identifier: string, fromPeerId?: string) {
    FileReceiveScheduler.markReceiveStart('audio', identifier);
    let audio: AudioFile = AudioStorage.instance.get(identifier);
    let task = BufferSharingTask.createReceiveTask<AudioFileContext>(identifier, fromPeerId);
    this.receiveTaskMap.set(identifier, task);

    task.onprogress = (task, loaded, total) => {
      let context = audio.toContext();
      context.name = (loaded * 100 / total).toFixed(1) + '%';
      audio.apply(context);
    }
    task.onfinish = (task, data) => {
      const ok = task.didCompleteSuccessfully;
      FileReceiveScheduler.noteReceiveEnded('audio', task.identifier, ok || task.didCancel);
      this.stopReceiveTask(task.identifier);
      if (ok && data) EventSystem.trigger('UPDATE_AUDIO_RESOURE', [data]);
      AudioStorage.instance.lazySynchronize(task.didCancel ? 800 : (ok ? 800 : 20_000));
    }

    task.start();
    netDebug('startReceiveTask => ', this.receiveTaskMap.size);
  }

  private stopSendTask(identifier: string) {
    let task = this.sendTaskMap.get(identifier);
    if (task) { task.cancel(); }
    this.removeSendTask(identifier);

    netDebug('stopSendTask => ', this.sendTaskMap.size);
  }

  private removeSendTask(sendKey: string) {
    this.sendTaskMap.delete(sendKey);
  }

  private sendTaskKey(sendTo: string, identifier: string): string {
    return `${sendTo}:${identifier}`;
  }

  private stopReceiveTask(identifier: string) {
    let task = this.receiveTaskMap.get(identifier);
    if (task) { task.cancel(); }
    this.receiveTaskMap.delete(identifier);
    FileReceiveScheduler.markReceiveEnd('audio', identifier);

    netDebug('stopReceiveTask => ', this.receiveTaskMap.size);
  }

  ensureRoomDownloads(catalogsByPeer: Map<string, CatalogItem[]>) {
    for (const [peerId, catalog] of catalogsByPeer) {
      if (!Network.peerIds.includes(peerId) || !catalog?.length) continue;
      const request: CatalogItem[] = [];
      for (const item of catalog) {
        if (this.hydrateUrlBackedIfNeeded(item)) continue;
        let audio = AudioStorage.instance.get(item.identifier);
        if (audio === null) {
          audio = AudioFile.createEmpty(item.identifier);
          AudioStorage.instance.add(audio);
        }
        if (audio.state < AudioState.COMPLETE
          && !this.receiveTaskMap.has(item.identifier)
          && FileReceiveScheduler.canEnqueueReceive('audio', item.identifier)) {
          request.push({ identifier: item.identifier, state: audio.state });
        }
      }
      if (request.length) void this.queueMissingDownloads(request, peerId, catalog);
    }
  }

  /** Path/HTTP assets load locally; never enqueue for P2P (compat with older hosts). */
  private hydrateUrlBackedIfNeeded(item: CatalogItem): boolean {
    if (item.state !== AudioState.URL && !isUrlBackedMediaIdentifier(item.identifier)) {
      return false;
    }
    const existing = AudioStorage.instance.get(item.identifier);
    if (!existing || existing.state < AudioState.URL) {
      AudioStorage.instance.add(AudioFile.create(item.identifier));
    }
    return true;
  }

  private queueMissingDownloads(request: CatalogItem[], peerId: string, catalogMeta: CatalogItem[]) {
    const metaById = new Map(catalogMeta.map(item => [item.identifier, item]));
    const sorted = FileReceiveScheduler.sortByNextReceiveBytes('audio', request, item => {
      const audio = AudioStorage.instance.get(item.identifier);
      return audio?.state ?? AudioState.NULL;
    });
    FolderMediaHydrator.instance.beginHydrateMissing('audio', sorted.map(item => item.identifier));
    for (const item of sorted) {
      const audio = AudioStorage.instance.get(item.identifier);
      const localState = audio?.state ?? AudioState.NULL;
      if (localState >= AudioState.COMPLETE) continue;
      const meta = metaById.get(item.identifier) ?? item;
      const bytes = estimateNextReceiveBytes('audio', localState, meta);
      FileReceiveScheduler.enqueueReceiveRequest('audio', peerId, item.identifier, bytes, () => {
        this.request([{ identifier: item.identifier, state: localState }], peerId);
      });
    }
  }

  private request(request: CatalogItem[], peerId: string) {
    const identifier = request[0]?.identifier;
    if (!Network.peerIds.includes(peerId)) {
      if (identifier) FileReceiveScheduler.abortOutboundRequest('audio', identifier);
      meshWarnThrottled(`audio-skip-${peerId.slice(0, 12)}`,
        'audio request skipped (peer not open)', peerId.slice(0, 16));
      AudioStorage.instance.lazySynchronize(1500, peerId);
      return;
    }
    netDebug('requestFile() ' + peerId);
    EventSystem.call('REQUEST_AUDIO_RESOURE', {
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
    for (let task of this.sendTaskMap.values()) {
      if (task && task.sendTo === peerId) return true;
    }
    return false;
  }
}
