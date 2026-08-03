import { MathUtil } from '@udonarium/core/system/util/math-util';
import { GameCharacter } from '@udonarium/game-character';
import { TabletopObject } from '@udonarium/tabletop-object';
import { Stackable } from '@udonarium/tabletop-object-util';
import { IPoint2D, Transform } from '@udonarium/transform/transform';
import { PointerCoordinate, PointerDeviceService } from 'service/pointer-device.service';
import { SelectionState, TabletopSelectionService } from 'service/tabletop-selection.service';
import { TransformPose, UndoService } from 'service/undo.service';

import { MovableDirective } from './movable.directive';

export class MovableSelectionSynchronizer {
  private static readonly objectMap: Map<TabletopObject, Set<MovableDirective>> = new Map();

  get selectedMovables(): Set<MovableDirective> {
    let selected: Set<MovableDirective> = new Set();
    for (let object of this.selection.objects) {
      MovableSelectionSynchronizer.objectMap.get(object)?.forEach(m => selected.add(m));
    }
    return selected;
  }

  private callbackOnPickStart = this.onPickStart.bind(this);
  private callbackOnPickObject = this.onPickObject.bind(this);
  private callbackOnPickRegion = this.onPickRegion.bind(this);

  private _isDestroyed: boolean = false;
  get isDestroyed(): boolean { return this._isDestroyed; }

  private latestDomRect: DOMRect;
  private latestRectPoints: IPoint2D[] = [];
  /** Movables participating in the current drag (includes absorbed MAGNETIC). */
  private undoTargets: Set<MovableDirective> = new Set();

  constructor(
    private movable: MovableDirective,
    private selection: TabletopSelectionService,
    private pointerDevice: PointerDeviceService,
  ) { }

  initialize() {
    this.register();
    this.addEventListeners();
  }

  destroy() {
    this.unregister();
    this._isDestroyed = true;
    this.removeEventListeners();
    this.movable = null;
  }

  private onPickStart(e: CustomEvent) {
    if (this.movable.tabletopObject == null || this.movable.isDisable) return;
    this.movable.state = e.detail.isMagnetic ? SelectionState.MAGNETIC : SelectionState.SELECTED;
    this.prepareMove();
  }

  private onPickObject(e: CustomEvent) {
    if (this.selection.excludeElement === this.movable.nativeElement) return;
    if (this.pointerDevice.isDragging || this.movable.isDisable) return;

    if (this.selection.excludeElement == null) {
      this.toggleState();
      this.selection.excludeElement = this.movable.nativeElement;
    } else {
      this.movable.state = SelectionState.SELECTED;
    }
  }

  private onPickRegion(e: CustomEvent) {
    if (this.pointerDevice.isDragging || this.movable.isDisable) return;

    let x: number = e.detail.x;
    let y: number = e.detail.y;
    let width: number = e.detail.width;
    let height: number = e.detail.height;

    let targetRect = this.movable.nativeElement.getBoundingClientRect();

    let isMaybeOverlap = targetRect.x <= x + width && x <= targetRect.x + targetRect.width && targetRect.y <= y + height && y <= targetRect.y + targetRect.height;
    if (!isMaybeOverlap) return;

    let hasUpdatedRect = !(this.latestDomRect != null
      && this.latestDomRect.x === targetRect.x
      && this.latestDomRect.y === targetRect.y
      && this.latestDomRect.width === targetRect.width
      && this.latestDomRect.height === targetRect.height
      && this.latestDomRect.top === targetRect.top
      && this.latestDomRect.left === targetRect.left
      && this.latestDomRect.bottom === targetRect.bottom
      && this.latestDomRect.right === targetRect.right);

    if (hasUpdatedRect) {
      let points: IPoint2D[] = [
        { x: 0, y: 0 },
        { x: this.movable.nativeElement.clientWidth, y: 0 },
        { x: this.movable.nativeElement.clientWidth, y: this.movable.nativeElement.clientHeight },
        { x: 0, y: this.movable.nativeElement.clientHeight },
      ];
      let transformer: Transform = new Transform(this.movable.nativeElement);
      this.latestDomRect = targetRect;
      this.latestRectPoints = points.map(point => transformer.localToGlobal(point.x, point.y));
      transformer.clear();
    }

    let rectA: IPoint2D[] = [
      { x: x, y: y },
      { x: x + width, y: y },
      { x: x + width, y: y + height },
      { x: x, y: y + height },
    ];
    let rectB: IPoint2D[] = this.latestRectPoints;

    let isOverlap = checkOverlapSAT(rectA, rectB);
    if (isOverlap) {
      this.movable.state = SelectionState.SELECTED;
    }
  }

