import { Component, OnDestroy, OnInit } from '@angular/core';
import { EventSystem } from '@udonarium/core/system';
import { ConfirmationComponent, ConfirmationType } from 'component/confirmation/confirmation.component';
import { FolderBackupService, RoomBackupInfo } from 'service/folder-backup.service';
import { I18nService } from 'service/i18n.service';
import { ModalService } from 'service/modal.service';
import { PanelService } from 'service/panel.service';

@Component({
  selector: 'app-folder-backup-list',
  templateUrl: './folder-backup-list.component.html',
  styleUrls: ['./folder-backup-list.component.css'],
  standalone: false
})
export class FolderBackupListComponent implements OnInit, OnDestroy {
  backups: RoomBackupInfo[] = [];
  deletingRoomId = '';

  constructor(
    private modalService: ModalService,
    private panelService: PanelService,
    private i18n: I18nService,
    private folderBackup: FolderBackupService
  ) {
    this.backups = Array.isArray(this.modalService.option?.backups)
      ? this.modalService.option.backups
      : [];
  }

  ngOnInit() {
    this.refreshTitle();
    EventSystem.register(this).on('LOCALE_CHANGED', () => this.refreshTitle());
    if (!this.backups.length) {
      void this.reloadList();
    }
  }

  ngOnDestroy() {
    EventSystem.unregister(this);
  }

  select(backup: RoomBackupInfo) {
    this.modalService.resolve(backup);
  }

  cancel() {
    this.modalService.resolve(null);
  }

  async deleteBackup(backup: RoomBackupInfo) {
    if (this.deletingRoomId) return;
    const ok = await this.modalService.open(ConfirmationComponent, {
      title: this.i18n.t('folderBackup.deleteConfirm.title'),
      text: this.i18n.t('folderBackup.deleteConfirm.text', {
        name: backup.displayName || backup.roomId,
      }),
      help: this.i18n.t('folderBackup.deleteConfirm.help'),
      type: ConfirmationType.OK_CANCEL,
      materialIcon: 'delete',
    });
    if (ok !== true) return;

    this.deletingRoomId = backup.roomId;
    try {
      const deleted = await this.folderBackup.deleteRoomBackup(backup);
      if (deleted) {
        this.backups = this.backups.filter(item => item.roomId !== backup.roomId);
      }
    } finally {
      this.deletingRoomId = '';
    }
  }

  formatSavedAt(savedAt: string): string {
    if (!savedAt) return '-';
    const date = new Date(savedAt);
    if (Number.isNaN(date.getTime())) return savedAt;
    return date.toLocaleString();
  }

  private async reloadList() {
    this.backups = await this.folderBackup.listRoomBackups();
  }

  private refreshTitle() {
    this.modalService.title = this.panelService.title = this.i18n.t('folderBackup.loadTitle');
  }
}
