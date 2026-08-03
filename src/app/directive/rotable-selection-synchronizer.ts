import { GameCharacter } from '@udonarium/game-character';
import { TabletopObject } from '@udonarium/tabletop-object';
import { SelectionState, TabletopSelectionService } from 'service/tabletop-selection.service';
import { TransformPose, UndoService } from 'service/undo.service';

import { RotableDirective } from './rotable.directive';

export class RotableSelectionSynchronizer {
  private static readonly rotablesMap: Map<TabletopObject, Set<RotableDirective>> = new Map();

  private get selectedRotables(): Set<RotableDirective> {
    let selected: Set<RotableDirective> = new Set();
    for (let object of this.selection.objects) {
      RotableSelectionSynchronizer.rotablesMap.get(object)?.forEach(r => selected.add(r));
    }
    return selected;
  }

  private _isDestroyed: boolean = false;
  get isDestroyed(): boolean { return this._isDestroyed; }

  private undoTargets: Set<RotableDirective> = new Set();

  constructor(
    private rotable: RotableDirective,
    private selection: TabletopSelectionService,
  ) { }

  initialize() {
    this.register();
  }

  destroy() {
    this.unregister();
    this._isDestroyed = true;
    this.rotable = null;
  }

  prepareRotate() {
    this.beginUndoCapture();

    if (1 < this.selection.size && this.rotable.state !== SelectionState.NONE) {
      for (let rotable of this.selectedRotables) {
        if (rotable === this.rotable) continue;
        if (!rotable.isDisable) {
          rotable.setAnimatedTransition(false);
          this.trackUndoTarget(rotable);
        }
      }
    } else {
      this.selection.clear();
    }
  }

  updateRotate() {
    if (this.selection.size <= 1 || this.rotable.state === SelectionState.NONE) return;
    for (let rotable of this.selectedRotables) {
      if (rotable === this.rotable) continue;
      if (!rotable.isDisable
        && rotable.tabletopObject.aliasName === this.rotable.tabletopObject.aliasName
        && rotable.targetPropertyName === this.rotable.targetPropertyName) {
        rotable.rotate = this.rotable.rotate;
      }
    }
  }

  finishRotate() {
    if (1 < this.selection.size && this.rotable.state !== SelectionState.NONE) {
      for (let rotable of this.selectedRotables) {
        if (rotable === this.rotable) continue;
        if (!rotable.isDisable
          && rotable.tabletopObject.aliasName === this.rotable.tabletopObject.aliasName
          && rotable.targetPropertyName === this.rotable.targetPropertyName) {
          rotable.setAnimatedTransition(true);
          rotable.rotate = this.rotable.rotate;
        }
      }
    }
    this.commitUndoCapture();
  }

  private beginUndoCapture() {
    const undo = UndoService.instance;
    if (!undo) return;
    undo.beginTransformGesture();
    this.undoTargets.clear();
    this.trackUndoTarget(this.rotable);
  }

  private trackUndoTarget(rotable: RotableDirective) {
    if (!rotable?.tabletopObject || rotable.targetPropertyName !== 'rotate') return;
    this.undoTargets.add(rotable);
    UndoService.instance?.rememberBeforePose(
      rotable.tabletopObject.identifier,
      poseFromRotable(rotable),
    );
  }

  private commitUndoCapture() {
    const undo = UndoService.instance;
    if (!undo) {
      this.undoTargets.clear();
      return;
    }
    const after = new Map<string, TransformPose>();
    for (const rotable of this.undoTargets) {
      if (!rotable?.tabletopObject) continue;
      after.set(rotable.tabletopObject.identifier, poseFromRotable(rotable));
    }
    this.undoTargets.clear();
    undo.commitTransformGesture(after, 'rotate');
  }

  register() {
    let rotableSet = RotableSelectionSynchronizer.rotablesMap.get(this.rotable.tabletopObject) ?? new Set();
    rotableSet.add(this.rotable);
    RotableSelectionSynchronizer.rotablesMap.set(this.rotable.tabletopObject, rotableSet);
  }

  unregister() {
    let objectSet = RotableSelectionSynchronizer.rotablesMap.get(this.rotable.tabletopObject);
    if (!objectSet) return;
    objectSet.delete(this.rotable);
    if (objectSet.size < 1) RotableSelectionSynchronizer.rotablesMap.delete(this.rotable.tabletopObject);
  }

  static syncRotateFromUndo(object: TabletopObject, rotate: number) {
    if (!object) return;
    const rotables = RotableSelectionSynchronizer.rotablesMap.get(object);
    if (!rotables) return;
    for (const rotable of rotables) {
      if (rotable.targetPropertyName !== 'rotate') continue;
      rotable.applyExternalRotate(rotate);
    }
  }

  static face(targets: TabletopObject[], angle: number): boolean {
    return RotableSelectionSynchronizer.applyRotate(targets, () => angle);
  }

  static rotateBy(targets: TabletopObject[], delta: number): boolean {
    if (delta === 0) return false;
    // Keep unbounded angles (no % 360). Wrapping while CSS transition is on
    // interpolates the long way and looks like a sudden ~180°+ spin.
    return RotableSelectionSynchronizer.applyRotate(targets, current => current + delta);
  }

  private static applyRotate(targets: TabletopObject[], nextAngle: (current: number) => number): boolean {
    const before = new Map<string, TransformPose>();
    for (const object of targets) {
      if (!('rotate' in object)) continue;
      if ((object as any).isLocked || (object as any).isLock) continue;
      if (object instanceof GameCharacter && object.isLockedByPlayerOwner) continue;
      before.set(object.identifier, poseFromObjectRotate(object));
    }

    let rotated = false;
    for (let object of targets) {
      let rotables = RotableSelectionSynchronizer.rotablesMap.get(object);
      if (rotables == null || rotables.size < 1) {
        if (!('rotate' in object)) continue;
        if ((object as any).isLocked || (object as any).isLock) continue;
        if (object instanceof GameCharacter && object.isLockedByPlayerOwner) continue;
        (object as any).rotate = nextAngle(+(object as any).rotate || 0);
        rotated = true;
        continue;
      }
      for (let rotable of rotables) {
        if (rotable.isDisable) continue;
        if (rotable.targetPropertyName !== 'rotate') continue;
        // Instant update — animated rotateZ(350→5) spins almost a full turn.
        rotable.setAnimatedTransition(false);
        rotable.stopTransition(rotable.rotate);
        rotable.rotate = nextAngle(rotable.rotate);
        rotated = true;
      }
    }

    if (rotated) {
      const after = new Map<string, TransformPose>();
      for (const id of before.keys()) {
        const object = targets.find(t => t.identifier === id);
        if (object) after.set(id, poseFromObjectRotate(object));
      }
      UndoService.instance?.recordTransform('rotate', before, after, 'rotate');
    }
    return rotated;
  }
}

function poseFromRotable(rotable: RotableDirective): TransformPose {
  const object = rotable.tabletopObject;
  return {
    x: object?.location.x ?? 0,
    y: object?.location.y ?? 0,
    posZ: object?.posZ ?? 0,
    rotate: rotable.rotate,
  };
}

function poseFromObjectRotate(object: TabletopObject): TransformPose {
  return {
    x: object.location.x,
    y: object.location.y,
    posZ: object.posZ,
    rotate: +(object as any).rotate || 0,
  };
}
