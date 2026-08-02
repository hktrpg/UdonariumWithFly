import { ChangeDetectionStrategy, ChangeDetectorRef, Component, OnDestroy, OnInit } from '@angular/core';

import { ObjectStore } from '@udonarium/core/synchronize-object/object-store';
import { EventSystem, Network } from '@udonarium/core/system';
import { PeerCursor } from '@udonarium/peer-cursor';
import { TabletopObject } from '@udonarium/tabletop-object';
import { TextNote } from '@udonarium/text-note';

import { ObjectNode } from '@udonarium/core/synchronize-object/object-node';
import { PanelService } from 'service/panel.service';

type NoteFilterId = 'all' | 'table' | 'other';

@Component({
  selector: 'note-inventory',
  templateUrl: './note-inventory.component.html',
  styleUrls: ['./note-inventory.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: false
})
export class NoteInventoryComponent implements OnInit, OnDestroy {
  selectFilter: NoteFilterId = 'all';
  selectedIdentifier: string = '';
  expandedId: string = '';

  readonly filters: { id: NoteFilterId, label: string }[] = [
    { id: 'all', label: '全部' },
    { id: 'table', label: '桌面' },
    { id: 'other', label: '其他' },
  ];

  private textNoteCache = new TabletopCache<TextNote>(() => ObjectStore.instance.getObjects(TextNote));
  get textNotes(): TextNote[] { return this.textNoteCache.objects; }

  constructor(
    private changeDetector: ChangeDetectorRef,
    private panelService: PanelService,
  ) { }

  GuestMode() {
    return Network.GuestMode();
  }

  ngOnInit() {
    this.panelService.title = '筆記倉庫';
    EventSystem.register(this)
      .on('SELECT_TABLETOP_OBJECT', -1000, event => {
        let object = ObjectStore.instance.get(event.data.identifier);
        if ((object instanceof TabletopObject) || (object instanceof PeerCursor) || object instanceof ObjectNode) {
          this.selectedIdentifier = event.data.identifier;
          this.changeDetector.markForCheck();
        }
      })
      .on('UPDATE_INVENTORY', event => {
        this.refresh();
      })
      .on('UPDATE_GAME_OBJECT', event => {
        this.refresh();
      })
      .on('DISCONNECT_PEER', event => {
        this.changeDetector.markForCheck();
      });
  }

  ngOnDestroy() {
    EventSystem.unregister(this);
  }

  refresh() {
    this.textNoteCache.refresh();
    this.changeDetector.markForCheck();
  }

  filteredNotes(): TextNote[] {
    const notes = this.textNotes || [];
    switch (this.selectFilter) {
      case 'table':
        return notes.filter(n => n.location?.name === 'table');
      case 'other':
        return notes.filter(n => n.location?.name !== 'table');
      default:
        return notes;
    }
  }

  countByFilter(filterId: NoteFilterId): number {
    const notes = this.textNotes || [];
    switch (filterId) {
      case 'table':
        return notes.filter(n => n.location?.name === 'table').length;
      case 'other':
        return notes.filter(n => n.location?.name !== 'table').length;
      default:
        return notes.length;
    }
  }

  locationLabel(note: TextNote): string {
    const name = note.location?.name || '';
    if (name === 'table') return '桌面';
    if (name === 'graveyard') return '墓場';
    if (name === 'common' || !name) return '共有';
    return '個人';
  }

  settotable(gameObject: TextNote) {
    if (this.GuestMode()) return;
    gameObject.setLocation('table');
    this.refresh();
  }

  showgameObject(gameObject: TextNote) {
    return gameObject.title || '(無標題筆記)';
  }

  isittable(note: TextNote) {
    return note.location?.name == 'table';
  }

  selectNote(note: TextNote) {
    this.selectedIdentifier = note.identifier;
    EventSystem.trigger('SELECT_TABLETOP_OBJECT', { identifier: note.identifier, className: 'GameCharacter' });
  }

  toggleExpand(note: TextNote) {
    this.expandedId = this.expandedId === note.identifier ? '' : note.identifier;
  }

  trackByGameObject(index: number, gameObject: TextNote) {
    return gameObject ? gameObject.identifier : index;
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

  constructor(readonly refreshCollector: () => T[]) { }

  refresh() {
    this.needsRefresh = true;
  }
}
