import { Injectable, NgZone, OnDestroy } from '@angular/core';
import { FileArchiver } from '@udonarium/core/file-storage/file-archiver';
import { EventSystem, Network } from '@udonarium/core/system';
import { PeerCursor } from '@udonarium/peer-cursor';
import { RoomAuth } from '@udonarium/room-auth';
import { SceneToolPermission } from '@udonarium/table-fx/scene-tool-permission';
import { ConfirmationComponent, ConfirmationType } from 'component/confirmation/confirmation.component';
import { FolderBackupListComponent } from 'component/folder-backup-list/folder-backup-list.component';
import { RoomSettingComponent } from 'component/room-setting/room-setting.component';
import * as localForage from 'localforage';
import { I18nService } from './i18n.service';
import { ModalService } from './modal.service';
import { FolderBackupCrypto, FolderBackupSecretsBlob } from './folder-backup-crypto';
import { RoomInviteService } from './room-invite.service';
import { SaveDataService } from './save-data.service';

export type FolderBackupStatus = 'unsupported' | 'unbound' | 'needAuth' | 'ready' | 'writing' | 'error';

export interface RoomBackupAuthSettings {
  allowUser: boolean;
  allowGuest: boolean;
  gmPassword: string;
  userPassword: string;
  guestPassword: string;
}

export type RoomBackupAuthStatus = 'ready' | 'legacy' | 'missing' | 'undecryptable';

export interface RoomBackupInfo {
  roomId: string;
  displayName: string;
  savedAt: string;
  zipFile: string;
  fileHandle: FileSystemFileHandle;
  auth?: RoomBackupAuthSettings;
  /** Whether role passwords can be restored on this browser. */
  authStatus: RoomBackupAuthStatus;
}

export interface RoomBackupMeta {
  roomId: string;
  displayName: string;
  savedAt: string;
  zipFile: string;
  allowUser?: boolean;
  allowGuest?: boolean;
  /** Encrypted role passwords (AES-GCM + PBKDF2 salt). */
  secrets?: FolderBackupSecretsBlob;
  /** @deprecated Legacy plaintext — read once for migration, never written again. */
  gmPassword?: string;
  /** @deprecated Legacy plaintext — read once for migration, never written again. */
  userPassword?: string;
  /** @deprecated Legacy plaintext — read once for migration, never written again. */
  guestPassword?: string;
}

export interface FolderFlushOptions {
  timeoutMs?: number;
  /** Write even if current identity is Guest (use after role already switched). */
  bypassGuest?: boolean;
  /** Write using last room snapshot even if peer left the room. */
  allowLeave?: boolean;
}

interface RoomSnapshot {
  roomId: string;
  displayName: string;
  auth?: RoomBackupAuthSettings;
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
  private writePromise: Promise<void> | null = null;
  private leaveFlushPromise: Promise<void> | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private minIntervalTimer: ReturnType<typeof setTimeout> | null = null;
  private lastWriteAt = 0;
  private activeRoomId = '';
  private lastRoomSnapshot: RoomSnapshot | null = null;
  private initialized = false;

  status: FolderBackupStatus = 'unsupported';
  folderName = '';
  lastSavedAt: string | null = null;
  lastError = '';

  constructor(
    private saveDataService: SaveDataService,
    private roomInvite: RoomInviteService,
    private ngZone: NgZone,
    private modalService: ModalService,
    private i18n: I18nService
  ) { }

  get needsBind(): boolean {
    return this.isSupported && (!this.hasFolder || this.status === 'unbound' || this.status === 'needAuth');
  }

