import { Injectable } from '@angular/core';
import { GuestSession } from '@udonarium/guest-session';
import { PresetSound, SoundEffect } from '@udonarium/sound-effect';
import { TabletopObject } from '@udonarium/tabletop-object';
import { MovableSelectionSynchronizer } from 'directive/movable-selection-synchronizer';

import { SceneToolService } from './scene-tool.service';
import { TabletopSelectionService } from './tabletop-selection.service';

export type PathWaypoint = { x: number; y: number };

/**
 * Ctrl+left-click adds waypoints (draft persists after releasing Ctrl).
 * Plain left-click starts movement along the path (adds click as final stop).
 * Space commits with the current waypoints (no extra point).
 * Right-click removes the last waypoint. Esc cancels the draft.
 */
@Injectable({ providedIn: 'root' })
export class TokenPathMoveService {
  private static readonly PATH_STEP_MS = 640;
  private static readonly PATH_PAUSE_MS = 300;

  waypoints: PathWaypoint[] = [];
  /** Token center when the draft started — used to draw origin→1. */
  origin: PathWaypoint = null;
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
    if (GuestSession.isGuest) return false;
    if (this.sceneTools.isBlockingPick) return false;
    // Keep accepting waypoints after the first even if selection was cleared.
    if (this.targets.length > 0) return true;
    return this.pathableTargets().length > 0;
  }

  addWaypoint(x: number, y: number) {
    if (!this.canDraft()) return false;
    if (!this.targets.length) {
      // Path waypoints are absolute destinations for one unit center.
      // Multi-token would stack everyone on the same points — refuse that.
      const primary = this.pathableTargets()[0];
      if (!primary) return false;
      this.targets = [primary];
      this.origin = MovableSelectionSynchronizer.centerOf(primary);
    }
    this.waypoints = [...this.waypoints, { x, y }];
    SoundEffect.playLocal(PresetSound.selectionStart);
    return true;
  }

  /** Remove the last waypoint; clears draft when none remain. */
  undoLastWaypoint(): boolean {
    if (this.isAnimating) return false;
    if (!this.waypoints.length) return false;
    this.waypoints = this.waypoints.slice(0, -1);
    if (!this.waypoints.length) {
      this.targets = [];
      this.origin = null;
    }
    SoundEffect.playLocal(PresetSound.selectionStart);
    return true;
  }

  /** Cancel unfinished draft. */
  cancelDraft() {
    if (this.isAnimating) return;
    if (!this.waypoints.length && !this.targets.length) return;
    this.waypoints = [];
    this.targets = [];
    this.origin = null;
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
    this.origin = null;
    this.isAnimating = true;
    const token = ++this.animToken;
    try {
      const ok = await MovableSelectionSynchronizer.animatePath(
        movers,
        path,
        TokenPathMoveService.PATH_STEP_MS,
        TokenPathMoveService.PATH_PAUSE_MS,
      );
      if (token === this.animToken && ok) {
        SoundEffect.play(PresetSound.piecePut);
      }
      return ok;
    } finally {
      if (token === this.animToken) this.isAnimating = false;
    }
  }
}
