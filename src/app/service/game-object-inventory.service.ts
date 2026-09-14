import { Injectable } from '@angular/core';
import { CharacterToken } from '@udonarium/character-token';
import { ObjectStore } from '@udonarium/core/synchronize-object/object-store';
import { EventSystem, Network } from '@udonarium/core/system';
import { StringUtil } from '@udonarium/core/system/util/string-util';
import { DataElement } from '@udonarium/data-element';
import { DataSummarySetting, SortOrder } from '@udonarium/data-summary-setting';
import { GameCharacter } from '@udonarium/game-character';
import { isOverviewTagNewline } from '@udonarium/overview-data-tag.util';
import { TabletopObject } from '@udonarium/tabletop-object';

type ObjectIdentifier = string;
type LocationName = string;
type ElementName = string;

@Injectable({
  providedIn: 'root'
})
export class GameObjectInventoryService {
  private get summarySetting(): DataSummarySetting { return DataSummarySetting.instance; }

  get sortTag(): string { return this.summarySetting.sortTag; }
  set sortTag(sortTag: string) { this.summarySetting.sortTag = sortTag; }
  get sortOrder(): SortOrder { return this.summarySetting.sortOrder; }
  set sortOrder(sortOrder: SortOrder) { this.summarySetting.sortOrder = sortOrder; }
  get dataTag(): string { return this.summarySetting.dataTag; }
  set dataTag(dataTag: string) { this.summarySetting.dataTag = dataTag; }
  get dataTags(): string[] { return this.summarySetting.dataTags; }

  resolveDataTags(character?: GameCharacter | null): string[] {
    if (character instanceof GameCharacter
      && character.useCustomOverviewDataTag
      && 0 < (character.overviewDataTag || '').trim().length) {
      return character.overviewDataTags;
    }
    return this.dataTags;
  }

  /**
   * Build inventory-summary DataElements for any character body.
   * Used by overview for temporary copies that are excluded from inventory lists.
   */
  summaryElementsFor(object: TabletopObject): DataElement[] {
    if (!object?.detailDataElement) return [];
    const tags = object instanceof GameCharacter ? this.resolveDataTags(object) : this.dataTags;
    return tags.map(tag =>
      isOverviewTagNewline(tag)
        ? this.newLineDataElement
        : object.detailDataElement.getFirstElementByNameUnsensitive(tag)
    );
  }

  collectDisplayableFields(character: GameCharacter): DataElement[] {
    if (!character?.detailDataElement) return [];
    const result: DataElement[] = [];
    const walk = (element: DataElement) => {
      if (element.children.length < 1) {
        result.push(element);
        return;
      }
      for (const child of element.children) {
        if (child instanceof DataElement) walk(child);
      }
    };
    for (const child of character.detailDataElement.children) {
      if (child instanceof DataElement) walk(child);
    }
    return result;
  }

  /** Every character (all maps + inventories + graveyard). Temporary copies stay off the list. */
  allInventory: ObjectInventory;
  /** Bodies that have a Token on the currently viewed map. */
  tableInventory: ObjectInventory;
  /** Common inventory for the currently viewed map only. */
  commonInventory: ObjectInventory;
  privateInventory: ObjectInventory;
  /** Room-wide graveyard (shared across all maps). */
  graveyardInventory: ObjectInventory;

  indicateAll: boolean = false;
  
  private _sortStop: boolean = false;
  get sortStop(): boolean { return this._sortStop; }
  set sortStop(sortStop: boolean) { 
    const oldState = this._sortStop;
    this._sortStop = sortStop;
    if (oldState && !this._sortStop) this.refresh();
  }

  private locationMap: Map<ObjectIdentifier, LocationName> = new Map();
  private tableIdMap: Map<ObjectIdentifier, string> = new Map();
  private placementsMap: Map<ObjectIdentifier, string> = new Map();
  private tagNameMap: Map<ObjectIdentifier, ElementName> = new Map();
  private tokenPresenceMap: Map<ObjectIdentifier, string> = new Map();
  private overviewTagMap: Map<ObjectIdentifier, string> = new Map();

