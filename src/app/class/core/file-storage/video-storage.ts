import { EventSystem } from '../system';
import {
  addPackedByContentHash,
  buildCompleteBlobCatalog,
  deleteMediaFromHash,
  getOrHydrateUrlBacked,
  insertOrUpdateMediaFile,
  LazyCatalogSynchronizer,
  MediaCatalogItem,
} from './media-storage-helpers';
import { VideoFile, VideoFileContext, VideoState } from './video-file';

export type VideoCatalogItem = MediaCatalogItem;

export class VideoStorage {
  private static _instance: VideoStorage;
  static get instance(): VideoStorage {
    if (!VideoStorage._instance) VideoStorage._instance = new VideoStorage();
    return VideoStorage._instance;
  }

  private readonly catalogSync = new LazyCatalogSynchronizer(peer => {
    EventSystem.call('SYNCHRONIZE_VIDEO_LIST', this.getCatalog(), peer);
  });
  private hash: { [identifier: string]: VideoFile } = {};

  get videos(): VideoFile[] {
    return Object.keys(this.hash).map(id => this.hash[id]);
  }

  private constructor() {
  }

  async addAsync(file: File, displayName?: string): Promise<VideoFile>
  async addAsync(blob: Blob, displayName?: string): Promise<VideoFile>
  async addAsync(arg: any, displayName?: string): Promise<VideoFile> {
    const video = await VideoFile.createAsync(arg, displayName);
    return this._add(video);
  }

  async addPackedAsync(file: File): Promise<VideoFile> {
    return addPackedByContentHash({
      file,
      completeState: VideoState.COMPLETE,
      get: id => this.get(id),
      addAsync: f => this.addAsync(f),
      createPacked: (f, hash) => VideoFile.createPackedAsync(f, hash),
      store: video => this._add(video),
    });
  }

  add(url: string): VideoFile
  add(video: VideoFile): VideoFile
  add(context: VideoFileContext): VideoFile
  add(arg: any): VideoFile {
    let video: VideoFile;
    if (typeof arg === 'string') {
      video = VideoFile.create(arg);
    } else if (arg instanceof VideoFile) {
      video = arg;
    } else {
      if (this.update(arg)) return this.hash[arg.identifier];
      video = VideoFile.create(arg);
    }
    return this._add(video);
  }

  private _add(video: VideoFile): VideoFile {
    return insertOrUpdateMediaFile({
      hash: this.hash,
      file: video,
      completeState: VideoState.COMPLETE,
      lazySynchronize: ms => this.lazySynchronize(ms),
      tryUpdate: file => this.update(file),
    });
  }

  private update(video: VideoFile): boolean
  private update(video: VideoFileContext): boolean
  private update(video: any): boolean {
    const updateVideo = this.hash[video.identifier];
    if (updateVideo) {
      updateVideo.apply(video instanceof VideoFile ? video.toContext() : video);
      return true;
    }
    return false;
  }

  delete(identifier: string): boolean {
    return deleteMediaFromHash(this.hash, identifier);
  }

  get(identifier: string): VideoFile {
    return getOrHydrateUrlBacked({
      hash: this.hash,
      identifier,
      createUrlBacked: id => VideoFile.create(id),
      store: file => this._add(file),
    });
  }

  synchronize(peer?: string) {
    this.catalogSync.synchronize(peer);
  }

  lazySynchronize(ms: number, peer?: string) {
    this.catalogSync.lazySynchronize(ms, peer);
  }

  getCatalog(): VideoCatalogItem[] {
    return buildCompleteBlobCatalog(this.videos, VideoState.COMPLETE);
  }
}
