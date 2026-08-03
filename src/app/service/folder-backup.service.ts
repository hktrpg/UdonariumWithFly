import { Injectable, NgZone, OnDestroy } from '@angular/core';
import { FileArchiver } from '@udonarium/core/file-storage/file-archiver';
import { EventSystem, Network } from '@udonarium/core/system';
import { PeerCursor } from '@udonarium/peer-cursor';
import { RoomAuth } from '@udonarium/room-auth';
import { ConfirmationComponent, ConfirmationType } from 'component/confirmation/confirmation.component';
import { FolderBackupListComponent } from 'component/folder-backup-list/folder-backup-list.component';
import { RoomSettingComponent } from 'component/room-setting/room-setting.component';
import * as localForage from 'localforage';
import { I18nService } from './i18n.service';
import { ModalService } from './modal.service';
import { SaveDataService } from './save-data.service';

export type FolderBackupStatus = 'unsupported' | 'unbound' | 'needAuth' | 'ready' | 'writing' | 'error';

export interface RoomBackupInfo {
  roomId: string;
  displayName: string;
  savedAt: string;
  zipFile: string;
  fileHandle: FileSystemFileHandle;
}

export interface RoomBackupMeta {
  roomId: string;
  displayName: string;
  savedAt: string;
  zipFile: string;
}

@Injectable({
  providedIn: 'root'
})
export class FolderBackupService implements OnDestroy {
  static readonly STORAGE_KEY = 'udonarium.folderBackup.dirHandle';
  private static readonly DEBOUNCE_MS = 5000;
  private static readonly MIN_INTERVAL_MS = 30000;
  private static readonly DEFAULT_FLUSH_TIMEOUT_MS = 15000;

  private dirHandle: FileSystemDirectoryHandle | null = null;
  private listening = false;
  private dirty = false;
  private writing = false;
  private writeAgain = false;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private minIntervalTimer: ReturnType<typeof setTimeout> | null = null;
  private lastWriteAt = 0;
  private activeRoomId = '';
  private initialized = false;

  status: FolderBackupStatus = 'unsupported';
  folderName = '';
  lastSavedAt: string | null = null;
  lastError = '';

  constructor(
    private saveDataService: SaveDataService,
    private ngZone: NgZone,
    private modalService: ModalService,
    private i18n: I18nService
  ) { }

  get needsBind(): boolean {
    return this.isSupported && (!this.hasFolder || this.status === 'unbound' || this.status === 'needAuth');
  }

  get canLoadFromFolder(): boolean {
    return this.isSupported && !Network.GuestMode();
  }

  get isSupported(): boolean {
    return typeof window !== 'undefined'
      && !!window.isSecureContext
      && typeof window.showDirectoryPicker === 'function';
  }

  get isReady(): boolean {
    return this.status === 'ready' || this.status === 'writing';
  }

  get hasFolder(): boolean {
    return !!this.dirHandle;
  }

  get canAutoWrite(): boolean {
    return !!this.dirHandle
      && (this.status === 'ready' || this.status === 'writing' || this.status === 'error')
      && !!Network.peer?.isRoom
      && !Network.GuestMode();
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;

    if (!this.isSupported) {
      this.setStatus('unsupported');
      return;
    }

    this.setStatus('unbound');
    try {
      const stored = await localForage.getItem<FileSystemDirectoryHandle>(FolderBackupService.STORAGE_KEY);
      if (stored) {
        this.dirHandle = stored;
        this.folderName = stored.name || '';
        const perm = await this.queryPermission(stored);
        this.setStatus(perm === 'granted' ? 'ready' : 'needAuth');
      }
    } catch (e) {
      console.warn('FolderBackup restore handle failed', e);
      this.dirHandle = null;
      this.setStatus('unbound');
    }

    EventSystem.register(this)
      .on('OPEN_NETWORK', () => this.onNetworkOpen())
      .on('CHANGE_GM_MODE', () => { void this.onGuestModePossiblyChanged(); })
      .on('UPDATE_GAME_OBJECT', event => this.onGameObjectDirty(event.data?.aliasName))
      .on('DELETE_GAME_OBJECT', event => this.onGameObjectDirty(event.data?.aliasName));

    this.onNetworkOpen();
  }