  static _newLineDataElement = createMockElement('/');
  get newLineDataElement(): DataElement { return GameObjectInventoryService._newLineDataElement; }

  constructor() {
    const summaryResolver = (object: TabletopObject) => this.summaryElementsFor(object);
    this.allInventory = new ObjectInventory(object => !object.isTemporaryCopy, summaryResolver);
    this.tableInventory = new ObjectInventory(object => {
      if (!(object instanceof GameCharacter) || object.isTemporaryCopy) return false;
      return CharacterToken.tokensOnTable(object.identifier).length > 0;
    }, summaryResolver);
    this.commonInventory = new ObjectInventory(object =>
      !object.isTemporaryCopy && !this.isAnyLocation(object.location.name) && object.isInventoryForCurrentView(), summaryResolver);
    this.privateInventory = new ObjectInventory(object =>
      !object.isTemporaryCopy && object.location.name === Network.peerId && object.isInventoryForCurrentView(), summaryResolver);
    this.graveyardInventory = new ObjectInventory(object =>
      !object.isTemporaryCopy && object.location.name === 'graveyard', summaryResolver);
    this.initialize();
  }

  private initialize() {
    EventSystem.register(this)
      .on('OPEN_NETWORK', event => { this.refresh(); })
      .on('CONNECT_PEER', event => { this.refresh(); })
      .on('DISCONNECT_PEER', event => { this.refresh(); })
      .on('SELECT_GAME_TABLE', event => { this.refresh(); })
      .on('UPDATE_GAME_OBJECT', event => {
        let object = ObjectStore.instance.get(event.data.identifier);
        if (!object) return;

        if (object instanceof CharacterToken) {
          const key = `${object.characterId}|${object.tablePlacements || ''}|${object.location.name}|${object.isTemporaryCopy}`;
          const prev = this.tokenPresenceMap.get(object.identifier);
          if (key !== prev) {
            this.tokenPresenceMap.set(object.identifier, key);
            this.refresh();
          }
        } else if (object instanceof GameCharacter) {
          let prevLocation = this.locationMap.get(object.identifier);
          let prevTableId = this.tableIdMap.get(object.identifier);
          const placementsKey = object.tablePlacements || '';
          const prevPlacements = this.placementsMap.get(object.identifier);
          if (object.location.name !== prevLocation || object.tableIdentifier !== prevTableId || placementsKey !== prevPlacements) {
            this.locationMap.set(object.identifier, object.location.name);
            this.tableIdMap.set(object.identifier, object.tableIdentifier);
            this.placementsMap.set(object.identifier, placementsKey);
            this.refresh();
          }
          const overviewKey = `${object.useCustomOverviewDataTag ? 1 : 0}|${object.overviewDataTag || ''}`;
          const prevOverview = this.overviewTagMap.get(object.identifier);
          if (overviewKey !== prevOverview) {
            this.overviewTagMap.set(object.identifier, overviewKey);
            this.refreshDataElements();
            this.callInventoryUpdate();
          }
        } else if (object instanceof DataElement) {
          if (!this.containsInGameCharacter(object)) return;

          let prevName = this.tagNameMap.get(object.identifier);
          if (object.name !== prevName) {
            this.tagNameMap.set(object.identifier, object.name);
            this.refreshDataElements();
          }
          //if (this.sortTag === object.name) {
          //  this.refreshSort();
          //}
          if (0 < object.children.length) {
            this.refreshDataElements();
            //this.refreshSort();
          }
          this.refreshSort();
          this.callInventoryUpdate();
        } else if (object instanceof DataSummarySetting) {
          this.refreshDataElements();
          this.refreshSort();
          this.callInventoryUpdate();
        }
      })
      .on('DELETE_GAME_OBJECT', event => {
        this.locationMap.delete(event.data.identifier);
        this.tableIdMap.delete(event.data.identifier);
        this.tagNameMap.delete(event.data.identifier);
        this.tokenPresenceMap.delete(event.data.identifier);
        this.overviewTagMap.delete(event.data.identifier);
        this.refresh();
      })
      .on('SYNCHRONIZE_FILE_LIST', event => {
        if (event.isSendFromSelf) this.callInventoryUpdate();
      });
  }

