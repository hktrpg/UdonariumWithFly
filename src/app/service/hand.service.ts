import { Injectable } from '@angular/core';

import { Card } from '@udonarium/card';
import { ObjectStore } from '@udonarium/core/synchronize-object/object-store';
import { Network } from '@udonarium/core/system';
import { PeerCursor } from '@udonarium/peer-cursor';

import * as localForage from 'localforage';

@Injectable({
  providedIn: 'root',
})
export class HandService {
  static readonly COLLAPSED_KEY = 'udonarium.hand-rail.collapsed';
  static readonly GM_PEEK_KEY = 'udonarium.hand-rail.gm-peek';
  static readonly HAND_DRAG_MIME = 'application/x-udonarium-hand-card';

  collapsed = false;
  gmPeekUserId = '';

  constructor() {
    localForage.getItem<boolean>(HandService.COLLAPSED_KEY).then(v => {
      if (typeof v === 'boolean') this.collapsed = v;
    });
    localForage.getItem<string>(HandService.GM_PEEK_KEY).then(v => {
      if (typeof v === 'string') this.gmPeekUserId = v;
    });
  }

  setCollapsed(collapsed: boolean) {
    this.collapsed = collapsed;
    localForage.setItem(HandService.COLLAPSED_KEY, collapsed).catch(() => {});
  }

  setGmPeekUserId(userId: string) {
    this.gmPeekUserId = userId;
    localForage.setItem(HandService.GM_PEEK_KEY, userId).catch(() => {});
  }

  /** Whose hand the rail should display (GM peek or self). */
  get viewUserId(): string {
    if (PeerCursor.myCursor?.isGMMode && this.gmPeekUserId) {
      return this.gmPeekUserId;
    }
    return Network.peer.userId;
  }

  cardsInHand(userId?: string): Card[] {
    const uid = userId ?? this.viewUserId;
    return ObjectStore.instance.getObjects(Card)
      .filter(card => card.isInHand && card.owner === uid)
      .sort((a, b) => a.handOrder - b.handOrder || a.identifier.localeCompare(b.identifier));
  }

  nextHandOrder(userId: string): number {
    const cards = this.cardsInHand(userId);
    if (cards.length < 1) return 0;
    return Math.max(...cards.map(c => c.handOrder)) + 1;
  }

  reorderCard(card: Card, targetIndex: number, userId?: string): void {
    const uid = userId ?? card.owner;
    if (!uid || card.owner !== uid) return;
    const cards = this.cardsInHand(uid);
    const fromIndex = cards.findIndex(c => c.identifier === card.identifier);
    if (fromIndex < 0 || targetIndex < 0 || targetIndex >= cards.length) return;
    if (fromIndex === targetIndex) return;
    const next = [...cards];
    const [moved] = next.splice(fromIndex, 1);
    next.splice(targetIndex, 0, moved);
    next.forEach((c, i) => { c.handOrder = i; });
  }

  peersWithHands(): { userId: string; name: string }[] {
    const seen = new Map<string, string>();
    for (const card of ObjectStore.instance.getObjects(Card)) {
      if (!card.isInHand || !card.owner) continue;
      if (!seen.has(card.owner)) {
        seen.set(card.owner, PeerCursor.findByUserId(card.owner)?.name || card.owner);
      }
    }
    return Array.from(seen.entries())
      .map(([userId, name]) => ({ userId, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }
}
