import { Component, OnDestroy, OnInit } from '@angular/core';

import { ObjectStore } from '@udonarium/core/synchronize-object/object-store';
import { EventSystem, Network } from '@udonarium/core/system';
import { DataElement } from '@udonarium/data-element';
import { GameCharacter } from '@udonarium/game-character';
import { PeerCursor } from '@udonarium/peer-cursor';

import * as localForage from 'localforage';

@Component({
  selector: 'character-resource-hud',
  templateUrl: './character-resource-hud.component.html',
  styleUrls: ['./character-resource-hud.component.css'],
  standalone: false
})
export class CharacterResourceHudComponent implements OnInit, OnDestroy {
  static readonly VISIBLE_KEY = 'udonanaumu-resource-hud-visible';
  static readonly GM_ALL_KEY = 'udonanaumu-resource-hud-gm-all';
  static isVisible = false;
  static showAllForGm = false;

  left = 12;
  top = 72;
  private dragOffsetX = 0;
  private dragOffsetY = 0;
  private dragging = false;
  private lazyUpdateTimer: NodeJS.Timeout = null;

  get visible(): boolean { return CharacterResourceHudComponent.isVisible; }
  get showAllForGm(): boolean { return CharacterResourceHudComponent.showAllForGm; }
  get isGm(): boolean { return !!PeerCursor.myCursor?.isGMMode; }
  get isGuest(): boolean { return Network.GuestMode(); }
  get canEdit(): boolean { return !this.isGuest; }

  get claimed(): GameCharacter | null {
    return GameCharacter.preferredChatCharacter();
  }

  get characters(): GameCharacter[] {
    if (this.isGm && this.showAllForGm) {
      return ObjectStore.instance.getObjects(GameCharacter).filter(ch => ch.isVisibleOnTable);
    }
    const mine = this.claimed;
    return mine ? [mine] : [];
  }

  ngOnInit() {
    localForage.getItem(CharacterResourceHudComponent.VISIBLE_KEY).then(v => {
      if (typeof v === 'boolean') CharacterResourceHudComponent.isVisible = v;
    });
    localForage.getItem(CharacterResourceHudComponent.GM_ALL_KEY).then(v => {
      if (typeof v === 'boolean') CharacterResourceHudComponent.showAllForGm = v;
    });
    EventSystem.register(this)
      .on('UPDATE_GAME_OBJECT', () => this.lazyNgZoneUpdate())
      .on('DELETE_GAME_OBJECT', () => this.lazyNgZoneUpdate());
    document.addEventListener('pointermove', this.onPointerMove);
    document.addEventListener('pointerup', this.onPointerUp);
  }

  ngOnDestroy() {
    EventSystem.unregister(this);
    document.removeEventListener('pointermove', this.onPointerMove);
    document.removeEventListener('pointerup', this.onPointerUp);
  }

  static setVisible(v: boolean) {
    CharacterResourceHudComponent.isVisible = v;
    localForage.setItem(CharacterResourceHudComponent.VISIBLE_KEY, v).catch(() => {});
  }

  static setShowAllForGm(v: boolean) {
    CharacterResourceHudComponent.showAllForGm = v;
    localForage.setItem(CharacterResourceHudComponent.GM_ALL_KEY, v).catch(() => {});
  }

  toggleShowAll() {
    CharacterResourceHudComponent.setShowAllForGm(!this.showAllForGm);
  }

  resourcesOf(ch: GameCharacter): DataElement[] {
    if (!ch?.detailDataElement) return [];
    return ch.detailDataElement.getElementsByType('numberResource');
  }

  canEditCharacter(ch: GameCharacter): boolean {
    if (!this.canEdit) return false;
    if (this.isGm) return true;
    return ch.playerOwner === Network.peer?.userId;
  }

  current(el: DataElement): number {
    return Number(el.currentValue) || 0;
  }

  max(el: DataElement): number {
    const m = Number(el.value);
    return isFinite(m) ? m : 0;
  }

  setCurrent(el: DataElement, ch: GameCharacter, raw: number) {
    if (!this.canEditCharacter(ch)) return;
    const max = this.max(el);
    let v = Math.round(Number(raw));
    if (!isFinite(v)) v = 0;
    if (max > 0) v = Math.max(0, Math.min(max, v));
    else v = Math.max(0, v);
    el.currentValue = v;
  }

  nudge(el: DataElement, ch: GameCharacter, delta: number) {
    this.setCurrent(el, ch, this.current(el) + delta);
  }

  onRange(el: DataElement, ch: GameCharacter, event: Event) {
    const input = event.target as HTMLInputElement;
    this.setCurrent(el, ch, Number(input.value));
  }

  startDrag(event: PointerEvent) {
    if ((event.target as HTMLElement).closest('button,input,label')) return;
    this.dragging = true;
    this.dragOffsetX = event.clientX - this.left;
    this.dragOffsetY = event.clientY - this.top;
  }

  private onPointerMove = (event: PointerEvent) => {
    if (!this.dragging) return;
    this.left = Math.max(0, event.clientX - this.dragOffsetX);
    this.top = Math.max(0, event.clientY - this.dragOffsetY);
  };

  private onPointerUp = () => {
    this.dragging = false;
  };

  private lazyNgZoneUpdate() {
    if (this.lazyUpdateTimer !== null) return;
    this.lazyUpdateTimer = setTimeout(() => {
      this.lazyUpdateTimer = null;
      // trigger CD via zone
    }, 80);
  }
}
