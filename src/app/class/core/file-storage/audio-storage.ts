import { EventSystem } from '../system';
import { AudioFile, AudioFileContext, AudioState } from './audio-file';
import {
  addPackedByContentHash,
  buildCompleteBlobCatalog,
  deleteMediaFromHash,
  getFromHash,
  insertOrUpdateMediaFile,
  LazyCatalogSynchronizer,
  MediaCatalogItem,
} from './media-storage-helpers';

export type CatalogItem = MediaCatalogItem;

export class AudioStorage {
  private static _instance: AudioStorage
  static get instance(): AudioStorage {
    if (!AudioStorage._instance) AudioStorage._instance = new AudioStorage();
    return AudioStorage._instance;
  }

  private readonly catalogSync = new LazyCatalogSynchronizer(peer => {
    EventSystem.call('SYNCHRONIZE_AUDIO_LIST', this.getCatalog(), peer);
  });
  private hash: { [identifier: string]: AudioFile } = {};

  get audios(): AudioFile[] {
    let audios: AudioFile[] = [];
    for (let identifier in this.hash) {
      audios.push(this.hash[identifier]);
    }
    return audios;
  }

  private constructor() {
  }

  private destroy() {
    for (let identifier in this.hash) {
      this.delete(identifier);
    }
  }

  async addAsync(file: File, displayName?: string): Promise<AudioFile>
  async addAsync(blob: Blob, displayName?: string): Promise<AudioFile>
  async addAsync(arg: any, displayName?: string): Promise<AudioFile> {
    let audio: AudioFile = await AudioFile.createAsync(arg, displayName);

    return this._add(audio);
  }

  async addPackedAsync(file: File): Promise<AudioFile> {
    return addPackedByContentHash({
      file,
      completeState: AudioState.COMPLETE,
      get: id => this.get(id),
      addAsync: f => this.addAsync(f),
      createPacked: (f, hash) => AudioFile.createPackedAsync(f, hash),
      store: audio => this._add(audio),
    });
  }

  add(url: string): AudioFile
  add(audio: AudioFile): AudioFile
  add(context: AudioFileContext): AudioFile
  add(arg: any): AudioFile {
    let audio: AudioFile;
    if (typeof arg === 'string') {
      audio = AudioFile.create(arg);
    } else if (arg instanceof AudioFile) {
      audio = arg;
    } else {
      if (this.update(arg)) return this.hash[arg.identifier];
      audio = AudioFile.create(arg);
    }
    return this._add(audio);
  }

  private _add(audio: AudioFile): AudioFile {
    return insertOrUpdateMediaFile({
      hash: this.hash,
      file: audio,
      completeState: AudioState.COMPLETE,
      lazySynchronize: ms => this.lazySynchronize(ms),
      tryUpdate: file => this.update(file),
    });
  }

  private update(audio: AudioFile): boolean
  private update(audio: AudioFileContext): boolean
  private update(audio: any): boolean {
    let context: AudioFileContext;
    if (audio instanceof AudioFile) {
      context = audio.toContext();
    } else {
      context = audio;
    }
    let updateAudio: AudioFile = this.hash[audio.identifier];
    if (updateAudio) {
      updateAudio.apply(audio);
      return true;
    }
    return false;
  }

  delete(identifier: string): boolean {
    return deleteMediaFromHash(this.hash, identifier);
  }

  get(identifier: string): AudioFile {
    return getFromHash(this.hash, identifier);
  }

  synchronize(peer?: string) {
    this.catalogSync.synchronize(peer);
  }

  lazySynchronize(ms: number, peer?: string) {
    this.catalogSync.lazySynchronize(ms, peer);
  }

  getCatalog(): CatalogItem[] {
    return buildCompleteBlobCatalog(this.audios, AudioState.COMPLETE);
  }
}
