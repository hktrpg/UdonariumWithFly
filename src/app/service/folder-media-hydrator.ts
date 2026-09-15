import { AudioState } from '@udonarium/core/file-storage/audio-file';
import { AudioStorage } from '@udonarium/core/file-storage/audio-storage';
import { FileArchiver } from '@udonarium/core/file-storage/file-archiver';
import { FileReceiveScheduler, FileResourceKind } from '@udonarium/core/file-storage/file-transfer-scheduler';
import { ImageState } from '@udonarium/core/file-storage/image-file';
import { ImageStorage } from '@udonarium/core/file-storage/image-storage';
import { MimeType } from '@udonarium/core/file-storage/mime-type';
import { PdfState } from '@udonarium/core/file-storage/pdf-file';
import { PdfStorage } from '@udonarium/core/file-storage/pdf-storage';
import { VideoState } from '@udonarium/core/file-storage/video-file';
import { VideoStorage } from '@udonarium/core/file-storage/video-storage';
import { Network } from '@udonarium/core/system';
import { collectRoomMediaRefs } from '@udonarium/core/file-storage/room-media-refs';
import { getResourcePolicy } from '@udonarium/core/file-storage/resource-policy';
import { FolderBackupService } from './folder-backup.service';
import { isContentHashIdentifier, isMediaFileName, mediaHashFromName } from './folder-backup-layout';

export class FolderMediaHydrator {
  private static _instance: FolderMediaHydrator;
  static get instance(): FolderMediaHydrator {
    if (!FolderMediaHydrator._instance) FolderMediaHydrator._instance = new FolderMediaHydrator();
    return FolderMediaHydrator._instance;
  }

  private index: Map<string, string> | null = null;
  private indexPromise: Promise<Map<string, string>> | null = null;
  private readonly inFlight = new Map<string, Promise<boolean>>();
  private roomHydratePromise: Promise<void> | null = null;

  private constructor() { }

  static invalidateIndex(): void {
    FolderMediaHydrator.instance.index = null;
    FolderMediaHydrator.instance.indexPromise = null;
  }

  warmIndex(): void {
    if (!this.canHydrate()) return;
    void this.ensureIndex();
  }

  canHydrate(): boolean {
    const backup = FolderBackupService.instance;
    return !!backup?.isReady && !Network.GuestMode();
  }

  private isComplete(kind: FileResourceKind, identifier: string): boolean {
    switch (kind) {
      case 'image': {
        const image = ImageStorage.instance.get(identifier);
        return !!image && image.state >= ImageState.COMPLETE;
      }
      case 'audio': {
        const audio = AudioStorage.instance.get(identifier);
        return !!audio && audio.state >= AudioState.COMPLETE;
      }
      case 'pdf': {
        const pdf = PdfStorage.instance.get(identifier);
        return !!pdf && pdf.state >= PdfState.COMPLETE;
      }
      case 'video': {
        const video = VideoStorage.instance.get(identifier);
        return !!video && video.state >= VideoState.COMPLETE;
      }
    }
  }

  private async ensureIndex(): Promise<Map<string, string>> {
    if (this.index) return this.index;
    if (this.indexPromise) return this.indexPromise;
    this.indexPromise = this.buildIndex().finally(() => {
      this.indexPromise = null;
    });
    this.index = await this.indexPromise;
    return this.index;
  }

  private async buildIndex(): Promise<Map<string, string>> {
    const map = new Map<string, string>();
    const mediaDir = await FolderBackupService.instance?.getMediaDirectoryHandle();
    if (!mediaDir) return map;
    try {
      for await (const [name, handle] of mediaDir.entries()) {
        if (handle.kind !== 'file') continue;
        if (!isMediaFileName(name)) continue;
        const hash = mediaHashFromName(name);
        if (!isContentHashIdentifier(hash)) continue;
        if (!map.has(hash)) map.set(hash, name);
      }
    } catch (e) {
      console.warn('FolderMediaHydrator index build failed', e);
    }
    return map;
  }

  async findFileName(hash: string): Promise<string | null> {
    if (!hash) return null;
    const index = await this.ensureIndex();
    return index.get(hash.toLowerCase()) ?? null;
  }

  async hydrate(kind: FileResourceKind, identifier: string): Promise<boolean> {
    const id = (identifier || '').toLowerCase();
    if (!id || !isContentHashIdentifier(id) || !this.canHydrate()) return false;
    if (this.isLibraryDeleted(id)) return false;
    if (this.isComplete(kind, id)) return true;

    const key = `${kind}:${id}`;
    const pending = this.inFlight.get(key);
    if (pending) return pending;

    const work = this.hydrateInner(kind, id);
    this.inFlight.set(key, work);
    try {
      return await work;
    } finally {
      this.inFlight.delete(key);
    }
  }

  private isCompleteAny(identifier: string): boolean {
    return this.isComplete('image', identifier)
      || this.isComplete('audio', identifier)
      || this.isComplete('pdf', identifier)
      || this.isComplete('video', identifier);
  }

