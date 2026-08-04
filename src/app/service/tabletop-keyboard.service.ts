import { Injectable } from '@angular/core';
import { Card } from '@udonarium/card';
import { CardStack } from '@udonarium/card-stack';
import { ObjectNode } from '@udonarium/core/synchronize-object/object-node';
import { ObjectSerializer } from '@udonarium/core/synchronize-object/object-serializer';
import { ObjectStore } from '@udonarium/core/synchronize-object/object-store';
import { EventSystem, Network } from '@udonarium/core/system';
import { DiceSymbol } from '@udonarium/dice-symbol';
import { GameCharacter } from '@udonarium/game-character';
import { GameTableMask } from '@udonarium/game-table-mask';
import { RangeArea } from '@udonarium/range';
import { PresetSound, SoundEffect } from '@udonarium/sound-effect';
import { TableSelecter } from '@udonarium/table-selecter';
import { TabletopObject } from '@udonarium/tabletop-object';
import { moveToBackmost, moveToTopmost, Stackable } from '@udonarium/tabletop-object-util';
import { Terrain } from '@udonarium/terrain';
import { TextNote } from '@udonarium/text-note';
import { MovableDirective } from 'directive/movable.directive';
import { MovableSelectionSynchronizer } from 'directive/movable-selection-synchronizer';
import { RotableSelectionSynchronizer } from 'directive/rotable-selection-synchronizer';

import { CoordinateService } from './coordinate.service';
import { SceneToolService } from './scene-tool.service';
import { TabletopSelectionService } from './tabletop-selection.service';
import { TokenPathMoveService } from './token-path-move.service';
import { DeleteEntry, UndoService } from './undo.service';

const MOVE_CODES = new Set([
  'KeyW', 'KeyA', 'KeyS', 'KeyD',
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
]);

@Injectable({
  providedIn: 'root'
})
export class TabletopKeyboardService {
  private readonly pressed = new Set<string>();
  private clipboardXml: string[] = [];
  private listening = false;
  /** Acc for Alt/Ctrl+Shift wheel → one discrete step per notch. */
  private wheelAcc = 0;

  private readonly onKeyDown = (e: KeyboardEvent) => this.handleKeyDown(e);
  private readonly onKeyUp = (e: KeyboardEvent) => this.handleKeyUp(e);
  private readonly onWheel = (e: WheelEvent) => this.handleWheel(e);
  private readonly onBlur = () => {
    this.pressed.clear();
    this.wheelAcc = 0;
  };

  constructor(
    private selectionService: TabletopSelectionService,
    private coordinateService: CoordinateService,
    private sceneTools: SceneToolService,
    private undoService: UndoService,
    private tokenPath: TokenPathMoveService,
  ) { }

  initialize() {
    if (this.listening) return;
    this.undoService.setPoseVisualSync((object, pose) => {
      MovableDirective.syncPoseFromUndo(object, pose.x, pose.y, pose.posZ);
      if (pose.rotate != null || pose.roll != null) {
        RotableSelectionSynchronizer.syncRotateFromUndo(object, pose);
      }
    });
    document.addEventListener('keydown', this.onKeyDown, true);
    document.addEventListener('keyup', this.onKeyUp, true);
    document.addEventListener('wheel', this.onWheel, { capture: true, passive: false });
    window.addEventListener('blur', this.onBlur);
    this.listening = true;
  }

  destroy() {
    if (!this.listening) return;
    document.removeEventListener('keydown', this.onKeyDown, true);
    document.removeEventListener('keyup', this.onKeyUp, true);
    document.removeEventListener('wheel', this.onWheel, true);
    window.removeEventListener('blur', this.onBlur);
    this.pressed.clear();
    this.listening = false;
  }

