import {
  CARD_STACK_HOLD_MS,
  CARD_STACK_QUICK_DRAG_PX,
  chooseMergePreviewId,
  HAND_RAIL_DROP_BAND_PX,
  holdProgressAt,
  isInHandDropBand,
  isMergeableCardId,
  isMergeableStackId,
  isQuickDragMove,
  resolveQuickDragDrop,
  shouldHoldHaptic,
} from './card-stack-gesture';
import { Card } from '@udonarium/card';
import { CardStack } from '@udonarium/card-stack';
import { ObjectStore } from '@udonarium/core/synchronize-object/object-store';

describe('card-stack-gesture', () => {
  it('uses 550ms hold and 8px quick-drag threshold', () => {
    expect(CARD_STACK_HOLD_MS).toBe(550);
    expect(CARD_STACK_QUICK_DRAG_PX).toBe(8);
    expect(HAND_RAIL_DROP_BAND_PX).toBe(168);
  });

  it('flags quick drag above 8px movement', () => {
    expect(isQuickDragMove(9, 0)).toBe(true);
    expect(isQuickDragMove(0, 9)).toBe(true);
    expect(isQuickDragMove(7, 0)).toBe(false);
    expect(isQuickDragMove(5, 5)).toBe(false);
  });

  it('maps elapsed time to hold progress', () => {
    expect(holdProgressAt(0)).toBe(0);
    expect(holdProgressAt(275)).toBe(0.5);
    expect(holdProgressAt(550)).toBe(1);
    expect(holdProgressAt(1100)).toBe(1);
  });

  it('fires haptic once after 400ms', () => {
    expect(shouldHoldHaptic(399, false)).toBe(false);
    expect(shouldHoldHaptic(400, false)).toBe(true);
    expect(shouldHoldHaptic(400, true)).toBe(false);
  });

  it('resolves quick-drag drop zones with hand rail priority', () => {
    expect(resolveQuickDragDrop(true, true, true, true)).toBe('hand');
    expect(resolveQuickDragDrop(true, false, false, true)).toBe('hand');
    expect(resolveQuickDragDrop(false, true, true, true)).toBe('stack');
    expect(resolveQuickDragDrop(false, false, true, true)).toBe('card');
    expect(resolveQuickDragDrop(false, false, false, true)).toBe('table');
    expect(resolveQuickDragDrop(false, false, false, false)).toBe('cancel');
  });

  describe('merge preview target selection', () => {
    let getSpy: jasmine.Spy;

    function stubStack(isLocked: boolean): CardStack {
      const stack = Object.create(CardStack.prototype) as CardStack;
      stack.isLocked = isLocked;
      return stack;
    }

    function stubCard(opts: { isLocked: boolean; locationName: string; parent?: unknown }): Card {
      const card = Object.create(Card.prototype) as Card;
      card.isLocked = opts.isLocked;
      card.location = { name: opts.locationName } as Card['location'];
      Object.defineProperty(card, 'parent', {
        configurable: true,
        get: () => opts.parent ?? null,
      });
      return card;
    }

    beforeEach(() => {
      getSpy = spyOn(ObjectStore.instance, 'get');
    });

    it('prefers an unlocked stack over a card', () => {
      const stack = stubStack(false);
      const card = stubCard({ isLocked: false, locationName: 'table' });
      getSpy.and.callFake((id: string) => (id === 'stack-1' ? stack : id === 'card-1' ? card : null));

      expect(chooseMergePreviewId('stack-1', 'card-1')).toBe('stack-1');
      expect(isMergeableStackId('stack-1')).toBe(true);
      expect(isMergeableCardId('card-1')).toBe(true);
    });

    it('suppresses preview when the stack under the pointer is locked', () => {
      const stack = stubStack(true);
      const card = stubCard({ isLocked: false, locationName: 'table' });
      getSpy.and.callFake((id: string) => (id === 'stack-1' ? stack : id === 'card-1' ? card : null));

      expect(chooseMergePreviewId('stack-1', 'card-1')).toBeNull();
      expect(isMergeableStackId('stack-1')).toBe(false);
    });

    it('skips locked or non-table free cards', () => {
      const locked = stubCard({ isLocked: true, locationName: 'table' });
      const handCard = stubCard({ isLocked: false, locationName: 'hand' });
      getSpy.and.callFake((id: string) => (id === 'locked' ? locked : id === 'hand' ? handCard : null));

      expect(chooseMergePreviewId(null, 'locked')).toBeNull();
      expect(chooseMergePreviewId(null, 'hand')).toBeNull();
      expect(isMergeableCardId('locked')).toBe(false);
      expect(isMergeableCardId('hand')).toBe(false);
    });
  });

  it('detects the bottom hand drop band', () => {
    const vh = window.innerHeight;
    const vw = window.innerWidth;
    expect(isInHandDropBand(vw / 2, vh - 20, 0)).toBe(true);
    expect(isInHandDropBand(vw / 2, 10, 0)).toBe(false);
    expect(isInHandDropBand(vw / 2, vh - 20, 80)).toBe(false);
    expect(isInHandDropBand(vw / 2, vh - 100, 80)).toBe(true);
  });
});