  toggleState() {
    this.movable.state = this.movable.state === SelectionState.SELECTED
      ? SelectionState.NONE
      : SelectionState.SELECTED;
  }

  prepareMove() {
    this.beginUndoCapture();

    if (!this.shouldSynchronize()) return;

    for (let movable of this.selectedMovables) {
      if (movable === this.movable) continue;
      if (movable.isDisable) {
        movable.state = SelectionState.NONE;
      } else {
        movable.state = SelectionState.SELECTED;
        movable.setPointerEvents(false);
        movable.setAnimatedTransition(false);
        this.trackUndoTarget(movable);
      }
    }
  }

  updateMove(delta: PointerCoordinate) {
    if (!this.shouldSynchronize()) {
      if (this.movable.isPointerMoved) this.selection.clear();
      return;
    }

    if (this.movable.state === SelectionState.MAGNETIC) {
      let layer = MovableDirective.layerMap.get(this.movable.layerName);
      if (layer) {
        for (let movable of layer) {
          if (movable !== this.movable && !movable.isDisable && movable.state === SelectionState.NONE) {
            if (movable.width < 0) movable.width = movable.nativeElement.clientWidth;
            if (movable.height < 0) movable.height = movable.nativeElement.clientHeight;
            if (this.isProximity(movable)) {
              movable.state = SelectionState.MAGNETIC;
              movable.setPointerEvents(false);
              movable.setAnimatedTransition(false);
              this.trackUndoTarget(movable);
              //movable.ondragstart.emit(e as PointerEvent);
            }
          }
        }
      }
    }

    for (let movable of this.selectedMovables) {
      if (movable === this.movable) continue;
      movable.posX += delta.x;
      movable.posY += delta.y;
      movable.posZ += delta.z;
      if (movable.state === SelectionState.MAGNETIC) {
        movable.posX = ((this.movable.posX + (this.movable.width - movable.width) / 2) * 0.02 + movable.posX * 0.98);
        movable.posY = ((this.movable.posY + (this.movable.height - movable.height) / 2) * 0.02 + movable.posY * 0.98);
        movable.posZ = (this.movable.posZ * 0.02 + movable.posZ * 0.98);
      }
      if (movable.posZ < 0) movable.posZ = 0;
      //movable.setUpdateBatching();
      //movable.ondrag.emit(e as PointerEvent);
    }
  }

