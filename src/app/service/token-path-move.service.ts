import { Injectable } from '@angular/core';
import { GuestSession } from '@udonarium/guest-session';
import { PresetSound, SoundEffect } from '@udonarium/sound-effect';
import { TabletopObject } from '@udonarium/tabletop-object';
import { MovableSelectionSynchronizer } from 'directive/movable-selection-synchronizer';

import { SceneToolService } from './scene-tool.service';
import { TabletopSelectionService } from './tabletop-selection.service';

export type PathWaypoint = { x: number; y: number };

/**
 * Shift+left-click waypoints while a token is selected, then Shift+right-click
 * to animate along the path. Releasing Shift cancels an unfinished draft.
 */
@Injectable({ providedIn: 'root' })
export class TokenPathMoveService {
  waypoints: PathWaypoint[] = [];
  isAnimating = false;

  private targets: TabletopObject[] = [];
  private animToken = 0;

  constructor(
    private selection: TabletopSelectionService,
    private sceneTools: SceneToolService,
  ) { }

  get hasDraft(): boolean {
    return this.waypoints.length > 0;
  }

  get isActive(): boolean {
    return this.hasDraft || this.isAnimating;
  }

  /** Selected unlocked table tokens that can follow a path. */
  pathableTargets(): TabletopObject[] {
    if (GuestSession.isGuest) return [];
    if (this.sceneTools.isBlockingPick) return [];
    return this.selection.objects.filter(object => {
      if (object.location?.name !== 'table') return false;
      return !MovableSelectionSynchronizer.isObjectLocked(object);
    });
  }

  canDraft(): boolean {
    if (this.isAnimating) return false;
    return this.pathableTargets().length > 0;
  }

  addWaypoint(x: number, y: number) {
    if (!this.canDraft()) return false;
    if (!this.targets.length) {
      this.targets = this.pathableTargets();
      if (!this.targets.length) return false;
    }
    this.waypoints = [...this.waypoints, { x, y }];
    SoundEffect.playLocal(PresetSound.selectionStart);
    return true;
  }

  /** Cancel unfinished draft (e.g. Shift released). */
  cancelDraft() {
    if (this.isAnimating) return;
    if (!this.waypoints.length && !this.targets.length) return;
    this.waypoints = [];
    this.targets = [];
  }

  async commit(): Promise<boolean> {
    if (this.isAnimating) return false;
    if (!this.waypoints.length || !this.targets.length) {
      this.cancelDraft();
      return false;
    }
    const path = this.waypoints.slice();
    const movers = this.targets.slice();
    this.waypoints = [];
    this.targets = [];
    this.isAnimating = true;
    const token = ++this.animToken;
    try {
      const ok = await MovableSelectionSynchronizer.animatePath(movers, path, 320);
      if (token === this.animToken && ok) {
        SoundEffect.play(PresetSound.piecePut);
      }
      return ok;
    } finally {
      if (token === this.animToken) this.isAnimating = false;
    }
  }
}
