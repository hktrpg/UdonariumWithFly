import { AudioState } from '@udonarium/core/file-storage/audio-file';
import { AudioStorage } from '@udonarium/core/file-storage/audio-storage';
import { FileArchiver } from '@udonarium/core/file-storage/file-archiver';
import { FileResourceKind } from '@udonarium/core/file-storage/file-transfer-scheduler';
import { ImageState } from '@udonarium/core/file-storage/image-file';
import { ImageStorage } from '@udonarium/core/file-storage/image-storage';
import { MimeType } from '@udonarium/core/file-storage/mime-type';
import { PdfState } from '@udonarium/core/file-storage/pdf-file';
import { PdfStorage } from '@udonarium/core/file-storage/pdf-storage';
import { VideoState } from '@udonarium/core/file-storage/video-file';
import { VideoStorage } from '@udonarium/core/file-storage/video-storage';
import { Network } from '@udonarium/core/system';

import { FolderBackupService } from './folder-backup.service';
import { isContentHashIdentifier, isMediaFileName, mediaHashFromName } from './folder-backup-layout';

const MAX_CONCURRENT_HYDRATE = 4;

export class FolderMediaHydrator {
  private static _instance: FolderMediaHydrator;
  static get instance(): FolderMediaHydrator {
    if (!FolderMediaHydrator._instance) FolderMediaHydrator._instance = new FolderMediaHydrator();
    return FolderMediaHydrator._instance;
  }

  private index: Map<string, string> | null = null;
  private indexPromise: Promise<Map<string, string>> | null = null;
  private readonly inFlight = new Map<string, Promise<boolean>>();

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

  private async hydrateInner(kind: FileResourceKind, identifier: string): Promise<boolean> {
    if (this.isComplete(kind, identifier)) return true;

    const fileName = await this.findFileName(identifier);
    if (!fileName) return false;

    const mediaDir = await FolderBackupService.instance?.getMediaDirectoryHandle();
    if (!mediaDir) return false;

    try {
      const raw = await (await mediaDir.getFileHandle(fileName)).getFile();
      const type = MimeType.type(fileName) || raw.type || '';
      const file = new File([raw], fileName, { type });
      await FileArchiver.instance.importMediaFile(file);
    } catch (e) {
      console.warn('FolderMediaHydrator hydrate failed', fileName, e);
      return false;
    }

    return this.isComplete(kind, identifier);
  }

  async hydrateMissing(kind: FileResourceKind, identifiers: string[]): Promise<void> {
    const unique = [...new Set(
      identifiers.filter(id => isContentHashIdentifier(id)).map(id => id.toLowerCase()),
    )];
    if (unique.length < 1 || !this.canHydrate()) return;

    let cursor = 0;
    const worker = async () => {
      while (cursor < unique.length) {
        const id = unique[cursor++];
        await this.hydrate(kind, id);
      }
    };
    const workers = Math.min(MAX_CONCURRENT_HYDRATE, unique.length);
    await Promise.all(Array.from({ length: workers }, () => worker()));
  }
}
