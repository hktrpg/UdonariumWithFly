import { ChangeDetectorRef, Component, OnDestroy, OnInit } from '@angular/core';

import { ObjectStore } from '@udonarium/core/synchronize-object/object-store';
import { EventSystem, Network } from '@udonarium/core/system';
import { GameCharacter } from '@udonarium/game-character';
import { GuestSession } from '@udonarium/guest-session';
import { PeerCursor } from '@udonarium/peer-cursor';
import { CombatTracker } from '@udonarium/table-fx/combat-tracker';
import { MobileLayoutService } from 'service/mobile-layout.service';
import {
  isCombatSurfaceDocked,
  loadCombatSurfaceDocked,
  onCombatSurfaceDockedChange,
  toggleCombatSurfaceDocked,
} from 'service/combat-surface-prefs';

import * as localForage from 'localforage';

@Component({
  selector: 'combat-command-rail',
  templateUrl: './combat-command-rail.component.html',
  styleUrls: ['./combat-command-rail.component.css'],
  standalone: false
})
export class CombatCommandRailComponent implements OnInit, OnDestroy {
  static readonly POS_KEY = 'udonanaumu-combat-rail-pos';

  docked = true;
  left = 12;
  top = 120;
  private dragOffsetX = 0;
  private dragOffsetY = 0;
  private dragging = false;
  private unsubDock: (() => void) | null = null;
  private mobileSub: { unsubscribe: () => void } | null = null;

  get tracker(): CombatTracker { return CombatTracker.instance; }
  get encounter() { return this.tracker.activeEncounter; }
  get isGuest(): boolean { return GuestSession.isGuest; }
  get isGm(): boolean { return !!PeerCursor.myCursor?.isGMMode; }
  get isMobile(): boolean { return this.mobileLayout.isMobile; }
  get inCombat(): boolean { return !!this.encounter?.isStarted; }
  get visible(): boolean { return true; }

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
    localForage.getItem<{ left: number; top: number }>(CombatCommandRailComponent.POS_KEY).then(pos => {
      if (pos && typeof pos.left === 'number' && typeof pos.top === 'number') {
        this.left = pos.left;
        this.top = pos.top;
        this.clampToViewport();
        this.changeDetector.markForCheck();
      }
    });
    EventSystem.register(this)
      .on('UPDATE_GAME_OBJECT', () => this.changeDetector.markForCheck())
      .on('DELETE_GAME_OBJECT', () => this.changeDetector.markForCheck());
    document.addEventListener('pointermove', this.onPointerMove);
    document.addEventListener('pointerup', this.onPointerUp);
    window.addEventListener('resize', this.onResize);
  }

  ngOnDestroy() {
    this.mobileSub?.unsubscribe();
    this.unsubDock?.();
    EventSystem.unregister(this);
    document.removeEventListener('pointermove', this.onPointerMove);
    document.removeEventListener('pointerup', this.onPointerUp);
    window.removeEventListener('resize', this.onResize);
  }

  toggleDocked() {
    toggleCombatSurfaceDocked();
  }

  begin() {
    if (this.isGuest) return;
    this.tracker.beginCombat();
  }

  end() {
    if (this.isGuest) return;
    this.tracker.endCombat();
  }

  nextTurn() {
    if (this.isGuest) return;
    this.tracker.nextTurn();
  }

  nextRound() {
    if (this.isGuest) return;
    this.tracker.nextRound();
  }

  isMyCombatTurn(): boolean {
    if (!this.encounter?.isStarted) return false;
    const cur = this.tracker.currentCombatant();
    if (!cur) return false;
    const ch = ObjectStore.instance.get<GameCharacter>(cur.characterIdentifier) || null;
    const userId = Network.peer?.userId;
    return !!ch && !!userId && ch.isControlledBy(userId);
  }

  endMyTurn() {
    if (!this.isMyCombatTurn()) return;
    this.tracker.nextTurn();
  }

  startDrag(event: PointerEvent) {
    if (this.docked) return;
    if ((event.target as HTMLElement).closest('button')) return;
    event.preventDefault();
    event.stopPropagation();
    this.dragging = true;
    this.dragOffsetX = event.clientX - this.left;
    this.dragOffsetY = event.clientY - this.top;
    (event.currentTarget as HTMLElement)?.setPointerCapture?.(event.pointerId);
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
    localForage.setItem(CombatCommandRailComponent.POS_KEY, { left: this.left, top: this.top }).catch(() => {});
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
}