  private isLibraryDeleted(identifier: string): boolean {
    return ImageStorage.instance.isDeleted(identifier) || AudioStorage.instance.isDeleted(identifier);
  }

  private async importMediaByHash(identifier: string): Promise<boolean> {
    if (this.isLibraryDeleted(identifier)) return false;
    const fileName = await this.findFileName(identifier);
    if (!fileName || this.isLibraryDeleted(identifier)) return false;

    const mediaDir = await FolderBackupService.instance?.getMediaDirectoryHandle();
    if (!mediaDir || this.isLibraryDeleted(identifier)) return false;

    try {
      const raw = await (await mediaDir.getFileHandle(fileName)).getFile();
      if (this.isLibraryDeleted(identifier)) return false;
      const type = MimeType.type(fileName) || raw.type || '';
      const file = new File([raw], fileName, { type });
      if (this.isLibraryDeleted(identifier)) return false;
      await FileArchiver.instance.importMediaFile(file);
    } catch (e) {
      console.warn('FolderMediaHydrator hydrate failed', fileName, e);
      return false;
    }
    return !this.isLibraryDeleted(identifier);
  }

  private async hydrateInner(kind: FileResourceKind, identifier: string): Promise<boolean> {
    if (this.isComplete(kind, identifier)) return true;
    if (!await this.importMediaByHash(identifier)) return false;
    return this.isComplete(kind, identifier);
  }

  private async hydrateFromDisk(identifier: string): Promise<boolean> {
    const id = (identifier || '').toLowerCase();
    if (!id || !isContentHashIdentifier(id) || !this.canHydrate()) return false;
    if (this.isLibraryDeleted(id)) return false;
    if (this.isCompleteAny(id)) return true;

    const key = `disk:${id}`;
    const pending = this.inFlight.get(key);
    if (pending) return pending;

    const work = (async () => {
      if (this.isCompleteAny(id)) return true;
      if (!await this.importMediaByHash(id)) return false;
      return this.isCompleteAny(id);
    })();
    this.inFlight.set(key, work);
    try {
      return await work;
    } finally {
      this.inFlight.delete(key);
    }
  }

  async hydrateMissing(kind: FileResourceKind, identifiers: string[]): Promise<void> {
    await this.hydratePool(identifiers, id => this.hydrate(kind, id));
  }

  private async hydrateMissingFromDisk(identifiers: string[]): Promise<void> {
    await this.hydratePool(identifiers, id => this.hydrateFromDisk(id));
  }

  private async hydratePool(
    identifiers: string[],
    hydrateOne: (id: string) => Promise<boolean>,
  ): Promise<void> {
    const unique = [...new Set(
      identifiers.filter(id => isContentHashIdentifier(id)).map(id => id.toLowerCase()),
    )];
    if (unique.length < 1 || !this.canHydrate()) return;

    let cursor = 0;
    const worker = async () => {
      while (cursor < unique.length) {
        const id = unique[cursor++];
        await hydrateOne(id);
      }
    };
    const workers = Math.min(getResourcePolicy().maxConcurrentHydrate, unique.length);
    await Promise.all(Array.from({ length: workers }, () => worker()));
  }

  /** Hydrate from folder backup without blocking peer download enqueue. */
  beginHydrateMissing(kind: FileResourceKind, identifiers: string[]): void {
    void this.hydrateMissing(kind, identifiers).finally(() => {
      FileReceiveScheduler.scheduleDeferred();
    });
  }

  /**
   * Restore any room-referenced blobs that are incomplete in memory but still
   * present under media/ (covers manifest shrink / peer-join races).
   */
  async hydrateRoomReferencedMedia(): Promise<void> {
    if (!this.canHydrate()) return;
    if (this.roomHydratePromise) return this.roomHydratePromise;
    this.roomHydratePromise = this.hydrateRoomReferencedMediaInner().finally(() => {
      this.roomHydratePromise = null;
    });
    return this.roomHydratePromise;
  }

  beginHydrateRoomReferencedMedia(): void {
    void this.hydrateRoomReferencedMedia().finally(() => {
      FileReceiveScheduler.scheduleDeferred();
    });
  }

  private collectRoomReferenced(): { image: string[]; pdf: string[]; video: string[]; audio: string[] } {
    const refs = collectRoomMediaRefs();
    const missing = (kind: FileResourceKind, ids: string[]) =>
      ids.filter(id => isContentHashIdentifier(id) && !this.isComplete(kind, id));
    return {
      image: missing('image', refs.image),
      pdf: missing('pdf', refs.pdf),
      video: missing('video', refs.video),
      audio: missing('audio', refs.audio),
    };
  }

  private async hydrateRoomReferencedMediaInner(): Promise<void> {
    const refs = this.collectRoomReferenced();
    await this.hydrateMissingFromDisk([
      ...refs.image,
      ...refs.pdf,
      ...refs.video,
      ...refs.audio,
    ]);
  }
}
