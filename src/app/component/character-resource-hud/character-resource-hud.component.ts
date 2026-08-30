import { ChangeDetectorRef, Component, OnDestroy, OnInit } from '@angular/core';

import { ObjectStore } from '@udonarium/core/synchronize-object/object-store';
import { EventSystem, Network } from '@udonarium/core/system';
import { CharacterToken } from '@udonarium/character-token';
import { DataElement } from '@udonarium/data-element';
import { GameCharacter } from '@udonarium/game-character';
import { GuestSession } from '@udonarium/guest-session';
import { PeerCursor } from '@udonarium/peer-cursor';
import { CombatTracker, CombatantData } from '@udonarium/table-fx/combat-tracker';
import { MobileLayoutService } from 'service/mobile-layout.service';
import {
  isCombatSurfaceDocked,
  loadCombatSurfaceDocked,
  onCombatSurfaceDockedChange,
  toggleCombatSurfaceDocked,
} from 'service/combat-surface-prefs';

import * as localForage from 'localforage';

export type PartyTier = 'turn' | 'mine' | 'other';

export interface PartyRow {
  character: GameCharacter;
  tier: PartyTier;
  combatant?: CombatantData;
}

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
  docked = true;
  expandedCharId: string | null = null;
  private dragOffsetX = 0;
  private dragOffsetY = 0;
  private dragging = false;
  private lazyUpdateTimer: ReturnType<typeof setTimeout> = null;
  private mobileSub: { unsubscribe: () => void } | null = null;
  private unsubDock: (() => void) | null = null;
  private charactersSignature = '';

  /** Shown when toggled on (desktop + compact mobile dock). */
  get visible(): boolean {
    return CharacterResourceHudComponent.isVisible;
  }
  get showAllForGm(): boolean { return CharacterResourceHudComponent.showAllForGm; }
  get isGm(): boolean { return !!PeerCursor.myCursor?.isGMMode; }
  get isGuest(): boolean { return GuestSession.isGuest; }
  get canEdit(): boolean { return !this.isGuest; }
  get isMobile(): boolean { return this.mobileLayout.isMobile; }

  get claimed(): GameCharacter | null {
    return GameCharacter.preferredChatCharacter();
  }

  get inCombat(): boolean {
    return !!CombatTracker.instance.activeEncounter?.isStarted;
  }

  get partyRows(): PartyRow[] {
    const claimed = this.claimed;
    const encounter = CombatTracker.instance.activeEncounter;
    if (encounter?.isStarted) {
      const turn = CombatTracker.instance.currentCombatant();
      const rows: PartyRow[] = [];
      for (const c of encounter.combatants) {
        if (!this.isGm && c.isHidden) continue;
        const ch = ObjectStore.instance.get<GameCharacter>(c.characterIdentifier);
        if (!ch) continue;
        let tier: PartyTier = 'other';
        if (turn && c.id === turn.id) tier = 'turn';
        else if (claimed && ch.identifier === claimed.identifier) tier = 'mine';
        rows.push({ character: ch, tier, combatant: c });
      }
      rows.sort((a, b) => this.tierRank(a.tier) - this.tierRank(b.tier));
      return rows;
    }
    return this.idleCharacters().map(ch => ({
      character: ch,
      tier: (claimed && ch.identifier === claimed.identifier ? 'mine' : 'other') as PartyTier,
    }));
  }

  get characters(): GameCharacter[] {
    return this.partyRows.map(r => r.character);
  }

  constructor(
    private changeDetector: ChangeDetectorRef,
    private mobileLayout: MobileLayoutService,
  ) {}

  ngOnInit() {
    this.mobileSub = this.mobileLayout.isMobile$.subscribe(() => this.changeDetector.markForCheck());
    this.unsubDock = onCombatSurfaceDockedChange(() => {
      this.docked = isCombatSurfaceDocked();
      this.changeDetector.markForCheck();
    });
    loadCombatSurfaceDocked().then(v => {
      this.docked = v;
      this.changeDetector.markForCheck();
    });
    localForage.getItem(CharacterResourceHudComponent.VISIBLE_KEY).then(v => {
      if (typeof v === 'boolean') {
        CharacterResourceHudComponent.isVisible = v;
      } else if (this.isMobile) {
        // Plan: mobile defaults to compact Party Status visible
        CharacterResourceHudComponent.isVisible = true;
      }
      this.changeDetector.markForCheck();
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
    this.mobileSub?.unsubscribe();
    this.mobileSub = null;
    this.unsubDock?.();
    this.unsubDock = null;
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

  toggleDocked() {
    toggleCombatSurfaceDocked();
  }

  toggleExpand(ch: GameCharacter) {
    this.expandedCharId = this.expandedCharId === ch.identifier ? null : ch.identifier;
  }

  isExpanded(ch: GameCharacter): boolean {
    return this.expandedCharId === ch.identifier;
  }

  resourcesOf(ch: GameCharacter): DataElement[] {
    if (!ch?.detailDataElement) return [];
    return ch.detailDataElement.getElementsByType('numberResource');
  }

  hpOf(ch: GameCharacter): DataElement | null {
    return this.findResource(ch, 'HP') || this.findResource(ch, 'hp');
  }

  mpOf(ch: GameCharacter): DataElement | null {
    return this.findResource(ch, 'MP') || this.findResource(ch, 'mp');
  }

  otherResourcesOf(ch: GameCharacter): DataElement[] {
    return this.resourcesOf(ch).filter(el => {
      const n = (el.name || '').toLowerCase();
      return n !== 'hp' && n !== 'mp';
    });
  }

  barPct(el: DataElement | null): number {
    if (!el) return 0;
    const max = this.max(el);
    if (max <= 0) return 0;
    return Math.max(0, Math.min(100, (this.current(el) / max) * 100));
  }

  canEditCharacter(ch: GameCharacter): boolean {
    if (!this.canEdit) return false;
    if (this.isGm) return true;
    const userId = Network.peer?.userId;
    return !!userId && ch.isControlledBy(userId);
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
    if (this.docked) return;
    if ((event.target as HTMLElement).closest('button, label, input')) return;
    event.preventDefault();
    event.stopPropagation();
    this.dragging = true;
    this.dragOffsetX = event.clientX - this.left;
    this.dragOffsetY = event.clientY - this.top;
    (event.currentTarget as HTMLElement)?.setPointerCapture?.(event.pointerId);
  }

  private idleCharacters(): GameCharacter[] {
    if (this.isGm && this.showAllForGm) {
      const seen = new Set<string>();
      const out: GameCharacter[] = [];
      for (const tok of ObjectStore.instance.getObjects(CharacterToken)) {
        if (!tok.isVisibleOnTable || tok.isTemporaryCopy) continue;
        const body = tok.character;
        if (!body || body.isTemporaryCopy || seen.has(body.identifier)) continue;
        seen.add(body.identifier);
        out.push(body);
      }
      return out;
    }
    const mine = this.claimed;
    return mine ? [mine] : [];
  }

  private findResource(ch: GameCharacter, name: string): DataElement | null {
    return ch?.detailDataElement?.getFirstElementByName(name) || null;
  }

  private tierRank(tier: PartyTier): number {
    if (tier === 'turn') return 0;
    if (tier === 'mine') return 1;
    return 2;
  }

  private onPointerMove = (event: PointerEvent) => {
    if (!this.dragging || this.docked) return;
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
      if (!this.visible) return;
      const signature = this.partyRows.map(r => `${r.character.identifier}:${r.tier}`).join('\0');
      this.charactersSignature = signature;
      this.changeDetector.markForCheck();
    }, 80);
  }
}
