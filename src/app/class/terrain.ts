import { ImageFile } from './core/file-storage/image-file';
import { SyncObject, SyncVar } from './core/synchronize-object/decorator';
import { DataElement } from './data-element';
import { TabletopObject } from './tabletop-object';

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

/**
 * Floor sample at a table point (flat roof or slope ramp).
 * No new SyncVars — pure derived geometry for ride / tip.
 */
export type TerrainFloorHit = {
  posZ: number;
  /** Pedestal tip CSS (empty on flat floors). Local-only visual. */
  alignCss: string;
};

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

  get hasWall(): boolean { return this.mode & TerrainViewState.WALL ? true : false; }
  get hasFloor(): boolean { return this.mode & TerrainViewState.FLOOR ? true : false; }

  /** Slope angle (radians) used by floor CSS and ride sampling — single source of truth. */
  get slopeAngleRad(): number {
    if (!this.isSlope) return 0;
    const h = Math.max(0, this.height || 0);
    if (h <= 0) return 0;
    const dir = this.slopeDirection;
    if (dir === SlopeDirection.LEFT || dir === SlopeDirection.RIGHT) {
      return Math.atan(h / Math.max(0.001, this.width || 1));
    }
    if (dir === SlopeDirection.TOP || dir === SlopeDirection.BOTTOM) {
      return Math.atan(h / Math.max(0.001, this.depth || 1));
    }
    return 0;
  }

  /** Same transform string as legacy floorModCss (mid-pivot ramp). */
  get floorModCss(): string {
    const tmp = this.slopeAngleRad;
    if (!tmp) return '';
    const s = 1 / Math.cos(tmp);
    switch (this.slopeDirection) {
      case SlopeDirection.TOP:
        return ` rotateX(${tmp}rad) scaleY(${s})`;
      case SlopeDirection.BOTTOM:
        return ` rotateX(${-tmp}rad) scaleY(${s})`;
      case SlopeDirection.LEFT:
        return ` rotateY(${-tmp}rad) scaleX(${s})`;
      case SlopeDirection.RIGHT:
        return ` rotateY(${tmp}rad) scaleX(${s})`;
      default:
        return '';
    }
  }

  get floorBrightness(): number {
    if (!this.isSurfaceShading || !this.isSlope) return 1.0;
    switch (this.slopeDirection) {
      case SlopeDirection.TOP: return 0.4;
      case SlopeDirection.BOTTOM: return 1.0;
      case SlopeDirection.LEFT: return 0.6;
      case SlopeDirection.RIGHT: return 0.9;
      default: return 1.0;
    }
  }

  /**
   * Sample this terrain's floor under (worldX, worldY).
   * Returns null outside footprint / without floor — callers keep prior pose (compat).
   */
  floorHitAt(worldX: number, worldY: number, gridSize: number = 50): TerrainFloorHit | null {
    if (!this.hasFloor || !this.isInteract) return null;
    if (this.location?.name !== 'table') return null;

    const g = gridSize;
    const w = Math.max(0.001, (this.width || 1) * g);
    const d = Math.max(0.001, (this.depth || 1) * g);
    const cx = (this.location?.x ?? 0) + w / 2;
    const cy = (this.location?.y ?? 0) + d / 2;
    const rad = -((this.rotate || 0) * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const dx = worldX - cx;
    const dy = worldY - cy;
    const localX = dx * cos - dy * sin;
    const localY = dx * sin + dy * cos;
    const halfW = w / 2;
    const halfD = d / 2;
    if (localX < -halfW || localX > halfW || localY < -halfD || localY > halfD) return null;

    const u = (localX + halfW) / w;
    const v = (localY + halfD) / d;
    const base = (this.posZ || 0) + (this.altitude || 0) * g;
    const hPx = Math.max(0, this.height || 0) * g;
    const angle = this.slopeAngleRad;

    let posZ = base + hPx;
    let alignCss = '';
    if (this.isSlope && this.slopeDirection !== SlopeDirection.NONE && hPx > 0 && angle > 0) {
      let rise = 0;
      switch (this.slopeDirection) {
        case SlopeDirection.TOP: rise = v; break;
        case SlopeDirection.BOTTOM: rise = 1 - v; break;
        case SlopeDirection.LEFT: rise = u; break;
        case SlopeDirection.RIGHT: rise = 1 - u; break;
        default: rise = 0.5; break;
      }
      posZ = base + hPx * rise;
      const deg = (angle * 180) / Math.PI;
      let rx = 0;
      let ry = 0;
      switch (this.slopeDirection) {
        case SlopeDirection.TOP: rx = deg; break;
        case SlopeDirection.BOTTOM: rx = -deg; break;
        case SlopeDirection.LEFT: ry = -deg; break;
        case SlopeDirection.RIGHT: ry = deg; break;
      }
      const yaw = this.rotate || 0;
      alignCss = `rotateZ(${yaw}deg) rotateX(${rx}deg) rotateY(${ry}deg) rotateZ(${-yaw}deg)`;
    }
    return { posZ, alignCss };
  }

  /** Highest interactable floor under a point (stacked decks). */
  static floorHitAt(
    terrains: Terrain[] | null | undefined,
    worldX: number,
    worldY: number,
    gridSize: number = 50,
  ): TerrainFloorHit | null {
    let best: TerrainFloorHit | null = null;
    for (const terrain of terrains || []) {
      const hit = terrain?.floorHitAt(worldX, worldY, gridSize);
      if (!hit) continue;
      if (!best || hit.posZ >= best.posZ) best = hit;
    }
    return best;
  }

  complement(): void {
    let element = this.getElement('altitude', this.commonDataElement);
    if (!element && this.commonDataElement) {
      this.commonDataElement.appendChild(DataElement.create('altitude', 0, {}, 'altitude_' + this.identifier));
    }
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
    object.initialize();

    return object;
  }
}
