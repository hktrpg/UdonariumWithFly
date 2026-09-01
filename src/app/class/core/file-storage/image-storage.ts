import { EventSystem } from '../system';
import { ResettableTimeout } from '../system/util/resettable-timeout';
import { catalogByteSize } from './file-transfer-scheduler';
import { ImageContext, ImageFile, ImageState } from './image-file';
import { getOrHydrateUrlBacked } from './media-storage-helpers';
import { isContentHashIdentifier, mediaHashFromName } from 'service/folder-backup-layout';

export type CatalogItem = {
  readonly identifier: string;
  readonly state: number;
  readonly byteSize?: number;
  readonly thumbBytes?: number;
};

export class ImageStorage {
  private static _instance: ImageStorage
  static get instance(): ImageStorage {
    if (!ImageStorage._instance) ImageStorage._instance = new ImageStorage();
    return ImageStorage._instance;
  }

  private imageHash: { [identifier: string]: ImageFile } = {};

  get images(): ImageFile[] {
    let images: ImageFile[] = [];
    for (let identifier in this.imageHash) {
      images.push(this.imageHash[identifier]);
    }
    return images;
  }

  private lazyTimer: ResettableTimeout;

  private constructor() {
  }

  private destroy() {
    for (let identifier in this.imageHash) {
      this.delete(identifier);
    }
  }

  async addAsync(file: File): Promise<ImageFile>
  async addAsync(blob: Blob): Promise<ImageFile>
  async addAsync(arg: any): Promise<ImageFile> {
    let image: ImageFile = await ImageFile.createAsync(arg);

    return this._add(image);
  }

  /** Restore `<sha256>.ext` from ZIP / folder media under the filename hash. */
  async addPackedAsync(file: File): Promise<ImageFile> {
    const hash = mediaHashFromName(file.name);
    if (!isContentHashIdentifier(hash)) return this.addAsync(file);
    const existing = this.get(hash);
    if (existing && existing.state >= ImageState.COMPLETE) return existing;
    const image = await ImageFile.createPackedAsync(file, hash);
    return this._add(image);
  }

  add(url: string): ImageFile
  add(image: ImageFile): ImageFile
  add(context: ImageContext): ImageFile
  add(arg: any): ImageFile {
    let image: ImageFile;
    if (typeof arg === 'string') {
      image = ImageFile.create(arg);
    } else if (arg instanceof ImageFile) {
      image = arg;
    } else {
      if (this.update(arg)) return this.imageHash[arg.identifier];
      image = ImageFile.create(arg);
    }
    return this._add(image);
  }

  private _add(image: ImageFile): ImageFile {
    // URL assets (./assets/...) are not P2P-synced; only blob-complete entries.
    if (image.state === ImageState.COMPLETE) this.lazySynchronize(100);
    if (this.update(image)) return this.imageHash[image.identifier];
    this.imageHash[image.identifier] = image;
    return image;
  }

  private update(image: ImageFile): boolean
  private update(image: ImageContext): boolean
  private update(image: any): boolean {
    let context: ImageContext;
    if (image instanceof ImageFile) {
      context = image.toContext();
    } else {
      context = image;
    }
    let updatingImage: ImageFile = this.imageHash[image.identifier];
    if (updatingImage) {
      updatingImage.apply(image);
      return true;
    }
    return false;
  }

  delete(identifier: string): boolean {
    let deleteImage: ImageFile = this.imageHash[identifier];
    if (deleteImage) {
      deleteImage.destroy();
      delete this.imageHash[identifier];
      return true;
    }
    return false;
  }

  get(identifier: string): ImageFile {
    return getOrHydrateUrlBacked({
      hash: this.imageHash,
      identifier,
      createUrlBacked: id => ImageFile.create(id),
      store: file => this._add(file),
    });
  }

  synchronize(peer?: string) {
    if (this.lazyTimer) this.lazyTimer.stop();
    EventSystem.call('SYNCHRONIZE_FILE_LIST', this.getCatalog(), peer);
  }

  lazySynchronize(ms: number, peer?: string) {
    const delay = Math.max(ms, 1500);
    if (this.lazyTimer == null) this.lazyTimer = new ResettableTimeout(() => this.synchronize(peer), delay);
    this.lazyTimer.reset(delay);
  }

  getCatalog(): CatalogItem[] {
    let catalog: CatalogItem[] = [];
    for (let image of this.images) {
      // Exclude ImageState.URL (1000): COMPLETE <= URL would advertise path/HTTP assets for P2P.
      if (image.state === ImageState.COMPLETE) {
        catalog.push({
          identifier: image.identifier,
          state: image.state,
          thumbBytes: catalogByteSize(image.thumbnail?.blob),
          byteSize: catalogByteSize(image.blob, catalogByteSize(image.thumbnail?.blob)),
        });
      }
    }
    return catalog;
  }
}
