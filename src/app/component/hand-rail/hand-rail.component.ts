import {
  ChangeDetectorRef,
  Component,
  ElementRef,
  HostListener,
  NgZone,
  OnDestroy,
  OnInit,
  ViewChild,
} from '@angular/core';

import { Card } from '@udonarium/card';
import { ObjectStore } from '@udonarium/core/synchronize-object/object-store';
import { EventSystem, Network } from '@udonarium/core/system';
import { PeerCursor } from '@udonarium/peer-cursor';
import { PresetSound, SoundEffect } from '@udonarium/sound-effect';
import {
  HAND_RAIL_DROP_BAND_PX,
  isInHandDropBand,
} from 'component/card-stack/card-stack-gesture';
import { CoordinateService } from 'service/coordinate.service';
import { HandService } from 'service/hand.service';
import { MobileLayoutService } from 'service/mobile-layout.service';
import { PointerDeviceService } from 'service/pointer-device.service';

@Component({
  selector: 'hand-rail',
  templateUrl: './hand-rail.component.html',
  styleUrls: ['./hand-rail.component.css'],
  standalone: false,
})
export class HandRailComponent implements OnInit, OnDestroy {
  @ViewChild('dropZone') dropZoneRef: ElementRef<HTMLElement>;

  readonly dropBandPx = HAND_RAIL_DROP_BAND_PX;

  /** True while a card drag toward the hand is active (shows dashed band). */
  isDropOffer = false;
  /** True while the pointer is over the hand drop zone. */
  isDropHover = false;
  reorderHoverIndex = -1;
  isPanningScroll = false;
  /** Cached — refreshed in syncFromModel(). */
  displayCards: Card[] = [];
  peersWithHands: { userId: string; name: string }[] = [];
  hudVisible = false;
  dropBandVisible = false;
  private handListSignature = '';
  private lazyUpdateTimer: ReturnType<typeof setTimeout> = null;
  private mobileSub: { unsubscribe: () => void } | null = null;
  private scrollWheelEl: HTMLElement | null = null;
  private scrollViewportEl: HTMLElement | null = null;

  @ViewChild('scrollViewport')
  set scrollViewport(ref: ElementRef<HTMLElement> | undefined) {
    this.scrollViewportEl = ref?.nativeElement ?? null;
    this.attachScrollWheelTo(this.scrollViewportEl);
  }

  private dragCard: Card | null = null;
  private dragGhost: HTMLElement | null = null;
  private dragPointerId = -1;

  private panPointerId = -1;
  private panStartX = 0;
  private panStartScrollLeft = 0;

  get isGuest(): boolean { return Network.GuestMode(); }
  get isMobileLayout(): boolean { return this.mobileLayout.isMobile; }
  get railBottomPx(): number {
    if (this.isMobileLayout && this.mobileLayout.isEdit) return 0;
    return this.isMobileLayout ? this.mobileLayout.bottomChromePx : 0;
  }
  get collapsed(): boolean { return this.handService.collapsed; }
  get isGm(): boolean { return !!PeerCursor.myCursor?.isGMMode; }
  get viewUserId(): string { return this.handService.viewUserId; }
  get gmPeekUserId(): string { return this.handService.gmPeekUserId; }
  get isViewingOwnHand(): boolean { return this.viewUserId === Network.peer.userId; }
  get isPeekingOther(): boolean {
    return this.isGm && !!this.gmPeekUserId && this.gmPeekUserId !== Network.peer.userId;
  }
  /** Drag/reorder/drop into own hand — disabled while GM peeks another player. */
  get canEditOwnHand(): boolean { return !this.isGuest && this.isViewingOwnHand; }

  get cards(): Card[] { return this.displayCards; }

  get viewOwnerName(): string {
    return PeerCursor.findByUserId(this.viewUserId)?.name || '';
  }

  get isDraggingCard(): boolean { return !!this.dragCard; }

  /** Fan / chrome HUD — shown whenever the viewed hand has cards (collapse never hides cards). */
  get showHud(): boolean { return this.hudVisible; }

  /** Card fan — always on when there are cards; also when expanded (empty drop zone). */
  get showFan(): boolean {
    return !this.collapsed || this.cards.length > 0;
  }

  /** Dashed drop band while dragging — empty hand only, pinned to viewport bottom. */
  get showDropBand(): boolean { return this.dropBandVisible; }

  private computeHudVisible(cardCount: number): boolean {
    if (this.isGuest) return false;
    if (this.isMobileLayout && this.mobileLayout.isEdit) return false;
    // Hand rail chrome/fan only when there are cards.
    return cardCount > 0;
  }

