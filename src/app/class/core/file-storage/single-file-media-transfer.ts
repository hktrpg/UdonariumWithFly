import { EventSystem, Network } from '../system';
import { BufferSharingTask } from './buffer-sharing-task';
import { FileReaderUtil } from './file-reader-util';
import { FileReceiveScheduler, FileResourceKind } from './file-transfer-scheduler';
import { isSendTaskLimitReached, mediaSendTaskKey } from './media-sharing-helpers';
import { finishMediaReceiveTask } from './receive-task-finish';
import { StartTransmissionDeclineGate } from './start-transmission-decline';

export interface CatalogIdState {
  identifier: string;
  state: number;
}

/** A/P/V REQUEST_*: send one upgradable file, else relay to another open peer. */
export function fulfillOrRelaySingleFileRequest(options: {
  kind: FileResourceKind;
  identifiers: CatalogIdState[];
  receiver: string;
  candidatePeers: string[];
  sendTaskCount: number;
  getLocalState: (identifier: string) => number | null;
  startSend: (identifier: string, receiver: string) => void;
  relayTo: (peerId: string) => void;
  onSend?: (receiver: string, identifier: string) => void;
  onRelay?: (peerId: string) => void;
  onOverflow?: (receiver: string, pendingCount: number) => void;
}): void {
  const upgradable: CatalogIdState[] = [];
  for (const item of options.identifiers) {
    const localState = options.getLocalState(item.identifier);
    if (localState != null && item.state < localState) {
      upgradable.push({ identifier: item.identifier, state: item.state });
    }
  }

  if (!isSendTaskLimitReached(options.sendTaskCount) && upgradable.length) {
    const sorted = FileReceiveScheduler.sortByNextReceiveBytes(
      options.kind,
      upgradable,
      item => item.state,
    );
    const item = sorted[0];
    if (item) {
      options.onSend?.(options.receiver, item.identifier);
      options.startSend(item.identifier, options.receiver);
    }
    return;
  }

  const candidatePeers = options.candidatePeers.filter(id => Network.peerIds.includes(id));
  const selfIndex = candidatePeers.indexOf(Network.peerId);
  if (-1 < selfIndex) candidatePeers.splice(selfIndex, 1);
  for (const peerId of candidatePeers) {
    options.onRelay?.(peerId);
    options.relayTo(peerId);
    return;
  }
  options.onOverflow?.(options.receiver, upgradable.length);
}

/** START_*_TRANSMISSION: decline if complete, else start receive. */
export function acceptOrDeclineStartTransmission(options: {
  identifier: string;
  sendFrom: string;
  isReceiving: boolean;
  localState: number | null;
  completeState: number;
  declineGate: StartTransmissionDeclineGate;
  startReceive: (identifier: string, sendFrom: string) => void;
}): void {
  if (options.isReceiving) return;
  if (options.localState != null && options.completeState <= options.localState) {
    options.declineGate.cancelRedundantStart(options.sendFrom, options.identifier);
    return;
  }
  options.startReceive(options.identifier, options.sendFrom);
}

export async function startSingleFileSendTask<TContext>(options: {
  identifier: string;
  sendTo: string;
  sendTaskMap: Map<string, BufferSharingTask<TContext>>;
  startEventName: string;
  buildContext: () => Promise<TContext>;
  synchronize: () => void;
  /** pdf/video always remesh; audio only after successful send. */
  synchronizeWhen: 'always' | 'success';
}): Promise<void> {
  const taskKey = mediaSendTaskKey(options.sendTo, options.identifier);
  if (options.sendTaskMap.has(taskKey)) return;

  const task = BufferSharingTask.createSendTask<TContext>(options.identifier, options.sendTo);
  options.sendTaskMap.set(taskKey, task);
  EventSystem.call(options.startEventName, { fileIdentifier: options.identifier }, options.sendTo);

  let context: TContext;
  try {
    context = await options.buildContext();
  } catch (err) {
    task.cancel();
    options.sendTaskMap.delete(taskKey);
    throw err;
  }
  task.onfinish = () => {
    options.sendTaskMap.delete(taskKey);
    if (options.synchronizeWhen === 'always' || task.didCompleteSuccessfully) {
      options.synchronize();
    }
  };
  task.start(context);
}

/** Shared blob/url context packing for A/P/V send. */
export async function buildBlobOrUrlSendContext(options: {
  identifier: string;
  name: string;
  state: number;
  urlState: number;
  url: string | null;
  blob: Blob | null;
  defaultMime?: string;
}): Promise<{ identifier: string; name: string; blob: any; type: string; url: string | null }> {
  const context = {
    identifier: options.identifier,
    name: options.name,
    blob: null as any,
    type: '',
    url: null as string | null,
  };
  if (options.state === options.urlState) {
    context.url = options.url;
    return context;
  }
  context.blob = <any>await FileReaderUtil.readAsArrayBufferAsync(options.blob);
  context.type = options.blob?.type || options.defaultMime || '';
  return context;
}

export function startSingleFileReceiveTask<TContext>(options: {
  kind: FileResourceKind;
  identifier: string;
  fromPeerId: string | undefined;
  receiveTaskMap: Map<string, BufferSharingTask<TContext>>;
  applyProgress: (loaded: number, total: number) => void;
  updateEventName: string;
  lazySynchronize: (ms: number) => void;
  stopReceiveTask: (identifier: string) => void;
  onStarted?: () => void;
}): void {
  FileReceiveScheduler.markReceiveStart(options.kind, options.identifier);
  const task = BufferSharingTask.createReceiveTask<TContext>(options.identifier, options.fromPeerId);
  options.receiveTaskMap.set(options.identifier, task);
  task.onprogress = (_task, loaded, total) => {
    options.applyProgress(loaded, total);
  };
  task.onfinish = (finished, data) => {
    finishMediaReceiveTask(options.kind, finished, data, {
      stopReceiveTask: options.stopReceiveTask,
      onSuccess: payload => EventSystem.trigger(options.updateEventName, [payload]),
      lazySynchronize: options.lazySynchronize,
    });
  };
  task.start();
  options.onStarted?.();
}

/** After structured-clone / peer transfer, rebuild Blob so MIME type sticks. */
export function repackTransferredBlob(
  blob: Blob | null | undefined,
  type: string | undefined,
  defaultMime = '',
): Blob | null | undefined {
  if (!blob) return blob;
  return new Blob([blob], { type: type || defaultMime });
}

/** APPLY UPDATE_* contexts: repack blobs then add to storage. */
export function applyBlobContextsToStorage<T extends { blob?: Blob | null; type?: string }>(
  contexts: T[],
  add: (ctx: T) => void,
  defaultMime = '',
): void {
  for (const context of contexts) {
    if (context.blob) {
      context.blob = repackTransferredBlob(context.blob, context.type, defaultMime) as Blob;
    }
    add(context);
  }
}

/** Apply download percent into a media object's display name. */
export function applyReceiveProgressPercent(
  media: { toContext(): { name: string }; apply(context: { name: string }): void },
  loaded: number,
  total: number,
): void {
  const context = media.toContext();
  context.name = (loaded * 100 / total).toFixed(1) + '%';
  media.apply(context);
}
