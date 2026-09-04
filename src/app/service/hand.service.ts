import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

import { Card } from '@udonarium/card';
import { ObjectStore } from '@udonarium/core/synchronize-object/object-store';
import { Network } from '@udonarium/core/system';
import { GmCardPeek } from '@udonarium/gm-card-peek';
import { PeerCursor } from '@udonarium/peer-cursor';

import * as localForage from 'localforage';

export type HandDropPreview = { active: boolean; hover: boolean };

export type HandPileInfo = {
  userId: string;
  name: string;
  count: number;
};

@Injectable({
  providedIn: 'root',
})
export class HandService {
  static readonly COLLAPSED_KEY = 'udonarium.hand-rail.collapsed';
  static readonly GM_PEEK_KEY = 'udonarium.hand-rail.gm-peek';
  static readonly PLAY_FACE_UP_KEY = 'udonarium.hand-rail.play-face-up';
  static readonly HAND_DRAG_MIME = 'application/x-udonarium-hand-card';

  collapsed = false;
  gmPeekUserId = '';
  /** When true, cards dragged from hand land face-up; otherwise face-down. Default face-up. */
  playFaceUp = true;

  private readonly dropPreviewSubject = new BehaviorSubject<HandDropPreview>({ active: false, hover: false });
  readonly dropPreview$ = this.dropPreviewSubject.asObservable();

  get dropPreview(): HandDropPreview {
    return this.dropPreviewSubject.value;
  }

  constructor() {
    localForage.getItem<boolean>(HandService.COLLAPSED_KEY).then(v => {
      if (typeof v === 'boolean') this.collapsed = v;
    });
    localForage.getItem<string>(HandService.GM_PEEK_KEY).then(v => {
      if (typeof v !== 'string' || !v) return;
      const selfId = Network.peer?.userId || '';
      this.gmPeekUserId = (selfId && v === selfId) ? '' : v;
    });
    localForage.getItem<boolean>(HandService.PLAY_FACE_UP_KEY).then(v => {
      if (typeof v === 'boolean') this.playFaceUp = v;
    }).catch(() => {});
  }

  /** Card / stack drag → hand rail drop band (Angular DI; reliable vs EventSystem). */
  setDropPreview(active: boolean, hover = false) {
    const cur = this.dropPreviewSubject.value;
    if (cur.active === active && cur.hover === hover) return;
    this.dropPreviewSubject.next({ active: !!active, hover: !!hover && !!active });
  }

  setCollapsed(collapsed: boolean) {
    this.collapsed = collapsed;
    localForage.setItem(HandService.COLLAPSED_KEY, collapsed).catch(() => {});
  }

  setGmPeekUserId(userId: string) {
    const selfId = Network.peer?.userId || '';
    // Treat selecting self the same as "My hand".
    this.gmPeekUserId = (userId && userId !== selfId) ? userId : '';
    localForage.setItem(HandService.GM_PEEK_KEY, this.gmPeekUserId).catch(() => {});
  }

  setPlayFaceUp(faceUp: boolean) {
    this.playFaceUp = !!faceUp;
    localForage.setItem(HandService.PLAY_FACE_UP_KEY, this.playFaceUp).catch(() => {});
  }

  /** Apply hand-rail play face preference when a card leaves the hand onto the table. */
  applyPlayFace(card: Card) {
    if (!card) return;
    if (this.playFaceUp) card.faceUp();
    else card.faceDown();
  }

