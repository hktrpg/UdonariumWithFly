import { ChangeDetectorRef, Component, OnDestroy, OnInit } from '@angular/core';

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
  static readonly POS_KEY = 'udonanaumu-resource-hud-pos';
  static readonly COLLAPSED_KEY = 'udonanaumu-resource-hud-collapsed';
  static isVisible = false;
  static showAllForGm = false;

  left = 12;
  top = 72;
  collapsed = false;
  private dragOffsetX = 0;
  private dragOffsetY = 0;
  private dragging = false;
  private lazyUpdateTimer: ReturnType<typeof setTimeout> = null;

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

  constructor(private changeDetector: ChangeDetectorRef) {}

  ngOnInit() {
    localForage.getItem(CharacterResourceHudComponent.VISIBLE_KEY).then(v => {
      if (typeof v === 'boolean') {
        CharacterResourceHudComponent.isVisible = v;
        this.changeDetector.markForCheck();
      }
    });
    localForage.getItem(CharacterResourceHudComponent.GM_ALL_KEY).then(v => {
      if (typeof v === 'boolean') {
        CharacterResourceHudComponent.showAllForGm = v;
        this.changeDetector.markForCheck();
      }
    });
    localForage.getItem<{ left: number; top: number }>(CharacterResourceHudComponent.POS_KEY).then(pos => {
      if (pos && typeof pos.left === 'number' && typeof pos.top === 'number') {
        this.left = pos.left;
        this.top = pos.top;
        this.clampToViewport();
        this.changeDetector.markForCheck();
      }
    });
    localForage.getItem(CharacterResourceHudComponent.COLLAPSED_KEY).then(v => {
      if (typeof v === 'boolean') {
        this.collapsed = v;
        this.changeDetector.markForCheck();
      }
    });
    EventSystem.register(this)
      .on('UPDATE_GAME_OBJECT', () => this.lazyNgZoneUpdate())
      .on('DELETE_GAME_OBJECT', () => this.lazyNgZoneUpdate());
    document.addEventListener('pointermove', this.onPointerMove);
    document.addEventListener('pointerup', this.onPointerUp);
    window.addEventListener('resize', this.onResize);
  }

  ngOnDestroy() {
    EventSystem.unregister(this);
    document.removeEventListener('pointermove', this.onPointerMove);
    document.removeEventListener('pointerup', this.onPointerUp);
    window.removeEventListener('resize', this.onResize);
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

  toggleCollapsed() {
    this.collapsed = !this.collapsed;
    localForage.setItem(CharacterResourceHudComponent.COLLAPSED_KEY, this.collapsed).catch(() => {});
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
    event.preventDefault();
    event.stopPropagation();
    this.dragging = true;
    this.dragOffsetX = event.clientX - this.left;
    this.dragOffsetY = event.clientY - this.top;
    (event.target as HTMLElement)?.setPointerCapture?.(event.pointerId);
  }

  private onPointerMove = (event: PointerEvent) => {
    if (!this.dragging) return;
    this.left = event.clientX - this.dragOffsetX;
    this.top = event.clientY - this.dragOffsetY;
    this.clampToViewport();
    this.changeDetector.detectChanges();
  };

  private onPointerUp = () => {
    if (!this.dragging) return;
    this.dragging = false;
    this.persistPosition();
  };

  private onResize = () => {
    this.clampToViewport();
    this.changeDetector.markForCheck();
  };

  private clampToViewport() {
    const maxLeft = Math.max(0, window.innerWidth - 48);
    const maxTop = Math.max(0, window.innerHeight - 40);
    this.left = Math.min(maxLeft, Math.max(0, this.left));
    this.top = Math.min(maxTop, Math.max(0, this.top));
  }

  private persistPosition() {
    localForage.setItem(CharacterResourceHudComponent.POS_KEY, { left: this.left, top: this.top }).catch(() => {});
  }

  private lazyNgZoneUpdate() {
    if (this.lazyUpdateTimer !== null) return;
    this.lazyUpdateTimer = setTimeout(() => {
      this.lazyUpdateTimer = null;
      this.changeDetector.markForCheck();
    }, 80);
  }
}
