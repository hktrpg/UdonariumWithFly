import { animate, keyframes, style, transition, trigger } from '@angular/animations';
import {
  AfterViewInit,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  ElementRef,
  HostListener,
  Input,
  NgZone,
  OnChanges,
  OnDestroy,
  ViewChild,
} from '@angular/core';
import { Card } from '@udonarium/card';
import { CardStack } from '@udonarium/card-stack';
import { ImageFile } from '@udonarium/core/file-storage/image-file';
import { ObjectStore } from '@udonarium/core/synchronize-object/object-store';
import { EventSystem, Network } from '@udonarium/core/system';
import { StringUtil } from '@udonarium/core/system/util/string-util';
import { MathUtil } from '@udonarium/core/system/util/math-util';
import { PeerCursor } from '@udonarium/peer-cursor';
import { PresetSound, SoundEffect } from '@udonarium/sound-effect';
import { TabletopLoadSettle } from '@udonarium/tabletop-load-settle';
import { shouldIgnoreTabletopDoubleClick } from '@udonarium/tabletop-interact';
import { LAYER_PEER_MOVABLE_Z_PX, layerPeerMovableTransform } from '@udonarium/tabletop-object-util';
import { CardStackListComponent } from 'component/card-stack-list/card-stack-list.component';
import { CardStackSettingsComponent } from 'component/card-stack-settings/card-stack-settings.component';
import { HandRailComponent } from 'component/hand-rail/hand-rail.component';
import { OpenUrlComponent } from 'component/open-url/open-url.component';
import { ObjectInteractGesture } from 'component/game-table/object-interact-gesture';
import { MovableDirective, MovableOption } from 'directive/movable.directive';
import { RotableOption } from 'directive/rotable.directive';
import { ContextMenuAction, ContextMenuSeparator, ContextMenuService, contextMenuToggleCheck } from 'service/context-menu.service';
import { I18nService } from 'service/i18n.service';
import { ImageService } from 'service/image.service';
import { PanelOption, PanelService } from 'service/panel.service';
import { PointerDeviceService } from 'service/pointer-device.service';
import {
  CARD_STACK_HOLD_MS,
  findCardIdAtPoint,
  findCardStackIdAtPoint,
  holdProgressAt,
  isQuickDragMove,
  resolveQuickDragDrop,
  shouldHoldHaptic,
} from './card-stack-gesture';
import { ModalService } from 'service/modal.service';
import { ChatMessageService } from 'service/chat-message.service';
import { CoordinateService } from 'service/coordinate.service';
import { SelectionState, TabletopSelectionService } from 'service/tabletop-selection.service';
import { TabletopActionService } from 'service/tabletop-action.service';
import { ObjectNode } from '@udonarium/core/synchronize-object/object-node';

