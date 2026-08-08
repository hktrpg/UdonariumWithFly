import { Injectable, OnDestroy } from '@angular/core';

import { ObjectStore } from '@udonarium/core/synchronize-object/object-store';
import { EventSystem, Network } from '@udonarium/core/system';
import { GameCharacter } from '@udonarium/game-character';
import { GameTableMask } from '@udonarium/game-table-mask';
import {
  applyMaskTokenFxToCharacter,
  MaskTokenFxSnapshot,
  restoreMaskTokenFxSnapshot,
} from '@udonarium/table-fx/mask-token-fx-apply';
import { pickTopPassiveMask } from '@udonarium/table-fx/mask-token-overlap';

import { TabletopService } from './tabletop.service';

interface ActiveZone {
  maskId: string;
  snap: MaskTokenFxSnapshot;
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
      .on('UPDATE_OBJECT_CHILDREN', () => this.scheduleRefresh());
    this.scheduleRefresh();
  }

  ngOnDestroy() {
    EventSystem.unregister(this);
    if (this.timer) clearTimeout(this.timer);
    this.started = false;
  }

  private scheduleRefresh() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      this.refresh();
    }, 80);
  }

  private refresh() {
    if (Network.GuestMode()) return;
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

      if (prev && prev.maskId === top.identifier) continue;

      if (prev) {
        restoreMaskTokenFxSnapshot(ch, prev.snap);
        this.active.delete(chId);
      }
      const snap = applyMaskTokenFxToCharacter(ch, top.tokenFxConfig);
      this.active.set(chId, { maskId: top.identifier, snap });
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