  ngOnDestroy() {
    EventSystem.unregister(this);
    this.clearTimers();
  }

  async bindFolder(): Promise<boolean> {
    if (!this.isSupported) {
      this.setStatus('unsupported');
      return false;
    }
    try {
      const handle = await window.showDirectoryPicker!({ mode: 'readwrite' });
      const perm = await this.requestPermission(handle);
      if (perm !== 'granted') {
        this.dirHandle = handle;
        this.folderName = handle.name || '';
        this.setStatus('needAuth');
        return false;
      }
      this.dirHandle = handle;
      this.folderName = handle.name || '';
      await localForage.setItem(FolderBackupService.STORAGE_KEY, handle);
      this.lastError = '';
      this.setStatus('ready');
      this.onNetworkOpen();
      return true;
    } catch (e) {
      if ((e as DOMException)?.name === 'AbortError') return false;
      console.warn('FolderBackup bind failed', e);
      this.lastError = String((e as Error)?.message || e);
      this.setStatus('error');
      return false;
    }
  }

  async requestAccess(): Promise<boolean> {
    if (!this.dirHandle) return this.bindFolder();
    try {
      const perm = await this.requestPermission(this.dirHandle);
      if (perm !== 'granted') {
        this.setStatus('needAuth');
        return false;
      }
      this.lastError = '';
      this.setStatus('ready');
      this.onNetworkOpen();
      return true;
    } catch (e) {
      console.warn('FolderBackup requestAccess failed', e);
      this.lastError = String((e as Error)?.message || e);
      this.setStatus('needAuth');
      return false;
    }
  }

  async unbindFolder(): Promise<void> {
    this.clearTimers();
    this.dirty = false;
    this.writeAgain = false;
    this.dirHandle = null;
    this.folderName = '';
    this.lastSavedAt = null;
    this.lastError = '';
    this.listening = false;
    try {
      await localForage.removeItem(FolderBackupService.STORAGE_KEY);
    } catch (e) {
      console.warn(e);
    }
    this.setStatus(this.isSupported ? 'unbound' : 'unsupported');
  }

  markDirty() {
    if (!this.canAutoWrite) return;
    this.dirty = true;
    this.scheduleWrite();
  }

  async flush(options?: { timeoutMs?: number }): Promise<boolean> {
    if (!this.dirHandle || !Network.peer?.isRoom || Network.GuestMode()) {
      this.dirty = false;
      this.clearTimers();
      return false;
    }
    if (!this.isReady && this.status !== 'writing') {
      const perm = await this.queryPermission(this.dirHandle);
      if (perm !== 'granted') return false;
      this.setStatus(this.writing ? 'writing' : 'ready');
    }

    this.clearTimers();
    this.dirty = true;
    const timeoutMs = options?.timeoutMs ?? FolderBackupService.DEFAULT_FLUSH_TIMEOUT_MS;
    try {
      await this.withTimeout(this.flushWrites(), timeoutMs);
      return true;
    } catch (e) {
      console.warn('FolderBackup flush failed', e);
      this.lastError = String((e as Error)?.message || e);
      return false;
    }
  }

  private async flushWrites(): Promise<void> {
    await this.writeNow(true);
    if (this.dirty || this.writeAgain) {
      this.writeAgain = false;
      this.dirty = true;
      await this.writeNow(true);
    }
  }

  async listRoomBackups(): Promise<RoomBackupInfo[]> {
    if (!this.dirHandle) return [];
    const perm = await this.queryPermission(this.dirHandle);
    if (perm !== 'granted') {
      this.setStatus('needAuth');
      return [];
    }

    const results: RoomBackupInfo[] = [];
    for await (const [name, handle] of this.dirHandle.entries()) {
      if (handle.kind !== 'file') continue;
      if (!name.endsWith('.meta.json')) continue;
      try {
        const fileHandle = handle as FileSystemFileHandle;
        const file = await fileHandle.getFile();
        const meta = JSON.parse(await file.text()) as RoomBackupMeta;
        if (!meta?.roomId || !meta?.zipFile) continue;
        const zipHandle = await this.dirHandle.getFileHandle(meta.zipFile);
        results.push({
          roomId: meta.roomId,
          displayName: meta.displayName || meta.roomId,
          savedAt: meta.savedAt || '',
          zipFile: meta.zipFile,
          fileHandle: zipHandle,
        });
      } catch (e) {
        console.warn('Skip backup meta', name, e);
      }
    }
    results.sort((a, b) => (b.savedAt || '').localeCompare(a.savedAt || ''));
    return results;
  }

