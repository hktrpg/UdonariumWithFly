import { ImageFile } from './core/file-storage/image-file';
import { ImageStorage } from './core/file-storage/image-storage';
import { SyncObject, SyncVar } from './core/synchronize-object/decorator';
import { ObjectNode } from './core/synchronize-object/object-node';
import { ObjectStore } from './core/synchronize-object/object-store';
import { MathUtil } from './core/system/util/math-util';
import { DataElement } from './data-element';
import { PeerCursor } from './peer-cursor';

export interface TabletopLocation {
  name: string;
  x: number;
  y: number;
}

@SyncObject('TabletopObject')
export class TabletopObject extends ObjectNode {
  @SyncVar() location: TabletopLocation = {
    name: 'table',
    x: 0,
    y: 0
  };

  @SyncVar() posZ: number = 0;

  /** Bound GameTable when on the tabletop; empty when in inventory / graveyard / hand. */
  @SyncVar() tableIdentifier: string = '';

  get isVisibleOnTable(): boolean {
    if (this.location.name !== 'table') return false;
    const viewId = TabletopObject.resolveViewTableIdentifier();
    if (!viewId) return false;
    // Do not write SyncVars in this getter (breaks CD / freezes panels). Migrate elsewhere.
    if (!this.tableIdentifier) return false;
    return this.tableIdentifier === viewId;
  }

  /** All tabletop subclasses (character/card/dice/…). getObjects(TabletopObject) only matches the base alias. */
  static getAll(): TabletopObject[] {
    const list: TabletopObject[] = [];
    for (const obj of ObjectStore.instance.getObjects()) {
      if (obj instanceof TabletopObject) list.push(obj);
    }
    return list;
  }

  /** Assign unbound table pieces to the current (or given) view table. */
  static migrateUnboundTablePieces(viewTableId?: string) {
    const id = viewTableId || TabletopObject.resolveViewTableIdentifier();
    if (!id) return;
    for (const obj of TabletopObject.getAll()) {
      if (obj.location.name === 'table' && !obj.tableIdentifier) {
        obj.tableIdentifier = id;
      }
    }
  }

  /**
   * After room XML load: rebind pieces whose tableIdentifier points at vanished UUIDs
   * (saves from before syncId). Returns old→new table id remap for scene presets.
   */
  static repairOrphanedPieceBindings(extraOrphanIds: string[] = []): Map<string, string> {
    // Use alias string — importing GameTable here creates a circular init cycle
    // (game-table → game-table-mask → tabletop-object).
    const tables = ObjectStore.instance.getObjects('game-table') as Array<{ identifier: string }>;
    const remap = new Map<string, string>();
    if (tables.length < 1) {
      TabletopObject.migrateUnboundTablePieces();
      return remap;
    }
    const validIds = new Set(tables.map(t => t.identifier));
    const orphanIds: string[] = [];
    const seen = new Set<string>();

    const consider = (tid: string) => {
      if (!tid || validIds.has(tid) || seen.has(tid)) return;
      seen.add(tid);
      orphanIds.push(tid);
    };

    for (const obj of TabletopObject.getAll()) {
      if (obj.location.name === 'table') consider(obj.tableIdentifier);
    }
    for (const tid of extraOrphanIds) consider(tid);

    if (orphanIds.length > 0) {
      if (tables.length === 1) {
        for (const id of orphanIds) remap.set(id, tables[0].identifier);
      } else if (orphanIds.length === tables.length) {
        for (let i = 0; i < orphanIds.length; i++) remap.set(orphanIds[i], tables[i].identifier);
      } else {
        const viewId = TabletopObject.resolveViewTableIdentifier() || tables[0].identifier;
        for (const id of orphanIds) remap.set(id, viewId);
      }

      for (const obj of TabletopObject.getAll()) {
        if (obj.location.name !== 'table') continue;
        const next = remap.get(obj.tableIdentifier);
        if (next) obj.tableIdentifier = next;
      }
    }

    TabletopObject.migrateUnboundTablePieces();
    return remap;
  }

  static resolveViewTableIdentifier(): string {
    const selecter = ObjectStore.instance.get<any>('TableSelecter');
    if (!selecter) return '';
    const view = selecter.viewTable;
    return view ? view.identifier : (selecter.viewTableIdentifier || '');
  }

