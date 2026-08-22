import { ChangeDetectionStrategy, ChangeDetectorRef, Component, HostListener, OnDestroy, OnInit } from '@angular/core';

import { ObjectStore } from '@udonarium/core/synchronize-object/object-store';
import { EventSystem, Network } from '@udonarium/core/system';
import { StringUtil } from '@udonarium/core/system/util/string-util';
import { PeerCursor } from '@udonarium/peer-cursor';
import { PresetSound, SoundEffect } from '@udonarium/sound-effect';
import { TabletopObject } from '@udonarium/tabletop-object';
import { TextNote } from '@udonarium/text-note';
import { NOTE_FILE_ACCEPT } from '@udonarium/note-file-kind';

import { buildNoteHandoutPayload } from 'component/note-handout/note-handout.component';
import { ConfirmationComponent, ConfirmationType } from 'component/confirmation/confirmation.component';
import { NoteSettingsComponent } from 'component/note-settings/note-settings.component';
import { ContextMenuAction, ContextMenuService, ContextMenuSeparator } from 'service/context-menu.service';
import { I18nService } from 'service/i18n.service';
import { ModalService } from 'service/modal.service';
import { NoteImportService } from 'service/note-import.service';
import { PanelOption, PanelService } from 'service/panel.service';
import { PointerDeviceService } from 'service/pointer-device.service';

