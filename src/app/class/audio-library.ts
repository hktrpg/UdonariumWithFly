import { AudioFile } from './core/file-storage/audio-file';
import { AudioStorage } from './core/file-storage/audio-storage';
import { SyncObject, SyncVar } from './core/synchronize-object/decorator';
import { GameObject } from './core/synchronize-object/game-object';
import { ObjectStore } from './core/synchronize-object/object-store';
import { InnerXml } from './core/synchronize-object/object-serializer';

/** HTML5 DnD MIME for library ↔ track / HUD drops. */
export const JUKEBOX_AUDIO_DRAG_MIME = 'application/x-udonarium-jukebox-audio';

export interface AudioLibraryFolder {
  id: string;
  name: string;
}

export interface AudioLibraryData {
  folders: AudioLibraryFolder[];
  /** audioId -> folderId (empty string = root) */
  membership: { [audioId: string]: string };
  /** audioId -> display name override */
  names: { [audioId: string]: string };
  /** folderId ('' = root) -> ordered audio ids */
  orders: { [folderId: string]: string[] };
  /** audioId -> preferred jukebox track index (only when user set) */
  trackTypes: { [audioId: string]: number };
  /** audioId -> true = LOOP, false = once (only when user set) */
  playLoops: { [audioId: string]: boolean };
  /** folderId -> default track index for folder playback */
  folderTrackTypes: { [folderId: string]: number };
  /** folderId -> default LOOP for folder playback */
  folderPlayLoops: { [folderId: string]: boolean };
}

function emptyData(): AudioLibraryData {
  return {
    folders: [],
    membership: {},
    names: {},
    orders: {},
    trackTypes: {},
    playLoops: {},
    folderTrackTypes: {},
    folderPlayLoops: {},
  };
}

function normalizeData(raw: any): AudioLibraryData {
  const data = emptyData();
  if (!raw || typeof raw !== 'object') return data;
  if (Array.isArray(raw.folders)) {
    for (const f of raw.folders) {
      if (!f || typeof f.id !== 'string' || !f.id) continue;
      data.folders.push({
        id: f.id,
        name: typeof f.name === 'string' && f.name.trim() ? f.name.trim() : 'Folder',
      });
    }
  }
  if (raw.membership && typeof raw.membership === 'object') {
    for (const key of Object.keys(raw.membership)) {
      const v = raw.membership[key];
      data.membership[key] = typeof v === 'string' ? v : '';
    }
  }
  if (raw.names && typeof raw.names === 'object') {
    for (const key of Object.keys(raw.names)) {
      const v = raw.names[key];
      if (typeof v === 'string' && v.trim()) data.names[key] = v.trim();
    }
  }
  if (raw.orders && typeof raw.orders === 'object') {
    for (const key of Object.keys(raw.orders)) {
      const list = raw.orders[key];
      if (!Array.isArray(list)) continue;
      data.orders[key] = list.filter((id: any) => typeof id === 'string' && id);
    }
  }
  if (raw.trackTypes && typeof raw.trackTypes === 'object') {
    for (const key of Object.keys(raw.trackTypes)) {
      const v = Number(raw.trackTypes[key]);
      if (Number.isFinite(v) && v >= 0) data.trackTypes[key] = Math.floor(v);
    }
  }
  if (raw.playLoops && typeof raw.playLoops === 'object') {
    for (const key of Object.keys(raw.playLoops)) {
      data.playLoops[key] = !!raw.playLoops[key];
    }
  }
  if (raw.folderTrackTypes && typeof raw.folderTrackTypes === 'object') {
    for (const key of Object.keys(raw.folderTrackTypes)) {
      const v = Number(raw.folderTrackTypes[key]);
      if (Number.isFinite(v) && v >= 0) data.folderTrackTypes[key] = Math.floor(v);
    }
  }
  if (raw.folderPlayLoops && typeof raw.folderPlayLoops === 'object') {
    for (const key of Object.keys(raw.folderPlayLoops)) {
      data.folderPlayLoops[key] = !!raw.folderPlayLoops[key];
    }
  }
  return data;
}

function newFolderId(): string {
  return 'af_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
}

function ensureOrderList(data: AudioLibraryData, folderId: string): string[] {
  const key = folderId || '';
  if (!Array.isArray(data.orders[key])) data.orders[key] = [];
  return data.orders[key];
}

