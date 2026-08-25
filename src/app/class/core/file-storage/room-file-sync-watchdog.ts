import { EventSystem, Network } from '../system';
import { netDebug } from '../system/network/net-debug';
import { AudioSharingSystem } from './audio-sharing-system';
import { AudioState } from './audio-file';
import { AudioStorage } from './audio-storage';
import { TransferCatalogMeta, FileReceiveScheduler } from './file-transfer-scheduler';
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

export class RoomFileSyncWatchdog {
  private static _instance: RoomFileSyncWatchdog;
  static get instance(): RoomFileSyncWatchdog {
    if (!RoomFileSyncWatchdog._instance) RoomFileSyncWatchdog._instance = new RoomFileSyncWatchdog();
    return RoomFileSyncWatchdog._instance;
  }

  private timer: ReturnType<typeof setTimeout> | null = null;
  private remoteImageCatalogs = new Map<string, TransferCatalogMeta[]>();
  private remoteAudioCatalogs = new Map<string, TransferCatalogMeta[]>();
  private remotePdfCatalogs = new Map<string, TransferCatalogMeta[]>();
  private remoteVideoCatalogs = new Map<string, TransferCatalogMeta[]>();
  private lastCatalogReply = new Map<string, number>();

  private constructor() { }

  initialize() {
    EventSystem.unregister(this);
    EventSystem.register(this)
      .on('OPEN_NETWORK', () => this.scheduleTick(500))
      .on('CONNECT_PEER', () => {
        FileReceiveScheduler.schedule();
        this.scheduleTick(300);
      })
      .on('DISCONNECT_PEER', event => {
        this.forgetPeer(event.data.peerId);
        this.scheduleTick(500);
      })
      .on('SYNCHRONIZE_FILE_LIST', event => {
        if (event.isSendFromSelf) return;
        this.remoteImageCatalogs.set(event.sendFrom, event.data);
        this.maybeReplyCatalog('image', event.sendFrom);
      })
      .on('SYNCHRONIZE_AUDIO_LIST', event => {
        if (event.isSendFromSelf) return;
        this.remoteAudioCatalogs.set(event.sendFrom, event.data);
        this.maybeReplyCatalog('audio', event.sendFrom);
      })
      .on('SYNCHRONIZE_PDF_LIST', event => {
        if (event.isSendFromSelf) return;
        this.remotePdfCatalogs.set(event.sendFrom, event.data);
        this.maybeReplyCatalog('pdf', event.sendFrom);
      })
      .on('SYNCHRONIZE_VIDEO_LIST', event => {
        if (event.isSendFromSelf) return;
        this.remoteVideoCatalogs.set(event.sendFrom, event.data);
        this.maybeReplyCatalog('video', event.sendFrom);
      });
    this.scheduleTick(2000);
  }

  private forgetPeer(peerId: string) {
    this.remoteImageCatalogs.delete(peerId);
    this.remoteAudioCatalogs.delete(peerId);
    this.remotePdfCatalogs.delete(peerId);
    this.remoteVideoCatalogs.delete(peerId);
    for (const key of this.lastCatalogReply.keys()) {
      if (key.endsWith(`:${peerId}`)) this.lastCatalogReply.delete(key);
    }
  }

  private maybeReplyCatalog(kind: 'image' | 'audio' | 'pdf' | 'video', peerId: string) {
    const key = `${kind}:${peerId}`;
    const now = performance.now();
    if (now - (this.lastCatalogReply.get(key) ?? 0) < CATALOG_REPLY_COOLDOWN_MS) return;
    this.lastCatalogReply.set(key, now);
    switch (kind) {
      case 'image': ImageStorage.instance.synchronize(peerId); break;
      case 'audio': AudioStorage.instance.synchronize(peerId); break;
      case 'pdf': PdfStorage.instance.synchronize(peerId); break;
      case 'video': VideoStorage.instance.synchronize(peerId); break;
    }
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

    const incomplete = this.hasIncompleteAssets();
    if (!incomplete) {
      this.scheduleTick(TICK_IDLE_MS);
      return;
    }

    for (const peerId of Network.peerIds) {
      ImageStorage.instance.synchronize(peerId);
      AudioStorage.instance.synchronize(peerId);
      PdfStorage.instance.synchronize(peerId);
      VideoStorage.instance.synchronize(peerId);
    }

    ImageSharingSystem.instance.ensureRoomDownloads(this.remoteImageCatalogs);
    AudioSharingSystem.instance.ensureRoomDownloads(this.remoteAudioCatalogs);
    PdfSharingSystem.instance.ensureRoomDownloads(this.remotePdfCatalogs);
    VideoSharingSystem.instance.ensureRoomDownloads(this.remoteVideoCatalogs);

    netDebug('room file sync watchdog: incomplete assets, will retry');
    this.scheduleTick(TICK_WHILE_INCOMPLETE_MS);
  }

  private hasIncompleteAssets(): boolean {
    for (const image of ImageStorage.instance.images) {
      if (image.state < ImageState.COMPLETE) return true;
    }
    for (const audio of AudioStorage.instance.audios) {
      if (audio.state < AudioState.COMPLETE) return true;
    }
    for (const pdf of PdfStorage.instance.pdfs) {
      if (pdf.state < PdfState.COMPLETE) return true;
    }
    for (const video of VideoStorage.instance.videos) {
      if (video.state < VideoState.COMPLETE) return true;
    }
    return false;
  }
}
