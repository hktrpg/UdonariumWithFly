import { EventSystem, Network } from '../system';
import { netDebug } from '../system/network/net-debug';
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
import { AudioFile, AudioFileContext, AudioState } from './audio-file';
import { AudioStorage, CatalogItem } from './audio-storage';
import { BufferSharingTask } from './buffer-sharing-task';
import { FileReaderUtil } from './file-reader-util';
import { isUrlBackedMediaIdentifier } from './media-identifier';

export class AudioSharingSystem {
  private static _instance: AudioSharingSystem
  static get instance(): AudioSharingSystem {
    if (!AudioSharingSystem._instance) AudioSharingSystem._instance = new AudioSharingSystem();
    return AudioSharingSystem._instance;
  }

  private sendTaskMap: Map<string, BufferSharingTask<AudioFileContext>> = new Map();
  private receiveTaskMap: Map<string, BufferSharingTask<AudioFileContext>> = new Map();
  private readonly startDeclineGate = new StartTransmissionDeclineGate();

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
        netDebug('SYNCHRONIZE_AUDIO_LIST active tasks ', this.sendTaskMap.size + this.receiveTaskMap.size);
        const hooks = this.missingDownloadHooks();
        const request = collectMissingDownloadRequests(otherCatalog, hooks);

        // Handle edge cases such as Peer disconnect
        if (request.length < 1 && !hasActiveMediaTasks(this.sendTaskMap.size, this.receiveTaskMap.size) && otherCatalog.length < AudioStorage.instance.getCatalog().length) {
          AudioStorage.instance.synchronize(event.sendFrom);
        }

        if (request.length < 1) {
          return;
        }
        queueMissingDownloads(request, event.sendFrom, otherCatalog, hooks);
      })
      .on('REQUEST_AUDIO_RESOURE', event => {
        if (event.isSendFromSelf) return;

        let request: CatalogItem[] = event.data.identifiers;
        let randomRequest: CatalogItem[] = [];

        for (let item of request) {
          let audio: AudioFile = AudioStorage.instance.get(item.identifier);
          if (audio && item.state < audio.state) randomRequest.push({ identifier: item.identifier, state: item.state });
        }

        if (!isSendTaskLimitReached(this.sendTaskMap.size) && 0 < randomRequest.length) {
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
          this.startDeclineGate.cancelRedundantStart(event.sendFrom, identifier);
          return;
        }
        this.startReceiveTask(identifier, event.sendFrom);
      });
  }

  private destroy() {
    EventSystem.unregister(this);
  }

  private async startSendTask(audio: AudioFile, sendTo: string) {
    const taskKey = mediaSendTaskKey(sendTo, audio.identifier);
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
      finishMediaReceiveTask('audio', task, data, {
        stopReceiveTask: id => this.stopReceiveTask(id),
        onSuccess: payload => EventSystem.trigger('UPDATE_AUDIO_RESOURE', [payload]),
        lazySynchronize: ms => AudioStorage.instance.lazySynchronize(ms),
      });
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

  private stopReceiveTask(identifier: string) {
    let task = this.receiveTaskMap.get(identifier);
    if (task) { task.cancel(); }
    this.receiveTaskMap.delete(identifier);
    FileReceiveScheduler.markReceiveEnd('audio', identifier);

    netDebug('stopReceiveTask => ', this.receiveTaskMap.size);
  }

  ensureRoomDownloads(catalogsByPeer: Map<string, CatalogItem[]>) {
    const hooks = this.missingDownloadHooks();
    ensureRoomMissingDownloads(catalogsByPeer, hooks);
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

  private missingDownloadHooks(): MissingDownloadHooks {
    return {
      kind: 'audio',
      completeState: AudioState.COMPLETE,
      nullState: AudioState.NULL,
      isReceiving: id => this.receiveTaskMap.has(id),
      getLocalState: id => {
        const audio = AudioStorage.instance.get(id);
        return audio ? audio.state : null;
      },
      ensurePlaceholder: id => {
        AudioStorage.instance.add(AudioFile.createEmpty(id));
      },
      hydrateUrlBacked: item => this.hydrateUrlBackedIfNeeded(item),
      requestOne: (identifier, localState, peerId) => {
        this.request([{ identifier, state: localState }], peerId);
      },
    };
  }

  private request(request: CatalogItem[], peerId: string) {
    const identifier = request[0]?.identifier;
    if (deferRequestIfPeerNotOpen('audio', peerId, identifier, (ms, peer) => {
      AudioStorage.instance.lazySynchronize(ms, peer);
    })) {
      return;
    }
    netDebug('requestFile() ' + peerId);
    EventSystem.call('REQUEST_AUDIO_RESOURE', {
      identifiers: request,
      receiver: Network.peerId,
      candidatePeers: meshCandidatePeerIds()
    }, peerId);
  }
}
