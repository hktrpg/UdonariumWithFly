import { ChangeDetectionStrategy, ChangeDetectorRef, Component, HostListener, OnDestroy, OnInit } from '@angular/core';

import { ObjectStore } from '@udonarium/core/synchronize-object/object-store';
import { EventSystem, Network } from '@udonarium/core/system';
import { PeerCursor } from '@udonarium/peer-cursor';
import { PresetSound, SoundEffect } from '@udonarium/sound-effect';
import { TabletopObject } from '@udonarium/tabletop-object';
import { TextNote } from '@udonarium/text-note';

import { ObjectNode } from '@udonarium/core/synchronize-object/object-node';
import { GameCharacterSheetComponent } from 'component/game-character-sheet/game-character-sheet.component';
import { ContextMenuAction, ContextMenuService, ContextMenuSeparator } from 'service/context-menu.service';
import { PanelOption, PanelService } from 'service/panel.service';
import { PointerDeviceService } from 'service/pointer-device.service';
import { I18nService } from 'service/i18n.service';

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
    private contextMenuService: ContextMenuService,
    private pointerDeviceService: PointerDeviceService,
    private i18n: I18nService,
  ) { }

  GuestMode() {
    return Network.GuestMode();
  }

  ngOnInit() {
    this.refreshLabels();
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
      })
      .on('LOCALE_CHANGED', () => {
        this.refreshLabels();
        this.changeDetector.markForCheck();
      });
  }

  ngOnDestroy() {
    EventSystem.unregister(this);
  }

  /** Blank area: block browser menu (item menus call stopPropagation). */
  @HostListener('contextmenu', ['$event'])
  onHostContextMenu(e: Event) {
    e.preventDefault();
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
    if (name === 'table') return this.i18n.t('note.location.table');
    if (name === 'graveyard') return this.i18n.t('note.location.graveyard');
    if (name === 'common' || !name) return this.i18n.t('note.location.common');
    return this.i18n.t('note.location.personal');
  }

  settotable(gameObject: TextNote) {
    if (this.GuestMode()) return;
    gameObject.setLocation('table');
    this.refresh();
  }

  showgameObject(gameObject: TextNote) {
    return gameObject.title || this.i18n.t('note.untitled');
  }

  isittable(note: TextNote) {
    return note.location?.name == 'table';
  }

  selectNote(note: TextNote) {
    this.selectedIdentifier = note.identifier;
    EventSystem.trigger('SELECT_TABLETOP_OBJECT', { identifier: note.identifier, className: note.aliasName });
  }

  toggleExpand(note: TextNote) {
    this.expandedId = this.expandedId === note.identifier ? '' : note.identifier;
  }

  onContextMenu(event: Event, gameObject: TextNote) {
    event.stopPropagation();
    event.preventDefault();

    if (this.GuestMode()) return;
    if (document.activeElement instanceof HTMLInputElement && document.activeElement.getAttribute('type') !== 'range') return;
    if (!this.pointerDeviceService.isAllowedToOpenContextMenu) return;

    this.selectNote(gameObject);

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
    const actions: ContextMenuAction[] = [
      {
        name: this.i18n.t('note.moveToTable'),
        action: () => {
          gameObject.setLocation('table');
          this.refresh();
        },
        disabled: location === 'table'
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
        name: this.i18n.t('note.moveToGraveyard'),
        action: () => {
          gameObject.setLocation('graveyard');
          this.refresh();
        },
        disabled: location === 'graveyard'
      },
      ContextMenuSeparator,
      { name: this.i18n.t('note.edit'), action: () => { this.showDetail(gameObject); } },
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
      {
        name: this.i18n.t('note.delete'),
        action: () => {
          gameObject.destroy();
          SoundEffect.play(PresetSound.sweep);
          this.refresh();
        }
      },
    ];

    this.contextMenuService.open(position, actions, this.showgameObject(gameObject));
  }

  private showDetail(gameObject: TextNote) {
    if (this.GuestMode()) return;
    EventSystem.trigger('SELECT_TABLETOP_OBJECT', { identifier: gameObject.identifier, className: gameObject.aliasName });
    const coordinate = this.pointerDeviceService.pointers[0];
    let title = this.i18n.t('note.detailTitle');
    if (gameObject.title.length) title += ' - ' + gameObject.title;
    const option: PanelOption = { title: title, left: coordinate.x - 350, top: coordinate.y - 200, width: 560, height: 470 };
    const component = this.panelService.open<GameCharacterSheetComponent>(GameCharacterSheetComponent, option);
    component.tabletopObject = gameObject;
  }

  trackByGameObject(index: number, gameObject: TextNote) {
    return gameObject ? gameObject.identifier : index;
  }

  private refreshLabels() {
    this.panelService.title = this.i18n.t('note.title');
    this.filters[0].label = this.i18n.t('note.filter.all');
    this.filters[1].label = this.i18n.t('note.filter.table');
    this.filters[2].label = this.i18n.t('note.filter.other');
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
