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
import { PdfFile, PdfFileContext, PdfState } from './pdf-file';
import { PdfCatalogItem, PdfStorage } from './pdf-storage';

export class PdfSharingSystem {
  private static _instance: PdfSharingSystem;
  static get instance(): PdfSharingSystem {
    if (!PdfSharingSystem._instance) PdfSharingSystem._instance = new PdfSharingSystem();
    return PdfSharingSystem._instance;
  }

  private sendTaskMap: Map<string, BufferSharingTask<PdfFileContext>> = new Map();
  private receiveTaskMap: Map<string, BufferSharingTask<PdfFileContext>> = new Map();
  private readonly startDeclineGate = new StartTransmissionDeclineGate();

  private constructor() { }

  initialize() {
    EventSystem.unregister(this);
    EventSystem.register(this)
      .on('CONNECT_PEER', -1, event => {
        if (!event.isSendFromSelf) return;
        PdfStorage.instance.synchronize(event.data.peerId);
        PdfStorage.instance.lazySynchronize(1000, event.data.peerId);
      })
      .on('SYNCHRONIZE_PDF_LIST', event => {
        if (event.isSendFromSelf) return;
        const otherCatalog: PdfCatalogItem[] = event.data;
        const hooks = this.missingDownloadHooks();
        const request = collectMissingDownloadRequests(otherCatalog, hooks);
        if (request.length < 1 && !hasActiveMediaTasks(this.sendTaskMap.size, this.receiveTaskMap.size) && otherCatalog.length < PdfStorage.instance.getCatalog().length) {
          PdfStorage.instance.synchronize(event.sendFrom);
        }
        if (request.length < 1) return;
        queueMissingDownloads(request, event.sendFrom, otherCatalog, hooks);
      })
      .on('REQUEST_PDF_RESOURE', event => {
        if (event.isSendFromSelf) return;
        const request: PdfCatalogItem[] = event.data.identifiers;
        const randomRequest: PdfCatalogItem[] = [];
        for (const item of request) {
          const pdf = PdfStorage.instance.get(item.identifier);
          if (pdf && item.state < pdf.state) randomRequest.push({ identifier: item.identifier, state: item.state });
        }
        if (!isSendTaskLimitReached(this.sendTaskMap.size) && randomRequest.length) {
          const sorted = FileReceiveScheduler.sortByNextReceiveBytes('pdf', randomRequest, item => item.state);
          const item = sorted[0];
          const pdf = PdfStorage.instance.get(item.identifier);
          this.startSendTask(pdf, event.data.receiver);
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
      .on('UPDATE_PDF_RESOURE', 1000, event => {
        const updatePdfs: PdfFileContext[] = event.data;
        for (const context of updatePdfs) {
          if (context.blob) context.blob = new Blob([context.blob], { type: context.type || 'application/pdf' });
          PdfStorage.instance.add(context);
        }
      })
      .on('START_PDF_TRANSMISSION', event => {
        const identifier: string = event.data.fileIdentifier;
        const pdf = PdfStorage.instance.get(identifier);
        if (this.receiveTaskMap.has(identifier)) {
          return;
        }
        if (pdf && PdfState.COMPLETE <= pdf.state) {
          this.startDeclineGate.cancelRedundantStart(event.sendFrom, identifier);
          return;
        }
        this.startReceiveTask(identifier, event.sendFrom);
      });
  }

  private async startSendTask(pdf: PdfFile, sendTo: string) {
    const taskKey = mediaSendTaskKey(sendTo, pdf.identifier);
    if (this.sendTaskMap.has(taskKey)) return;

    const task = BufferSharingTask.createSendTask<PdfFileContext>(pdf.identifier, sendTo);
    this.sendTaskMap.set(taskKey, task);
    EventSystem.call('START_PDF_TRANSMISSION', { fileIdentifier: pdf.identifier }, sendTo);
    const context: PdfFileContext = {
      identifier: pdf.identifier,
      name: pdf.name,
      blob: null,
      type: '',
      url: null
    };
    if (pdf.state === PdfState.URL) {
      context.url = pdf.url;
    } else {
      context.blob = <any>await FileReaderUtil.readAsArrayBufferAsync(pdf.blob);
      context.type = pdf.blob.type || 'application/pdf';
    }
    task.onfinish = () => {
      this.stopSendTask(taskKey);
      PdfStorage.instance.synchronize();
    };
    task.start(context);
  }

  private startReceiveTask(identifier: string, fromPeerId?: string) {
    FileReceiveScheduler.markReceiveStart('pdf', identifier);
    const pdf = PdfStorage.instance.get(identifier);
    const task = BufferSharingTask.createReceiveTask<PdfFileContext>(identifier, fromPeerId);
    this.receiveTaskMap.set(identifier, task);
    task.onprogress = (task, loaded, total) => {
      const context = pdf.toContext();
      context.name = (loaded * 100 / total).toFixed(1) + '%';
      pdf.apply(context);
    };
    task.onfinish = (task, data) => {
      finishMediaReceiveTask('pdf', task, data, {
        stopReceiveTask: id => this.stopReceiveTask(id),
        onSuccess: payload => EventSystem.trigger('UPDATE_PDF_RESOURE', [payload]),
        lazySynchronize: ms => PdfStorage.instance.lazySynchronize(ms),
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
    FileReceiveScheduler.markReceiveEnd('pdf', identifier);
  }

  ensureRoomDownloads(catalogsByPeer: Map<string, PdfCatalogItem[]>) {
    const hooks = this.missingDownloadHooks();
    ensureRoomMissingDownloads(catalogsByPeer, hooks);
  }

  /** Path/HTTP assets load locally; never enqueue for P2P (compat with older hosts). */
  private hydrateUrlBackedIfNeeded(item: PdfCatalogItem): boolean {
    if (item.state !== PdfState.URL && !isUrlBackedMediaIdentifier(item.identifier)) {
      return false;
    }
    const existing = PdfStorage.instance.get(item.identifier);
    if (!existing || existing.state < PdfState.URL) {
      PdfStorage.instance.add(PdfFile.create(item.identifier));
    }
    return true;
  }

  private missingDownloadHooks(): MissingDownloadHooks {
    return {
      kind: 'pdf',
      completeState: PdfState.COMPLETE,
      nullState: PdfState.NULL,
      isReceiving: id => this.receiveTaskMap.has(id),
      getLocalState: id => {
        const pdf = PdfStorage.instance.get(id);
        return pdf ? pdf.state : null;
      },
      ensurePlaceholder: id => {
        PdfStorage.instance.add(PdfFile.createEmpty(id));
      },
      hydrateUrlBacked: item => this.hydrateUrlBackedIfNeeded(item),
      requestOne: (identifier, localState, peerId) => {
        this.request([{ identifier, state: localState }], peerId);
      },
    };
  }

  private request(request: PdfCatalogItem[], peerId: string) {
    const identifier = request[0]?.identifier;
    if (deferRequestIfPeerNotOpen('pdf', peerId, identifier, (ms, peer) => {
      PdfStorage.instance.lazySynchronize(ms, peer);
    })) {
      return;
    }
    EventSystem.call('REQUEST_PDF_RESOURE', {
      identifiers: request,
      receiver: Network.peerId,
      candidatePeers: meshCandidatePeerIds()
    }, peerId);
  }
}