  get canLoadFromFolder(): boolean {
    return this.isSupported && !Network.GuestMode() && this.isReady;
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

  get hasError(): boolean {
    return this.status === 'error';
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
      .on('OPEN_NETWORK', () => { void this.onNetworkOpen(); })
      .on('CHANGE_GM_MODE', () => { void this.onGuestModePossiblyChanged(); })
      .on('UPDATE_GAME_OBJECT', event => this.onGameObjectDirty(event.data?.aliasName))
      .on('DELETE_GAME_OBJECT', event => this.onGameObjectDirty(event.data?.aliasName));

    void this.onNetworkOpen();
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
      void this.onNetworkOpen();
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
      void this.onNetworkOpen();
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
    this.lastRoomSnapshot = null;
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

  async flush(options?: FolderFlushOptions): Promise<boolean> {
    if (!this.dirHandle) {
      return false;
    }
    if (Network.GuestMode() && !options?.bypassGuest) {
      return false;
    }
    const inRoom = !!Network.peer?.isRoom;
    if (!inRoom && !options?.allowLeave) {
      return false;
    }
    if (!inRoom && options?.allowLeave && !this.lastRoomSnapshot) {
      this.dirty = false;
      this.clearTimers();
      return false;
    }

    if (this.status === 'needAuth' || this.status === 'error' || this.status === 'unbound') {
      const perm = await this.queryPermission(this.dirHandle);
      if (perm !== 'granted') {
        this.setStatus('needAuth');
        return false;
      }
      this.setStatus(this.writing ? 'writing' : 'ready');
    }

    this.clearTimers();
    this.dirty = true;
    const timeoutMs = options?.timeoutMs ?? FolderBackupService.DEFAULT_FLUSH_TIMEOUT_MS;
    try {
      await this.withTimeout(this.flushWrites(options), timeoutMs);
      return !this.dirty && !this.lastError;
    } catch (e) {
      console.warn('FolderBackup flush failed', e);
      this.lastError = String((e as Error)?.message || e);
      return false;
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
        if (!this.isSafeRoomFileName(meta.roomId) || !this.isSafeZipFileName(meta.zipFile)) continue;
        const zipHandle = await this.dirHandle.getFileHandle(meta.zipFile);
        const resolved = await this.authFromMeta(meta);
        results.push({
          roomId: meta.roomId,
          displayName: meta.displayName || meta.roomId,
          savedAt: meta.savedAt || '',
          zipFile: meta.zipFile,
          fileHandle: zipHandle,
          auth: resolved.auth,
          authStatus: resolved.status,
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
    if (!this.isSafeZipFileName(zipFile) || !this.isSafeRoomFileName(backup.roomId)) return false;

    let zipRemoved = false;
    let metaRemoved = false;
    try {
      await this.dirHandle.removeEntry(zipFile);
      zipRemoved = true;
    } catch (e) {
      console.warn('Failed to remove backup zip', zipFile, e);
    }
    try {
      await this.dirHandle.removeEntry(metaFile);
      metaRemoved = true;
    } catch (e) {
      console.warn('Failed to remove backup meta', metaFile, e);
    }
    try {
      await this.dirHandle.removeEntry(`${zipFile}.tmp`);
    } catch { /* ignore missing temp */ }
    return zipRemoved || metaRemoved;
  }

  async ensureBound(): Promise<boolean> {
    if (!this.isSupported || Network.GuestMode()) return false;
    if (this.status === 'needAuth') return this.requestAccess();
    if (!this.hasFolder || this.status === 'unbound') return this.bindFolder();
    if (this.status === 'error') return this.requestAccess();
    return this.isReady;
  }

  async openLoadUi(): Promise<void> {
    if (!this.canLoadFromFolder) return;
    if (!SceneToolPermission.instance.canLoadRoom()) return;

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
        text: this.i18n.t('menu.confirm.loadFolder.text', {
          name: selected.displayName || selected.roomId,
          id: selected.roomId,
        }),
        help: this.resumeConfirmHelp(selected.authStatus),
        type: ConfirmationType.OK_CANCEL,
        materialIcon: 'folder',
        okLabel: this.i18n.t('menu.confirm.loadFolder.resumeRoom'),
        cancelLabel: this.i18n.t('menu.confirm.loadZip.loadDirect'),
        cancelAction: () => {
          loadDirect = true;
          void this.loadRoomBackup(selected);
        },
      });
      if (choice === true) {
        await this.modalService.open(RoomSettingComponent, {
          width: 720,
          height: 720,
          left: 0,
          top: 80,
          preferredRoomId: selected.roomId,
          preferredRoomName: selected.displayName,
          preferredAuth: selected.auth,
          preferredAuthStatus: selected.authStatus,
          afterCreate: () => { void this.loadRoomBackup(selected); },
        });
      }
      if (loadDirect || choice === false) return;
      return;
    }

    // Already in a room: same roomId keeps one backup; different id forks a new zip.
    const sameRoom = Network.peer.roomId === selected.roomId;
    const overwrite = await this.modalService.open(ConfirmationComponent, {
      title: this.i18n.t('menu.confirm.loadFolder.overwrite.title'),
      text: this.i18n.t('menu.confirm.loadFolder.overwrite.text'),
      help: sameRoom
        ? this.i18n.t('menu.confirm.loadFolder.overwrite.help')
        : this.i18n.t('menu.confirm.loadFolder.overwrite.helpFork', {
          currentId: Network.peer.roomId,
          backupId: selected.roomId,
        }),
      type: ConfirmationType.OK_CANCEL,
      materialIcon: 'folder',
    });
    if (overwrite === true) {
      await this.loadRoomBackup(selected);
    }
  }

  private async onNetworkOpen() {
    const peer = Network.peer;
    if (!peer?.isRoom) {
      if (!this.leaveFlushPromise) {
        this.leaveFlushPromise = this.handleLeaveRoom().finally(() => {
          this.leaveFlushPromise = null;
        });
      }
      await this.leaveFlushPromise;
      return;
    }

    const roomId = peer.roomId || '';
    const prevSnapshot = this.lastRoomSnapshot;
    if (prevSnapshot && prevSnapshot.roomId !== roomId && (this.dirty || this.writing || this.writePromise)) {
      await this.flush({
        timeoutMs: FolderBackupService.DEFAULT_FLUSH_TIMEOUT_MS,
        bypassGuest: true,
        allowLeave: true,
      });
    }

    this.captureRoomSnapshot();
    this.activeRoomId = roomId;
    this.listening = !Network.GuestMode();
    if (!this.listening) this.clearTimers();
  }

  private async handleLeaveRoom() {
    if ((this.dirty || this.writing || this.writePromise) && this.dirHandle && this.lastRoomSnapshot) {
      await this.flush({
        timeoutMs: FolderBackupService.DEFAULT_FLUSH_TIMEOUT_MS,
        bypassGuest: true,
        allowLeave: true,
      });
    }
    this.activeRoomId = '';
    this.listening = false;
    this.clearTimers();
    this.dirty = false;
    this.writeAgain = false;
    this.lastRoomSnapshot = null;
  }

  private async onGuestModePossiblyChanged() {
    if (Network.GuestMode()) {
      if (this.dirty || this.writing || this.writePromise) {
        await this.flush({
          timeoutMs: FolderBackupService.DEFAULT_FLUSH_TIMEOUT_MS,
          bypassGuest: true,
        });
      }
      this.listening = false;
      this.clearTimers();
      return;
    }
    await this.onNetworkOpen();
  }

  private onGameObjectDirty(aliasName?: string) {
    if (!this.listening || !this.canAutoWrite) return;
    if (aliasName === PeerCursor.aliasName) return;
    this.captureRoomSnapshot();
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
    await this.performWrite({});
  }

  private async flushWrites(options?: FolderFlushOptions): Promise<void> {
    if (this.writePromise) {
      try {
        await this.writePromise;
      } catch {
        // Retry below.
      }
    }
    this.dirty = true;
    await this.performWrite(options || {});
    if (this.dirty || this.writeAgain) {
      this.writeAgain = false;
      this.dirty = true;
      await this.performWrite(options || {});
    }
  }

  private async performWrite(options: FolderFlushOptions): Promise<void> {
    if (this.writePromise) {
      this.writeAgain = true;
      this.dirty = true;
      await this.writePromise;
      if (!this.dirty && !this.writeAgain) return;
    }

    if (!this.dirHandle) return;
    if (Network.GuestMode() && !options.bypassGuest) return;

    const snapshot = this.resolveSnapshot(options.allowLeave);
    if (!snapshot || !this.isSafeRoomFileName(snapshot.roomId)) return;

    this.writing = true;
    this.dirty = false;
    this.writeAgain = false;
    this.setStatus('writing');

    const run = async () => {
      try {
        let metaAuth: {
          allowUser: boolean;
          allowGuest: boolean;
          secrets?: FolderBackupSecretsBlob;
        } | undefined;
        if (snapshot.auth) {
          const secrets = await FolderBackupCrypto.encrypt({
            gmPassword: snapshot.auth.gmPassword,
            userPassword: snapshot.auth.userPassword,
            guestPassword: snapshot.auth.guestPassword,
          });
          metaAuth = {
            allowUser: snapshot.auth.allowUser,
            allowGuest: snapshot.auth.allowGuest,
            secrets,
          };
        }
        await this.saveDataService.saveRoomToDirectoryAsync(
          this.dirHandle,
          snapshot.roomId,
          snapshot.displayName,
          undefined,
          metaAuth
        );
        this.lastWriteAt = Date.now();
        this.lastSavedAt = new Date().toISOString();
        this.lastError = '';
        this.activeRoomId = snapshot.roomId;
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
        if (this.writeAgain) {
          this.writeAgain = false;
          this.dirty = true;
        }
        if (this.dirty && !options.bypassGuest && !options.allowLeave) {
          this.scheduleWrite();
        } else if (this.status === 'writing') {
          this.setStatus('ready');
        }
      }
    };

    this.writePromise = run().finally(() => {
      this.writePromise = null;
    });
    await this.writePromise;
  }

  private resolveSnapshot(allowLeave?: boolean): RoomSnapshot | null {
    if (Network.peer?.isRoom && Network.peer.roomId) {
      this.captureRoomSnapshot();
      return this.lastRoomSnapshot;
    }
    if (allowLeave) return this.lastRoomSnapshot;
    return null;
  }

  private captureRoomSnapshot() {
    const peer = Network.peer;
    if (!peer?.isRoom || !peer.roomId) return;
    this.lastRoomSnapshot = {
      roomId: peer.roomId,
      displayName: RoomAuth.displayRoomName(peer.roomName || peer.roomId) || peer.roomId,
      auth: this.captureAuthSettings(peer.roomName || ''),
    };
  }

  private captureAuthSettings(roomName: string): RoomBackupAuthSettings {
    const info = RoomAuth.parse(roomName);
    const allowUser = info.user.mode !== 'disabled';
    const allowGuest = info.guest.mode !== 'disabled';
    return {
      allowUser,
      allowGuest,
      gmPassword: this.roomInvite.getRolePassword('gm'),
      userPassword: allowUser ? this.roomInvite.getRolePassword('user') : '',
      guestPassword: allowGuest ? this.roomInvite.getRolePassword('guest') : '',
    };
  }

  private resumeConfirmHelp(status: RoomBackupAuthStatus): string {
    const base = this.i18n.t('menu.confirm.loadFolder.help');
    let extra = this.i18n.t('menu.confirm.loadFolder.helpAuthMissing');
    switch (status) {
      case 'ready':
        extra = this.i18n.t('menu.confirm.loadFolder.helpAuthReady');
        break;
      case 'legacy':
        extra = this.i18n.t('menu.confirm.loadFolder.helpAuthLegacy');
        break;
      case 'undecryptable':
        extra = this.i18n.t('menu.confirm.loadFolder.helpAuthUndecryptable');
        break;
      default:
        break;
    }
    return `${base}\n\n${extra}`;
  }

  private async authFromMeta(meta: RoomBackupMeta): Promise<{
    auth?: RoomBackupAuthSettings;
    status: RoomBackupAuthStatus;
  }> {
    const hasAllow = meta.allowUser != null || meta.allowGuest != null;
    const hasLegacyPlain =
      meta.gmPassword != null || meta.userPassword != null || meta.guestPassword != null;
    const hasSecrets = !!meta.secrets;

    if (!hasAllow && !hasLegacyPlain && !hasSecrets) {
      return { status: 'missing' };
    }

    let gmPassword = '';
    let userPassword = '';
    let guestPassword = '';
    let status: RoomBackupAuthStatus = 'missing';

    if (meta.secrets) {
      const decrypted = await FolderBackupCrypto.decrypt(meta.secrets);
      if (decrypted) {
        gmPassword = decrypted.gmPassword;
        userPassword = decrypted.userPassword;
        guestPassword = decrypted.guestPassword;
        status = 'ready';
      } else {
        status = 'undecryptable';
      }
    } else if (hasLegacyPlain) {
      gmPassword = String(meta.gmPassword || '');
      userPassword = String(meta.userPassword || '');
      guestPassword = String(meta.guestPassword || '');
      status = 'legacy';
    } else if (hasAllow) {
      // Allow flags only — passwords never saved (or empty).
      status = 'missing';
    }

    return {
      status,
      auth: {
        allowUser: meta.allowUser !== false,
        allowGuest: meta.allowGuest !== false,
        gmPassword,
        userPassword,
        guestPassword,
      },
    };
  }

  private isSafeRoomFileName(roomId: string): boolean {
    return !!roomId && /^[A-Za-z0-9_-]{1,32}$/.test(roomId);
  }

  private isSafeZipFileName(name: string): boolean {
    return !!name && /^[A-Za-z0-9_-]{1,32}\.zip$/.test(name);
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
