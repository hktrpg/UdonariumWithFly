import { Card, CardState } from './card';
import { ImageFile } from './core/file-storage/image-file';
import { SyncObject, SyncVar } from './core/synchronize-object/decorator';
import { ObjectNode } from './core/synchronize-object/object-node';
import { DataElement } from './data-element';
import { PeerCursor } from './peer-cursor';
import { TabletopObject } from './tabletop-object';
import { EventSystem, Network } from './core/system';
import { moveToBackmost, moveToTopmost, moveToTopmostInTier } from './tabletop-object-util';

@SyncObject('card-stack')
export class CardStack extends TabletopObject {
  @SyncVar() rotate: number = 0;
  @SyncVar() zindex: number = 0;
  @SyncVar() owner: string = '';
  @SyncVar() isShowTotal: boolean = true;
  @SyncVar() isLocked: boolean = false;

  /** Skip auto-destroy while bulk-emptying (inverse / drawCardAll). */
  private suppressEmptyDestroy = false;
  
  get name(): string { return this.getCommonValue('name', ''); }
  get ownerName(): string {
    return PeerCursor.findByUserId(this.owner)?.name || '';
  }
  get ownerColor(): string {
    return PeerCursor.findByUserId(this.owner)?.color || '#444444';
  }
  get hasOwner(): boolean { return !!(this.owner && this.owner.length); }
  get ownerIsOnline(): boolean { return this.hasOwner && Network.peers.some(peer => peer.userId === this.owner && peer.isOpen); }

  /** Footprint size in grid squares (from cover / top card). */
  get size(): number {
    const card = this.coverCard || this.topCard;
    return card ? card.size : 2;
  }

  /**
   * Deck thickness in table Z (px). Shared by render + token ride.
   * Scales with count so a full pile reads as a real block.
   */
  static visualHeightPx(cardCount: number): number {
    if (cardCount <= 1) return 0;
    return Math.min(24, Math.max(4, Math.round(cardCount * 0.45)));
  }

  get visualHeightPx(): number {
    return CardStack.visualHeightPx(this.cards.length);
  }

  /**
   * Top surface under a world XY point (rotated footprint).
   * Tokens use this so posZ follows stack thickness as cards are drawn.
   */
  surfaceHitAt(worldX: number, worldY: number, gridSize: number = 50): { posZ: number } | null {
    if (this.location?.name !== 'table' || this.isEmpty) return null;
    const g = gridSize > 0 ? gridSize : 50;
    const size = Math.max(0.1, this.size || 2);
    const w = size * g;
    const h = size * g * 1.25; // match card ghost aspect
    const cx = this.location.x + w / 2;
    const cy = this.location.y + h / 2;
    const rot = ((this.rotate || 0) * Math.PI) / 180;
    const dx = worldX - cx;
    const dy = worldY - cy;
    const lx = dx * Math.cos(-rot) - dy * Math.sin(-rot);
    const ly = dx * Math.sin(-rot) + dy * Math.cos(-rot);
    if (Math.abs(lx) > w / 2 || Math.abs(ly) > h / 2) return null;
    return { posZ: (this.posZ || 0) + this.visualHeightPx };
  }

  /** Tallest stack surface under the point (or null). */
  static surfaceHitAt(
    stacks: CardStack[],
    worldX: number,
    worldY: number,
    gridSize: number = 50,
  ): { posZ: number } | null {
    let best: { posZ: number } | null = null;
    for (const stack of stacks || []) {
      const hit = stack?.surfaceHitAt(worldX, worldY, gridSize);
      if (!hit) continue;
      if (!best || hit.posZ >= best.posZ) best = hit;
    }
    return best;
  }