  private containsInGameCharacter(element: DataElement): boolean {
    let parent = element.parent;
    let aliasName = GameCharacter.aliasName;
    while (parent) {
      if (parent.aliasName === aliasName) return true;
      parent = parent.parent;
    }
    return false;
  }

  private refresh() {
    this.refreshObjects();
    this.refreshDataElements();
    this.refreshSort();
    this.callInventoryUpdate();
  }

  private refreshObjects() {
    this.allInventory.refreshObjects();
    this.tableInventory.refreshObjects();
    this.commonInventory.refreshObjects();
    this.privateInventory.refreshObjects();
    this.graveyardInventory.refreshObjects();
  }

  private refreshDataElements() {
    this.allInventory.refreshDataElements();
    this.tableInventory.refreshDataElements();
    this.commonInventory.refreshDataElements();
    this.privateInventory.refreshDataElements();
    this.graveyardInventory.refreshDataElements();
  }

  private refreshSort() {
    if (this.sortStop) return;
    //console.log('refreshSort')
    this.allInventory.refreshSort();
    this.tableInventory.refreshSort();
    this.commonInventory.refreshSort();
    this.privateInventory.refreshSort();
    this.graveyardInventory.refreshSort();
  }

  private callInventoryUpdate() {
    EventSystem.trigger('UPDATE_INVENTORY', null);
  }

  private isAnyLocation(location: string): boolean {
    if (location === 'table' || location === Network.peerId || location === 'graveyard') return true;
    for (let peer of Network.peers) {
      if (peer.isOpen && location === peer.peerId) {
        return true;
      }
    }
    return false;
  }
}

class ObjectInventory {
  private get summarySetting(): DataSummarySetting { return DataSummarySetting.instance; }

  get sortTag(): string { return this.summarySetting.sortTag; }
  set sortTag(sortTag: string) { this.summarySetting.sortTag = sortTag; }

  get sortOrder(): SortOrder { return this.summarySetting.sortOrder; }
  set sortOrder(sortOrder: SortOrder) { this.summarySetting.sortOrder = sortOrder; }

  get dataTag(): string { return this.summarySetting.dataTag; }
  set dataTag(dataTag: string) { this.summarySetting.dataTag = dataTag; }

  get dataTags(): string[] { return this.summarySetting.dataTags; }

  private _tabletopObjects: TabletopObject[] = [];
  private _tempSortOrder: Map<string, number> = new Map();
  get tabletopObjects(): TabletopObject[] {
    if (this.needsRefreshObjects) {
      this._tabletopObjects = this.searchTabletopObjects();
      this.needsRefreshObjects = false;
    }
    if (this.needsSort) {
      this._tabletopObjects = this.sortTabletopObjects(this._tabletopObjects);
      this.needsSort = false;
    }
    return this._tabletopObjects;
  }

  get length(): number {
    if (this.needsRefreshObjects) {
      this._tabletopObjects = this.searchTabletopObjects();
      this.needsRefreshObjects = false;
    }
    return this._tabletopObjects.length;
  }

  private _dataElementMap: Map<ObjectIdentifier, DataElement[]> = new Map();
  get dataElementMap(): Map<ObjectIdentifier, DataElement[]> {
    if (this.needsRefreshElements) {
      this._dataElementMap.clear();
      let caches = this.tabletopObjects;
      for (let object of caches) {
        if (!object.detailDataElement) continue;
        this._dataElementMap.set(object.identifier, this.summaryResolver(object));
      }
      this.needsRefreshElements = false;
    }
    return this._dataElementMap;
  }

  private needsRefreshObjects: boolean = true;
  private needsRefreshElements: boolean = true;
  private needsSort: boolean = true;

  constructor(
    readonly classifier: (object: TabletopObject) => boolean,
    private readonly summaryResolver: (object: TabletopObject) => DataElement[]
  ) { }