  async loadRoomBackup(backup: RoomBackupInfo): Promise<void> {
    const file = await backup.fileHandle.getFile();
    await FileArchiver.instance.load([new File([file], backup.zipFile || `${backup.roomId}.zip`, { type: 'application/zip' })]);
  }

  async deleteRoomBackup(backup: RoomBackupInfo): Promise<boolean> {
    if (!this.dirHandle) return false;
    const perm = await this.queryPermission(this.dirHandle);
    if (perm !== 'granted') {
      this.setStatus('needAuth');
      return false;
    }
    const zipFile = backup.zipFile || `${backup.roomId}.zip`;
    const metaFile = `${backup.roomId}.meta.json`;
    try {
      await this.dirHandle.removeEntry(zipFile);
    } catch (e) {
      console.warn('Failed to remove backup zip', zipFile, e);
    }
    try {
      await this.dirHandle.removeEntry(metaFile);
    } catch (e) {
      console.warn('Failed to remove backup meta', metaFile, e);
    }
    try {
      await this.dirHandle.removeEntry(`${zipFile}.tmp`);
    } catch { /* ignore missing temp */ }
    return true;
  }

  async ensureBound(): Promise<boolean> {
    if (!this.isSupported || Network.GuestMode()) return false;
    if (this.status === 'needAuth') return this.requestAccess();
    if (!this.hasFolder || this.status === 'unbound') return this.bindFolder();
    return this.isReady || this.status === 'error';
  }

  async openLoadUi(): Promise<void> {
    if (Network.GuestMode() || !this.isSupported) return;
    if (!(await this.ensureBound())) return;

    const backups = await this.listRoomBackups();
    const selected = await this.modalService.open(FolderBackupListComponent, {
      width: 560,
      height: 520,
      backups,
    }) as RoomBackupInfo | null;
    if (!selected) return;

    const isRoom = !!Network.peer?.isRoom;
    if (!isRoom) {
      let loadDirect = false;
      const choice = await this.modalService.open(ConfirmationComponent, {
        title: this.i18n.t('menu.confirm.loadFolder.title'),
        text: this.i18n.t('menu.confirm.loadFolder.text'),
        help: this.i18n.t('menu.confirm.loadFolder.help'),
        type: ConfirmationType.OK_CANCEL,
        materialIcon: 'folder',
        okLabel: this.i18n.t('menu.confirm.loadZip.createRoom'),
        cancelLabel: this.i18n.t('menu.confirm.loadZip.loadDirect'),
        cancelAction: () => {
          loadDirect = true;
          void this.loadRoomBackup(selected);
        },
      });
      if (choice === true) {
        await this.modalService.open(RoomSettingComponent, {
          width: 700,
          height: 420,
          left: 0,
          top: 400,
          afterCreate: () => { void this.loadRoomBackup(selected); },
        });
      }
      if (loadDirect || choice === false) return;
      return;
    }

    const overwrite = await this.modalService.open(ConfirmationComponent, {
      title: this.i18n.t('menu.confirm.loadFolder.overwrite.title'),
      text: this.i18n.t('menu.confirm.loadFolder.overwrite.text'),
      help: this.i18n.t('menu.confirm.loadFolder.overwrite.help'),
      type: ConfirmationType.OK_CANCEL,
      materialIcon: 'folder',
    });
    if (overwrite === true) {
      await this.loadRoomBackup(selected);
    }
  }

  private onNetworkOpen() {
    const peer = Network.peer;
    if (!peer?.isRoom) {
      this.activeRoomId = '';
      this.listening = false;
      this.clearTimers();
      this.dirty = false;
      return;
    }

    const roomId = peer.roomId || '';
    if (this.activeRoomId && this.activeRoomId !== roomId) {
      this.clearTimers();
      this.dirty = false;
      this.writeAgain = false;
    }
    this.activeRoomId = roomId;
    this.listening = true;

    if (Network.GuestMode()) {
      this.listening = false;
      this.clearTimers();
    }
  }

