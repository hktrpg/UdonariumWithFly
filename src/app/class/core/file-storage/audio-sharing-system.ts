import { EventSystem, Network } from '../system';
import { netDebug } from '../system/network/net-debug';
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
import { AudioFile, AudioFileContext, AudioState } from './audio-file';
import { AudioStorage, CatalogItem } from './audio-storage';
import { BufferSharingTask } from './buffer-sharing-task';
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
        fulfillOrRelaySingleFileRequest({
          kind: 'audio',
          identifiers: event.data.identifiers,
          receiver: event.data.receiver,
          candidatePeers: event.data.candidatePeers,
          sendTaskCount: this.sendTaskMap.size,
          getLocalState: id => AudioStorage.instance.get(id)?.state ?? null,
          startSend: (id, receiver) => {
            const audio = AudioStorage.instance.get(id);
            if (audio) this.startSendTask(audio, receiver);
          },
          relayTo: peerId => EventSystem.call(event, peerId),
          onSend: (receiver, id) => netDebug('REQUEST_AUDIO_RESOURE Send!!! ' + receiver + ' -> ' + id),
          onRelay: peerId => netDebug('REQUEST_AUDIO_RESOURE AudioStorageService Relay!!! ' + peerId + ' -> ' + event.data.identifiers),
          onOverflow: (receiver, count) => netDebug('REQUEST_FILE_RESOURE AudioStorageService overflow...' + receiver, count),
        });
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
        const identifier: string = event.data.fileIdentifier;
        acceptOrDeclineStartTransmission({
          identifier,
          sendFrom: event.sendFrom,
          isReceiving: this.receiveTaskMap.has(identifier),
          localState: AudioStorage.instance.get(identifier)?.state ?? null,
          completeState: AudioState.COMPLETE,
          declineGate: this.startDeclineGate,
          startReceive: (id, from) => this.startReceiveTask(id, from),
        });
      });
  }

  private destroy() {
    EventSystem.unregister(this);
  }

  private async startSendTask(audio: AudioFile, sendTo: string) {
    await startSingleFileSendTask({
      identifier: audio.identifier,
      sendTo,
      sendTaskMap: this.sendTaskMap,
      startEventName: 'START_AUDIO_TRANSMISSION',
      synchronizeWhen: 'success',
      synchronize: () => AudioStorage.instance.synchronize(),
      buildContext: () => buildBlobOrUrlSendContext({
        identifier: audio.identifier,
        name: audio.name,
        state: audio.state,
        urlState: AudioState.URL,
        url: audio.url,
        blob: audio.blob,
      }),
    });
  }

  private startReceiveTask(identifier: string, fromPeerId?: string) {
    const audio = AudioStorage.instance.get(identifier);
    startSingleFileReceiveTask({
      kind: 'audio',
      identifier,
      fromPeerId,
      receiveTaskMap: this.receiveTaskMap,
      applyProgress: (loaded, total) => {
        if (audio) applyReceiveProgressPercent(audio, loaded, total);
      },
      updateEventName: 'UPDATE_AUDIO_RESOURE',
      lazySynchronize: ms => AudioStorage.instance.lazySynchronize(ms),
      stopReceiveTask: id => this.stopReceiveTask(id),
      onStarted: () => netDebug('startReceiveTask => ', this.receiveTaskMap.size),
    });
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