  refreshObjects() {
    this.needsRefreshObjects = true;
  }

  refreshDataElements() {
    this.needsRefreshElements = true;
  }

  refreshSort() {
    this.needsSort = true;
  }

  private searchTabletopObjects(): TabletopObject[] {
    let objects: TabletopObject[] = ObjectStore.instance.getObjects(GameCharacter);
    let caches: TabletopObject[] = [];
    for (let object of objects) {
      if (this.classifier(object)) caches.push(object);
    }
    return caches;
  }

  private sortTabletopObjects(objects: TabletopObject[]): TabletopObject[] {
    let sortTag = this.sortTag.length ? this.sortTag.trim() : '';
    let sortOrder = this.sortOrder === 'ASC' ? -1 : 1;
    if (sortTag.length < 1) return objects;

    objects.sort((a, b) => {
      let aElm = a.rootDataElement?.getFirstElementByName('name');
      let bElm = b.rootDataElement?.getFirstElementByName('name');
      if (!aElm && !bElm) return 0;
      if (!bElm) return -1;
      if (!aElm) return 1;

      let aValue = this.convertToSortableValue(aElm, a);
      let bValue = this.convertToSortableValue(bElm, b);
      if (aValue < bValue) return -1;
      if (aValue > bValue) return 1;
      return 0;
    }).sort((a, b) => {
      const orderA = this._tempSortOrder.get(a.identifier);
      const orderB = this._tempSortOrder.get(b.identifier);
      if (orderA == null) {
        return (orderB == null ? 0 : 1);
      }
      if (orderB == null) return -1;
      if (orderA == orderB) return 0;
      return (orderA - orderB) < 0 ? -1 : 1;
    }).sort((a, b) => {
      let aElm = a.rootDataElement?.getFirstElementByNameUnsensitive(sortTag);
      let bElm = b.rootDataElement?.getFirstElementByNameUnsensitive(sortTag);
      if (!aElm && !bElm) return 0;
      if (!bElm) return -1;
      if (!aElm) return 1;

      let aValue = this.convertToSortableValue(aElm, a);
      let bValue = this.convertToSortableValue(bElm, b);
      if (aValue < bValue) return sortOrder;
      if (aValue > bValue) return sortOrder * -1;
      return 0;
    });

    this._tempSortOrder.clear();
    objects.forEach((elm, order) => {
      this._tempSortOrder.set(elm.identifier, order);
    });
    return objects;
  }

  private convertToSortableValue(dataElement: DataElement, tabletopObject: TabletopObject=null): number | string {
    //let value = dataElement.isNumberResource ? dataElement.currentValue : dataElement.value;
    //let resultStr = StringUtil.toHalfWidth((value + '').trim());
    let value = this.evaluate(dataElement, tabletopObject);
    let resultStr = StringUtil.toHalfWidth((value + '').replace(/[―ー—‐]/g, '-')).toLowerCase().trim();
    let resultNum = +resultStr;
    return Number.isNaN(resultNum) ? resultStr : resultNum;
  }

  private evaluate(dataElement, tabletopObject: TabletopObject=null): string {
    let value;
    if (dataElement.isCheckProperty) {
      let ary = dataElement.currentValue.toString().split(/[|｜]/, 2);
      if (ary.length <= 1) return (dataElement.value == null || dataElement.value == '') ? '' : dataElement.currentValue.toString();
      value = (dataElement.value == null || dataElement.value == '') ? ary[1] : ary[0];
    } else if (dataElement.isAbilityScore) {
      value = dataElement.calcAbilityScore;
    } else {
      value = dataElement.isNumberResource ? dataElement.currentValue : dataElement.value;
    }
    if (value != null && tabletopObject instanceof GameCharacter && tabletopObject.chatPalette) {
      value = tabletopObject.chatPalette.evaluate(value + '', tabletopObject.rootDataElement);
    }
    return value;
  }
}

function createMockElement(name: string): DataElement {
  let identifier = 'newLineString_DataElement';
  let dataElement = new DataElement(identifier);
  dataElement.name = name;
  return dataElement;
}