  private async onGuestModePossiblyChanged() {
    if (Network.GuestMode()) {
      if (this.dirty || this.writing) {
        await this.flush({ timeoutMs: FolderBackupService.DEFAULT_FLUSH_TIMEOUT_MS });
      }
      this.listening = false;
      this.clearTimers();
      this.dirty = false;
      return;
    }
    this.onNetworkOpen();
  }

  private onGameObjectDirty(aliasName?: string) {
    if (!this.listening || !this.canAutoWrite) return;
    if (aliasName === PeerCursor.aliasName) return;
    this.markDirty();
  }

  private scheduleWrite() {
    if (!this.canAutoWrite) return;
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      void this.writeWhenAllowed();
    }, FolderBackupService.DEBOUNCE_MS);
  }

  private async writeWhenAllowed() {
    if (!this.canAutoWrite || !this.dirty) return;
    const elapsed = Date.now() - this.lastWriteAt;
    if (this.lastWriteAt > 0 && elapsed < FolderBackupService.MIN_INTERVAL_MS) {
      if (this.minIntervalTimer) clearTimeout(this.minIntervalTimer);
      this.minIntervalTimer = setTimeout(() => {
        this.minIntervalTimer = null;
        void this.writeWhenAllowed();
      }, FolderBackupService.MIN_INTERVAL_MS - elapsed);
      return;
    }
    await this.writeNow(false);
  }

  private async writeNow(force: boolean): Promise<void> {
    if (!this.dirHandle) return;
    if (!force && !this.canAutoWrite) return;
    if (!Network.peer?.isRoom || Network.GuestMode()) return;
    if (this.writing) {
      this.writeAgain = true;
      return;
    }

    const roomId = Network.peer.roomId;
    if (!roomId) return;

    this.writing = true;
    this.dirty = false;
    this.setStatus('writing');
    try {
      const displayName = RoomAuth.displayRoomName(Network.peer.roomName || roomId) || roomId;
      await this.saveDataService.saveRoomToDirectoryAsync(this.dirHandle, roomId, displayName);
      this.lastWriteAt = Date.now();
      this.lastSavedAt = new Date().toISOString();
      this.lastError = '';
      this.activeRoomId = roomId;
      this.setStatus('ready');
    } catch (e) {
      console.warn('FolderBackup write failed', e);
      this.lastError = String((e as Error)?.message || e);
      this.dirty = true;
      const perm = this.dirHandle ? await this.queryPermission(this.dirHandle) : 'denied';
      this.setStatus(perm === 'granted' ? 'error' : 'needAuth');
      throw e;
    } finally {
      this.writing = false;
      if (this.writeAgain || this.dirty) {
        this.writeAgain = false;
        this.dirty = true;
        if (!force) this.scheduleWrite();
      } else if (this.status === 'writing') {
        this.setStatus('ready');
      }
    }
  }

  private async queryPermission(handle: FileSystemDirectoryHandle): Promise<PermissionState> {
    if (typeof handle.queryPermission === 'function') {
      return handle.queryPermission({ mode: 'readwrite' });
    }
    return 'granted';
  }

  private async requestPermission(handle: FileSystemDirectoryHandle): Promise<PermissionState> {
    if (typeof handle.requestPermission === 'function') {
      return handle.requestPermission({ mode: 'readwrite' });
    }
    return 'granted';
  }

  private setStatus(status: FolderBackupStatus) {
    this.ngZone.run(() => {
      this.status = status;
    });
  }

  private clearTimers() {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    if (this.minIntervalTimer) {
      clearTimeout(this.minIntervalTimer);
      this.minIntervalTimer = null;
    }
  }

  private withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('FolderBackup flush timeout')), timeoutMs);
      promise.then(
        value => {
          clearTimeout(timer);
          resolve(value);
        },
        err => {
          clearTimeout(timer);
          reject(err);
        }
      );
    });
  }
}