  // GameObject Lifecycle
  onStoreAdded() {
    super.onStoreAdded();
    if (this.location.name === 'table' && !this.tableIdentifier) {
      const viewId = TabletopObject.resolveViewTableIdentifier();
      if (viewId) this.tableIdentifier = viewId;
    }
  }

  private _imageFile: ImageFile = ImageFile.Empty;
  private _shadowImageFile: ImageFile = ImageFile.Empty;
  //private _faceIcon: ImageFile = null;
  private _dataElements: { [name: string]: string } = {};

  // GameDataElement getter/setter
  get rootDataElement(): DataElement {
    for (let node of this.children) {
      if (node.getAttribute('name') === this.aliasName) return <DataElement>node;
    }
    return null;
  }

  get imageDataElement(): DataElement { return this.getElement('image'); }
  get commonDataElement(): DataElement { return this.getElement('common'); }
  get detailDataElement(): DataElement { return this.getElement('detail'); }

  @SyncVar() currntImageIndex: number = 0;
  /*
  get imageFile(): ImageFile {
    if (!this.imageDataElement) return this._imageFile;
    let imageIdElement: DataElement = this.imageDataElement.getFirstElementByName('imageIdentifier');
    if (imageIdElement && this._imageFile.identifier !== imageIdElement.value) {
      let file: ImageFile = ImageStorage.instance.get(<string>imageIdElement.value);
      this._imageFile = file ? file : ImageFile.Empty;
    }
    return this._imageFile;
  }
  */
  get imageElement(): DataElement {
    if (!this.imageDataElement) return null;
    let imageIdElements: DataElement[] = this.imageDataElement.getElementsByName('imageIdentifier');
    return imageIdElements[this.currntImageIndex < 0 ? 0 : this.currntImageIndex >= imageIdElements.length ? imageIdElements.length - 1 : this.currntImageIndex];
  }
  get imageFile(): ImageFile {
    if (!this.imageDataElement) return this._imageFile;
    let imageIdElement = this.imageElement;
    if (imageIdElement && this._imageFile.identifier !== imageIdElement.value) {
      let file: ImageFile = ImageStorage.instance.get(<string>imageIdElement.value);
      this._imageFile = file ? file : ImageFile.Empty;
    }
    return this._imageFile;
  }
  get imageFiles(): ImageFile[] {
    if (!this.imageDataElement) return [];
    let elements = this.imageDataElement.getElementsByName('imageIdentifier');
    return elements.map((element) => {
      let file: ImageFile = ImageStorage.instance.get(<string>element.value);
      return file ? file : null;
    }).filter((file) => { return file != null });
  }

  @SyncVar() isUseIconToOverviewImage: boolean = false;
  @SyncVar() currntIconIndex: number = 0;
  get faceIcon(): ImageFile {
    if (!this.imageDataElement) return null;
    let elements = this.imageDataElement.getElementsByName('faceIcon');
    if (elements) {
      let imageIdElement = elements[this.currntIconIndex];
      if (this.currntIconIndex < 0) this.currntIconIndex = 0;
      return imageIdElement ? ImageStorage.instance.get(<string>imageIdElement.value) : null;
    }
    return null;
  }
  get faceIcons(): ImageFile[] {
    if (!this.imageDataElement) return [];
    let elements = this.imageDataElement.getElementsByName('faceIcon');
    return elements.map((element) => {
      let file: ImageFile = ImageStorage.instance.get(<string>element.value);
      return file ? file : null;
    }).filter((file) => { return file != null });
  }

  get shadowImageFile(): ImageFile {
    if (!this.imageDataElement) return this._shadowImageFile;
    let imageIdElement: DataElement = this.imageDataElement.getFirstElementByName('shadowImageIdentifier');
    if (imageIdElement && this._shadowImageFile.identifier !== imageIdElement.value) {
      let file: ImageFile = ImageStorage.instance.get(<string>imageIdElement.value);
      this._shadowImageFile = file ? file : ImageFile.Empty;
    } else {
      let imageIdElement: DataElement = this.imageElement;
      if (imageIdElement && this._shadowImageFile.identifier !== imageIdElement.currentValue) {
        let file: ImageFile = ImageStorage.instance.get(<string>imageIdElement.currentValue);
        this._shadowImageFile = file ? file : ImageFile.Empty;
      }
    }
    return this._shadowImageFile;
  }

