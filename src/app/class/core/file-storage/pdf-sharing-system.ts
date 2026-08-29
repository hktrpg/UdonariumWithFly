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
        fulfillOrRelaySingleFileRequest({
          kind: 'pdf',
          identifiers: event.data.identifiers,
          receiver: event.data.receiver,
          candidatePeers: event.data.candidatePeers,
          sendTaskCount: this.sendTaskMap.size,
          getLocalState: id => PdfStorage.instance.get(id)?.state ?? null,
          startSend: (id, receiver) => {
            const pdf = PdfStorage.instance.get(id);
            if (pdf) this.startSendTask(pdf, receiver);
          },
          relayTo: peerId => EventSystem.call(event, peerId),
        });
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
        acceptOrDeclineStartTransmission({
          identifier,
          sendFrom: event.sendFrom,
          isReceiving: this.receiveTaskMap.has(identifier),
          localState: PdfStorage.instance.get(identifier)?.state ?? null,
          completeState: PdfState.COMPLETE,
          declineGate: this.startDeclineGate,
          startReceive: (id, from) => this.startReceiveTask(id, from),
        });
      });
  }

  private async startSendTask(pdf: PdfFile, sendTo: string) {
    await startSingleFileSendTask({
      identifier: pdf.identifier,
      sendTo,
      sendTaskMap: this.sendTaskMap,
      startEventName: 'START_PDF_TRANSMISSION',
      synchronizeWhen: 'always',
      synchronize: () => PdfStorage.instance.synchronize(),
      buildContext: () => buildBlobOrUrlSendContext({
        identifier: pdf.identifier,
        name: pdf.name,
        state: pdf.state,
        urlState: PdfState.URL,
        url: pdf.url,
        blob: pdf.blob,
        defaultMime: 'application/pdf',
      }),
    });
  }

  private startReceiveTask(identifier: string, fromPeerId?: string) {
    const pdf = PdfStorage.instance.get(identifier);
    startSingleFileReceiveTask({
      kind: 'pdf',
      identifier,
      fromPeerId,
      receiveTaskMap: this.receiveTaskMap,
      applyProgress: (loaded, total) => {
        if (pdf) applyReceiveProgressPercent(pdf, loaded, total);
      },
      updateEventName: 'UPDATE_PDF_RESOURE',
      lazySynchronize: ms => PdfStorage.instance.lazySynchronize(ms),
      stopReceiveTask: id => this.stopReceiveTask(id),
    });
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
