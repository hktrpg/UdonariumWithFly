import { Injectable, OnDestroy } from '@angular/core';

import { ObjectStore } from '@udonarium/core/synchronize-object/object-store';
import { EventSystem, Network } from '@udonarium/core/system';
import { GameCharacter } from '@udonarium/game-character';
import { GameTableMask } from '@udonarium/game-table-mask';
import {
  applyMaskTokenFxToCharacter,
  MaskTokenFxSnapshot,
  restoreMaskTokenFxSnapshot,
  snapshotCharacterTokenFx,
} from '@udonarium/table-fx/mask-token-fx-apply';
import { tokenFxConfigHasWork } from '@udonarium/table-fx/mask-appearance';
import { pickTopPassiveMask } from '@udonarium/table-fx/mask-token-overlap';

import { TabletopService } from './tabletop.service';

interface ActiveZone {
  maskId: string;
  snap: MaskTokenFxSnapshot;
  /** Mask tokenFxJson at time of apply; used to detect config edits. */
  configKey: string;
}

/**
 * Passive mask zones: when a token stands on a mask with tokenFxPassive,
 * apply image FX + altitude and restore on leave. Highest posZ mask wins.
 */
@Injectable()
export class MaskTokenFxService implements OnDestroy {
  private started = false;
  private timer: ReturnType<typeof setTimeout> = null;
  private readonly active = new Map<string, ActiveZone>();

  constructor(private tabletopService: TabletopService) {}

  start() {
    if (this.started) return;
    this.started = true;
    EventSystem.register(this)
      .on('UPDATE_GAME_OBJECT', () => this.scheduleRefresh())
      .on('DELETE_GAME_OBJECT', () => this.scheduleRefresh())
      .on('UPDATE_OBJECT_CHILDREN', () => this.scheduleRefresh())
      .on<{ characterIds?: string[] }>('MASK_TOKEN_FX_ADOPT', event => {
        this.adoptCurrentAsRestorePoint(event.data?.characterIds || []);
      });
    this.scheduleRefresh();
  }

  ngOnDestroy() {
    EventSystem.unregister(this);
    if (this.timer) clearTimeout(this.timer);
    this.started = false;
  }

  /**
   * After Alt+double-click (or other external) FX changes, update the leave-restore
   * snapshot so walking off the mask does not undo those changes.
   */
  adoptCurrentAsRestorePoint(characterIds: string[]) {
    if (!characterIds?.length) return;
    for (const id of characterIds) {
      const zone = this.active.get(id);
      if (!zone) continue;
      const ch = ObjectStore.instance.get<GameCharacter>(id);
      if (!ch) continue;
      const altitudeTouched = zone.snap.altitudeTouched;
      zone.snap = snapshotCharacterTokenFx(ch);
      zone.snap.altitudeTouched = altitudeTouched;
    }
  }

  private scheduleRefresh() {
    if (this.active.size === 0 && !this.hasPassiveMask()) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      this.refresh();
    }, 80);
  }

  private hasPassiveMask(): boolean {
    const masks = this.tabletopService.tableMasks || [];
    for (const m of masks) {
      if (m?.tokenFxPassive) return true;
    }
    return false;
  }

  private refresh() {
    if (Network.GuestMode()) return;
    if (this.active.size === 0 && !this.hasPassiveMask()) return;
    const characters = this.tabletopService.characters || [];
    const masks = (this.tabletopService.tableMasks || []).filter(m => m?.tokenFxPassive);
    const seen = new Set<string>();

    for (const ch of characters) {
      if (!ch || ch.location.name !== 'table') continue;
      const top = pickTopPassiveMask(masks, ch);
      const chId = ch.identifier;
      seen.add(chId);
      const prev = this.active.get(chId);

      if (!top) {
        if (prev) {
          restoreMaskTokenFxSnapshot(ch, prev.snap);
          this.active.delete(chId);
        }
        continue;
      }

      const cfg = top.tokenFxConfig;
      const hasWork = tokenFxConfigHasWork(cfg);
      const configKey = top.tokenFxJson || '';

      if (prev && prev.maskId === top.identifier) {
        if (prev.configKey === configKey) continue;
        // Same mask, config edited while standing — re-apply from original snap.
        restoreMaskTokenFxSnapshot(ch, prev.snap);
        this.active.delete(chId);
        if (!hasWork) continue;
        const snap = applyMaskTokenFxToCharacter(ch, cfg);
        this.active.set(chId, { maskId: top.identifier, snap, configKey });
        continue;
      }

      if (prev) {
        restoreMaskTokenFxSnapshot(ch, prev.snap);
        this.active.delete(chId);
      }
      if (!hasWork) continue;
      const snap = applyMaskTokenFxToCharacter(ch, cfg);
      this.active.set(chId, { maskId: top.identifier, snap, configKey });
    }

    for (const chId of Array.from(this.active.keys())) {
      if (seen.has(chId)) continue;
      const prev = this.active.get(chId);
      const ch = ObjectStore.instance.get<GameCharacter>(chId);
      if (ch && prev) restoreMaskTokenFxSnapshot(ch, prev.snap);
      this.active.delete(chId);
    }
  }
}