  finishMove(delta: PointerCoordinate) {
    if (!this.shouldSynchronize()) {
      // Do not clear here: a plain click may end with no sync window while
      // click-to-select already registered the object on input start.
      this.commitUndoCapture();
      return;
    }

    for (let movable of this.selectedMovables) {
      if (movable === this.movable) continue;
      movable.posX += delta.x;
      movable.posY += delta.y;
      movable.posZ += delta.z;
    }

    let movables = Array.from(this.selectedMovables).sort((a, b) => {
      let zindexA = (a.tabletopObject as Stackable).zindex;
      let zindexB = (b.tabletopObject as Stackable).zindex;
      if (zindexA == null || zindexB == null) return 0;
      return zindexA - zindexB;
    }).filter(movable => movable.state === SelectionState.MAGNETIC && movable !== this.movable);

    let polygonal = 360 / movables.length;
    let angle = Math.random() * 360;
    let distance = Math.min(Math.max((this.movable.width + this.movable.height) / 2, 50), 75);
    let center = { x: this.movable.posX + this.movable.width / 2, y: this.movable.posY + this.movable.height / 2, z: this.movable.posZ };

    for (let movable of movables) {
      if (movable === this.movable) continue;
      //movable.ondragend.emit(e as PointerEvent);
      //movable.onend.emit(e as PointerEvent);
      angle += polygonal;
      let rad = MathUtil.radians(angle);
      movable.posX = center.x + distance * Math.sin(rad) - (movable.width / 2);
      movable.posY = center.y + distance * Math.cos(rad) - (movable.height / 2);
    }

    // Capture after-state before selection clear drops MAGNETIC targets.
    this.commitUndoCapture();

    if (this.movable.state === SelectionState.MAGNETIC && this.selection.size <= 1) {
      this.selection.clear();
    } else {
      this.refreshState();
    }
  }

  private beginUndoCapture() {
    const undo = UndoService.instance;
    if (!undo) return;
    undo.beginTransformGesture();
    this.undoTargets.clear();
    this.trackUndoTarget(this.movable);
  }

  private trackUndoTarget(movable: MovableDirective) {
    if (!movable?.tabletopObject) return;
    this.undoTargets.add(movable);
    UndoService.instance?.rememberBeforePose(
      movable.tabletopObject.identifier,
      poseFromMovable(movable),
    );
  }

  private commitUndoCapture() {
    const undo = UndoService.instance;
    if (!undo) {
      this.undoTargets.clear();
      return;
    }
    const after = new Map<string, TransformPose>();
    for (const movable of this.undoTargets) {
      if (!movable?.tabletopObject) continue;
      after.set(movable.tabletopObject.identifier, poseFromMovable(movable));
    }
    this.undoTargets.clear();
    undo.commitTransformGesture(after, 'move');
  }

  private shouldSynchronize(): boolean {
    let isSynchronize = this.movable.state !== SelectionState.NONE;
    return isSynchronize;
  }

  private refreshState() {
    for (let movable of this.selectedMovables) {
      movable.state = SelectionState.SELECTED;
      if (movable === this.movable) continue;
      movable.setPointerEvents(true);
      movable.setAnimatedTransition(true);
      movable.width = movable.height = -1;
    }
  }

  private isProximity(a: MovableDirective, b: MovableDirective = this.movable): boolean {
    let range = Math.max((((a.width + b.width) / 4) + ((a.height + b.height) / 4)) * 0.95, 25) ** 2;
    let posA = {
      x: a.posX + a.width / 2,
      y: a.posY + a.height / 2,
      z: a.posZ
    };
    let posB = {
      x: b.posX + b.width / 2,
      y: b.posY + b.height / 2,
      z: b.posZ
    };
    let distance = MathUtil.sqrMagnitude(posA, posB);
    return distance < range;
  }

  private addEventListeners() {
    this.movable.nativeElement.addEventListener('pickstart', this.callbackOnPickStart);
    this.movable.nativeElement.addEventListener('pickobject', this.callbackOnPickObject);
    this.movable.nativeElement.ownerDocument.addEventListener('pickregion', this.callbackOnPickRegion);
  }

  private removeEventListeners() {
    this.movable.nativeElement.removeEventListener('pickstart', this.callbackOnPickStart);
    this.movable.nativeElement.removeEventListener('pickobject', this.callbackOnPickObject);
    this.movable.nativeElement.ownerDocument.removeEventListener('pickregion', this.callbackOnPickRegion);
  }

  register() {
    let movableSet = MovableSelectionSynchronizer.objectMap.get(this.movable.tabletopObject) ?? new Set();
    movableSet.add(this.movable);
    MovableSelectionSynchronizer.objectMap.set(this.movable.tabletopObject, movableSet);
  }