  private computeDropBandVisible(cardCount: number): boolean {
    if (this.isGuest) return false;
    if (this.isMobileLayout && this.mobileLayout.isEdit) return false;
    if (!this.canEditOwnHand) return false;
    if (!this.isDropOffer) return false;
    // Teaching strip only when the hand is empty — never alongside the hand rail.
    return cardCount < 1;
  }

  /** Sync cached card list / HUD visibility; returns true when display state changed. */
  private syncFromModel(): boolean {
    const cards = this.handService.cardsInHand();
    const signature = cards.map(card =>
      `${card.identifier}:${card.handOrder}:${card.state}:${card.rotate}`,
    ).join('|');
    let changed = false;
    if (signature !== this.handListSignature) {
      this.handListSignature = signature;
      this.displayCards = cards;
      changed = true;
    }
    const nextHud = this.computeHudVisible(cards.length);
    if (nextHud !== this.hudVisible) {
      this.hudVisible = nextHud;
      changed = true;
    }
    const nextDropBand = this.computeDropBandVisible(cards.length);
    if (nextDropBand !== this.dropBandVisible) {
      this.dropBandVisible = nextDropBand;
      changed = true;
    }
    if (this.isGm) {
      const nextPeers = this.handService.peersWithHands();
      const peerSig = nextPeers.map(p => p.userId).join('|');
      const prevPeerSig = this.peersWithHands.map(p => p.userId).join('|');
      if (peerSig !== prevPeerSig) {
        this.peersWithHands = nextPeers;
        changed = true;
      }
    }
    return changed;
  }

  private refreshDropBandVisible(): boolean {
    const next = this.computeDropBandVisible(this.displayCards.length);
    if (next === this.dropBandVisible) return false;
    this.dropBandVisible = next;
    return true;
  }

  private requestViewUpdate(force = false) {
    const changed = this.syncFromModel() || force;
    if (changed) {
      this.ngZone.run(() => this.changeDetector.detectChanges());
    }
  }

  private touchDropPreviewState(nextOffer: boolean, nextHover: boolean): boolean {
    const offerChanged = this.isDropOffer !== nextOffer;
    const hoverChanged = this.isDropHover !== nextHover;
    if (!offerChanged && !hoverChanged) return false;
    this.isDropOffer = nextOffer;
    this.isDropHover = nextHover;
    return this.refreshDropBandVisible() || offerChanged || hoverChanged;
  }

  constructor(
    private changeDetector: ChangeDetectorRef,
    private ngZone: NgZone,
    private handService: HandService,
    private coordinateService: CoordinateService,
    private pointerDeviceService: PointerDeviceService,
    private mobileLayout: MobileLayoutService,
  ) {}

  ngOnInit() {
    this.syncFromModel();
    this.mobileSub = this.mobileLayout.isMobile$.subscribe(() => this.requestViewUpdate(true));
    EventSystem.register(this)
      .on('UPDATE_GAME_OBJECT', event => {
        if (this.isHandRelevantCardEvent(event.data)) this.scheduleViewRefresh();
      })
      .on(`UPDATE_GAME_OBJECT/aliasName/${Card.aliasName}`, event => {
        if (this.isHandRelevantCardEvent(event.data)) this.scheduleViewRefresh();
      })
      .on('DELETE_GAME_OBJECT', event => {
        if (this.isHandRelevantCardDelete(event.data)) this.scheduleViewRefresh();
      })
      .on('CARD_STACK_DECREASED', () => this.scheduleViewRefresh())
      .on('HAND_RAIL_SYNC', () => this.ngZone.run(() => this.requestViewUpdate(true)))
      .on('HAND_RAIL_DROP_PREVIEW', event => {
        const nextOffer = this.canEditOwnHand && !!event.data?.active;
        const nextHover = this.canEditOwnHand && !!event.data?.hover;
        if (this.touchDropPreviewState(nextOffer, nextHover)) {
          this.changeDetector.markForCheck();
        }
      });
    document.addEventListener('pointermove', this.onDocumentPointerMove);
    document.addEventListener('pointerup', this.onDocumentPointerUp);
    document.addEventListener('pointercancel', this.onDocumentPointerUp);
    document.addEventListener('pointermove', this.onScrollPanMove);
    document.addEventListener('pointerup', this.onScrollPanUp);
    document.addEventListener('pointercancel', this.onScrollPanUp);
  }