  private get cardRoot(): ObjectNode {
    for (let node of this.children) {
      if (node.getAttribute('name') === 'cardRoot') return node;
    }
    return null;
  }
  get cards(): Card[] { return this.cardRoot ? <Card[]>this.cardRoot.children : []; }
  /** Card drawn / quick-drag target. Face-down pile: bottom of stack (reversed order). */
  get topCard(): Card {
    if (this.isEmpty) return null;
    return this.pileShowsBack() ? this.bottomCard : this.firstCard;
  }
  /** Card face shown on the pile (always the first slot). */
  get coverCard(): Card { return this.firstCard; }
  get isEmpty(): boolean { return this.cards.length < 1 }
  get imageFile(): ImageFile { return this.coverCard ? this.coverCard.imageFile : null; }

  private get firstCard(): Card { return this.isEmpty ? null : this.cards[0]; }
  private get bottomCard(): Card { return this.isEmpty ? null : this.cards[this.cards.length - 1]; }

  private isAllFaceDown(): boolean {
    return !this.isEmpty && this.cards.every(card => !card.isFront);
  }

  /** Cover card shows back — pile behaves as a face-down deck (draw from bottom). */
  private pileShowsBack(): boolean {
    return !!(this.firstCard && !this.firstCard.isFront);
  }

  private normalizeCardOnStack(card: Card) {
    card.owner = '';
    card.zindex = 0;
    let delta = Math.abs(card.rotate - this.rotate);
    if (180 < delta) delta = 360 - delta;
    card.rotate = delta <= 90 ? 0 : 180;
    this.setSamePositionFor(card);
  }

  complement(): void {
    this.cards.forEach(card => card.complement());
  }

  // ObjectNode Lifecycle
  onChildRemoved(child: ObjectNode) {
    super.onChildRemoved(child);
    if (child instanceof Card) {
      EventSystem.trigger('CARD_STACK_DECREASED', { cardStackIdentifier: this.identifier, cardIdentifier: child.identifier });
      this.destroyIfEmpty();
    }
  }

  /** Remove empty stacks from the table (no lingering "0 cards" pile). */
  destroyIfEmpty() {
    if (this.suppressEmptyDestroy || !this.isEmpty) return;
    if (this.location.name === 'graveyard') return;
    this.setLocation('graveyard');
    this.destroy();
  }

  shuffle(): Card[] {
    if (!this.cardRoot) return;
    const pileFaceDown = this.pileShowsBack();
    const allFaceDown = this.isAllFaceDown();
    const length = this.cardRoot.children.length;
    for (let card of this.cards) {
      card.index = Math.random() * length;
      // Face-down piles stay flat; random 180° spins look like cards flipped face-up.
      card.rotate = pileFaceDown ? 0 : Math.floor(Math.random() * 2) * 180;
      this.setSamePositionFor(card);
    }
    if (pileFaceDown) {
      if (allFaceDown) {
        for (const card of this.cards) {
          if (card.isFront) card.faceDown();
        }
      } else {
        if (this.firstCard?.isFront) {
          this.firstCard.faceDown();
          this.setSamePositionFor(this.firstCard);
        }
        if (this.topCard?.isFront) {
          this.topCard.faceDown();
          this.setSamePositionFor(this.topCard);
        }
      }
    }
    return this.cards;
  }

  drawCard(): Card {
    const pileFaceDown = this.pileShowsBack();
    let card = this.topCard ? this.cardRoot.removeChild(this.topCard) : null;
    if (card) {
      card.rotate += this.rotate;
      if (360 < card.rotate) card.rotate -= 360;
      this.setSamePositionFor(card);
      card.raiseInTier();
      // Drawn card must match the pile face (F may have flipped only the cover).
      if (pileFaceDown) {
        if (card.isFront) card.faceDown();
      } else if (!card.isFront) {
        card.faceUp();
      }
      if (pileFaceDown && this.topCard?.isFront) {
        this.topCard.faceDown();
        this.setSamePositionFor(this.topCard);
      }
    }
    return card;
  }

  drawCardAll(): Card[] {
    this.suppressEmptyDestroy = true;
    try {
      let cards = this.cards;
      for (let card of cards) {
        this.cardRoot.removeChild(card);
        card.rotate += this.rotate;
        this.setSamePositionFor(card);
        if (360 < card.rotate) card.rotate -= 360;
      }
      return cards;
    } finally {
      this.suppressEmptyDestroy = false;
    }
  }

