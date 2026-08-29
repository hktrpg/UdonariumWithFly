import { Network } from '../system';
import { FolderMediaHydrator } from 'service/folder-media-hydrator';
import {
  estimateNextReceiveBytes,
  FileReceiveScheduler,
  FileResourceKind,
  TransferCatalogMeta,
} from './file-transfer-scheduler';

export type MissingCatalogItem = TransferCatalogMeta;

export interface MissingDownloadCollector {
  kind: FileResourceKind;
  completeState: number;
  nullState: number;
  isReceiving: (identifier: string) => boolean;
  /** Current local state, or null if the slot does not exist yet. */
  getLocalState: (identifier: string) => number | null;
  ensurePlaceholder: (identifier: string) => void;
  hydrateUrlBacked: (item: MissingCatalogItem) => boolean;
}

export interface MissingDownloadQueuer extends Pick<
  MissingDownloadCollector,
  'kind' | 'completeState' | 'nullState' | 'getLocalState'
> {
  requestOne: (identifier: string, localState: number, peerId: string) => void;
}

export interface MissingDownloadHooks extends MissingDownloadCollector, MissingDownloadQueuer {}

/** Collect incomplete local files from a peer catalog (SYNCHRONIZE / ensureRoomDownloads). */
export function collectMissingDownloadRequests(
  catalog: MissingCatalogItem[],
  hooks: MissingDownloadCollector,
): Array<{ identifier: string; state: number }> {
  const request: Array<{ identifier: string; state: number }> = [];
  for (const item of catalog) {
    if (hooks.hydrateUrlBacked(item)) continue;
    let localState = hooks.getLocalState(item.identifier);
    if (localState === null) {
      hooks.ensurePlaceholder(item.identifier);
      localState = hooks.getLocalState(item.identifier) ?? hooks.nullState;
    }
    if (localState < hooks.completeState
      && !hooks.isReceiving(item.identifier)
      && FileReceiveScheduler.canEnqueueReceive(hooks.kind, item.identifier)) {
      request.push({ identifier: item.identifier, state: localState });
    }
  }
  return request;
}

/** Enqueue P2P receives for collected missing files (priority sort + folder hydrate). */
export function queueMissingDownloads(
  request: Array<{ identifier: string; state: number }>,
  peerId: string,
  catalogMeta: MissingCatalogItem[],
  hooks: MissingDownloadQueuer,
): void {
  const metaById = new Map(catalogMeta.map(item => [item.identifier, item]));
  const sorted = FileReceiveScheduler.sortByNextReceiveBytes(hooks.kind, request, item => {
    return hooks.getLocalState(item.identifier) ?? hooks.nullState;
  });
  FolderMediaHydrator.instance.beginHydrateMissing(
    hooks.kind,
    sorted.map(item => item.identifier),
  );
  for (const item of sorted) {
    const localState = hooks.getLocalState(item.identifier) ?? hooks.nullState;
    if (localState >= hooks.completeState) continue;
    const meta = metaById.get(item.identifier) ?? item;
    const bytes = estimateNextReceiveBytes(hooks.kind, localState, meta);
    FileReceiveScheduler.enqueueReceiveRequest(
      hooks.kind,
      peerId,
      item.identifier,
      bytes,
      () => hooks.requestOne(item.identifier, localState, peerId),
    );
  }
}

/** For each open peer catalog, collect missing files and queue downloads. */
export function ensureRoomMissingDownloads(
  catalogsByPeer: Map<string, MissingCatalogItem[]>,
  hooks: MissingDownloadHooks,
): void {
  for (const [peerId, catalog] of catalogsByPeer) {
    if (!Network.peerIds.includes(peerId) || !catalog?.length) continue;
    const request = collectMissingDownloadRequests(catalog, hooks);
    if (request.length) queueMissingDownloads(request, peerId, catalog, hooks);
  }
}