  ngOnDestroy() {
    this.mobileSub?.unsubscribe();
    this.mobileSub = null;
    if (this.lazyUpdateTimer !== null) {
      clearTimeout(this.lazyUpdateTimer);
      this.lazyUpdateTimer = null;
    }
    EventSystem.unregister(this);
    document.removeEventListener('pointermove', this.onDocumentPointerMove);
    document.removeEventListener('pointerup', this.onDocumentPointerUp);
    document.removeEventListener('pointercancel', this.onDocumentPointerUp);
    document.removeEventListener('pointermove', this.onScrollPanMove);
    document.removeEventListener('pointerup', this.onScrollPanUp);
    document.removeEventListener('pointercancel', this.onScrollPanUp);
    this.detachScrollWheelListener();
    this.removeDragGhost();
  }

  toggleCollapsed() {
    this.handService.setCollapsed(!this.collapsed);
    this.requestViewUpdate(true);
  }

  onGmPeekChange(userId: string) {
    this.handService.setGmPeekUserId(userId);
    this.requestViewUpdate(true);
  }

  fanRotate(index: number, total: number): number {
    if (total <= 1) return 0;
    const spread = Math.min(16, 4 + total);
    const step = spread / (total - 1);
    return -spread / 2 + step * index;
  }

  fanLift(index: number): number {
    return -Math.min(index * 1.5, 12);
  }

  fanDepth(index: number): number {
    return index * 0.4;
  }

  onScrollWheel = (event: WheelEvent) => {
    const el = this.scrollViewportEl;
    if (!el || !this.canScrollHorizontally(el)) return;
    event.preventDefault();
    event.stopPropagation();
    const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
    el.scrollLeft += delta;
  };

  onScrollPanDown(event: PointerEvent) {
    const target = event.target as HTMLElement;
    if (target.closest('.hand-card-slot') || target.closest('.hand-collapse')) return;
    if (event.button !== 0 && event.button !== 1) return;
    const el = this.scrollViewportEl;
    if (!el || !this.canScrollHorizontally(el)) return;
    event.preventDefault();
    event.stopPropagation();
    this.isPanningScroll = true;
    this.panPointerId = event.pointerId;
    this.panStartX = event.clientX;
    this.panStartScrollLeft = el.scrollLeft;
    el.setPointerCapture?.(event.pointerId);
    this.changeDetector.markForCheck();
  }

  onRailDragOver(event: DragEvent) {
    if (!this.canEditOwnHand || !this.isHandCardDrag(event)) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    if (!this.isDropHover) {
      this.isDropHover = true;
      this.changeDetector.markForCheck();
    }
  }

  onRailDragLeave(event: DragEvent) {
    const related = event.relatedTarget as Node | null;
    const zone = this.dropZoneRef?.nativeElement;
    if (zone && related && zone.contains(related)) return;
    if (this.isDropHover) {
      this.isDropHover = false;
      this.changeDetector.markForCheck();
    }
  }

  onRailDrop(event: DragEvent) {
    if (!this.canEditOwnHand) return;
    event.preventDefault();
    event.stopPropagation();
    this.isDropHover = false;
    this.refreshDropBandVisible();
    const id = this.readHandDragId(event);
    if (!id) return;
    const card = ObjectStore.instance.get<Card>(id);
    if (!card) return;
    card.moveToHand(Network.peer.userId);
    SoundEffect.play(PresetSound.cardPut);
    this.requestViewUpdate(true);
  }

