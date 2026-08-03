import { GuestSession } from '../guest-session';
import { SyncObject, SyncVar } from '../core/synchronize-object/decorator';
import { GameObject } from '../core/synchronize-object/game-object';
import { InnerXml } from '../core/synchronize-object/object-serializer';
import { PeerCursor } from '../peer-cursor';

export type SceneCreateKind = 'light' | 'wall' | 'draw-rect' | 'draw-ellipse' | 'draw-polygon' | 'draw-freehand' | 'draw-text';
export type SceneModifyKind = 'light' | 'wall' | 'drawing';

/**
 * Room-wide scene-tool permissions for non-GM players.
 * Defaults: all create/modify allowed. GM is always unrestricted.
 */
@SyncObject('scene-tool-permission')
export class SceneToolPermission extends GameObject implements InnerXml {
  @SyncVar() playerCanCreateLight: boolean = true;
  @SyncVar() playerCanCreateWall: boolean = true;
  @SyncVar() playerCanCreateRect: boolean = true;
  @SyncVar() playerCanCreateEllipse: boolean = true;
  @SyncVar() playerCanCreatePolygon: boolean = true;
  @SyncVar() playerCanCreateFreehand: boolean = true;
  @SyncVar() playerCanCreateText: boolean = true;

  @SyncVar() playerCanModifyLight: boolean = true;
  @SyncVar() playerCanModifyWall: boolean = true;
  @SyncVar() playerCanModifyDrawing: boolean = true;

  private static _instance: SceneToolPermission;

  static get instance(): SceneToolPermission {
    if (!SceneToolPermission._instance) {
      SceneToolPermission._instance = new SceneToolPermission('SceneToolPermission');
      SceneToolPermission._instance.initialize();
    }
    return SceneToolPermission._instance;
  }

  private get isGM(): boolean {
    return !!PeerCursor.myCursor?.isGMMode;
  }

  get canOpenPanel(): boolean {
    if (GuestSession.isGuest) return false;
    return this.isGM || this.canCreateAnything || this.canModifyAnything;
  }

  get canCreateAnything(): boolean {
    return this.playerCanCreateLight
      || this.playerCanCreateWall
      || this.playerCanCreateRect
      || this.playerCanCreateEllipse
      || this.playerCanCreatePolygon
      || this.playerCanCreateFreehand
      || this.playerCanCreateText;
  }

  get canModifyAnything(): boolean {
    return this.playerCanModifyLight || this.playerCanModifyWall || this.playerCanModifyDrawing;
  }

  /** @deprecated Prefer {@link canCreateKind}. True if any create permission. */
  get canCreate(): boolean {
    if (GuestSession.isGuest) return false;
    return this.isGM || this.canCreateAnything;
  }

  /** @deprecated Prefer {@link canModifyKind}. True if any modify permission. */
  get canModify(): boolean {
    if (GuestSession.isGuest) return false;
    return this.isGM || this.canModifyAnything;
  }

  canCreateKind(kind: SceneCreateKind): boolean {
    if (GuestSession.isGuest) return false;
    if (this.isGM) return true;
    switch (kind) {
      case 'light': return !!this.playerCanCreateLight;
      case 'wall': return !!this.playerCanCreateWall;
      case 'draw-rect': return !!this.playerCanCreateRect;
      case 'draw-ellipse': return !!this.playerCanCreateEllipse;
      case 'draw-polygon': return !!this.playerCanCreatePolygon;
      case 'draw-freehand': return !!this.playerCanCreateFreehand;
      case 'draw-text': return !!this.playerCanCreateText;
      default: return false;
    }
  }

  canModifyKind(kind: SceneModifyKind): boolean {
    if (GuestSession.isGuest) return false;
    if (this.isGM) return true;
    switch (kind) {
      case 'light': return !!this.playerCanModifyLight;
      case 'wall': return !!this.playerCanModifyWall;
      case 'drawing': return !!this.playerCanModifyDrawing;
      default: return false;
    }
  }

  /** Whether the given scene-tool mode may be used to place/create. */
  canUseCreateMode(mode: string): boolean {
    if (mode === 'light' || mode === 'wall') return this.canCreateKind(mode);
    if (mode.startsWith('draw-')) return this.canCreateKind(mode as SceneCreateKind);
    return false;
  }

  setAllCreate(enabled: boolean) {
    const v = !!enabled;
    this.playerCanCreateLight = v;
    this.playerCanCreateWall = v;
    this.playerCanCreateRect = v;
    this.playerCanCreateEllipse = v;
    this.playerCanCreatePolygon = v;
    this.playerCanCreateFreehand = v;
    this.playerCanCreateText = v;
  }

  setAllModify(enabled: boolean) {
    const v = !!enabled;
    this.playerCanModifyLight = v;
    this.playerCanModifyWall = v;
    this.playerCanModifyDrawing = v;
  }

  innerXml(): string { return ''; }

  parseInnerXml(element: Element) {
    const context = SceneToolPermission.instance.toContext();
    context.syncData = this.toContext().syncData;
    SceneToolPermission.instance.apply(context);
    SceneToolPermission.instance.update();
    this.destroy();
  }
}
