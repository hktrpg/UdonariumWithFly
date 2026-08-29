import { EventSystem, Network } from '../system';
import { meshWarnThrottled } from '../system/network/net-debug';
import { BufferSharingTask } from './buffer-sharing-task';
import { estimateNextReceiveBytes, FileReceiveScheduler } from './file-transfer-scheduler';
import { finishMediaReceiveTask } from './receive-task-finish';
import { StartTransmissionDeclineGate } from './start-transmission-decline';
import { FileReaderUtil } from './file-reader-util';
import { isUrlBackedMediaIdentifier } from './media-identifier';
import { PdfFile, PdfFileContext, PdfState } from './pdf-file';
import { PdfCatalogItem, PdfStorage } from './pdf-storage';
import { FolderMediaHydrator } from 'service/folder-media-hydrator';

export class PdfSharingSystem {
  private static _instance: PdfSharingSystem;
  static get instance(): PdfSharingSystem {
    if (!PdfSharingSystem._instance) PdfSharingSystem._instance = new PdfSharingSystem();
    return PdfSharingSystem._instance;
  }

  private sendTaskMap: Map<string, BufferSharingTask<PdfFileContext>> = new Map();
  private receiveTaskMap: Map<string, BufferSharingTask<PdfFileContext>> = new Map();
  private readonly startDeclineGate = new StartTransmissionDeclineGate();
  private maxSendTask = 2;
  private maxReceiveTask = 4;

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
        const request: PdfCatalogItem[] = [];
        for (const item of otherCatalog) {
          if (this.hydrateUrlBackedIfNeeded(item)) continue;
          let pdf = PdfStorage.instance.get(item.identifier);
          if (pdf === null) {
            pdf = PdfFile.createEmpty(item.identifier);
            PdfStorage.instance.add(pdf);
          }
          if (pdf.state < PdfState.COMPLETE
          && !this.receiveTaskMap.has(item.identifier)
          && FileReceiveScheduler.canEnqueueReceive('pdf', item.identifier)) {
            request.push({ identifier: item.identifier, state: pdf.state });
          }
        }
        if (request.length < 1 && !this.hasActiveTask() && otherCatalog.length < PdfStorage.instance.getCatalog().length) {
          PdfStorage.instance.synchronize(event.sendFrom);
        }
        if (request.length < 1) return;
        void this.queueMissingDownloads(request, event.sendFrom, otherCatalog);
      })
      .on('REQUEST_PDF_RESOURE', event => {
        if (event.isSendFromSelf) return;
        const request: PdfCatalogItem[] = event.data.identifiers;
        const randomRequest: PdfCatalogItem[] = [];
        for (const item of request) {
          const pdf = PdfStorage.instance.get(item.identifier);
          if (pdf && item.state < pdf.state) randomRequest.push({ identifier: item.identifier, state: item.state });
        }
        if (!this.isLimitSendTask() && randomRequest.length) {
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
    const taskKey = this.sendTaskKey(sendTo, pdf.identifier);
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

  private sendTaskKey(sendTo: string, identifier: string): string {
    return `${sendTo}:${identifier}`;
  }

  private existsSendTask(peerId: string): boolean {
    for (const task of this.sendTaskMap.values()) {
      if (task && task.sendTo === peerId) return true;
    }
    return false;
  }

  private stopReceiveTask(identifier: string) {
    const task = this.receiveTaskMap.get(identifier);
    if (task) task.cancel();
    this.receiveTaskMap.delete(identifier);
    FileReceiveScheduler.markReceiveEnd('pdf', identifier);
  }

  ensureRoomDownloads(catalogsByPeer: Map<string, PdfCatalogItem[]>) {
    for (const [peerId, catalog] of catalogsByPeer) {
      if (!Network.peerIds.includes(peerId) || !catalog?.length) continue;
      const request: PdfCatalogItem[] = [];
      for (const item of catalog) {
        if (this.hydrateUrlBackedIfNeeded(item)) continue;
        let pdf = PdfStorage.instance.get(item.identifier);
        if (pdf === null) {
          pdf = PdfFile.createEmpty(item.identifier);
          PdfStorage.instance.add(pdf);
        }
        if (pdf.state < PdfState.COMPLETE
          && !this.receiveTaskMap.has(item.identifier)
          && FileReceiveScheduler.canEnqueueReceive('pdf', item.identifier)) {
          request.push({ identifier: item.identifier, state: pdf.state });
        }
      }
      if (request.length) void this.queueMissingDownloads(request, peerId, catalog);
    }
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

  private queueMissingDownloads(request: PdfCatalogItem[], peerId: string, catalogMeta: PdfCatalogItem[]) {
    const metaById = new Map(catalogMeta.map(item => [item.identifier, item]));
    const sorted = FileReceiveScheduler.sortByNextReceiveBytes('pdf', request, item => {
      const pdf = PdfStorage.instance.get(item.identifier);
      return pdf?.state ?? PdfState.NULL;
    });
    FolderMediaHydrator.instance.beginHydrateMissing('pdf', sorted.map(item => item.identifier));
    for (const item of sorted) {
      const pdf = PdfStorage.instance.get(item.identifier);
      const localState = pdf?.state ?? PdfState.NULL;
      if (localState >= PdfState.COMPLETE) continue;
      const meta = metaById.get(item.identifier) ?? item;
      const bytes = estimateNextReceiveBytes('pdf', localState, meta);
      FileReceiveScheduler.enqueueReceiveRequest('pdf', peerId, item.identifier, bytes, () => {
        this.request([{ identifier: item.identifier, state: localState }], peerId);
      });
    }
  }

  private request(request: PdfCatalogItem[], peerId: string) {
    const identifier = request[0]?.identifier;
    if (!Network.peerIds.includes(peerId)) {
      if (identifier) FileReceiveScheduler.abortOutboundRequest('pdf', identifier);
      meshWarnThrottled(`pdf-skip-${peerId.slice(0, 12)}`,
        'pdf request skipped (peer not open)', peerId.slice(0, 16));
      PdfStorage.instance.lazySynchronize(1500, peerId);
      return;
    }
    EventSystem.call('REQUEST_PDF_RESOURE', {
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
}