function removeFromAllOrders(data: AudioLibraryData, audioId: string) {
  for (const key of Object.keys(data.orders)) {
    data.orders[key] = (data.orders[key] || []).filter(id => id !== audioId);
  }
}

@SyncObject('audio-library')
export class AudioLibrary extends GameObject implements InnerXml {
  @SyncVar() dataJson: string = JSON.stringify(emptyData());

  private static _instance: AudioLibrary;

  static get instance(): AudioLibrary {
    if (AudioLibrary._instance) return AudioLibrary._instance;
    const existing = ObjectStore.instance.get<AudioLibrary>('AudioLibrary');
    if (existing) {
      AudioLibrary._instance = existing;
      return existing;
    }
    AudioLibrary._instance = new AudioLibrary('AudioLibrary');
    AudioLibrary._instance.initialize();
    return AudioLibrary._instance;
  }

  get data(): AudioLibraryData {
    try {
      return normalizeData(this.dataJson ? JSON.parse(this.dataJson) : null);
    } catch {
      return emptyData();
    }
  }

  set data(value: AudioLibraryData) {
    this.dataJson = JSON.stringify(normalizeData(value));
  }

  get folders(): AudioLibraryFolder[] {
    return this.data.folders;
  }

  displayName(audio: AudioFile): string {
    if (!audio) return '';
    const override = this.data.names[audio.identifier];
    return override || audio.name || audio.identifier;
  }

  folderOf(audioId: string): string {
    return this.data.membership[audioId] || '';
  }

  audiosInFolder(folderId: string, audios: AudioFile[]): AudioFile[] {
    const fid = folderId || '';
    const inFolder = audios.filter(a => (this.data.membership[a.identifier] || '') === fid);
    const order = this.data.orders[fid] || [];
    if (order.length < 1) return inFolder;
    const rank = new Map(order.map((id, i) => [id, i]));
    return inFolder.slice().sort((a, b) => {
      const ra = rank.has(a.identifier) ? rank.get(a.identifier)! : Number.MAX_SAFE_INTEGER;
      const rb = rank.has(b.identifier) ? rank.get(b.identifier)! : Number.MAX_SAFE_INTEGER;
      if (ra !== rb) return ra - rb;
      return (a.name || '').localeCompare(b.name || '');
    });
  }

  createFolder(name: string): AudioLibraryFolder {
    const data = this.data;
    const folder: AudioLibraryFolder = {
      id: newFolderId(),
      name: (name || '').trim() || 'Folder',
    };
    data.folders.push(folder);
    data.orders[folder.id] = [];
    this.data = data;
    return folder;
  }

  renameFolder(folderId: string, name: string) {
    const data = this.data;
    const folder = data.folders.find(f => f.id === folderId);
    if (!folder) return;
    folder.name = (name || '').trim() || folder.name;
    this.data = data;
  }

  deleteFolder(folderId: string) {
    const data = this.data;
    data.folders = data.folders.filter(f => f.id !== folderId);
    const moved = data.orders[folderId] || [];
    delete data.orders[folderId];
    delete data.folderTrackTypes[folderId];
    delete data.folderPlayLoops[folderId];
    const root = ensureOrderList(data, '');
    for (const id of Object.keys(data.membership)) {
      if (data.membership[id] === folderId) {
        data.membership[id] = '';
        if (!root.includes(id)) root.push(id);
      }
    }
    for (const id of moved) {
      if (!root.includes(id)) root.push(id);
    }
    this.data = data;
  }

  moveToFolder(audioId: string, folderId: string, beforeAudioId: string | null = null) {
    if (!audioId) return;
    const data = this.data;
    if (folderId && !data.folders.some(f => f.id === folderId)) folderId = '';
    const dest = folderId || '';
    data.membership[audioId] = dest;
    removeFromAllOrders(data, audioId);
    const list = ensureOrderList(data, dest);
    if (beforeAudioId && list.includes(beforeAudioId)) {
      const idx = list.indexOf(beforeAudioId);
      list.splice(idx, 0, audioId);
    } else {
      list.push(audioId);
    }
    this.data = data;
  }

  /** Reorder within the same folder (or move+insert when folder differs). */
  reorder(audioId: string, folderId: string, beforeAudioId: string | null) {
    if (!audioId || audioId === beforeAudioId) return;
    this.moveToFolder(audioId, folderId || '', beforeAudioId);
  }