  private handleKeyDown(e: KeyboardEvent) {
    if (this.shouldIgnore(e)) return;

    const code = e.code;
    if (MOVE_CODES.has(code)) this.pressed.add(code);

    const mod = e.ctrlKey || e.metaKey;

    if (mod && !e.altKey && !e.shiftKey) {
      if (code === 'KeyZ') {
        if (this.undoService.undo()) this.consume(e);
        return;
      }
      if (code === 'KeyY') {
        if (this.undoService.redo()) this.consume(e);
        return;
      }
      if (code === 'KeyC') {
        if (this.hasTextSelection()) return;
        if (this.copySelection()) this.consume(e);
        return;
      }
      if (code === 'KeyX') {
        if (this.hasTextSelection()) return;
        if (this.cutSelection()) this.consume(e);
        return;
      }
      if (code === 'KeyV') {
        if (this.pasteClipboard()) this.consume(e);
        return;
      }
    }

    if (mod && e.shiftKey && !e.altKey && code === 'KeyZ') {
      if (this.undoService.redo()) this.consume(e);
      return;
    }

    if (Network.GuestMode()) return;

    // Path draft: Space commits movement along existing waypoints.
    if (code === 'Space' && !mod && !e.altKey && !e.shiftKey) {
      if (this.tokenPath.hasDraft && !this.tokenPath.isAnimating) {
        void this.tokenPath.commit();
        this.consume(e);
      }
      // Always stop here so Space does not fall through to WASD / other handlers.
      return;
    }

    if (code === 'Escape' && !mod && !e.altKey && !e.shiftKey) {
      if (this.tokenPath.hasDraft && !this.tokenPath.isAnimating) {
        this.tokenPath.cancelDraft();
        this.consume(e);
        return;
      }
      if (this.sceneTools.selectionCount > 0) {
        this.sceneTools.clearSelection();
        this.consume(e);
        return;
      }
      if (this.selectionService.size > 0) {
        this.selectionService.clear();
        this.consume(e);
      }
      return;
    }

    if (code === 'Delete' && !mod && !e.altKey) {
      if (this.sceneTools.selectionCount > 0) {
        if (this.sceneTools.deleteSelection()) this.consume(e);
        return;
      }
      if (this.deleteSelection()) this.consume(e);
      return;
    }

    if ((code === 'BracketLeft' || code === 'BracketRight') && !mod && !e.altKey && !e.shiftKey) {
      if (this.changeLayerOrder(code === 'BracketRight')) this.consume(e);
      return;
    }

    if (!MOVE_CODES.has(code) || mod || e.altKey) return;

    // Scene-tool selection: WASD / arrows nudge drawings, lights, walls.
    if (this.sceneTools.selectionCount > 0) {
      if (e.shiftKey) return;
      const sceneDelta = this.moveDeltaFromPressed();
      if (!sceneDelta) return;
      const sceneGrid = TableSelecter.instance.viewTable?.gridSize ?? 50;
      if (this.sceneTools.nudgeSelection(sceneDelta.dx * sceneGrid, sceneDelta.dy * sceneGrid)) {
        if (!e.repeat) SoundEffect.play(PresetSound.piecePut);
        this.consume(e);
      }
      return;
    }

    if (this.selectionService.size < 1) return;

    if (e.shiftKey) {
      const angle = this.facingAngleFromPressed();
      if (angle == null) return;
      if (RotableSelectionSynchronizer.face(this.selectionService.objects, angle)) {
        this.consume(e);
      }
      return;
    }

    const delta = this.moveDeltaFromPressed();
    if (!delta) return;
    const gridSize = TableSelecter.instance.viewTable?.gridSize ?? 50;
    if (MovableSelectionSynchronizer.nudge(this.selectionService.objects, delta.dx * gridSize, delta.dy * gridSize)) {
      if (!e.repeat) SoundEffect.play(PresetSound.piecePut);
      this.consume(e);
    }
  }

  private handleKeyUp(e: KeyboardEvent) {
    this.pressed.delete(e.code);
  }

  private handleWheel(e: WheelEvent) {
    if (this.shouldIgnore(e)) return;
    if (Network.GuestMode()) return;
    // With selection:
    //   Alt+wheel → facing ±3° per notch
    //   Alt+Shift+wheel → roll ±3° per notch
    //   Ctrl+Shift+wheel → facing ±45° per notch
    // Empty selection: Alt / Alt+Shift view rotate (±3°) is handled by TableMouseGesture.
    const isCtrlShift = (e.ctrlKey || e.metaKey) && e.shiftKey;
    const isAltOnly = e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey;
    const isAltShift = e.altKey && e.shiftKey && !e.ctrlKey && !e.metaKey;
    const stepDeg = isCtrlShift ? 45 : (isAltOnly || isAltShift) ? 3 : null;
    if (stepDeg == null) return;
    if (this.selectionService.size < 1) return;

    // Prefer the dominant axis (Shift may still contribute deltaX while Ctrl is held).
    const scroll = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    if (scroll === 0) return;

    let amount = scroll;
    if (e.deltaMode === WheelEvent.DOM_DELTA_LINE) amount *= 16;
    else if (e.deltaMode === WheelEvent.DOM_DELTA_PAGE) amount *= 800;

    // Always consume so TableMouseGesture cannot also rotate the view.
    e.preventDefault();
    e.stopPropagation();

    const notch = 100;
    this.wheelAcc += amount;
    if (Math.abs(this.wheelAcc) < notch) return;
    const dir = this.wheelAcc > 0 ? 1 : -1;
    this.wheelAcc -= dir * notch;
    const delta = dir * stepDeg;

    if (isAltShift) {
      RotableSelectionSynchronizer.rollBy(this.selectionService.objects, delta);
    } else {
      RotableSelectionSynchronizer.rotateBy(this.selectionService.objects, delta);
    }
  }

