import { ImageFile } from './core/file-storage/image-file';
import { SyncObject, SyncVar } from './core/synchronize-object/decorator';
import { DataElement } from './data-element';
import { TabletopObject } from './tabletop-object';
import { TerrainFaceName } from './terrain-surface';

export enum TerrainViewState {
  NULL = 0,
  FLOOR = 1,
  WALL = 2,
  ALL = 3,
}
export enum SlopeDirection {
  NONE = 0,
  TOP = 1,
  BOTTOM = 2,
  LEFT = 3,
  RIGHT = 4,
}

/** Optional per-face image element names (fallback to wall / floor). */
export const TERRAIN_FACE_ELEMENTS: TerrainFaceName[] = [
  'floor',
  'underside',
  'wall',
  'wallTop',
  'wallBottom',
  'wallLeft',
  'wallRight',
];

@SyncObject('terrain')
export class Terrain extends TabletopObject {
  @SyncVar() isLocked: boolean = false;
  @SyncVar() mode: TerrainViewState = TerrainViewState.ALL;
  @SyncVar() rotate: number = 0;
  @SyncVar() isDropShadow: boolean = true;
  @SyncVar() isSurfaceShading: boolean = true
  @SyncVar() isInteract: boolean = true;
  /** When true, footprint blocks light and vision (opt-in; floors stay open by default). */
  @SyncVar() affectsLight: boolean = false;
  @SyncVar() isSlope: boolean = false;
  @SyncVar() slopeDirection: number = SlopeDirection.NONE;
  /**
   * Historical wall CSS uses scaleX(-1) on top/left faces (can mirror sign text).
   * Default true keeps old look; turn off for readable neon / sign faces.
   */
  @SyncVar() mirrorWallTop: boolean = true;
  @SyncVar() mirrorWallLeft: boolean = true;

  get width(): number { return this.getCommonValue('width', 1); }
  set width(width: number) { this.setCommonValue('width', width); }
  get height(): number { return this.getCommonValue('height', 1); }
  set height(height: number) { this.setCommonValue('height', height); }
  get depth(): number { return this.getCommonValue('depth', 1); }
  set depth(depth: number) { this.setCommonValue('depth', depth); }
  get name(): string { return this.getCommonValue('name', ''); }
  set name(name: string) { this.setCommonValue('name', name); }

  get wallImage(): ImageFile { return this.getImageFile('wall'); }
  get floorImage(): ImageFile { return this.getImageFile('floor'); }
  get undersideImage(): ImageFile { return this.getImageFile('underside'); }
  get wallTopImage(): ImageFile { return this.getImageFile('wallTop'); }
  get wallBottomImage(): ImageFile { return this.getImageFile('wallBottom'); }
  get wallLeftImage(): ImageFile { return this.getImageFile('wallLeft'); }
  get wallRightImage(): ImageFile { return this.getImageFile('wallRight'); }

  /**
   * Resolve a face texture: per-face override if set, else wall (vertical) or floor (horizontal).
   */
  faceImage(face: TerrainFaceName): ImageFile {
    if (face === 'floor') return this.floorImage;
    if (face === 'wall') return this.wallImage;
    const own = this.getImageFile(face);
    if (own && !own.isEmpty) return own;
    if (face === 'underside') return this.floorImage;
    return this.wallImage;
  }

  /** True when a dedicated (non-fallback) image id is stored for the face. */
  hasOwnFaceImage(face: TerrainFaceName): boolean {
    if (face === 'floor' || face === 'wall') {
      const img = this.getImageFile(face);
      return !!(img && img.identifier);
    }
    const el = this.imageDataElement?.getFirstElementByName(face);
    const v = el ? (el.value + '') : '';
    return !!(v && v !== 'null');
  }

  get hasWall(): boolean { return this.mode & TerrainViewState.WALL ? true : false; }
  get hasFloor(): boolean { return this.mode & TerrainViewState.FLOOR ? true : false; }

  complement(): void {
    let element = this.getElement('altitude', this.commonDataElement);
    if (!element && this.commonDataElement) {
      this.commonDataElement.appendChild(DataElement.create('altitude', 0, {}, 'altitude_' + this.identifier));
    }
    this.ensureFaceImageElements();
  }

  /** Lazily add optional face slots so old saves stay valid without forcing images. */
  ensureFaceImageElements(): void {
    if (!this.imageDataElement) return;
    const optional: TerrainFaceName[] = ['underside', 'wallTop', 'wallBottom', 'wallLeft', 'wallRight'];
    for (const name of optional) {
      if (this.imageDataElement.getFirstElementByName(name)) continue;
      this.imageDataElement.appendChild(
        DataElement.create(name, '', { type: 'image' }, `${name}_${this.identifier}`)
      );
    }
  }

  setFaceImage(face: TerrainFaceName, imageIdentifier: string): void {
    this.ensureFaceImageElements();
    let el = this.imageDataElement?.getFirstElementByName(face);
    if (!el && this.imageDataElement) {
      el = DataElement.create(face, '', { type: 'image' }, `${face}_${this.identifier}`);
      this.imageDataElement.appendChild(el);
    }
    if (el) el.value = imageIdentifier ?? '';
  }

  static create(name: string, width: number, depth: number, height: number, wall: string, floor: string, identifier?: string): Terrain {
    let object: Terrain = null;

    if (identifier) {
      object = new Terrain(identifier);
    } else {
      object = new Terrain();
    }
    object.createDataElements();

    object.commonDataElement.appendChild(DataElement.create('name', name, {}, 'name_' + object.identifier));
    object.commonDataElement.appendChild(DataElement.create('width', width, {}, 'width_' + object.identifier));
    object.commonDataElement.appendChild(DataElement.create('height', height, {}, 'height_' + object.identifier));
    object.commonDataElement.appendChild(DataElement.create('depth', depth, {}, 'depth_' + object.identifier));
    object.commonDataElement.appendChild(DataElement.create('altitude', 0, {}, 'altitude_' + object.identifier));
    object.imageDataElement.appendChild(DataElement.create('wall', wall, { type: 'image' }, 'wall_' + object.identifier));
    object.imageDataElement.appendChild(DataElement.create('floor', floor, { type: 'image' }, 'floor_' + object.identifier));
    object.ensureFaceImageElements();
    object.initialize();

    return object;
  }
}
