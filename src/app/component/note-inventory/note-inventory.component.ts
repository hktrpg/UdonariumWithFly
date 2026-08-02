import { AfterViewInit, ChangeDetectionStrategy, ChangeDetectorRef, Component, ElementRef, Input, NgZone, OnDestroy, OnInit, ViewChild } from '@angular/core';

import { ObjectStore } from '@udonarium/core/synchronize-object/object-store';
import { EventSystem, Network } from '@udonarium/core/system';
import { DataElement } from '@udonarium/data-element';
import { SortOrder } from '@udonarium/data-summary-setting';
import { GameCharacter } from '@udonarium/game-character';
import { PeerCursor } from '@udonarium/peer-cursor';
import { TabletopObject } from '@udonarium/tabletop-object';
import { TextNote } from '@udonarium/text-note';

import { ObjectNode } from '@udonarium/core/synchronize-object/object-node';
import { GameObjectInventoryService } from 'service/game-object-inventory.service';
import { PanelService } from 'service/panel.service';

@Component({
  selector: 'note-inventory',
  templateUrl: './note-inventory.component.html',
  styleUrls: ['./note-inventory.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: false
})
export class NoteInventoryComponent implements OnInit, AfterViewInit, OnDestroy {
  inventoryTypes: string[] = ['table', 'common', 'graveyard'];
  @Input() gameCharacter: GameCharacter = null;
  @Input() textNote: TextNote = null;
  @ViewChild('textArea', { static: true }) textAreaElementRef: ElementRef;

  selectTab: string = 'table';
  selectedIdentifier: string = '';
  isEdit: boolean = false;

  private textNoteCache = new TabletopCache<TextNote>(() => ObjectStore.instance.getObjects(TextNote));
  get textNotes(): TextNote[] { return this.textNoteCache.objects; }

  get sortTag(): string { return this.inventoryService.sortTag; }
  set sortTag(sortTag: string) { this.inventoryService.sortTag = sortTag; }
  get sortOrder(): SortOrder { return this.inventoryService.sortOrder; }
  set sortOrder(sortOrder: SortOrder) { this.inventoryService.sortOrder = sortOrder; }
  get dataTag(): string { return this.inventoryService.dataTag; }
  set dataTag(dataTag: string) { this.inventoryService.dataTag = dataTag; }
  get dataTags(): string[] { return this.inventoryService.dataTags; }

  get sortOrderName(): string { return this.sortOrder === SortOrder.ASC ? '升序' : '降序'; }

  private calcFitHeightTimer: NodeJS.Timeout = null;

  constructor(
    private ngZone: NgZone,
    private changeDetector: ChangeDetectorRef,
    private panelService: PanelService,
    private inventoryService: GameObjectInventoryService,
  ) { }

  ngOnInit() {
    this.panelService.title = '筆記倉庫';
    EventSystem.register(this)
      .on('SELECT_TABLETOP_OBJECT', -1000, event => {
        let object = ObjectStore.instance.get(event.data.identifier);
        if ((object instanceof TabletopObject) || (object instanceof PeerCursor) || object instanceof ObjectNode || this.textNote === object) {
          this.selectedIdentifier = event.data.identifier;
          this.changeDetector.markForCheck();
        }
      })
      .on('UPDATE_FILE_RESOURE', -1000, event => {
        this.changeDetector.markForCheck();
      })
      .on('SYNCHRONIZE_FILE_LIST', event => {
        this.changeDetector.markForCheck();
      })
      .on('UPDATE_INVENTORY', event => {
        this.textNoteCache.refresh();
        this.changeDetector.markForCheck();
      })
      .on('UPDATE_GAME_OBJECT', event => {
        this.textNoteCache.refresh();
        this.changeDetector.markForCheck();
      })
      .on('OPEN_NETWORK', event => {
        this.selectTab = Network.peerId;
      }).on('DISCONNECT_PEER', event => {
        this.changeDetector.markForCheck();
      });
    this.inventoryTypes = ['table', 'common', Network.peerId, 'graveyard'];
  }

  ngAfterViewInit() { }

  ngOnDestroy() {
    EventSystem.unregister(this);
  }

  getTabTitle(inventoryType: string) {
    switch (inventoryType) {
      case 'table':
        return '桌面';
      case Network.peerId:
        return '個人倉庫';
      case 'graveyard':
        return '墓場';
      default:
        return '共有倉庫';
    }
  }

  getNotes() {
    return this.textNotes;
  }

  getInventory(inventoryType: string) {
    switch (inventoryType) {
      case 'table':
        return this.inventoryService.tableInventory;
      case Network.peerId:
        return this.inventoryService.privateInventory;
      case 'graveyard':
        return this.inventoryService.graveyardInventory;
      default:
        return this.inventoryService.commonInventory;
    }
  }

  calcFitHeightIfNeeded() {
    if (this.calcFitHeightTimer) return;
    this.ngZone.runOutsideAngular(() => {
      this.calcFitHeightTimer = setTimeout(() => {
        this.calcFitHeight();
        this.calcFitHeightTimer = null;
      }, 0);
    });
  }

  calcFitHeight() {
    if (!this.textAreaElementRef) return;
    let textArea: HTMLTextAreaElement = this.textAreaElementRef.nativeElement;
    textArea.style.height = '0';
    if (textArea.scrollHeight > textArea.offsetHeight) {
      textArea.style.height = textArea.scrollHeight + 'px';
    }
  }

  getGameObjects(inventoryType: string): TabletopObject[] {
    return this.getInventory(inventoryType).tabletopObjects;
  }

  getInventoryTags(gameObject: TextNote): DataElement[] {
    return this.getInventory(gameObject.location.name).dataElementMap.get(gameObject.identifier);
  }

  settotable(gameObject: TextNote) {
    gameObject.setLocation('table');
    this.textNoteCache.refresh();
    this.changeDetector.markForCheck();
  }

  showgameObject(gameObject: TextNote) {
    return gameObject.title || '(無標題筆記)';
  }

  isittable(note: TextNote) {
    return note.location.name == 'table';
  }

  isDisabled(_gameObject: TextNote) {
    return false;
  }

  toggleEdit() {
    this.isEdit = !this.isEdit;
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