  onCardPointerDown(event: PointerEvent, card: Card) {
    if (!this.canEditOwnHand || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    this.startCardDrag(event, card);
  }

  @HostListener('document:keydown.escape')
  onEscape() {
    if (this.dragCard) this.cancelCardDrag();
    if (this.isPanningScroll) this.finishScrollPan();
  }

  /** Hit-test for quick-drag / hand-card drop (viewport bottom band; works when HUD is hidden). */
  static isDropTargetAt(clientX: number, clientY: number): boolean {
    if (Network.GuestMode()) return false;
    const root = document.querySelector('hand-rail .hand-rail-root') as HTMLElement | null;
    let bottomChrome = 0;
    if (root) {
      const bottom = parseFloat(getComputedStyle(root).bottom || '0');
      if (Number.isFinite(bottom)) bottomChrome = bottom;
    }
    const band = document.querySelector('hand-rail .hand-rail-drop-band') as HTMLElement | null;
    if (band) {
      const rect = band.getBoundingClientRect();
      if (clientX >= rect.left && clientX <= rect.right
        && clientY >= rect.top && clientY <= rect.bottom) {
        return true;
      }
    }
    const hud = document.querySelector('hand-rail .hand-rail') as HTMLElement | null;
    if (hud) {
      const rect = hud.getBoundingClientRect();
      if (clientX >= rect.left && clientX <= rect.right
        && clientY >= rect.top && clientY <= rect.bottom) {
        return true;
      }
      if (!hud.classList.contains('is-collapsed') || hud.classList.contains('has-cards')) {
        return false;
      }
    }
    return isInHandDropBand(clientX, clientY, bottomChrome, HAND_RAIL_DROP_BAND_PX);
  }

  static acceptQuickDragCard(card: Card) {
    if (Network.GuestMode() || !card) return;
    card.moveToHand(Network.peer.userId);
    SoundEffect.play(PresetSound.cardPut);
    EventSystem.trigger('HAND_RAIL_SYNC', {});
  }

  private onScrollPanMove = (event: PointerEvent) => {
    if (!this.isPanningScroll || event.pointerId !== this.panPointerId) return;
    const el = this.scrollViewportEl;
    if (!el) return;
    el.scrollLeft = this.panStartScrollLeft - (event.clientX - this.panStartX);
  };

  private onScrollPanUp = (event: PointerEvent) => {
    if (!this.isPanningScroll || event.pointerId !== this.panPointerId) return;
    this.finishScrollPan();
  };

  private finishScrollPan() {
    const el = this.scrollViewportEl;
    if (el && this.panPointerId >= 0) {
      el.releasePointerCapture?.(this.panPointerId);
    }
    this.isPanningScroll = false;
    this.panPointerId = -1;
    this.changeDetector.markForCheck();
  }

  private attachScrollWheelTo(el: HTMLElement | null) {
    if (el === this.scrollWheelEl) return;
    this.detachScrollWheelListener();
    this.scrollWheelEl = el;
    if (el) {
      el.addEventListener('wheel', this.onScrollWheel, { passive: false });
    }
  }

  private detachScrollWheelListener() {
    if (this.scrollWheelEl) {
      this.scrollWheelEl.removeEventListener('wheel', this.onScrollWheel);
      this.scrollWheelEl = null;
    }
  }

  private canScrollHorizontally(el: HTMLElement): boolean {
    return el.scrollWidth > el.clientWidth + 1;
  }

  private onDocumentPointerMove = (event: PointerEvent) => {
    if (!this.dragCard || event.pointerId !== this.dragPointerId) return;
    this.moveDragGhost(event.clientX, event.clientY);
    const nextHover = HandRailComponent.isDropTargetAt(event.clientX, event.clientY);
    const nextReorder = nextHover ? this.handSlotIndexAt(event.clientX, event.clientY) : -1;
    if (this.isDropOffer && this.isDropHover === nextHover && this.reorderHoverIndex === nextReorder) {
      return;
    }
    this.isDropOffer = true;
    this.isDropHover = nextHover;
    this.reorderHoverIndex = nextReorder;
    this.refreshDropBandVisible();
    this.changeDetector.markForCheck();
  };

  private onDocumentPointerUp = (event: PointerEvent) => {
    if (!this.dragCard || event.pointerId !== this.dragPointerId) return;
    const card = this.dragCard;
    const x = event.clientX;
    const y = event.clientY;
    this.finishCardDrag();

    if (HandRailComponent.isDropTargetAt(x, y)) {
      const targetIndex = this.handSlotIndexAt(x, y);
      if (targetIndex >= 0 && targetIndex < this.cards.length) {
        this.handService.reorderCard(card, targetIndex);
        SoundEffect.play(PresetSound.cardPut);
      } else {
        card.moveToHand(Network.peer.userId);
        SoundEffect.play(PresetSound.cardPut);
      }
    } else if (this.isOverTable(x, y)) {
      this.dropCardOnTable(card, x, y);
    } else {
      card.moveToHand(Network.peer.userId);
    }
    this.requestViewUpdate(true);
  };

  private startCardDrag(event: PointerEvent, card: Card) {
    this.dragCard = card;
    this.dragPointerId = event.pointerId;
    this.isDropOffer = true;
    this.refreshDropBandVisible();
    this.createDragGhost(card, event.clientX, event.clientY);
    (event.currentTarget as HTMLElement)?.setPointerCapture?.(event.pointerId);
    this.changeDetector.markForCheck();
  }

  private finishCardDrag() {
    this.dragCard = null;
    this.dragPointerId = -1;
    this.isDropOffer = false;
    this.isDropHover = false;
    this.reorderHoverIndex = -1;
    this.refreshDropBandVisible();
    this.removeDragGhost();
  }

  private cancelCardDrag() {
    this.finishCardDrag();
  }

  private createDragGhost(card: Card, x: number, y: number) {
    this.removeDragGhost();
    const ghost = document.createElement('div');
    ghost.className = 'hand-rail-drag-ghost';
    Object.assign(ghost.style, {
      position: 'fixed',
      top: '0',
      left: '0',
      width: '64px',
      height: '88px',
      zIndex: '100000',
      pointerEvents: 'none',
      filter: 'none',
      boxShadow: 'none',
      overflow: 'hidden',
      borderRadius: '4px',
    } as CSSStyleDeclaration);
    const img = document.createElement('img');
    img.src = card.imageFile?.url || '';
    img.alt = '';
    img.draggable = false;
    Object.assign(img.style, {
      width: '100%',
      height: '100%',
      objectFit: 'contain',
      display: 'block',
    } as CSSStyleDeclaration);
    ghost.appendChild(img);
    document.body.appendChild(ghost);
    this.dragGhost = ghost;
    this.moveDragGhost(x, y);
  }

  private moveDragGhost(x: number, y: number) {
    if (!this.dragGhost) return;
    this.dragGhost.style.transform = `translate(${x - 32}px, ${y - 44}px)`;
  }

  private removeDragGhost() {
    if (this.dragGhost?.parentElement) {
      this.dragGhost.parentElement.removeChild(this.dragGhost);
    }
    this.dragGhost = null;
  }

  private isOverTable(clientX: number, clientY: number): boolean {
    const layer = document.querySelector('#app-table-layer');
    if (!layer) return false;
    const rect = layer.getBoundingClientRect();
    return clientX >= rect.left && clientX <= rect.right
      && clientY >= rect.top && clientY <= rect.bottom;
  }

  private handSlotIndexAt(clientX: number, clientY: number): number {
    const slots = Array.from(
      document.querySelectorAll('.hand-rail-drop-zone .hand-card-slot'),
    ) as HTMLElement[];
    for (let i = slots.length - 1; i >= 0; i--) {
      const rect = slots[i].getBoundingClientRect();
      if (clientX >= rect.left && clientX <= rect.right
        && clientY >= rect.top && clientY <= rect.bottom) {
        return i;
      }
    }
    return -1;
  }

  private dropCardOnTable(card: Card, clientX: number, clientY: number) {
    const pointer = { x: clientX, y: clientY, z: 0 };
    const local = this.coordinateService.calcTabletopLocalCoordinate(
      pointer,
      this.pointerDeviceService.targetElement,
    );
    card.location.x = local.x;
    card.location.y = local.y;
    card.owner = '';
    card.setLocation('table');
    card.raiseInTier();
    SoundEffect.play(PresetSound.cardPut);
  }

  private isHandCardDrag(event: DragEvent): boolean {
    const types = Array.from(event.dataTransfer?.types || []);
    return types.includes(HandService.HAND_DRAG_MIME) || types.includes('text/plain');
  }

  private readHandDragId(event: DragEvent): string {
    const typed = event.dataTransfer?.getData(HandService.HAND_DRAG_MIME);
    if (typed) return typed.trim();
    const plain = event.dataTransfer?.getData('text/plain') || '';
    if (plain.startsWith('udonarium-hand-card:')) {
      return plain.slice('udonarium-hand-card:'.length).trim();
    }
    return '';
  }

  /** Coalesce burst sync events — next task, no 80ms lag. */
  private scheduleViewRefresh() {
    if (this.lazyUpdateTimer !== null) return;
    this.lazyUpdateTimer = setTimeout(() => {
      this.lazyUpdateTimer = null;
      this.requestViewUpdate(false);
    }, 0);
  }

  /** ObjectContext has no top-level location — read live store state. */
  private isHandRelevantCardEvent(data: {
    aliasName?: string;
    identifier?: string;
  } | null | undefined): boolean {
    if (!data || data.aliasName !== Card.aliasName || !data.identifier) return false;
    if (this.handListSignature.includes(data.identifier)) return true;
    const card = ObjectStore.instance.get<Card>(data.identifier);
    if (!card?.isInHand) return false;
    if (card.owner === this.viewUserId) return true;
    return this.isGm;
  }

  private isHandRelevantCardDelete(data: {
    aliasName?: string;
    identifier?: string;
  } | null | undefined): boolean {
    if (!data || data.aliasName !== Card.aliasName || !data.identifier) return false;
    return this.handListSignature.includes(data.identifier);
  }
}
