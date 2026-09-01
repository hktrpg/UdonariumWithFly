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
import { Subscription } from 'rxjs';

import { Card } from '@udonarium/card';
import { CardStack } from '@udonarium/card-stack';
import { ObjectStore } from '@udonarium/core/synchronize-object/object-store';
import { EventSystem, Network } from '@udonarium/core/system';
import { PeerCursor } from '@udonarium/peer-cursor';
import { GmCardPeek } from '@udonarium/gm-card-peek';
import { PresetSound, SoundEffect } from '@udonarium/sound-effect';
import {
  findCardIdAtPoint,
  findCardStackIdAtPoint,
  findMergeTargetIdAtPoint,
  HAND_RAIL_DROP_BAND_PX,
  isInHandDropBand,
  resolveQuickDragDrop,
  setCardMergePreview,
} from 'component/card-stack/card-stack-gesture';
import {
  CardHoverCaptionController,
  cardCaptionName,
  cardCaptionRubiedText,
  wireCardHoverCaptionDismiss,
} from 'service/card-hover-caption';
import { ChatMessageService } from 'service/chat-message.service';
import { ContextMenuAction, ContextMenuSeparator, ContextMenuService } from 'service/context-menu.service';
import { CoordinateService } from 'service/coordinate.service';
import { HandService } from 'service/hand.service';
import { I18nService } from 'service/i18n.service';
import { MobileLayoutService } from 'service/mobile-layout.service';
import { buildCardPreviewPayload } from 'service/object-preview-payload';
import { ObjectPreviewService } from 'service/object-preview.service';
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

  hoveredCardId: string | null = null;
  captionCardId: string | null = null;
  private readonly caption = new CardHoverCaptionController(() => this.changeDetector.markForCheck());
  private previewOpenedSub: Subscription | null = null;

  get captionVisible(): boolean { return this.caption.isVisible; }
  get captionShowName(): boolean { return this.caption.showName; }
  get captionShowText(): boolean { return this.caption.showText; }

  captionNameFor(card: Card): string {
    return cardCaptionName(card, this.i18n.t('overview.cardBack'));
  }

  captionTextHtmlFor(card: Card): string {
    return cardCaptionRubiedText(card);
  }

  get isGuest(): boolean { return Network.GuestMode(); }
  get isMobileLayout(): boolean { return this.mobileLayout.isMobile; }
  get railBottomPx(): number {
    if (this.isMobileLayout && this.mobileLayout.isEdit) return 0;
    return this.isMobileLayout ? this.mobileLayout.bottomChromePx : 0;
  }
  get collapsed(): boolean { return this.handService.collapsed; }
  get isGm(): boolean { return !!PeerCursor.myCursor?.isGMMode; }
  /** GM hand-rail peek of other players (respects personal card-peek preference). */
  get showGmHandPeek(): boolean { return GmCardPeek.active; }
  get viewUserId(): string { return this.handService.viewUserId; }
  get gmPeekUserId(): string { return this.handService.gmPeekUserId; }
  get playFaceUp(): boolean { return this.handService.playFaceUp; }
  get isViewingOwnHand(): boolean { return this.viewUserId === Network.peer.userId; }
  get isPeekingOther(): boolean {
    return GmCardPeek.active && !!this.gmPeekUserId && this.gmPeekUserId !== Network.peer.userId;
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

  /** Card row / drop zone — always on when there are cards; also when expanded (empty drop zone). */
  get showCardRow(): boolean {
    return !this.collapsed || this.cards.length > 0;
  }

  /** Dashed drop band while dragging — empty hand only, pinned to viewport bottom. */
  get showDropBand(): boolean { return this.dropBandVisible; }

  private computeHudVisible(cardCount: number): boolean {
    if (this.isGuest) return false;
    if (this.isMobileLayout && this.mobileLayout.isEdit) return false;
    // Always show while GM-peeking so empty peek cannot hide the rail forever
    // (stored peek in normal browser vs empty private profile).
    if (this.isPeekingOther) return true;
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
    // Stale GM peek (IndexedDB): empty target while own hand has cards → snap back to self.
    // Only when own hand already has cards (avoids clearing a valid peek before ObjectStore sync).
    if (this.isPeekingOther) {
      const viewedEmpty = this.handService.cardsInHand().length < 1;
      const ownId = Network.peer?.userId || '';
      const ownHasCards = !!ownId && this.handService.cardsInHand(ownId).length > 0;
      if (viewedEmpty && ownHasCards) {
        this.handService.setGmPeekUserId('');
      }
    }
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
    private i18n: I18nService,
    private objectPreview: ObjectPreviewService,
    private contextMenuService: ContextMenuService,
    private chatMessageService: ChatMessageService,
  ) {}

  ngOnInit() {
    // Collapse chevron UI removed — always keep rail expanded.
    if (this.handService.collapsed) this.handService.setCollapsed(false);
    this.syncFromModel();
    this.mobileSub = this.mobileLayout.isMobile$.subscribe(() => this.requestViewUpdate(true));
    this.previewOpenedSub = wireCardHoverCaptionDismiss(this.objectPreview, this.caption, () => {
      this.captionCardId = null;
      this.changeDetector.markForCheck();
    });
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
      .on('CHANGE_GM_MODE', () => this.ngZone.run(() => this.requestViewUpdate(true)))
      .on('CHANGE_GM_CARD_PEEK', () => this.ngZone.run(() => this.requestViewUpdate(true)))
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
    this.previewOpenedSub?.unsubscribe();
    this.previewOpenedSub = null;
    if (this.hoveredCardId) {
      this.objectPreview.clearHovered(this.hoveredCardId);
      this.objectPreview.closeForObject(this.hoveredCardId);
    }
    this.caption.clear();
    this.hoveredCardId = null;
    this.captionCardId = null;
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
    setCardMergePreview(null);
  }

  toggleCollapsed() {
    this.handService.setCollapsed(!this.collapsed);
    this.requestViewUpdate(true);
  }

  onGmPeekChange(userId: string) {
    this.handService.setGmPeekUserId(userId);
    this.requestViewUpdate(true);
  }

  onPlayFaceChange(event: Event) {
    const checked = !!(event.target as HTMLInputElement)?.checked;
    this.handService.setPlayFaceUp(checked);
    this.changeDetector.markForCheck();
  }

  onCardContextMenu(event: MouseEvent, card: Card) {
    event.preventDefault();
    event.stopPropagation();
    if (!this.canEditOwnHand || !card || this.isGuest) return;
    if (!this.pointerDeviceService.isAllowedToOpenContextMenu) return;
    const actions = this.makeHandCardContextMenu(card);
    if (!actions.length) return;
    this.contextMenuService.open(
      this.pointerDeviceService.pointers[0],
      actions,
      card.name || this.i18n.t('card.unnamed'),
    );
  }

  private makeHandCardContextMenu(card: Card): ContextMenuAction[] {
    const actions: ContextMenuAction[] = [];
    actions.push({
      name: this.i18n.t('hand.menu.playFaceUp'),
      action: () => this.playCardToTable(card, true),
      materialIcon: 'visibility',
      default: true,
    });
    actions.push({
      name: this.i18n.t('hand.menu.playFaceDown'),
      action: () => this.playCardToTable(card, false),
      materialIcon: 'visibility_off',
    });
    actions.push(ContextMenuSeparator);

    const peers = this.handService.onlinePeers();
    if (peers.length > 0) {
      actions.push({
        name: this.i18n.t('hand.menu.giveTo'),
        action: null,
        materialIcon: 'person_add',
        subActions: peers.map(peer => ({
          name: peer.name,
          action: () => {
            card.moveToHand(peer.userId);
            SoundEffect.play(PresetSound.cardDraw);
            this.chatMessageService.sendOperationLog(this.i18n.t('hand.gaveTo', {
              card: card.name || this.i18n.t('card.unnamed'),
              name: peer.name,
            }));
            this.requestViewUpdate(true);
          },
        })),
      });
      actions.push(ContextMenuSeparator);
    }

    actions.push({
      name: this.i18n.t('hand.menu.discard'),
      action: () => {
        card.destroy();
        SoundEffect.play(PresetSound.sweep);
        this.requestViewUpdate(true);
      },
      materialIcon: 'delete',
    });
    return actions;
  }

  /** Place a hand card onto the table near the pointer (or slight offset from origin). */
  private playCardToTable(card: Card, faceUp: boolean) {
    if (!card || !this.canEditOwnHand) return;
    const pointer = this.pointerDeviceService.pointers[0] || { x: 0, y: 0, z: 0 };
    const local = this.coordinateService.calcTabletopLocalCoordinate(
      { x: pointer.x, y: pointer.y, z: 0 },
      this.pointerDeviceService.targetElement,
    );
    card.location.x = local.x;
    card.location.y = local.y;
    card.setLocation('table');
    if (faceUp) card.faceUp();
    else card.faceDown();
    card.raiseInTier();
    SoundEffect.play(PresetSound.cardPut);
    this.chatMessageService.sendOperationLog(faceUp
      ? this.i18n.t('card.revealedOne', { name: card.name || this.i18n.t('card.unnamed') })
      : this.i18n.t('hand.playedFaceDown', { name: card.name || this.i18n.t('card.facedown') }));
    this.requestViewUpdate(true);
  }

  onCardMouseEnter(card: Card) {
    if (!card) return;
    this.hoveredCardId = card.identifier;
    this.objectPreview.setHovered(card.identifier, () => buildCardPreviewPayload(card));
    if (!this.isDraggingCard) {
      this.captionCardId = card.identifier;
      this.caption.startIfDesktop(this.mobileLayout.isMobile);
    }
    this.changeDetector.markForCheck();
  }

  onCardMouseLeave(card: Card) {
    if (!card) return;
    if (this.hoveredCardId === card.identifier) {
      this.objectPreview.clearHovered(card.identifier);
      this.hoveredCardId = null;
    }
    if (this.captionCardId === card.identifier) {
      this.caption.clear();
      this.captionCardId = null;
    }
    this.changeDetector.markForCheck();
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
    const mergeId = nextHover
      ? null
      : findMergeTargetIdAtPoint(event.clientX, event.clientY);
    setCardMergePreview(mergeId);
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
    } else {
      this.dropCardFromHand(card, x, y);
    }
    this.requestViewUpdate(true);
  };

  private startCardDrag(event: PointerEvent, card: Card) {
    if (this.hoveredCardId) {
      this.objectPreview.clearHovered(this.hoveredCardId);
    }
    this.caption.clear();
    this.captionCardId = null;
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
    setCardMergePreview(null);
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
      width: '108px',
      height: '150px',
      zIndex: '100000',
      pointerEvents: 'none',
      filter: 'none',
      boxShadow: 'none',
      overflow: 'hidden',
      borderRadius: '4px',
    } as CSSStyleDeclaration);
    const img = document.createElement('img');
    const playUrl = this.handService.playFaceUp
      ? (card.frontImage?.url || card.imageFile?.url || '')
      : (card.backImage?.url || card.frontImage?.url || '');
    img.src = playUrl;
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
    this.dragGhost.style.transform = `translate(${x - 54}px, ${y - 75}px)`;
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

  /** Hand → stack / free card / empty table (same priority as table quick-drag). */
  private dropCardFromHand(card: Card, clientX: number, clientY: number) {
    const stackId = findCardStackIdAtPoint(clientX, clientY);
    const cardId = !stackId ? findCardIdAtPoint(clientX, clientY) : null;
    const overTable = !stackId && !cardId && this.isOverTable(clientX, clientY);
    switch (resolveQuickDragDrop(false, !!stackId, !!cardId, overTable)) {
      case 'stack': {
        const stack = ObjectStore.instance.get(stackId!) as CardStack;
        if (stack instanceof CardStack && !stack.isLocked) {
          this.handService.applyPlayFace(card);
          stack.putOnTop(card);
          SoundEffect.play(PresetSound.cardPut);
          return;
        }
        break;
      }
      case 'card': {
        const target = ObjectStore.instance.get(cardId!) as Card;
        if (target instanceof Card) {
          this.mergeHandCardOntoCard(card, target);
          return;
        }
        break;
      }
      case 'table':
        this.dropCardOnTable(card, clientX, clientY);
        return;
      default:
        card.moveToHand(Network.peer.userId);
        return;
    }
    if (this.isOverTable(clientX, clientY)) this.dropCardOnTable(card, clientX, clientY);
    else card.moveToHand(Network.peer.userId);
  }

  private mergeHandCardOntoCard(dropped: Card, target: Card) {
    if (!dropped || !target || dropped === target || target.isLocked || target.parent
      || target.location.name !== 'table') {
      dropped.moveToHand(Network.peer.userId);
      return;
    }
    const cardStack = CardStack.create(this.i18n.t('card.deckDefault'));
    cardStack.location.x = target.location.x;
    cardStack.location.y = target.location.y;
    cardStack.posZ = target.posZ;
    cardStack.location.name = target.location.name;
    cardStack.tableIdentifier = target.tableIdentifier;
    cardStack.rotate = target.rotate;
    cardStack.zindex = Math.max(dropped.zindex, target.zindex);
    cardStack.putOnBottom(target);
    this.handService.applyPlayFace(dropped);
    cardStack.putOnTop(dropped);
    SoundEffect.play(PresetSound.cardPut);
  }

  private dropCardOnTable(card: Card, clientX: number, clientY: number) {
    const pointer = { x: clientX, y: clientY, z: 0 };
    const local = this.coordinateService.calcTabletopLocalCoordinate(
      pointer,
      this.pointerDeviceService.targetElement,
    );
    card.location.x = local.x;
    card.location.y = local.y;
    card.setLocation('table');
    this.handService.applyPlayFace(card);
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
