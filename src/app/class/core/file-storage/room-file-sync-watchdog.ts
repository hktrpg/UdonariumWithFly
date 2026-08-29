import { EventSystem, Network } from '../system';
import { netDebug } from '../system/network/net-debug';
import { AudioSharingSystem } from './audio-sharing-system';
import { AudioState } from './audio-file';
import { AudioStorage } from './audio-storage';
import { TransferCatalogMeta, FileReceiveScheduler, FileResourceKind } from './file-transfer-scheduler';
import { ImageSharingSystem } from './image-sharing-system';
import { ImageState } from './image-file';
import { ImageStorage } from './image-storage';
import { PdfSharingSystem } from './pdf-sharing-system';
import { PdfState } from './pdf-file';
import { PdfStorage } from './pdf-storage';
import { VideoSharingSystem } from './video-sharing-system';
import { VideoState } from './video-file';
import { VideoStorage } from './video-storage';
import { FolderMediaHydrator } from 'service/folder-media-hydrator';

const TICK_WHILE_INCOMPLETE_MS = 3_000;
const TICK_IDLE_MS = 8_000;
const CATALOG_REPLY_COOLDOWN_MS = 2_500;

type SyncListEvent =
  | 'SYNCHRONIZE_FILE_LIST'
  | 'SYNCHRONIZE_AUDIO_LIST'
  | 'SYNCHRONIZE_PDF_LIST'
  | 'SYNCHRONIZE_VIDEO_LIST';

interface RoomSyncKindBinding {
  kind: FileResourceKind;
  listEvent: SyncListEvent;
  catalogs: Map<string, TransferCatalogMeta[]>;
  synchronize: (peerId: string) => void;
  ensureRoomDownloads: (catalogsByPeer: Map<string, TransferCatalogMeta[]>) => void;
  hasIncomplete: () => boolean;
}

export class RoomFileSyncWatchdog {
  private static _instance: RoomFileSyncWatchdog;
  static get instance(): RoomFileSyncWatchdog {
    if (!RoomFileSyncWatchdog._instance) RoomFileSyncWatchdog._instance = new RoomFileSyncWatchdog();
    return RoomFileSyncWatchdog._instance;
  }

  private timer: ReturnType<typeof setTimeout> | null = null;
  private lastCatalogReply = new Map<string, number>();
  private readonly kinds: RoomSyncKindBinding[] = [
    {
      kind: 'image',
      listEvent: 'SYNCHRONIZE_FILE_LIST',
      catalogs: new Map(),
      synchronize: peerId => ImageStorage.instance.synchronize(peerId),
      ensureRoomDownloads: catalogs => ImageSharingSystem.instance.ensureRoomDownloads(catalogs),
      hasIncomplete: () => ImageStorage.instance.images.some(f => f.state < ImageState.COMPLETE),
    },
    {
      kind: 'audio',
      listEvent: 'SYNCHRONIZE_AUDIO_LIST',
      catalogs: new Map(),
      synchronize: peerId => AudioStorage.instance.synchronize(peerId),
      ensureRoomDownloads: catalogs => AudioSharingSystem.instance.ensureRoomDownloads(catalogs),
      hasIncomplete: () => AudioStorage.instance.audios.some(f => f.state < AudioState.COMPLETE),
    },
    {
      kind: 'pdf',
      listEvent: 'SYNCHRONIZE_PDF_LIST',
      catalogs: new Map(),
      synchronize: peerId => PdfStorage.instance.synchronize(peerId),
      ensureRoomDownloads: catalogs => PdfSharingSystem.instance.ensureRoomDownloads(catalogs),
      hasIncomplete: () => PdfStorage.instance.pdfs.some(f => f.state < PdfState.COMPLETE),
    },
    {
      kind: 'video',
      listEvent: 'SYNCHRONIZE_VIDEO_LIST',
      catalogs: new Map(),
      synchronize: peerId => VideoStorage.instance.synchronize(peerId),
      ensureRoomDownloads: catalogs => VideoSharingSystem.instance.ensureRoomDownloads(catalogs),
      hasIncomplete: () => VideoStorage.instance.videos.some(f => f.state < VideoState.COMPLETE),
    },
  ];

  private constructor() { }

  initialize() {
    EventSystem.unregister(this);
    let registration = EventSystem.register(this)
      .on('OPEN_NETWORK', () => this.scheduleTick(500))
      .on('CONNECT_PEER', () => {
        FileReceiveScheduler.schedule();
        this.scheduleTick(300);
      })
      .on('DISCONNECT_PEER', event => {
        this.forgetPeer(event.data.peerId);
        this.scheduleTick(500);
      });
    for (const binding of this.kinds) {
      registration = registration.on(binding.listEvent, event => {
        if (event.isSendFromSelf) return;
        binding.catalogs.set(event.sendFrom, event.data);
        this.maybeReplyCatalog(binding, event.sendFrom);
      });
    }
    this.scheduleTick(2000);
  }

  private forgetPeer(peerId: string) {
    for (const binding of this.kinds) {
      binding.catalogs.delete(peerId);
    }
    for (const key of this.lastCatalogReply.keys()) {
      if (key.endsWith(`:${peerId}`)) this.lastCatalogReply.delete(key);
    }
  }

  private maybeReplyCatalog(binding: RoomSyncKindBinding, peerId: string) {
    const key = `${binding.kind}:${peerId}`;
    const now = performance.now();
    const last = this.lastCatalogReply.get(key);
    if (last != null && now - last < CATALOG_REPLY_COOLDOWN_MS) return;
    this.lastCatalogReply.set(key, now);
    binding.synchronize(peerId);
  }

  private scheduleTick(ms: number) {
    if (this.timer != null) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.tick(), ms);
  }

  private tick() {
    this.timer = null;
    if (!Network.isOpen) {
      this.scheduleTick(TICK_IDLE_MS);
      return;
    }

    // Solo rooms still need media/ rehydrate when blobs were dropped from memory.
    FolderMediaHydrator.instance.beginHydrateRoomReferencedMedia();

    if (Network.peerIds.length < 1) {
      this.scheduleTick(TICK_IDLE_MS);
      return;
    }

    if (!this.hasIncompleteAssets()) {
      this.scheduleTick(TICK_IDLE_MS);
      return;
    }

    for (const peerId of Network.peerIds) {
      for (const binding of this.kinds) {
        binding.synchronize(peerId);
      }
    }

    for (const binding of this.kinds) {
      binding.ensureRoomDownloads(binding.catalogs);
    }

    netDebug('room file sync watchdog: incomplete assets, will retry');
    this.scheduleTick(TICK_WHILE_INCOMPLETE_MS);
  }

  private hasIncompleteAssets(): boolean {
    return this.kinds.some(binding => binding.hasIncomplete());
  }
}