  renameAudio(audioId: string, name: string) {
    if (!audioId) return;
    const trimmed = (name || '').trim();
    if (!trimmed) return;
    const data = this.data;
    data.names[audioId] = trimmed;
    this.data = data;
    const audio = AudioStorage.instance.get(audioId);
    if (audio) {
      const ctx = audio.toContext();
      AudioStorage.instance.add({
        identifier: audio.identifier,
        name: trimmed,
        type: ctx.type,
        blob: audio.blob,
        url: audio.url,
      });
    }
  }

  removeAudioMeta(audioId: string) {
    if (!audioId) return;
    const data = this.data;
    delete data.membership[audioId];
    delete data.names[audioId];
    delete data.trackTypes[audioId];
    delete data.playLoops[audioId];
    removeFromAllOrders(data, audioId);
    this.data = data;
  }

  /** Whether this audio has an explicit track override. */
  hasTrackType(audioId: string): boolean {
    return !!audioId && Object.prototype.hasOwnProperty.call(this.data.trackTypes, audioId);
  }

  /** Raw preferred track index (0 if unset). Prefer effectiveTrackType(). */
  trackTypeOf(audioId: string): number {
    if (!audioId) return 0;
    const v = this.data.trackTypes[audioId];
    return Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0;
  }

  setTrackType(audioId: string, trackIndex: number) {
    if (!audioId) return;
    const data = this.data;
    data.trackTypes[audioId] = Math.max(0, Math.floor(trackIndex) || 0);
    this.data = data;
  }

  clearTrackType(audioId: string) {
    if (!audioId) return;
    const data = this.data;
    delete data.trackTypes[audioId];
    this.data = data;
  }

  folderTrackType(folderId: string): number {
    const v = this.data.folderTrackTypes[folderId || ''];
    return Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0;
  }

  setFolderTrackType(folderId: string, trackIndex: number) {
    const data = this.data;
    data.folderTrackTypes[folderId || ''] = Math.max(0, Math.floor(trackIndex) || 0);
    this.data = data;
  }

  /**
   * Effective track: audio override if set, otherwise folder default.
   */
  effectiveTrackType(audioId: string, folderId?: string): number {
    if (this.hasTrackType(audioId)) return this.trackTypeOf(audioId);
    const fid = folderId != null ? folderId : this.folderOf(audioId);
    return this.folderTrackType(fid);
  }

  hasPlayLoop(audioId: string): boolean {
    return !!audioId && Object.prototype.hasOwnProperty.call(this.data.playLoops, audioId);
  }

  /** Raw play-loop flag (default true if unset). Prefer effectivePlayLoop(). */
  playLoopOf(audioId: string): boolean {
    if (!audioId) return true;
    return this.data.playLoops[audioId] !== false;
  }

  setPlayLoop(audioId: string, isLoop: boolean) {
    if (!audioId) return;
    const data = this.data;
    data.playLoops[audioId] = !!isLoop;
    this.data = data;
  }

  folderPlayLoop(folderId: string): boolean {
    return this.data.folderPlayLoops[folderId || ''] !== false;
  }

  setFolderPlayLoop(folderId: string, isLoop: boolean) {
    const data = this.data;
    data.folderPlayLoops[folderId || ''] = !!isLoop;
    this.data = data;
  }

  /** Effective LOOP: audio override if set, otherwise folder default. */
  effectivePlayLoop(audioId: string, folderId?: string): boolean {
    if (this.hasPlayLoop(audioId)) return this.playLoopOf(audioId);
    const fid = folderId != null ? folderId : this.folderOf(audioId);
    return this.folderPlayLoop(fid);
  }

  /** Ensure newly added audio appears in root order. */
  ensureListed(audioId: string) {
    if (!audioId) return;
    const data = this.data;
    if (data.membership[audioId] == null) data.membership[audioId] = '';
    const fid = data.membership[audioId] || '';
    const list = ensureOrderList(data, fid);
    if (!list.includes(audioId)) {
      list.push(audioId);
      this.data = data;
    }
  }

  innerXml(): string { return ''; }

  parseInnerXml(element: Element) {
    const context = AudioLibrary.instance.toContext();
    context.syncData = this.toContext().syncData;
    AudioLibrary.instance.apply(context);
    AudioLibrary.instance.update();
    this.destroy();
  }
}