  private shouldIgnore(e: Event): boolean {
    const target = e.target;
    if (!(target instanceof HTMLElement)) return false;
    const tag = target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
    if (target.isContentEditable) return true;
    return !!target.closest('[contenteditable="true"], [contenteditable=""]');
  }

  private hasTextSelection(): boolean {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount < 1 || sel.isCollapsed) return false;
    return sel.toString().length > 0;
  }

  private consume(e: KeyboardEvent) {
    e.preventDefault();
    e.stopPropagation();
  }

  private moveDeltaFromPressed(): { dx: number, dy: number } | null {
    let dx = 0;
    let dy = 0;
    if (this.pressed.has('KeyW') || this.pressed.has('ArrowUp')) dy -= 1;
    if (this.pressed.has('KeyS') || this.pressed.has('ArrowDown')) dy += 1;
    if (this.pressed.has('KeyA') || this.pressed.has('ArrowLeft')) dx -= 1;
    if (this.pressed.has('KeyD') || this.pressed.has('ArrowRight')) dx += 1;
    if (dx === 0 && dy === 0) return null;
    return { dx, dy };
  }

  private facingAngleFromPressed(): number | null {
    const delta = this.moveDeltaFromPressed();
    if (!delta) return null;
    let angle = Math.atan2(delta.dx, -delta.dy) * 180 / Math.PI;
    if (angle < 0) angle += 360;
    return angle;
  }

  private changeLayerOrder(toFront: boolean): boolean {
    if (this.selectionService.size < 1) return false;
    const before = this.snapshotZindexes(this.selectionService.objects);
    const beforeOrder = this.snapshotChildOrders(this.selectionService.objects);
    let changed = false;
    for (const object of this.selectionService.objects) {
      if (this.isLocked(object)) continue;
      if (toFront ? this.bringToFront(object) : this.sendToBack(object)) changed = true;
    }
    if (changed) {
      const after = this.snapshotZindexes(this.selectionService.objects);
      const afterOrder = this.snapshotChildOrders(this.selectionService.objects);
      this.undoService.recordLayerChange(before, after, beforeOrder, afterOrder, 'layer');
    }
    return changed;
  }

  private snapshotZindexes(objects: TabletopObject[]): Map<string, number> {
    const map = new Map<string, number>();
    const aliases = new Set<string>();
    for (const object of objects) {
      if (!('zindex' in object)) continue;
      aliases.add(object.aliasName);
    }
    for (const alias of aliases) {
      for (const peer of ObjectStore.instance.getObjects(alias) as Stackable[]) {
        if (!peer.isVisibleOnTable) continue;
        map.set(peer.identifier, peer.zindex);
      }
    }
    return map;
  }

  private snapshotChildOrders(objects: TabletopObject[]): Map<string, string[]> {
    const map = new Map<string, string[]>();
    for (const object of objects) {
      if (!(object instanceof Terrain || object instanceof GameTableMask)) continue;
      const parent = (object as ObjectNode).parent;
      if (!parent || map.has(parent.identifier)) continue;
      map.set(parent.identifier, parent.children.map(c => c.identifier));
    }
    return map;
  }

  private bringToFront(object: TabletopObject): boolean {
    if (typeof (object as any).toTopmost === 'function') {
      (object as any).toTopmost();
      return true;
    }
    if ((object instanceof Terrain || object instanceof GameTableMask) && object.parent) {
      object.parent.appendChild(object);
      return true;
    }
    if ('zindex' in object) {
      moveToTopmost(object as Stackable);
      return true;
    }
    return false;
  }

  private sendToBack(object: TabletopObject): boolean {
    if (typeof (object as any).toBackmost === 'function') {
      (object as any).toBackmost();
      return true;
    }
    if ((object instanceof Terrain || object instanceof GameTableMask) && object.parent) {
      object.parent.prependChild(object);
      return true;
    }
    if ('zindex' in object) {
      moveToBackmost(object as Stackable);
      return true;
    }
    return false;
  }

  private copySelection(): boolean {
    if (Network.GuestMode()) return false;
    if (this.selectionService.size < 1) return false;
    this.clipboardXml = this.selectionService.objects.map(object => object.toXml());
    return this.clipboardXml.length > 0;
  }

  private cutSelection(): boolean {
    if (!this.copySelection()) return false;
    return this.deleteSelection();
  }

  private pasteClipboard(): boolean {
    if (Network.GuestMode()) return false;
    if (this.clipboardXml.length < 1) return false;

    const table = TableSelecter.instance.viewTable;
    const pasted: TabletopObject[] = [];

    for (const xml of this.clipboardXml) {
      const object = ObjectSerializer.instance.parseXml(xml);
      if (!(object instanceof TabletopObject)) continue;
      pasted.push(object);
    }
    if (pasted.length < 1) return false;

    let cx = 0;
    let cy = 0;
    for (const object of pasted) {
      cx += object.location.x;
      cy += object.location.y;
    }
    cx /= pasted.length;
    cy /= pasted.length;

    const pointer = this.coordinateService.calcTabletopLocalCoordinate();
    const dx = pointer.x - cx;
    const dy = pointer.y - cy;

    for (const object of pasted) {
      object.location.x += dx;
      object.location.y += dy;

      if (object instanceof GameCharacter) {
        object.update();
      } else if (object instanceof Terrain) {
        object.isLocked = false;
        if (table) table.appendChild(object);
      } else if (object instanceof GameTableMask) {
        object.isLock = false;
        object.isPreview = false;
        if (table) table.appendChild(object);
      } else if (object instanceof Card) {
        object.isLocked = false;
        object.toTopmost();
      } else if (object instanceof CardStack) {
        object.isLocked = false;
        object.owner = '';
        object.toTopmost();
      } else if (object instanceof TextNote) {
        object.isLocked = false;
        object.toTopmost();
      } else if (object instanceof DiceSymbol) {
        object.update();
      } else if (object instanceof RangeArea) {
        object.isLocked = false;
        object.toTopmost();
      } else {
        object.update();
      }
    }

    this.selectionService.clear();
    for (const object of pasted) {
      this.selectionService.add(object);
    }
    this.undoService.recordCreated(pasted as ObjectNode[], 'paste');
    SoundEffect.play(PresetSound.piecePut);
    return true;
  }

  private deleteSelection(): boolean {
    if (Network.GuestMode()) return false;
    if (this.selectionService.size < 1) return false;

    const targets = [...this.selectionService.objects];
    const entries: DeleteEntry[] = [];
    let deleted = false;

    for (const object of targets) {
      if (this.isLocked(object)) continue;

      if (object instanceof GameCharacter) {
        entries.push({
          kind: 'graveyard',
          id: object.identifier,
          fromLocation: object.location.name,
          fromTableIdentifier: object.tableIdentifier,
        });
        EventSystem.call('FAREWELL_STAND_IMAGE', { characterIdentifier: object.identifier });
        object.setLocation('graveyard');
        this.selectionService.remove(object);
        deleted = true;
        continue;
      }

      entries.push({
        kind: 'destroy',
        xml: object.toXml(),
        parentId: (object as ObjectNode).parentId || TableSelecter.instance.viewTable?.identifier || '',
        liveId: object.identifier,
      });
      object.destroy();
      this.selectionService.remove(object);
      deleted = true;
    }

    if (deleted) {
      this.undoService.recordDeleted(entries, 'delete');
      SoundEffect.play(PresetSound.sweep);
    }
    return deleted;
  }

  private isLocked(object: TabletopObject): boolean {
    if (!!(object as any).isLocked || !!(object as any).isLock) return true;
    if (object instanceof GameCharacter && object.isLockedByPlayerOwner) return true;
    return false;
  }
}