  unregister() {
    let movableSet = MovableSelectionSynchronizer.objectMap.get(this.movable.tabletopObject);
    if (!movableSet) return;
    movableSet.delete(this.movable);
    if (movableSet.size < 1) MovableSelectionSynchronizer.objectMap.delete(this.movable.tabletopObject);
  }

  static congregate(center: PointerCoordinate, targets: TabletopObject[]) {
    let objects = targets.sort((a, b) => {
      let zindexA = (a as any).zindex;
      let zindexB = (b as any).zindex;
      if (zindexA == null || zindexB == null) return 0;
      return zindexA - zindexB;
    });
    let polygonal = 360 / objects.length;
    let angle = Math.random() * 360;
    let distance = Math.min(Math.max(objects.length * 9, 5), 75);

    for (let object of objects) {
      let movables = MovableSelectionSynchronizer.objectMap.get(object);
      if (movables == null) continue;
      for (let movable of movables) {
        movable.setAnimatedTransition(true);
        movable.stopTransition();
        if (movable.width < 0) movable.width = movable.nativeElement.clientWidth;
        if (movable.height < 0) movable.height = movable.nativeElement.clientHeight;
        angle += polygonal;
        let rad = MathUtil.radians(angle);
        movable.posX = center.x + distance * Math.sin(rad) - (movable.width / 2);
        movable.posY = center.y + distance * Math.cos(rad) - (movable.height / 2);
        movable.posZ = center.z;
      }
    }
  }

  static nudge(targets: TabletopObject[], dx: number, dy: number): boolean {
    if (dx === 0 && dy === 0) return false;
    const before = new Map<string, TransformPose>();
    for (const object of targets) {
      if (MovableSelectionSynchronizer.isLocked(object)) continue;
      before.set(object.identifier, poseFromObject(object));
    }
    let moved = false;
    for (let object of targets) {
      let movables = MovableSelectionSynchronizer.objectMap.get(object);
      if (movables == null || movables.size < 1) {
        if (MovableSelectionSynchronizer.isLocked(object)) continue;
        object.location.x += dx;
        object.location.y += dy;
        object.update();
        moved = true;
        continue;
      }
      for (let movable of movables) {
        if (movable.isDisable) continue;
        movable.posX += dx;
        movable.posY += dy;
        moved = true;
      }
    }
    if (moved) {
      const after = new Map<string, TransformPose>();
      for (const id of before.keys()) {
        const object = targets.find(t => t.identifier === id);
        if (object) after.set(id, poseFromObject(object));
      }
      UndoService.instance?.recordTransform('nudge', before, after, 'nudge');
    }
    return moved;
  }

  /** Move object centers to (x, y) with optional CSS transition duration. */
  static moveCentersTo(targets: TabletopObject[], x: number, y: number, durationMs: number = 132): boolean {
    let moved = false;
    for (const object of targets) {
      if (MovableSelectionSynchronizer.isLocked(object)) continue;
      const movables = MovableSelectionSynchronizer.objectMap.get(object);
      if (movables == null || movables.size < 1) {
        const size = typeof (object as any).size === 'number' ? (object as any).size : 1;
        const grid = 50;
        const half = (size * grid) / 2;
        object.location.x = x - half;
        object.location.y = y - half;
        object.update();
        moved = true;
        continue;
      }
      for (const movable of movables) {
        if (movable.isDisable) continue;
        if (movable.width < 0) movable.width = movable.nativeElement.clientWidth;
        if (movable.height < 0) movable.height = movable.nativeElement.clientHeight;
        movable.setAnimatedTransition(true, durationMs);
        movable.posX = x - movable.width / 2;
        movable.posY = y - movable.height / 2;
        moved = true;
      }
    }
    return moved;
  }

