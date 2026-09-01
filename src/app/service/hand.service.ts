import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

import { Card } from '@udonarium/card';
import { ObjectStore } from '@udonarium/core/synchronize-object/object-store';
import { Network } from '@udonarium/core/system';
import { GmCardPeek } from '@udonarium/gm-card-peek';
import { PeerCursor } from '@udonarium/peer-cursor';

import * as localForage from 'localforage';

export type HandDropPreview = { active: boolean; hover: boolean };

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
        seen.set(card.owner, PeerCursor.findByUserId(card.owner)?.name || card.owner);
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
      const userId = cursor?.userId || '';
      if (!userId || userId === selfId || seen.has(userId)) continue;
      seen.add(userId);
      out.push({ userId, name: cursor?.name || userId });
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }
}