@Component({
  selector: 'note-inventory',
  templateUrl: './note-inventory.component.html',
  styleUrls: ['../shared/settings-ui.css', './note-inventory.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: false
})
export class NoteInventoryComponent implements OnInit, OnDestroy {
  inventoryTypes: string[] = ['all', 'table', 'common', Network.peerId, 'graveyard'];
  private _selectTab = 'all';
  get selectTab(): string { return this._selectTab; }
  set selectTab(selectTab: string) {
    this._selectTab = selectTab;
    this.selectedIdentifier = '';
    this.expandedId = '';
  }

  selectedIdentifier: string = '';
  expandedId: string = '';
  isDragOver = false;
  dropTargetTab = '';
  private noteDragBlocked = false;

  get isGM(): boolean { return !!PeerCursor.myCursor?.isGMMode; }

  private textNoteCache = new TabletopCache<TextNote>(() => ObjectStore.instance.getObjects(TextNote));
  get textNotes(): TextNote[] { return this.textNoteCache.objects; }
  get selected(): TextNote {
    const obj = ObjectStore.instance.get(this.selectedIdentifier);
    return obj instanceof TextNote ? obj : null;
  }

  constructor(
    private changeDetector: ChangeDetectorRef,
    private panelService: PanelService,
    private contextMenuService: ContextMenuService,
    private pointerDeviceService: PointerDeviceService,
    private noteImport: NoteImportService,
    private modalService: ModalService,
    private i18n: I18nService,
  ) { }

  GuestMode() {
    return Network.GuestMode();
  }

  ngOnInit() {
    Promise.resolve().then(() => this.refreshPanelTitle());
    EventSystem.register(this)
      .on('SELECT_TABLETOP_OBJECT', event => {
        const object = ObjectStore.instance.get(event.data.identifier);
        if (object instanceof TextNote) {
          this.selectedIdentifier = event.data.identifier;
          this.changeDetector.markForCheck();
        }
      })
      .on('SELECT_GAME_TABLE', () => this.refresh())
      .on('UPDATE_INVENTORY', () => this.refresh())
      .on('UPDATE_GAME_OBJECT', () => this.refresh())
      .on('DISCONNECT_PEER', () => this.changeDetector.markForCheck())
      .on('OPEN_NETWORK', () => {
        this.inventoryTypes = ['all', 'table', 'common', Network.peerId, 'graveyard'];
        if (!this.inventoryTypes.includes(this.selectTab)) {
          this.selectTab = 'all';
        }
        this.changeDetector.markForCheck();
      })
      .on('LOCALE_CHANGED', () => {
        this.refreshPanelTitle();
        this.changeDetector.markForCheck();
      });
  }

  ngOnDestroy() {
    EventSystem.unregister(this);
  }

  @HostListener('contextmenu', ['$event'])
  onHostContextMenu(e: Event) {
    e.preventDefault();
  }

  refresh() {
    this.textNoteCache.refresh();
    this.changeDetector.markForCheck();
  }

  getTabTitle(inventoryType: string): string {
    switch (inventoryType) {
      case 'all':
        return this.i18n.t('inv.tab.all');
      case 'table':
        return this.i18n.t('inv.tab.table');
      case Network.peerId:
        return this.i18n.t('inv.tab.personal');
      case 'graveyard':
        return this.i18n.t('inv.tab.graveyard');
      default:
        return this.i18n.t('inv.tab.common');
    }
  }

  /** Hide other players' self-only notes (owner + GM can see — same as tokens). */
  private visibleNotes(notes: TextNote[]): TextNote[] {
    const gm = this.isGM;
    return (notes || []).filter(n => n?.canSeeSelfOnly || gm);
  }

  getNotes(inventoryType: string): TextNote[] {
    const notes = this.visibleNotes(this.textNotes);
    switch (inventoryType) {
      case 'table':
        return notes.filter(n => n.location?.name === 'table');
      case Network.peerId:
        return notes.filter(n => n.location?.name === Network.peerId);
      case 'graveyard':
        return notes.filter(n => n.location?.name === 'graveyard');
      case 'common':
        return notes.filter(n => n.location?.name === 'common');
      default:
        return notes;
    }
  }

  getLocationLabel(note: TextNote): string {
    if (note.isVisibleOnTable) return this.i18n.t('note.location.table');
    const loc = note.location?.name || '';
    if (loc === 'graveyard') return this.i18n.t('note.location.graveyard');
    if (loc === 'common') return this.i18n.t('note.location.common');
    if (loc === Network.peerId) return this.i18n.t('note.location.personal');
    if (loc === 'table') return this.i18n.t('note.location.otherMap');
    return loc || '-';
  }

  settotable(gameObject: TextNote) {
    if (this.GuestMode()) return;
    gameObject.addToTable();
    this.refresh();
  }

  showgameObject(gameObject: TextNote) {
    return gameObject.title || this.i18n.t('note.untitled');
  }

  isittable(note: TextNote) {
    return note.isVisibleOnTable;
  }

  isOnOtherTable(note: TextNote): boolean {
    return note.location?.name === 'table' && !note.isVisibleOnTable;
  }

  selectNote(note: TextNote) {
    if (this.selectedIdentifier === note.identifier) {
      this.selectedIdentifier = '';
      if (this.expandedId === note.identifier) {
        this.expandedId = '';
      }
      this.changeDetector.markForCheck();
      return;
    }
    this.ensureNoteSelected(note);
  }

  private ensureNoteSelected(note: TextNote) {
    this.selectedIdentifier = note.identifier;
    EventSystem.trigger('SELECT_TABLETOP_OBJECT', { identifier: note.identifier, className: note.aliasName });
    this.changeDetector.markForCheck();
  }

  focusNote(note: TextNote, e: Event) {
    if (!(e.target instanceof HTMLElement)) return;
    if (new Set(['input', 'button']).has(e.target.tagName.toLowerCase())) return;
    if (!note.isVisibleOnTable) return;
    EventSystem.trigger('FOCUS_TABLETOP_OBJECT', {
      x: note.location.x + note.width * 50 / 2,
      y: note.location.y + note.height * 50 / 2,
      z: note.posZ + (note.altitude > 0 ? note.altitude * 50 : 0),
    });
  }

  toggleExpand(note: TextNote) {
    this.expandedId = this.expandedId === note.identifier ? '' : note.identifier;
    this.changeDetector.markForCheck();
  }

  cleanGraveyard() {
    if (this.GuestMode()) return;
    const tabTitle = this.getTabTitle(this.selectTab);
    const notes = this.getNotes(this.selectTab);
    this.modalService.open(ConfirmationComponent, {
      title: this.i18n.t('note.emptyGraveyardTitle'),
      text: this.i18n.t('note.emptyGraveyardText'),
      helpHtml: this.i18n.t('note.emptyGraveyardHelp', { tab: StringUtil.escapeHtml(tabTitle), count: notes.length }),
      type: ConfirmationType.OK_CANCEL,
      materialIcon: 'delete_forever',
      action: () => {
        for (const note of notes) {
          note.destroy();
        }
        SoundEffect.play(PresetSound.sweep);
        this.refresh();
      }
    });
  }

  onContextMenu(event: Event, gameObject: TextNote) {
    event.stopPropagation();
    event.preventDefault();

    if (this.GuestMode()) return;
    if (document.activeElement instanceof HTMLInputElement && document.activeElement.getAttribute('type') !== 'range') return;
    if (!this.pointerDeviceService.isAllowedToOpenContextMenu) return;

    this.ensureNoteSelected(gameObject);

    const target = event.target as HTMLElement;
    let position;
    if (target && target.tagName === 'BUTTON') {
      const clientRect = target.getBoundingClientRect();
      position = {
        x: window.pageXOffset + clientRect.left + target.clientWidth,
        y: window.pageYOffset + clientRect.top
      };
    } else {
      position = this.pointerDeviceService.pointers[0];
    }

    const location = gameObject.location?.name || '';
    const onCurrentMap = gameObject.isVisibleOnTable;
    const onOtherMap = this.isOnOtherTable(gameObject);
    const actions: ContextMenuAction[] = [
      onCurrentMap ? {
        name: this.i18n.t('char.findOnTable'),
        action: () => this.focusNote(gameObject, event),
        default: true,
      } : null,
      {
        name: this.i18n.t(onOtherMap ? 'inv.placeOnCurrentMap' : 'note.moveToTable'),
        action: () => {
          gameObject.addToTable();
          this.refresh();
        },
        disabled: onCurrentMap
      },
      {
        name: this.i18n.t('inv.moveToCurrentMapOnly'),
        action: () => {
          gameObject.moveToTableOnly();
          this.refresh();
        },
        disabled: !onOtherMap
      },
      {
        name: this.i18n.t('inv.removeFromCurrentMap'),
        action: () => {
          gameObject.removeFromTable();
          this.refresh();
        },
        disabled: !onCurrentMap
      },
      {
        name: this.i18n.t('note.moveToCommon'),
        action: () => {
          gameObject.setLocation('common');
          this.refresh();
        },
        disabled: location === 'common' || !location
      },
      {
        name: this.i18n.t('note.moveToPersonal'),
        action: () => {
          gameObject.setLocation(Network.peerId);
          this.refresh();
        },
        disabled: location === Network.peerId
      },
      {
        name: this.i18n.t('note.moveToGraveyard'),
        action: () => {
          if (gameObject.location?.name === 'table') {
            gameObject.leaveCurrentTable('graveyard');
          } else {
            gameObject.setLocation('graveyard');
          }
          SoundEffect.play(PresetSound.sweep);
          this.refresh();
        },
        disabled: location === 'graveyard'
      },
      ContextMenuSeparator,
      { name: this.i18n.t('note.edit'), action: () => { this.showDetail(gameObject); } },
      {
        name: this.i18n.t('note.showPlayers'),
        action: () => this.showToPlayers(gameObject),
        disabled: !this.isGM
      },
      {
        name: this.i18n.t('note.previewSelf'),
        action: () => this.previewSelf(gameObject)
      },
      {
        name: this.i18n.t('note.clone'),
        action: () => {
          const cloneObject = gameObject.clone();
          cloneObject.isLocked = false;
          SoundEffect.play(PresetSound.cardPut);
          this.refresh();
        }
      },
      ContextMenuSeparator,
      location === 'graveyard' ? {
        name: this.i18n.t('char.deleteForever'),
        action: () => {
          gameObject.destroy();
          SoundEffect.play(PresetSound.sweep);
          this.refresh();
        }
      } : {
        name: this.i18n.t('char.deleteToGraveyard'),
        action: () => {
          if (gameObject.location?.name === 'table') {
            gameObject.leaveCurrentTable('graveyard');
          } else {
            gameObject.setLocation('graveyard');
          }
          SoundEffect.play(PresetSound.sweep);
          this.refresh();
        }
      },
    ].filter((a): a is ContextMenuAction => !!a);

    this.contextMenuService.open(position, actions, this.showgameObject(gameObject));
  }

  onDragOver(e: DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    this.isDragOver = true;
  }

  onDragLeave(e: DragEvent) {
    e.preventDefault();
    this.isDragOver = false;
  }

  async onDrop(e: DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    this.isDragOver = false;
    if (this.GuestMode()) return;
    const files = e.dataTransfer?.files;
    if (!files?.length) return;
    await this.noteImport.importFiles(files, { addToTable: true });
    this.refresh();
  }

  onNoteDragGestureStart(e: Event) {
    this.noteDragBlocked = this.isNoteUiControl(e.target);
    if (this.noteDragBlocked && e.type === 'dragstart') {
      e.preventDefault();
    }
  }

  onNoteDragStart(e: DragEvent, note: TextNote) {
    if (this.GuestMode() || this.noteDragBlocked) return;
    e.stopPropagation();
    if (!e.dataTransfer) return;
    e.dataTransfer.effectAllowed = 'move';
    const payload = note.identifier;
    e.dataTransfer.setData(TextNote.INVENTORY_DRAG_MIME, payload);
    e.dataTransfer.setData('text/plain', `udonarium-note:${payload}`);
  }

  onNoteDragEnd() {
    this.noteDragBlocked = false;
    this.dropTargetTab = '';
    this.changeDetector.markForCheck();
  }

  onTabDragOver(e: DragEvent, inventoryType: string) {
    if (inventoryType === 'all') return;
    if (!this.readNoteDragIds(e).length) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    if (this.dropTargetTab !== inventoryType) {
      this.dropTargetTab = inventoryType;
      this.changeDetector.markForCheck();
    }
  }

  onTabDragLeave(e: DragEvent, inventoryType: string) {
    const related = e.relatedTarget as Node | null;
    const current = e.currentTarget as Node | null;
    if (related && current && current.contains(related)) return;
    if (this.dropTargetTab === inventoryType) {
      this.dropTargetTab = '';
      this.changeDetector.markForCheck();
    }
  }

  onTabDrop(e: DragEvent, inventoryType: string) {
    const ids = this.readNoteDragIds(e);
    this.dropTargetTab = '';
    if (!ids.length || ids[0] === '__pending__') return;
    if (inventoryType === 'all') return;
    e.preventDefault();
    e.stopPropagation();
    if (this.GuestMode()) return;
    let moved = 0;
    for (const id of ids) {
      const note = ObjectStore.instance.get(id);
      if (!(note instanceof TextNote)) continue;
      if (note.location?.name === inventoryType) {
        if (inventoryType === 'table' && this.isOnOtherTable(note)) {
          // fall through — place on current map
        } else {
          continue;
        }
      }
      this.moveNoteToLocation(note, inventoryType);
      moved++;
    }
    if (moved > 0 && this.selectTab !== inventoryType) {
      this.selectTab = inventoryType;
    }
    this.changeDetector.markForCheck();
  }

  private moveNoteToLocation(note: TextNote, location: string) {
    if (location === 'table') {
      if (note.location?.name === 'table' && !note.isVisibleOnTable) {
        note.moveToTableOnly();
      } else if (!note.isVisibleOnTable) {
        note.addToTable();
      }
    } else if (location === 'graveyard') {
      if (note.location?.name === 'table') {
        note.leaveCurrentTable('graveyard');
      } else {
        note.setLocation('graveyard');
      }
    } else {
      note.setLocation(location);
    }
    SoundEffect.play(location === 'graveyard' ? PresetSound.sweep : PresetSound.piecePut);
    EventSystem.call('UPDATE_INVENTORY', true);
    this.refresh();
  }

  private readNoteDragIds(e: DragEvent): string[] {
    if (!e.dataTransfer) return [];
    const typed = e.dataTransfer.getData(TextNote.INVENTORY_DRAG_MIME);
    if (typed) return [typed];
    if (e.type === 'dragover') {
      const types = Array.from(e.dataTransfer.types || []);
      if (types.includes(TextNote.INVENTORY_DRAG_MIME) || types.includes('text/plain')) {
        return ['__pending__'];
      }
      return [];
    }
    const plain = e.dataTransfer.getData('text/plain') || '';
    const m = /^udonarium-note:(.+)$/.exec(plain);
    return m?.[1] ? [m[1]] : [];
  }

  private isNoteUiControl(target: EventTarget | null): boolean {
    if (!(target instanceof Element)) return false;
    return !!target.closest('input, button, select, textarea, a, label, note-settings');
  }

  pickImport() {
    if (this.GuestMode()) return;
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.accept = NOTE_FILE_ACCEPT;
    input.onchange = async () => {
      if (!input.files?.length) return;
      await this.noteImport.importFiles(input.files, { addToTable: true });
      this.refresh();
    };
    input.click();
  }

  private showToPlayers(note: TextNote) {
    if (!this.isGM || !note) return;
    const data = buildNoteHandoutPayload(note, this.i18n.t('note.untitled'));
    if (!data.imageUrl && !data.pdfIdentifier && !data.videoUrl && !data.videoIdentifier && !data.text) {
      data.text = note.title || this.i18n.t('note.untitled');
    }
    EventSystem.call('SHOW_NOTE_HANDOUT', data);
    EventSystem.trigger('SHOW_NOTE_HANDOUT', data);
  }

  private previewSelf(note: TextNote) {
    if (!note) return;
    const data = buildNoteHandoutPayload(note, this.i18n.t('note.untitled'));
    if (!data.imageUrl && !data.pdfIdentifier && !data.videoUrl && !data.videoIdentifier && !data.text) {
      data.text = note.title || this.i18n.t('note.untitled');
    }
    EventSystem.trigger('SHOW_NOTE_HANDOUT', data);
  }

  private showDetail(gameObject: TextNote) {
    if (this.GuestMode()) return;
    EventSystem.trigger('SELECT_TABLETOP_OBJECT', { identifier: gameObject.identifier, className: gameObject.aliasName });
    let title = this.i18n.t('note.detailTitle');
    if (gameObject.title.length) title += ' - ' + gameObject.title;
    const tourId = PanelService.tourIdObjectDetail(gameObject.identifier);
    if (PanelService.bringTourPanelToFront(tourId, { title })) return;
    const coordinate = this.pointerDeviceService.pointers[0];
    const option: PanelOption = {
      title: title, left: coordinate.x - 280, top: coordinate.y - 180, width: 420, height: 440,
      tourPanelId: tourId,
      geometryKey: PanelService.sheetGeometryKey(gameObject.aliasName),
    };
    const component = this.panelService.open<NoteSettingsComponent>(NoteSettingsComponent, option);
    component.note = gameObject;
    component.embedded = false;
  }

  trackByGameObject(index: number, gameObject: TextNote) {
    return gameObject ? gameObject.identifier : index;
  }

  private refreshPanelTitle() {
    this.panelService.title = this.i18n.t('note.title');
  }
}

class TabletopCache<T extends TabletopObject> {
  private needsRefresh: boolean = true;
  private _objects: T[] = [];

  get objects(): T[] {
    if (this.needsRefresh) {
      this._objects = this.refreshCollector() || [];
      this.needsRefresh = false;
    }
    return this._objects;
  }

  constructor(private refreshCollector: () => T[]) { }

  refresh() { this.needsRefresh = true; }
}
