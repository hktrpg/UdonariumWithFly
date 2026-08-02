import { Injectable } from '@angular/core';
import { Card } from '@udonarium/card';
import { CardStack } from '@udonarium/card-stack';
import { ObjectSerializer } from '@udonarium/core/synchronize-object/object-serializer';
import { EventSystem, Network } from '@udonarium/core/system';
import { DiceSymbol } from '@udonarium/dice-symbol';
import { GameCharacter } from '@udonarium/game-character';
import { GameTableMask } from '@udonarium/game-table-mask';
import { RangeArea } from '@udonarium/range';
import { PresetSound, SoundEffect } from '@udonarium/sound-effect';
import { TableSelecter } from '@udonarium/table-selecter';
import { TabletopObject } from '@udonarium/tabletop-object';
import { Terrain } from '@udonarium/terrain';
import { TextNote } from '@udonarium/text-note';
import { MovableSelectionSynchronizer } from 'directive/movable-selection-synchronizer';
import { RotableSelectionSynchronizer } from 'directive/rotable-selection-synchronizer';

import { TabletopSelectionService } from './tabletop-selection.service';

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

  private readonly onKeyDown = (e: KeyboardEvent) => this.handleKeyDown(e);
  private readonly onKeyUp = (e: KeyboardEvent) => this.handleKeyUp(e);
  private readonly onBlur = () => this.pressed.clear();

  constructor(
    private selectionService: TabletopSelectionService,
  ) { }

  initialize() {
    if (this.listening) return;
    document.addEventListener('keydown', this.onKeyDown, true);
    document.addEventListener('keyup', this.onKeyUp, true);
    window.addEventListener('blur', this.onBlur);
    this.listening = true;
  }

  destroy() {
    if (!this.listening) return;
    document.removeEventListener('keydown', this.onKeyDown, true);
    document.removeEventListener('keyup', this.onKeyUp, true);
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
      if (code === 'KeyC') {
        // Prefer native text copy when the user has highlighted text.
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

    if (Network.GuestMode()) return;

    if (code === 'Escape' && !mod && !e.altKey && !e.shiftKey) {
      if (this.selectionService.size > 0) {
        this.selectionService.clear();
        this.consume(e);
      }
      return;
    }

    if (code === 'Delete' && !mod && !e.altKey) {
      if (this.deleteSelection()) this.consume(e);
      return;
    }

    if (!MOVE_CODES.has(code) || mod || e.altKey) return;
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

  private shouldIgnore(e: KeyboardEvent): boolean {
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
    // Up = 0°, Right = 90°, Down = 180°, Left = 270° (and diagonals).
    let angle = Math.atan2(delta.dx, -delta.dy) * 180 / Math.PI;
    if (angle < 0) angle += 360;
    return angle;
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

    const gridSize = TableSelecter.instance.viewTable?.gridSize ?? 50;
    const table = TableSelecter.instance.viewTable;
    const pasted: TabletopObject[] = [];

    for (const xml of this.clipboardXml) {
      const object = ObjectSerializer.instance.parseXml(xml);
      if (!(object instanceof TabletopObject)) continue;

      object.location.x += gridSize;
      object.location.y += gridSize;

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

      pasted.push(object);
    }

    if (pasted.length < 1) return false;

    this.selectionService.clear();
    for (const object of pasted) {
      this.selectionService.add(object);
    }
    SoundEffect.play(PresetSound.piecePut);
    return true;
  }

  private deleteSelection(): boolean {
    if (Network.GuestMode()) return false;
    if (this.selectionService.size < 1) return false;

    const targets = [...this.selectionService.objects];
    let deleted = false;

    for (const object of targets) {
      if (this.isLocked(object)) continue;

      if (object instanceof GameCharacter) {
        EventSystem.call('FAREWELL_STAND_IMAGE', { characterIdentifier: object.identifier });
        object.setLocation('graveyard');
        this.selectionService.remove(object);
        deleted = true;
        continue;
      }

      object.destroy();
      this.selectionService.remove(object);
      deleted = true;
    }

    if (deleted) SoundEffect.play(PresetSound.sweep);
    return deleted;
  }

  private isLocked(object: TabletopObject): boolean {
    return !!(object as any).isLocked || !!(object as any).isLock;
  }
}