  /** Whose hand the rail should display (GM peek or self). */
  get viewUserId(): string {
    if (GmCardPeek.active && this.gmPeekUserId) {
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
    const selfId = Network.peer?.userId || '';
    const seen = new Map<string, string>();
    for (const card of ObjectStore.instance.getObjects(Card)) {
      if (!card.isInHand || !card.owner) continue;
      // Own hand is the dedicated "My hand" option — do not list self again by name.
      if (selfId && card.owner === selfId) continue;
      if (!seen.has(card.owner)) {
        seen.set(card.owner, card.ownerName || card.owner);
      }
    }
    return Array.from(seen.entries())
      .map(([userId, name]) => ({ userId, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  /** Online peers (excluding self) — for “give card” menus. */
  onlinePeers(): { userId: string; name: string }[] {
    const selfId = Network.peer?.userId || '';
    const out: { userId: string; name: string }[] = [];
    const seen = new Set<string>();
    for (const peer of Network.peers) {
      if (!peer?.isOpen) continue;
      const cursor = PeerCursor.findByPeerId(peer.peerId);
      const userId = cursor?.userId || peer.userId || '';
      if (!userId || userId === selfId || seen.has(userId)) continue;
      seen.add(userId);
      out.push({ userId, name: cursor?.name || userId });
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }

  /** True when an open mesh peer is bound to this hand owner. */
  isOwnerOnline(userId: string): boolean {
    if (!userId) return false;
    const cursor = PeerCursor.findByUserId(userId);
    return Network.peers.some(p => {
      if (!p?.isOpen) return false;
      if (p.userId === userId) return true;
      return !!(cursor?.peerId && p.peerId === cursor.peerId);
    });
  }

  /** Hand piles whose owner is not currently online (excludes self). */
  offlineHandPiles(): HandPileInfo[] {
    this.backfillHandOwnerLabels();
    const selfId = Network.peer?.userId || '';
    const counts = new Map<string, { name: string; count: number }>();
    for (const card of ObjectStore.instance.getObjects(Card)) {
      if (!card.isInHand || !card.owner) continue;
      if (selfId && card.owner === selfId) continue;
      if (this.isOwnerOnline(card.owner)) continue;
      const prev = counts.get(card.owner);
      if (prev) {
        prev.count += 1;
      } else {
        counts.set(card.owner, { name: card.ownerName || card.owner, count: 1 });
      }
    }
    return Array.from(counts.entries())
      .map(([userId, info]) => ({ userId, name: info.name, count: info.count }))
      .sort((a, b) => a.name.localeCompare(b.name) || a.userId.localeCompare(b.userId));
  }

  /**
   * Move all hand cards from an offline owner into the local player's hand.
   * Returns merged card count, or 0 if refused (online / self / empty).
   */
  mergeHandIntoSelf(fromUserId: string): number {
    const selfId = Network.peer?.userId || '';
    if (!fromUserId || !selfId || fromUserId === selfId) return 0;
    if (this.isOwnerOnline(fromUserId)) return 0;
    const cards = this.cardsInHand(fromUserId);
    if (cards.length < 1) return 0;
    for (const card of cards) {
      card.moveToHand(selfId);
    }
    return cards.length;
  }

  static normalizeNickname(name: string): string {
    return (name || '').trim().toLocaleLowerCase();
  }

  /**
   * Auto-claim offline piles whose stamped/live nickname matches mine.
   * Owner userIds always differ across reconnects — match by nickname only.
   * Offline = no open peer (cursor may still exist during disconnect grace).
   */
  autoClaimMatchingNickname(): HandPileInfo[] {
    this.backfillHandOwnerLabels();
    const myName = HandService.normalizeNickname(PeerCursor.myCursor?.name || '');
    if (!myName) return [];
    const claimed: HandPileInfo[] = [];
    for (const pile of this.offlineHandPiles()) {
      const pileName = HandService.normalizeNickname(pile.name);
      if (!pileName || pileName !== myName) continue;
      // Never claim a pile whose display name is just a raw userId (no nickname known).
      if (pileName === pile.userId) continue;
      const n = this.mergeHandIntoSelf(pile.userId);
      if (n > 0) claimed.push({ ...pile, count: n });
    }
    return claimed;
  }

  /** Stamp ownerLabel from a live cursor so nicknames survive cursor purge. */
  backfillHandOwnerLabels(): void {
    for (const card of ObjectStore.instance.getObjects(Card)) {
      if (!card.isInHand || !card.owner || card.ownerLabel) continue;
      const name = PeerCursor.findByUserId(card.owner)?.name;
      if (name) card.ownerLabel = name;
    }
  }

  shortUserId(userId: string, len = 6): string {
    if (!userId) return '';
    return userId.length <= len ? userId : userId.slice(0, len);
  }
}