  /** Center of a tabletop object in table coordinates. */
  static centerOf(object: TabletopObject): { x: number; y: number } {
    for (const movable of MovableDirective.layerMap.get(object.aliasName) ?? []) {
      if (movable.tabletopObject !== object || movable.isDisable) continue;
      if (movable.width < 0) movable.width = movable.nativeElement.clientWidth;
      if (movable.height < 0) movable.height = movable.nativeElement.clientHeight;
      return {
        x: movable.posX + movable.width / 2,
        y: movable.posY + movable.height / 2,
      };
    }
    const size = typeof (object as any).size === 'number' ? (object as any).size : 1;
    const half = (size * 50) / 2;
    return {
      x: object.location.x + half,
      y: object.location.y + half,
    };
  }

  /** Animate selected movables through absolute center waypoints. */
  static async animatePath(
    targets: TabletopObject[],
    waypoints: { x: number; y: number }[],
    stepMs: number = 640,
    pauseMs: number = 300
  ): Promise<boolean> {
    if (!targets.length || !waypoints.length) return false;
    let any = false;
    for (const wp of waypoints) {
      if (MovableSelectionSynchronizer.moveCentersTo(targets, wp.x, wp.y, stepMs)) any = true;
      await new Promise<void>(resolve => setTimeout(resolve, stepMs));
      if (pauseMs > 0) {
        await new Promise<void>(resolve => setTimeout(resolve, pauseMs));
      }
    }
    for (const object of targets) {
      MovableSelectionSynchronizer.objectMap.get(object)?.forEach(m => m.setAnimatedTransition(true));
    }
    return any;
  }

  static isObjectLocked(object: TabletopObject): boolean {
    return MovableSelectionSynchronizer.isLocked(object);
  }

  private static isLocked(object: TabletopObject): boolean {
    if (!!(object as any).isLocked || !!(object as any).isLock) return true;
    if (object instanceof GameCharacter && object.isLockedByPlayerOwner) return true;
    return false;
  }
}

function poseFromMovable(movable: MovableDirective): TransformPose {
  const pose: TransformPose = {
    x: movable.posX,
    y: movable.posY,
    posZ: movable.posZ,
  };
  const object = movable.tabletopObject;
  if (object && 'rotate' in object) pose.rotate = +(object as any).rotate || 0;
  return pose;
}

function poseFromObject(object: TabletopObject): TransformPose {
  // Prefer live directive positions (BatchService may lag object.location).
  for (const movable of MovableDirective.layerMap.get(object.aliasName) ?? []) {
    if (movable.tabletopObject === object && !movable.isDisable) {
      return poseFromMovable(movable);
    }
  }
  const pose: TransformPose = {
    x: object.location.x,
    y: object.location.y,
    posZ: object.posZ,
  };
  if ('rotate' in object) pose.rotate = +(object as any).rotate || 0;
  return pose;
}

function checkOverlapSAT(rectA: IPoint2D[], rectB: IPoint2D[]) {
  let edges = [...getEdges(rectA), ...getEdges(rectB)];

  for (let edge of edges) {
    let axis = { x: -edge.y, y: edge.x }; // 法線向量
    let projA = projectOntoAxis(rectA, axis);
    let projB = projectOntoAxis(rectB, axis);

    let isProjectionsOverlap = !(projA.max < projB.min || projB.max < projA.min);
    if (!isProjectionsOverlap) return false;
  }

  return true; // 若各軸投影皆重疊則判定為接觸
}

function getEdges(points: IPoint2D[]): IPoint2D[] {
  let edges = [];
  for (let i = 0; i < points.length; i++) {
    let next = (i + 1) % points.length;
    edges.push({ x: points[next].x - points[i].x, y: points[next].y - points[i].y });
  }
  return edges;
}

function projectOntoAxis(points: IPoint2D[], axis: IPoint2D): { min: number, max: number } {
  let min = Infinity, max = -Infinity;
  for (let p of points) {
    let projection = (p.x * axis.x + p.y * axis.y);
    min = Math.min(min, projection);
    max = Math.max(max, projection);
  }
  return { min, max };
}