  @SyncVar() isAltitudeIndicate: boolean = false;
  get altitude(): number {
    let element = this.getElement('altitude', this.commonDataElement);
    //if (!element && this.commonDataElement) {
    //  this.commonDataElement.appendChild(DataElement.create('altitude', 0, {}, 'altitude_' + this.identifier));
    //}
    let num = element ? +element.value : 0;
    return Number.isNaN(num) ? 0 : num;
  }
  set altitude(altitude: number) {
    let element = this.getElement('altitude', this.commonDataElement);
    if (element) element.value = altitude;
  }

  get isHaveAltitude(): boolean {
    return !!this.getElement('altitude', this.commonDataElement);
  }

  @SyncVar() isInverse: boolean = false;
  @SyncVar() isHollow: boolean = false;
  @SyncVar() isBlackPaint: boolean = false;
  @SyncVar() isGrayscale: boolean = false;
  @SyncVar() isSepia: boolean = false;
  @SyncVar() isWhitePaint: boolean = false;
  @SyncVar() isMatrix: boolean = false;
  @SyncVar() isFlipVertical: boolean = false;
  @SyncVar() isContrast: boolean = false;
  @SyncVar() aura = -1;

  @SyncVar() isNotRide: boolean = true;
  @SyncVar() isInventoryIndicate: boolean = true;

  get isGMMode(): boolean{ return PeerCursor.myCursor ? PeerCursor.myCursor.isGMMode : false; }

  calcSqrDistance(other: TabletopObject): number {
    let pos1 = { x: this.location.x, y: this.location.y, z: this.posZ };
    let pos2 = { x: other.location.x, y: other.location.y, z: other.posZ };
    return MathUtil.sqrMagnitude(pos1, pos2);
  }

  protected createDataElements() {
    this.initialize();
    let aliasName: string = this.aliasName;
    if (!this.rootDataElement) {
      let rootElement = DataElement.create(aliasName, '', {}, aliasName + '_' + this.identifier);
      this.appendChild(rootElement);
    }

    if (!this.imageDataElement) {
      this.rootDataElement.appendChild(DataElement.create('image', '', {}, 'image_' + this.identifier));
      this.imageDataElement.appendChild(DataElement.create('imageIdentifier', '', { type: 'image' }, 'imageIdentifier_' + this.identifier));
    }
    if (!this.commonDataElement) this.rootDataElement.appendChild(DataElement.create('common', '', {}, 'common_' + this.identifier));
    if (!this.detailDataElement) this.rootDataElement.appendChild(DataElement.create('detail', '', {}, 'detail_' + this.identifier));
  }

  protected getElement(name: string, from: DataElement = this.rootDataElement): DataElement {
    if (!from) return null;
    let element: DataElement = this._dataElements[name] ? ObjectStore.instance.get(this._dataElements[name]) : null;
    if (!element || !from.contains(element)) {
      element = from.getFirstElementByName(name);
      this._dataElements[name] = element ? element.identifier : null;
    }
    return element;
  }

  protected getCommonValue<T extends string | number>(elementName: string, defaultValue: T): T {
    let element = this.getElement(elementName, this.commonDataElement);
    if (!element) return defaultValue;

    if (typeof defaultValue === 'number') {
      let number: number = +element.value;
      return <T>(Number.isNaN(number) ? defaultValue : number);
    } else {
      return <T>(element.value + '');
    }
  }

  getUrls(): DataElement[] {
    return this.rootDataElement.getElementsByType('url');
  }

  protected setCommonValue(elementName: string, value: any) {
    let element = this.getElement(elementName, this.commonDataElement);
    if (!element) { return; }
    element.value = value;
  }

  protected getImageFile(elementName: string) {
    if (!this.imageDataElement) return null;
    let image = this.getElement(elementName, this.imageDataElement);
    return image ? ImageStorage.instance.get(<string>image.value) : null;
  }

  protected setImageFile(elementName: string, imageFile: ImageFile) {
    let image = imageFile ? this.getElement(elementName, this.imageDataElement) : null;
    if (!image) return;
    image.value = imageFile.identifier;
  }

  setLocation(location: string, tableIdentifier?: string) {
    this.location.name = location;
    if (location === 'table') {
      // Prefer explicit id, then current view table (inventory drag / "move to table").
      // Fall back to existing binding only when no view table is resolved yet.
      this.tableIdentifier = tableIdentifier
        || TabletopObject.resolveViewTableIdentifier()
        || this.tableIdentifier
        || '';
    } else {
      this.tableIdentifier = '';
    }
    this.update();
  }
}