  faceUp() {
    if (this.coverCard) {
      this.coverCard.faceUp();
      this.setSamePositionFor(this.coverCard);
    }
  }

  faceDown() {
    if (this.coverCard) {
      this.coverCard.faceDown();
      this.setSamePositionFor(this.coverCard);
    }
  }

  faceUpAll() {
    for (let card of this.cards) {
      card.faceUp();
      this.setSamePositionFor(card);
    }
  }

  faceDownAll() {
    for (let card of this.cards) {
      card.faceDown();
      this.setSamePositionFor(card);
    }
  }

  uprightAll() {
    for (let card of this.cards) {
      card.rotate = 0;
      this.setSamePositionFor(card);
    }
  }

  inverse() {
    this.suppressEmptyDestroy = true;
    try {
      const tmp: Card[] = [];
      while (true) {
        let card = this.firstCard ? <Card>this.cardRoot.removeChild(this.firstCard) : null;
        if (card == null) break;
        tmp.unshift(card);
        card.state = (card.state == CardState.FRONT ? CardState.BACK : CardState.FRONT);
      }
      for (let card of tmp) {
        this.putOnBottom(card);
      }
    } finally {
      this.suppressEmptyDestroy = false;
    }
  }

  unifyCardsSize(size: number): void {
    for (const card of this.cards) {
      if (card.size !== size) card.size = size;
    }
  }

  putOnTop(card: Card): Card {
    if (!this.cardRoot) return null;
    if (!this.firstCard) return this.putOnBottom(card);
    const pileFaceDown = this.pileShowsBack();
    this.normalizeCardOnStack(card);
    const placed = pileFaceDown
      ? this.cardRoot.appendChild(card)
      : this.cardRoot.prependChild(card);
    if (pileFaceDown && placed.isFront) {
      placed.faceDown();
      this.setSamePositionFor(placed);
    }
    return placed;
  }

  putOnBottom(card: Card): Card {
    if (!this.cardRoot) return null;
    const pileFaceDown = this.pileShowsBack();
    this.normalizeCardOnStack(card);
    const placed = pileFaceDown
      ? this.cardRoot.prependChild(card)
      : this.cardRoot.appendChild(card);
    if (pileFaceDown && placed.isFront) {
      placed.faceDown();
      this.setSamePositionFor(placed);
    }
    return placed;
  }

  toTopmost() {
    moveToTopmost(this);
  }

  raiseInTier() {
    moveToTopmostInTier(this);
  }

  toBackmost() {
    moveToBackmost(this);
  }

  // override
  setLocation(location: string, tableIdentifier?: string) {
    super.setLocation(location, tableIdentifier);
    let cards = this.cards;
    if (location === 'table') {
      const tableId = tableIdentifier || this.tableIdentifier || TabletopObject.resolveViewTableIdentifier();
      for (let card of cards) {
        card.addToTable(tableId, {
          x: this.location.x,
          y: this.location.y,
          posZ: this.posZ,
        });
      }
    } else {
      for (let card of cards) card.setLocation(location);
    }
  }

  private setSamePositionFor(card: Card) {
    card.location.name = this.location.name;
    card.location.x = this.location.x;
    card.location.y = this.location.y;
    card.posZ = this.posZ;
    if (this.location.name === 'table') {
      card.tablePlacements = this.tablePlacements;
      card.tableIdentifier = this.tableIdentifier;
    } else {
      card.tableIdentifier = '';
      card.tablePlacements = '';
    }
  }

  static create(name: string, identifier?: string): CardStack {
    let object: CardStack = null;

    if (identifier) {
      object = new CardStack(identifier);
    } else {
      object = new CardStack();
    }
    object.createDataElements();
    object.commonDataElement.appendChild(DataElement.create('name', name, {}, 'name_' + object.identifier));
    let cardRoot = new ObjectNode('cardRoot_' + object.identifier);
    cardRoot.setAttribute('name', 'cardRoot');
    cardRoot.initialize();
    object.appendChild(cardRoot);
    object.initialize();

    return object;
  }
}