@Component({
    selector: 'card-stack',
    templateUrl: './card-stack.component.html',
    styleUrls: ['./card-stack.component.css'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    animations: [
        trigger('shuffle', [
            transition('* => active', [
                animate('800ms ease', keyframes([
                    style({ transform: 'scale3d(0, 0, 0) rotateZ(0deg)', offset: 0 }),
                    style({ transform: 'scale3d(1.2, 1.2, 1.2) rotateZ(360deg)', offset: 0.5 }),
                    style({ transform: 'scale3d(0.75, 0.75, 0.75) rotateZ(520deg)', offset: 0.75 }),
                    style({ transform: 'scale3d(1.125, 1.125, 1.125) rotateZ(630deg)', offset: 0.875 }),
                    style({ transform: 'scale3d(1.0, 1.0, 1.0) rotateZ(720deg)', offset: 1.0 })
                ]))
            ]),
            transition('* => inverse', [
                animate('200ms ease', keyframes([
                    style({ transform: 'scale3d(1.0, 1.0, 1.0)', offset: 0 }),
                    style({ transform: 'scale3d(0.6, 1.2, 1.2)', offset: 0.5 }),
                    style({ transform: 'scale3d(0, 0.75, 0.75)', offset: 0.75 }),
                    style({ transform: 'scale3d(0.5, 1.125, 1.125)', offset: 0.875 }),
                    style({ transform: 'scale3d(1.0, 1.0, 1.0)', offset: 1.0 })
                ]))
            ])
        ]),
        trigger('bounceInOut', [
            transition('void => *', [
                animate('600ms ease', keyframes([
                    style({ transform: 'scale3d(0, 0, 0)', offset: 0 }),
                    style({ transform: 'scale3d(1.5, 1.5, 1.5)', offset: 0.5 }),
                    style({ transform: 'scale3d(0.75, 0.75, 0.75)', offset: 0.75 }),
                    style({ transform: 'scale3d(1.125, 1.125, 1.125)', offset: 0.875 }),
                    style({ transform: 'scale3d(1.0, 1.0, 1.0)', offset: 1.0 })
                ]))
            ]),
            transition('* => void', [
                animate(100, style({ transform: 'scale3d(0, 0, 0)' }))
            ])
        ]),
    ],
    standalone: false
})
export class CardStackComponent implements OnChanges, AfterViewInit, OnDestroy {
  get skipEnterBounce(): boolean { return TabletopLoadSettle.skipEnterAnimation; }
  @Input() cardStack: CardStack = null;
  @Input() is3D: boolean = false;

  get name(): string { return this.cardStack.name; }
  get rotate(): number { return this.cardStack.rotate; }
  set rotate(rotate: number) { this.cardStack.mutateAppearance(() => { this.cardStack.rotate = rotate; }); }
  get zindex(): number { return this.cardStack.zindex; }
  get isShowTotal(): boolean { return this.cardStack.isShowTotal; }
  get cards(): Card[] { return this.cardStack.cards; }
  get isEmpty(): boolean { return this.cardStack.isEmpty; }
  get size(): number {
    let card = this.cardStack.topCard;
    return card ? MathUtil.clampMin(card.size) : 2;
  }

  get hasOwner(): boolean { return this.cardStack.hasOwner; }
  get ownerIsOnline(): boolean { return this.cardStack.ownerIsOnline; }
  get ownerName(): string { return this.cardStack.ownerName; }
  get ownerColor(): string { return this.cardStack.ownerColor; }

  get topCard(): Card { return this.cardStack.topCard; }
  get coverCard(): Card { return this.cardStack.coverCard; }
  get imageFile(): ImageFile { return this.imageService.getSkeletonOr(this.cardStack.imageFile); }

  /**
   * Deck height in table Z (px). Scales with count so a full pile reads as a real block.
   * Tokens ride this height via MovableSelectionSynchronizer (see CardStack.visualHeightPx).
   */
  get stackHeightPx(): number {
    return this.cardStack?.visualHeightPx ?? 0;
  }

  get hasStackThickness(): boolean {
    return this.stackHeightPx > 0;
  }

  get stackTopTransform(): string {
    const h = this.stackHeightPx;
    return h > 0 ? `translateZ(${h}px)` : '';
  }

  /** Hold ring must sit above stack underlay/top translateZ or it is occluded. */
  get holdRingTransform(): string {
    return `translateZ(${this.stackHeightPx + 16}px)`;
  }

  /**
   * Z offsets for underlay card faces (bottom + middle). Top is rendered separately.
   * Cap layer count for perf — still looks like a solid deck, not a hollow box.
   */
  get stackUnderlayZs(): number[] {
    const h = this.stackHeightPx;
    const n = this.cards.length;
    if (h < 1 || n <= 1) return [];
    // faces including top; underlays = faces - 1
    const faces = Math.min(n, Math.max(2, Math.min(12, Math.round(h / 2) + 2)));
    const underlays = faces - 1;
    const zs: number[] = [];
    for (let i = 0; i < underlays; i++) {
      zs.push(Math.round((h * i) / (faces - 1) * 100) / 100);
    }
    return zs;
  }

  get selectionState(): SelectionState { return this.selectionService.state(this.cardStack); }
  get isSelected(): boolean { return this.selectionState !== SelectionState.NONE; }
  get isMagnetic(): boolean { return this.selectionState === SelectionState.MAGNETIC; }

  animeState: string = 'inactive';

  private iconHiddenTimer: NodeJS.Timeout = null;
  get isIconHidden(): boolean { return this.iconHiddenTimer != null };

  get rubiedText(): string { return StringUtil.rubyToHtml(StringUtil.escapeHtml(this.coverCard.text)) }

  get isLocked(): boolean { return this.cardStack ? this.cardStack.isLocked : false; }
  set isLocked(isLocked: boolean) { if (this.cardStack) { this.cardStack.mutateAppearance(() => { this.cardStack.isLocked = isLocked; }); } }

  get stackMovableDisabled(): boolean { return this.isLocked || this.suppressStackMovable; }

  @ViewChild(MovableDirective) private movableDir: MovableDirective;

  holdProgress = 0;

  private holdTimer: ReturnType<typeof setTimeout> | null = null;
  private holdStartedAt = 0;
  private holdVibrated = false;
  private holdProgressFrame = 0;
  private suppressStackMovable = false;
  private quickDragging = false;
  /** Top card identifier at drag start — stack is not mutated until drop commits. */
  private quickDragPeekId = '';
  private quickDragGhost: HTMLElement | null = null;
  private quickPointerId = -1;
  private pointerStartX = 0;
  private pointerStartY = 0;
  private holdComplete = false;
  private handDropPreviewActive = false;
  private handDropPreviewHover = false;

  gridSize: number = 50;

  movableOption: MovableOption = {};
  rotableOption: RotableOption = {};

  viewRotateZ = 10;

  get isInverse(): boolean {
    const rotate = Math.abs(this.viewRotateZ + this.rotate) % 360;
    return 90 < rotate && rotate < 270
  }

  private interactGesture: ObjectInteractGesture = null;

  constructor(
    private ngZone: NgZone,
    private contextMenuService: ContextMenuService,
    private panelService: PanelService,
    private elementRef: ElementRef<HTMLElement>,
    private changeDetector: ChangeDetectorRef,
    private selectionService: TabletopSelectionService,
    private imageService: ImageService,
    private pointerDeviceService: PointerDeviceService,
    private modalService: ModalService,
    private chatMessageService: ChatMessageService,
    private tabletopActionService: TabletopActionService,
    private coordinateService: CoordinateService,
    private i18n: I18nService
  ) { }

  GuestMode() {
    return Network.GuestMode();
  }


  ngOnChanges(): void {
    EventSystem.unregister(this);
    EventSystem.register(this)
      .on('SHUFFLE_CARD_STACK', event => {
        if (event.data.identifier === this.cardStack.identifier) {
          this.animeState = 'active';
          this.changeDetector.markForCheck();
        }
      })
      .on('INVERSE_CARD_STACK', event => {
        if (event.data.identifier === this.cardStack.identifier) {
          this.animeState = 'inverse';
          this.changeDetector.markForCheck();
        }
      })
      .on('UPDATE_GAME_OBJECT', event => {
        let object = ObjectStore.instance.get(event.data.identifier);
        if (!this.cardStack || !object) return;
        if ((this.cardStack === object)
          || (object instanceof ObjectNode && this.cardStack.contains(object))
          || (object instanceof PeerCursor && object.userId === this.cardStack.owner)) {
          this.changeDetector.markForCheck();
        }
      })
      .on<object>('TABLE_VIEW_ROTATE', -1000, event => {
        this.viewRotateZ = event.data['z'];
        this.changeDetector.markForCheck();
      })
      .on('CARD_STACK_DECREASED', event => {
        if (event.data.cardStackIdentifier === this.cardStack.identifier && this.cardStack) this.changeDetector.markForCheck();
      })
      .on(`UPDATE_GAME_OBJECT/aliasName/${PeerCursor.aliasName}`, event => {
        let object = ObjectStore.instance.get<PeerCursor>(event.data.identifier);
        if (this.cardStack && object && object.userId === this.cardStack.owner) {
          this.changeDetector.markForCheck();
        }
      })
      .on(`UPDATE_GAME_OBJECT/identifier/${this.cardStack?.identifier}`, event => {
        this.changeDetector.markForCheck();
      })
      .on(`UPDATE_OBJECT_CHILDREN/identifier/${this.cardStack?.identifier}`, event => {
        this.changeDetector.markForCheck();
      })
      .on('SYNCHRONIZE_FILE_LIST', event => {
        this.changeDetector.markForCheck();
      })
      .on('UPDATE_FILE_RESOURE', event => {
        this.changeDetector.markForCheck();
      })
      .on(`UPDATE_SELECTION/identifier/${this.cardStack?.identifier}`, event => {
        this.changeDetector.markForCheck();
      })
      .on('DISCONNECT_PEER', event => {
        let cursor = PeerCursor.findByPeerId(event.data.peerId);
        if (!cursor || this.cardStack.owner === cursor.userId) this.changeDetector.markForCheck();
      });
    this.movableOption = {
      tabletopObject: this.cardStack,
      transformCssOffset: layerPeerMovableTransform(),
      colideLayers: ['terrain', 'text-note']
    };
    this.rotableOption = {
      tabletopObject: this.cardStack
    };
  }

  ngAfterViewInit() {
    this.ngZone.runOutsideAngular(() => {
      this.interactGesture = new ObjectInteractGesture(this.elementRef.nativeElement);
    });

    this.interactGesture.onstart = this.onInputStart.bind(this);
    this.interactGesture.oninteract = this.onDoubleClick.bind(this);
  }

  ngOnDestroy() {
    this.cleanupQuickDragListeners();
    this.clearHoldTimer();
    this.removeQuickDragGhost();
    this.interactGesture.destroy();
    EventSystem.unregister(this);
  }

  animationShuffleStarted(event: any) {

  }

  animationShuffleDone(event: any) {
    this.animeState = 'inactive';
    this.changeDetector.markForCheck();
  }

  @HostListener('carddrop', ['$event'])
  onCardDrop(e) {
    if (this.GuestMode()) return;
    if (this.cardStack === e.detail || (e.detail instanceof Card === false && e.detail instanceof CardStack === false)) {
      return;
    }

    if (e.detail instanceof Card) {
      let card: Card = e.detail;
      let distance: number = this.cardStack.calcSqrDistance(card);
      if (distance < 50 ** 2) {
        e.stopPropagation();
        e.preventDefault();
        this.chatMessageService.sendOperationLog(this.i18n.t('stack.putCard', {
        card: card.isFront ? (card.name == '' ? this.i18n.t('card.unnamed') : card.name) : this.i18n.t('card.facedown'),
        stack: this.stackDisplayName()
      }));
        this.cardStack.putOnTop(card);
      }
    } else if (e.detail instanceof CardStack) {
      let cardStack: CardStack = e.detail;
      let distance: number = this.cardStack.calcSqrDistance(cardStack);
      if (distance < 50 ** 2) {
        e.stopPropagation();
        e.preventDefault();
        this.chatMessageService.sendOperationLog(this.i18n.t('stack.putAll', {
        from: cardStack.name == '' ? this.i18n.t('stack.unnamed') : cardStack.name,
        to: this.stackDisplayName()
      }));
        this.concatStack(cardStack);
      }
    }
  }

  onDoubleClick(e?: Event) {
    if (shouldIgnoreTabletopDoubleClick(e)) return;
    e?.stopPropagation();
    this.showDetail(this.cardStack);
  }

  @HostListener('dragstart', ['$event'])
  onDragstart(e) {
    e.stopPropagation();
    e.preventDefault();
  }

  onInputStart(e: MouseEvent | TouchEvent) {
    if (this.GuestMode()) return;
    // TODO: 想更好的做法
    if (this.isLocked) {
      this.cardStack.raiseInTier();
      EventSystem.trigger('DRAG_LOCKED_OBJECT', {});
      return;
    }

    EventSystem.trigger('SELECT_TABLETOP_OBJECT', { identifier: this.cardStack.identifier, className: 'GameCharacter' });
    this.ngZone.run(() => {
      this.cardStack.raiseInTier();
      this.startIconHiddenTimer();
    });
  }

  onStackPointerDown(event: PointerEvent) {
    if (this.GuestMode() || event.button !== 0) return;
    event.stopPropagation();
    this.resetQuickDragState();
    // Suppress movable immediately so the companion mousedown cannot start a stack drag.
    this.suppressStackMovable = true;
    this.changeDetector.detectChanges();
    this.pointerStartX = event.clientX;
    this.pointerStartY = event.clientY;
    this.quickPointerId = event.pointerId;
    this.holdStartedAt = Date.now();
    this.holdVibrated = false;
    this.holdProgress = 0;
    this.holdTimer = setTimeout(() => this.onHoldTimerComplete(event), CARD_STACK_HOLD_MS);
    this.scheduleHoldProgressFrame();
    document.addEventListener('pointermove', this.onQuickPointerMove);
    document.addEventListener('pointerup', this.onQuickPointerUp);
    document.addEventListener('pointercancel', this.onQuickPointerUp);
    this.changeDetector.markForCheck();
  }

  private onHoldTimerComplete(event: PointerEvent) {
    this.holdTimer = null;
    if (this.isLocked) {
      this.resetQuickDragState();
      return;
    }
    this.holdComplete = true;
    this.suppressStackMovable = false;
    this.holdProgress = 0;
    this.ngZone.run(() => {
      this.onInputStart(event);
      this.changeDetector.detectChanges();
      this.movableDir?.startDeferredDrag({
        pageX: event.pageX,
        pageY: event.pageY,
        clientX: event.clientX,
        clientY: event.clientY,
      });
      this.changeDetector.markForCheck();
    });
  }

  private onQuickPointerMove = (event: PointerEvent) => {
    if (event.pointerId !== this.quickPointerId) return;
    const dx = event.clientX - this.pointerStartX;
    const dy = event.clientY - this.pointerStartY;

    if (!this.quickDragging && !this.holdComplete && this.holdTimer && isQuickDragMove(dx, dy)) {
      this.clearHoldTimer();
      this.startQuickCardDrag(event);
      return;
    }

    if (this.quickDragging) {
      this.moveQuickDragGhost(event.clientX, event.clientY);
      const overHand = HandRailComponent.isDropTargetAt(event.clientX, event.clientY);
      const overStack = !overHand
        && !!findCardStackIdAtPoint(event.clientX, event.clientY, this.cardStack.identifier);
      const overCard = !overHand && !overStack && !!findCardIdAtPoint(event.clientX, event.clientY);
      const overTable = !overHand && !overStack && !overCard && this.isOverTable(event.clientX, event.clientY);
      this.emitHandDropPreview(true, overHand);
      EventSystem.trigger('TABLE_DROP_PREVIEW', { active: overTable });
    }
  };

  private onQuickPointerUp = (event: PointerEvent) => {
    if (event.pointerId !== this.quickPointerId) return;
    this.cleanupQuickDragListeners();
    this.emitHandDropPreview(false);
    EventSystem.trigger('TABLE_DROP_PREVIEW', { active: false });

    if (this.quickDragging && this.quickDragPeekId) {
      this.finishQuickCardDrag(event.clientX, event.clientY);
    } else {
      this.clearHoldTimer();
    }

    this.resetQuickDragState();
    this.changeDetector.markForCheck();
  };

  private startQuickCardDrag(event: PointerEvent) {
    const top = this.cardStack?.topCard;
    if (!top) {
      this.resetQuickDragState();
      return;
    }
    this.quickDragging = true;
    this.quickDragPeekId = top.identifier;
    SoundEffect.play(PresetSound.cardPick);
    this.createQuickDragGhost(top, event.clientX, event.clientY);
    this.emitHandDropPreview(
      true,
      HandRailComponent.isDropTargetAt(event.clientX, event.clientY),
    );
    this.changeDetector.markForCheck();
  }

  private finishQuickCardDrag(clientX: number, clientY: number) {
    if (!this.quickDragPeekId || this.cardStack.topCard?.identifier !== this.quickDragPeekId) {
      this.removeQuickDragGhost();
      this.quickDragging = false;
      this.quickDragPeekId = '';
      return;
    }

    const overHand = HandRailComponent.isDropTargetAt(clientX, clientY);
    const otherStackId = !overHand
      ? findCardStackIdAtPoint(clientX, clientY, this.cardStack.identifier)
      : null;
    const cardId = !overHand && !otherStackId ? findCardIdAtPoint(clientX, clientY) : null;
    const overTable = !overHand && !otherStackId && !cardId && this.isOverTable(clientX, clientY);
    const dropTarget = resolveQuickDragDrop(overHand, !!otherStackId, !!cardId, overTable);

    if (dropTarget === 'hand' || dropTarget === 'table' || dropTarget === 'card' || dropTarget === 'stack') {
      const card = this.cardStack.drawCard();
      if (!card) return;
      if (dropTarget === 'hand') {
        HandRailComponent.acceptQuickDragCard(card);
      } else if (dropTarget === 'stack') {
        const target = ObjectStore.instance.get(otherStackId!) as CardStack;
        if (target instanceof CardStack) {
          target.putOnTop(card);
          SoundEffect.play(PresetSound.cardPut);
        } else {
          this.placeQuickDragOnTable(card, clientX, clientY);
        }
      } else if (dropTarget === 'card') {
        const target = ObjectStore.instance.get(cardId!) as Card;
        if (target instanceof Card) this.mergeDrawnCardOntoCard(card, target);
        else this.placeQuickDragOnTable(card, clientX, clientY);
      } else {
        this.placeQuickDragOnTable(card, clientX, clientY);
      }
    }
    // Dropped on same stack or outside valid zones: peek only — stack unchanged.

    this.removeQuickDragGhost();
    this.quickDragging = false;
    this.quickDragPeekId = '';
  }

  private placeQuickDragOnTable(card: Card, clientX: number, clientY: number) {
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

  private mergeDrawnCardOntoCard(dropped: Card, target: Card) {
    if (!dropped || !target || dropped === target || target.isLocked || target.parent) {
      dropped.owner = '';
      dropped.setLocation('table', this.cardStack.tableIdentifier);
      dropped.raiseInTier();
      SoundEffect.play(PresetSound.cardPut);
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
    cardStack.putOnTop(dropped);
    SoundEffect.play(PresetSound.cardPut);
  }

  private isOverTable(clientX: number, clientY: number): boolean {
    const layer = document.querySelector('#app-table-layer');
    if (!layer) return false;
    const rect = layer.getBoundingClientRect();
    return clientX >= rect.left && clientX <= rect.right
      && clientY >= rect.top && clientY <= rect.bottom;
  }

  private createQuickDragGhost(topCard: Card, x: number, y: number) {
    this.removeQuickDragGhost();
    const ghost = document.createElement('div');
    ghost.className = 'hand-rail-drag-ghost';
    const w = this.size * this.gridSize;
    const h = Math.round(w * 1.25);
    Object.assign(ghost.style, {
      position: 'fixed',
      top: '0',
      left: '0',
      width: `${w}px`,
      height: `${h}px`,
      zIndex: '100000',
      pointerEvents: 'none',
      willChange: 'transform',
      filter: 'drop-shadow(0 6px 12px rgba(0, 0, 0, 0.5))',
    } as CSSStyleDeclaration);
    if (this.isLocked) {
      ghost.classList.add('is-locked-quick-drag');
      ghost.style.outline = '2px dashed rgba(251, 191, 36, 0.95)';
      ghost.style.outlineOffset = '2px';
      ghost.style.borderRadius = '6px';
    }
    const img = document.createElement('img');
    const cover = this.cardStack.coverCard;
    const pileFaceDown = !!(cover && !cover.isFront);
    const visible = pileFaceDown
      ? cover.backImage
      : (topCard.isFront ? topCard.frontImage : topCard.backImage);
    const ghostRotate = pileFaceDown ? cover.rotate : topCard.rotate;
    img.src = visible?.url || '';
    img.alt = '';
    img.draggable = false;
    Object.assign(img.style, {
      width: '100%',
      height: '100%',
      objectFit: 'contain',
      display: 'block',
      pointerEvents: 'none',
      transform: `rotate(${ghostRotate}deg)`,
    } as CSSStyleDeclaration);
    ghost.appendChild(img);
    document.body.appendChild(ghost);
    this.quickDragGhost = ghost;
    this.moveQuickDragGhost(x, y);
  }

  private moveQuickDragGhost(x: number, y: number) {
    if (!this.quickDragGhost) return;
    const w = this.size * this.gridSize;
    const h = Math.round(w * 1.25);
    this.quickDragGhost.style.transform = `translate(${x - w / 2}px, ${y - h / 2}px)`;
  }

  private removeQuickDragGhost() {
    if (this.quickDragGhost?.parentElement) {
      this.quickDragGhost.parentElement.removeChild(this.quickDragGhost);
    }
    this.quickDragGhost = null;
  }

  private clearHoldTimer() {
    if (this.holdTimer) {
      clearTimeout(this.holdTimer);
      this.holdTimer = null;
    }
    cancelAnimationFrame(this.holdProgressFrame);
    this.holdProgressFrame = 0;
    this.holdProgress = 0;
  }

  private scheduleHoldProgressFrame() {
    cancelAnimationFrame(this.holdProgressFrame);
    this.holdProgressFrame = requestAnimationFrame(() => this.updateHoldProgress());
  }

  private updateHoldProgress() {
    if (!this.holdTimer) {
      this.holdProgress = 0;
      return;
    }
    const elapsed = Date.now() - this.holdStartedAt;
    this.holdProgress = holdProgressAt(elapsed);
    if (shouldHoldHaptic(elapsed, this.holdVibrated) && typeof navigator !== 'undefined' && navigator.vibrate) {
      navigator.vibrate(12);
      this.holdVibrated = true;
    }
    if (this.holdProgress < 1) {
      this.scheduleHoldProgressFrame();
    }
    this.ngZone.run(() => this.changeDetector.markForCheck());
  }

  private cleanupQuickDragListeners() {
    document.removeEventListener('pointermove', this.onQuickPointerMove);
    document.removeEventListener('pointerup', this.onQuickPointerUp);
    document.removeEventListener('pointercancel', this.onQuickPointerUp);
  }

  private resetQuickDragState() {
    this.removeQuickDragGhost();
    this.emitHandDropPreview(false);
    this.clearHoldTimer();
    this.suppressStackMovable = false;
    this.quickDragging = false;
    this.quickDragPeekId = '';
    this.quickPointerId = -1;
    this.holdComplete = false;
    this.holdVibrated = false;
    this.holdStartedAt = 0;
  }

  private emitHandDropPreview(active: boolean, hover = false) {
    if (this.handDropPreviewActive === active && this.handDropPreviewHover === hover) return;
    this.handDropPreviewActive = active;
    this.handDropPreviewHover = hover;
    EventSystem.trigger('HAND_RAIL_DROP_PREVIEW', { active, hover });
  }

  get holdRingDashOffset(): number {
    const circumference = 2 * Math.PI * 22;
    return circumference * (1 - this.holdProgress);
  }

  readonly holdRingCircumference = 2 * Math.PI * 22;

  @HostListener('contextmenu', ['$event'])
  onContextMenu(e: Event) {
    e.stopPropagation();
    e.preventDefault();


    if (this.GuestMode()) return;
    if (!this.pointerDeviceService.isAllowedToOpenContextMenu) return;
    this.tabletopActionService.ensureObjectSelected(this.cardStack);
    let position = this.pointerDeviceService.pointers[0];

    let menuActions: ContextMenuAction[] = [];
    let title = this.name;

    if (this.isMultiSelectedStacks()) {
      menuActions = this.makeSelectionContextMenu();
      title = this.i18n.t('stack.selectedCount', { count: this.selectedCardStacks().length });
    } else {
      menuActions = menuActions.concat(this.makeSelectionContextMenu());
      menuActions = menuActions.concat(this.makeContextMenu());
    }
    menuActions = this.tabletopActionService.withClipboardMenuPrefix(menuActions);

    this.contextMenuService.open(position, menuActions, title);
  }

  onMove() {
    this.contextMenuService.close();
    SoundEffect.play(PresetSound.cardPick);
  }

  onMoved() {
    SoundEffect.play(PresetSound.cardPut);
    this.ngZone.run(() => this.dispatchCardDropEvent());
  }

  private drawCard(): Card {
    let card = this.cardStack.drawCard();
    if (card) {
      card.location.x += 100 + (Math.random() * 50);
      card.location.y += 25 + (Math.random() * 50);
      card.setLocation(this.cardStack.location.name, this.cardStack.tableIdentifier);
    }
    return card;
  }

  textShadowCss(textColor: string): string {
    const shadow = StringUtil.textShadowColor(textColor);
    return `${shadow} 0px 0px 2px, 
    ${shadow} 0px 0px 2px, 
    ${shadow} 0px 0px 2px, 
    ${shadow} 0px 0px 2px, 
    ${shadow} 0px 0px 2px, 
    ${shadow} 0px 0px 2px,
    ${shadow} 0px 0px 2px,
    ${shadow} 0px 0px 2px`;
  }

  private breakStack() {
    let cards = this.cardStack.drawCardAll().reverse();
    for (let card of cards) {
      card.location.x += 25 - (Math.random() * 50);
      card.location.y += 25 - (Math.random() * 50);
      card.raiseInTier();
      card.setLocation(this.cardStack.location.name, this.cardStack.tableIdentifier);
    }
    this.cardStack.setLocation('graveyard');
    this.cardStack.destroy();
  }

  private splitStack(split: number) {
    if (this.GuestMode()) return;
    if (split < 2) return;
    let cardStacks: CardStack[] = [];
    for (let i = 0; i < split; i++) {
      let cardStack = CardStack.create(`${this.cardStack.name}_${('0' + (i+1).toString()).slice(-2)}`);
      cardStack.location.x = this.cardStack.location.x + 50 - (Math.random() * 100);
      cardStack.location.y = this.cardStack.location.y + 50 - (Math.random() * 100);
      cardStack.posZ = this.cardStack.posZ;
      cardStack.location.name = this.cardStack.location.name;
      cardStack.tableIdentifier = this.cardStack.tableIdentifier;
      cardStack.rotate = this.rotate;
      cardStack.raiseInTier();
      cardStacks.push(cardStack);
    }

    let cards = this.cardStack.drawCardAll();
    this.cardStack.setLocation('graveyard');
    this.cardStack.destroy();

    let num = 0;
    let splitIndex = (cards.length / split) * (num + 1);
    for (let i = 0; i < cards.length; i++) {
      cardStacks[num].putOnBottom(cards[i]);
      if (splitIndex <= i + 1) {
        num++;
        splitIndex = (cards.length / split) * (num + 1);
      }
    }
  }

  private concatStack(topStack: CardStack, bottomStack: CardStack = this.cardStack) {
    if (this.GuestMode()) return;
    let newCardStack = CardStack.create(bottomStack.name);
    newCardStack.location.name = bottomStack.location.name;
    newCardStack.tableIdentifier = bottomStack.tableIdentifier;
    newCardStack.location.x = bottomStack.location.x;
    newCardStack.location.y = bottomStack.location.y;
    newCardStack.posZ = bottomStack.posZ;
    newCardStack.zindex = topStack.zindex;
    newCardStack.rotate = bottomStack.rotate;

    let bottomCards: Card[] = bottomStack.drawCardAll();
    let topCards: Card[] = topStack.drawCardAll();
    for (let card of topCards.concat(bottomCards)) newCardStack.putOnBottom(card);

    bottomStack.setLocation('');
    bottomStack.destroy();

    topStack.setLocation('');
    topStack.destroy();
  }

  private dispatchCardDropEvent() {
    let element: HTMLElement = this.elementRef.nativeElement;
    let parent = element.parentElement;
    if (!parent) return;
    let children = parent.children;
    for (let i = 0; i < children.length; i++) {
      // Fresh event per sibling — a shared event stopped by one host never reaches the rest.
      let event = new CustomEvent('carddrop', { detail: this.cardStack, bubbles: true });
      children[i].dispatchEvent(event);
    }
  }

  private selectedCardStacks(): CardStack[] {
    return this.selectionService.objects.filter(
      object => object.aliasName === this.cardStack.aliasName
    ) as CardStack[];
  }

  private isMultiSelectedStacks(): boolean {
    return this.isSelected && this.selectedCardStacks().length > 1;
  }

  private makeSelectionContextMenu(): ContextMenuAction[] {
    if (this.selectionService.size <= 1) return [];

    let actions: ContextMenuAction[] = [];

    let size = this.cardStack.topCard?.size ?? 2;
    let objectPosition = {
      x: this.cardStack.location.x + (size * this.gridSize) / 2,
      y: this.cardStack.location.y + (size * this.gridSize) / 2,
      z: this.cardStack.posZ
    };
    actions.push({
      name: this.i18n.t('stack.menu.1'),
      hotkey: 'T',
      action: () => this.tabletopActionService.congregateOrMergeSelection(objectPosition),
    });

    if (this.isMultiSelectedStacks()) {
      let selectedCardStacks = () => this.selectedCardStacks();
      actions.push(
        {
          name: this.i18n.t('stack.menu.2'), action: null, subActions: [
            {
              name: this.i18n.t('stack.menu.3'), action: () => {
                selectedCardStacks().forEach(cardStack => cardStack.faceUpAll());
                SoundEffect.play(PresetSound.cardDraw);
              }
            },
            {
              name: this.i18n.t('stack.menu.4'), action: () => {
                selectedCardStacks().forEach(cardStack => cardStack.faceDownAll());
                SoundEffect.play(PresetSound.cardDraw);
              }
            },
            {
              name: this.i18n.t('stack.menu.5'), action: () => {
                selectedCardStacks().forEach(cardStack => cardStack.uprightAll());
                SoundEffect.play(PresetSound.cardDraw);
              }
            },
            ContextMenuSeparator,
            {
              name: this.i18n.t('stack.menu.6'), action: () => {
                SoundEffect.play(PresetSound.cardShuffle);
                selectedCardStacks().forEach(cardStack => {
                  cardStack.shuffle();
                  EventSystem.call('SHUFFLE_CARD_STACK', { identifier: cardStack.identifier });
                });
              }
            },
          ]
        },
        ContextMenuSeparator,
        {
          name: this.i18n.t('char.clearSelection'),
          action: () => this.selectionService.clear()
        },
      );
    }
    actions.push(ContextMenuSeparator);
    return actions;
  }

  private makeContextMenu(): ContextMenuAction[] {
    let actions: ContextMenuAction[] = [
      contextMenuToggleCheck({
        get: () => this.isLocked,
        set: (v) => {
          this.isLocked = v;
          SoundEffect.play(v ? PresetSound.lock : PresetSound.unlock);
        },
        on: this.i18n.t('stack.menu.7'),
        off: this.i18n.t('stack.menu.8'),
        hotkey: 'L',
      }),
      ContextMenuSeparator,
      {
        name: this.i18n.t('stack.menu.9'), action: () => {
          const card = this.drawCard();
          if (card) {
            SoundEffect.play(PresetSound.cardDraw);
            let text: string;
            if (card.isFront) {
              text = this.i18n.t('stack.drewCard', {
                stack: this.cardStack.name,
                card: card.name == '' ? this.i18n.t('card.unnamed') : card.name
              });
            } else {
              text = this.i18n.t('stack.drewFacedown', { stack: this.cardStack.name });
            }
            this.chatMessageService.sendOperationLog(text);
          }
        },
        default: this.cards.length > 0,
        disabled: this.cards.length == 0
      },
      {
        name: this.i18n.t('stack.menu.10'), action: null,
        subActions: [2, 3, 4, 5, 10].map(n => {
          return {
            name: this.i18n.t('stack.nCards', { count: n }),
            action: () => {
              const cards: Card[] = [];
              for (let i = 0; i < n; i++) {
                const card = this.drawCard();
                if (card) {
                  cards.push(card);
                  if (i == 0 || i == 3 || i == 9) SoundEffect.play(PresetSound.cardDraw);
                }
              }
              if (cards.length > 0) {
                const frontCards = cards.filter(card => card.isFront);
                if (frontCards.length == 0) {
                  this.chatMessageService.sendOperationLog(this.i18n.t('stack.drewNFacedown', { stack: this.stackDisplayName(), count: cards.length }));
                } else {
                  const counter = new Map();
                  for (const card of frontCards) {
                    const name = card.name == '' ? this.i18n.t('card.unnamed') : card.name;
                    let count = counter.get(name) || 0;
                    count += 1;
                    counter.set(name, count);
                  }
                  let text = this.i18n.t('stack.drewMulti', {
                    stack: this.stackDisplayName(),
                    cards: [...counter.keys()].map(key => key + (counter.get(key) <= 1 ? '' : this.i18n.t('stack.times', { count: counter.get(key) }))).join(this.i18n.t('common.listSep'))
                  });
                  if (frontCards.length !== cards.length) {
                    text += this.i18n.t('stack.alsoFacedown', { count: cards.length - frontCards.length });
                  }
                  this.chatMessageService.sendOperationLog(text);
                }
              }
            }
          };
        }),
        disabled: this.cards.length == 0
      },
      ContextMenuSeparator,
      (this.cards.length == 0 || !this.cardStack.coverCard?.isFront ? {
        name: this.i18n.t('stack.menu.11'), action: () => {
          if (!this.cardStack.coverCard) return;
          if (!this.cardStack.coverCard.isFront) this.chatMessageService.sendOperationLog(this.i18n.t('stack.revealedTop', {
            stack: this.stackDisplayName(),
            card: this.cardStack.coverCard.name == '' ? this.i18n.t('card.unnamed') : this.cardStack.coverCard.name
          }));
          this.cardStack.faceUp();
          SoundEffect.play(PresetSound.cardDraw);
        },
        disabled: this.cards.length == 0,
        hotkey: 'F',
      } : {
        name: this.i18n.t('stack.menu.12'), action: () => {
          this.cardStack.faceDown();
          SoundEffect.play(PresetSound.cardDraw);
        },
        disabled: this.cards.length == 0,
        hotkey: 'F',
      }),
      ContextMenuSeparator,
      {
        name: this.i18n.t('stack.menu.13'), action: () => {
          //if (!this.cardStack.topCard) return;
          //if (!this.cardStack.topCard.isFront) this.chatMessageService.sendOperationLog(`${this.cardStack.name} 全部翻正面，並公開最上方的 ${this.cardStack.topCard.name}`);
          this.cardStack.faceUpAll();
          SoundEffect.play(PresetSound.cardDraw);
        },
        disabled: this.cards.length == 0
      },
      {
        name: this.i18n.t('stack.menu.14'), action: () => {
          this.cardStack.faceDownAll();
          SoundEffect.play(PresetSound.cardDraw);
        },
        disabled: this.cards.length == 0
      },
      {
        name: this.i18n.t('stack.menu.15'), action: () => {
          this.cardStack.uprightAll();
          SoundEffect.play(PresetSound.cardDraw);
        },
        disabled: this.cards.length == 0
      },
      ContextMenuSeparator,
      {
        name: this.i18n.t('stack.menu.16'),
        hotkey: 'R',
        action: () => {
          this.cardStack.shuffle();
          SoundEffect.play(PresetSound.cardShuffle);
          EventSystem.call('SHUFFLE_CARD_STACK', { identifier: this.cardStack.identifier });
        },
        disabled: this.cards.length == 0
      },
      { name: this.i18n.t('stack.menu.17'), action: () => {
        this.showStackList(this.cardStack);
        this.chatMessageService.sendOperationLog(this.i18n.t('stack.viewedList', { stack: this.stackDisplayName() }));
      }, disabled: this.cards.length == 0 },
      ContextMenuSeparator,
      contextMenuToggleCheck({
        get: () => this.isShowTotal,
        set: (v) => { this.cardStack.isShowTotal = v; },
        on: this.i18n.t('stack.menu.18'),
        off: this.i18n.t('stack.menu.19'),
      }),
      { name: this.i18n.t('stack.menu.20'), action: () => { if (this.cardStack.topCard) this.cardStack.unifyCardsSize(this.cardStack.topCard.size); }, disabled: this.cards.length == 0 },
      ContextMenuSeparator,
      {
        name: this.i18n.t('stack.menu.21'),
        subActions: [
          {
            name: this.i18n.t('stack.menu.22'),
            action: () => {
              this.splitStack(Network.peerIds.length);
              SoundEffect.play(PresetSound.cardDraw);
            }
          },
          ContextMenuSeparator,
          ...[2, 3, 4, 5, 6].map(num => {
            return {
              name: this.i18n.t('stack.splitInto', { count: num }),
              action: () => {
                this.splitStack(num);
                SoundEffect.play(PresetSound.cardDraw);
              }
            }
          })
        ],
        disabled: this.cards.length == 0
      },
      {
        name: this.i18n.t('stack.menu.23'), action: () => {
          this.breakStack();
          SoundEffect.play(PresetSound.cardShuffle);
        },
        disabled: this.cards.length == 0
      },
      {
        name: this.i18n.t('stack.menu.24'), action: () => {
          this.cardStack.inverse();
          SoundEffect.play(PresetSound.cardDraw);
          SoundEffect.play(PresetSound.cardDraw);
          EventSystem.call('INVERSE_CARD_STACK', { identifier: this.cardStack.identifier });
        },
        disabled: this.cards.length == 0
      },
      ContextMenuSeparator,
      { name: this.i18n.t('stack.menu.25'), action: () => { this.showDetail(this.cardStack); } },
      (this.cardStack.getUrls().length <= 0 ? null : {
        name: this.i18n.t('stack.menu.26'), action: null,
        subActions: this.cardStack.getUrls().map((urlElement) => {
          const url = urlElement.value.toString();
          return {
            name: urlElement.name ? urlElement.name : url,
            action: () => {
              if (StringUtil.sameOrigin(url)) {
                window.open(url.trim(), '_blank', 'noopener');
              } else {
                this.modalService.open(OpenUrlComponent, { url: url, title: this.cardStack.name, subTitle: urlElement.name });
              }
            },
            disabled: !StringUtil.validUrl(url),
            error: !StringUtil.validUrl(url) ? this.i18n.t('common.invalidUrl') : null,
            isOuterLink: StringUtil.validUrl(url) && !StringUtil.sameOrigin(url)
          };
        })
      }),
      (this.cardStack.getUrls().length <= 0 ? null : ContextMenuSeparator),
      {
        name: this.i18n.t('stack.menu.28'), action: () => {
          this.cardStack.setLocation('graveyard');
          this.cardStack.destroy();
          SoundEffect.play(PresetSound.sweep);
        },
        hotkey: 'Del',
      },
    ];

    return actions;
  }

  private stackDisplayName(): string {
    return this.cardStack.name == '' ? this.i18n.t('stack.unnamed') : this.cardStack.name;
  }

  private showDetail(gameObject: CardStack) {
    if (this.GuestMode()) return;
    EventSystem.trigger('SELECT_TABLETOP_OBJECT', { identifier: gameObject.identifier, className: gameObject.aliasName });
    let title = this.i18n.t('stack.panelTitle');
    if (gameObject.name.length) title += ' - ' + gameObject.name;
    const tourId = PanelService.tourIdObjectDetail(gameObject.identifier);
    if (PanelService.bringTourPanelToFront(tourId, { title })) return;
    let coordinate = this.pointerDeviceService.pointers[0];
    let option: PanelOption = {
      title: title, left: coordinate.x - 210, top: coordinate.y - 140, width: 420, height: 320,
      tourPanelId: tourId,
      geometryKey: PanelService.sheetGeometryKey(gameObject.aliasName),
    };
    let component = this.panelService.open<CardStackSettingsComponent>(CardStackSettingsComponent, option);
    component.cardStack = gameObject;
  }

  private showStackList(gameObject: CardStack) {
    if (this.GuestMode()) return;
    EventSystem.trigger('SELECT_TABLETOP_OBJECT', { identifier: gameObject.identifier, className: gameObject.aliasName });

    let coordinate = this.pointerDeviceService.pointers[0];
    let option: PanelOption = { left: coordinate.x - 200, top: coordinate.y - 260, width: 400, height: 520 };

    this.cardStack.owner = Network.peer.userId;
    let component = this.panelService.open<CardStackListComponent>(CardStackListComponent, option);
    component.cardStack = gameObject;
  }

  private startIconHiddenTimer() {
    clearTimeout(this.iconHiddenTimer);
    this.iconHiddenTimer = setTimeout(() => {
      this.iconHiddenTimer = null;
      this.changeDetector.markForCheck();
    }, 300);
    this.changeDetector.markForCheck();
  }
}
